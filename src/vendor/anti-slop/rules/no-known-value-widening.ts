import { defineRule } from "@oxlint/plugins";

import {
	classifyUnsafeDictionaryValue,
	classifyWideningTarget,
	createTypeEnvironment,
	isKnownEvidenceExpression,
	resetTypeEnvironment,
	type TypeEnvironment,
	type WideningTarget,
} from "../shared/dictionary-types.ts";
import {
	containsUnknownType,
	functionParameterBindingName,
	functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";
import { resolveVariable } from "../shared/scope.ts";
import { typeBindingVisitors } from "../shared/type-alias-resolution.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

// Kinds of pending checks. A flow kind also names how its report describes the subject.
const BINDING_SUBJECT = 0;
const PROPERTY_SUBJECT = 1;
const RETURN_SUBJECT = 2;
const ASSERTION_SUBJECT = 3;
const ASSIGNMENT_CHECK = 4;
const CALL_CHECK = 5;
// A declarator without an initializer: no check, but its annotation can make assignments flows.
const DECLARATION = 6;

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSSatisfiesExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
	if (variable.defs.length !== 1) return null;
	const [definition] = variable.defs;
	return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
		? definition.node
		: null;
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
	return (
		declarator.parent.type === "VariableDeclaration" &&
		declarator.parent.kind === "const" &&
		variable.references.every((reference) => reference.init || !reference.isWrite())
	);
}

function hasKnownEvidence(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	constNames: ReadonlySet<string>,
	visitedVariables = new Set<Variable>(),
): boolean {
	if (isKnownEvidenceExpression(expression)) return true;
	const unwrapped = unwrapExpression(expression);
	// Evidence flows only through `const` bindings with initializers; skip scope analysis otherwise.
	if (unwrapped.type !== "Identifier" || !constNames.has(unwrapped.name)) return false;
	const variable = resolveVariable(sourceCode, unwrapped);
	if (variable === null || visitedVariables.has(variable)) return false;
	const declarator = variableDeclarator(variable);
	if (
		declarator === null ||
		declarator.init === null ||
		!isStableConstVariable(variable, declarator)
	) {
		return false;
	}
	visitedVariables.add(variable);
	return hasKnownEvidence(sourceCode, declarator.init, constNames, visitedVariables);
}

/** Add every name a binding pattern declares. */
function addBindingNames(pattern: ESTree.Node, names: Set<string>): void {
	switch (pattern.type) {
		case "Identifier":
			names.add(pattern.name);
			return;
		case "ObjectPattern":
			for (const property of pattern.properties) addBindingNames(property.type === "RestElement" ? property : property.value, names);
			return;
		case "ArrayPattern":
			for (const element of pattern.elements) if (element !== null) addBindingNames(element, names);
			return;
		case "AssignmentPattern":
			addBindingNames(pattern.left, names);
			return;
		case "RestElement":
			addBindingNames(pattern.argument, names);
			return;
		default:
			return;
	}
}

/** Whether `hasKnownEvidence` can be true for this expression, without scope analysis. */
function mayCarryEvidence(expression: ESTree.Expression): boolean {
	return isKnownEvidenceExpression(expression) || unwrapExpression(expression).type === "Identifier";
}

function isTypePredicateFunction(node: ESTree.Node): boolean {
	return isFunctionExpression(node) && node.returnType?.typeAnnotation.type === "TSTypePredicate";
}

function isFunctionExpression(node: ESTree.Node): node is FunctionExpression {
	return (
		node.type === "ArrowFunctionExpression" ||
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "TSDeclareFunction" ||
		node.type === "TSEmptyBodyFunctionExpression"
	);
}

function localFunctionForCall(
	sourceCode: SourceCode,
	callee: ESTree.Expression,
): FunctionExpression | null {
	const unwrapped = unwrapExpression(callee);
	if (isFunctionExpression(unwrapped)) return unwrapped;
	if (unwrapped.type !== "Identifier") return null;
	const variable = resolveVariable(sourceCode, unwrapped);
	if (variable === null || variable.defs.length !== 1) return null;
	const [definition] = variable.defs;
	if (definition === undefined) return null;
	if (definition.type === "FunctionName" && isFunctionExpression(definition.node)) {
		return definition.node;
	}
	if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator") {
		return null;
	}
	const initializer = definition.node.init;
	if (initializer === null) return null;
	const unwrappedInitializer = unwrapExpression(initializer);
	return isFunctionExpression(unwrappedInitializer) ? unwrappedInitializer : null;
}

function variableTypeAnnotation(
	sourceCode: SourceCode,
	variable: Variable,
): ESTree.TSTypeAnnotation | null {
	if (variable.defs.length !== 1) return null;
	const [definition] = variable.defs;
	if (definition === undefined) return null;
	if (
		definition.type === "Variable" &&
		definition.node.type === "VariableDeclarator" &&
		definition.node.id.type === "Identifier"
	) {
		return definition.node.id.typeAnnotation ?? null;
	}
	if (definition.type !== "Parameter" || !isFunctionExpression(definition.node)) {
		return null;
	}
	const parameter = definition.node.params.find(
		(candidate) =>
			functionParameterBindingName(candidate, sourceCode) === variable.name,
	);
	return parameter === undefined ? null : (functionParameterTypeAnnotation(parameter) ?? null);
}

function hasInformativeType(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): boolean {
	return classifyUnsafeDictionaryValue(type, environment) === null;
}

function hasKnownCallArgumentEvidence(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	environment: TypeEnvironment,
	visitedVariables = new Set<Variable>(),
): boolean {
	if (expression.type === "ParenthesizedExpression" || expression.type === "TSNonNullExpression") {
		return hasKnownCallArgumentEvidence(
			sourceCode,
			expression.expression,
			environment,
			visitedVariables,
		);
	}
	if (expression.type === "TSAsExpression" || expression.type === "TSTypeAssertion") {
		return hasInformativeType(expression.typeAnnotation, environment);
	}
	if (expression.type === "TSSatisfiesExpression") {
		return hasKnownCallArgumentEvidence(
			sourceCode,
			expression.expression,
			environment,
			visitedVariables,
		);
	}
	if (expression.type === "CallExpression") {
		const owner = localFunctionForCall(sourceCode, expression.callee);
		const returnType = owner?.returnType?.typeAnnotation;
		return returnType !== undefined && hasInformativeType(returnType, environment);
	}
	if (expression.type !== "Identifier") return isKnownEvidenceExpression(expression);
	const variable = resolveVariable(sourceCode, expression);
	if (variable === null || visitedVariables.has(variable)) return false;
	const annotation = variableTypeAnnotation(sourceCode, variable);
	if (annotation !== null) {
		return hasInformativeType(annotation.typeAnnotation, environment);
	}
	const declarator = variableDeclarator(variable);
	if (
		declarator === null ||
		declarator.init === null ||
		!isStableConstVariable(variable, declarator)
	) {
		return false;
	}
	visitedVariables.add(variable);
	return hasKnownCallArgumentEvidence(
		sourceCode,
		declarator.init,
		environment,
		visitedVariables,
	);
}

function typePredicateSubjectIndex(
	sourceCode: SourceCode,
	owner: FunctionExpression,
): number | null {
	const predicate = owner.returnType?.typeAnnotation;
	if (predicate?.type !== "TSTypePredicate" || predicate.parameterName.type !== "Identifier") {
		return null;
	}
	const predicateParameterName = predicate.parameterName.name;
	const index = owner.params.findIndex(
		(parameter) =>
			functionParameterBindingName(parameter, sourceCode) === predicateParameterName,
	);
	return index === -1 ? null : index;
}

function annotationTarget(
	annotation: ESTree.TSTypeAnnotation | null | undefined,
	environment: TypeEnvironment,
): WideningTarget | null {
	return annotation === null || annotation === undefined
		? null
		: classifyWideningTarget(annotation.typeAnnotation, environment);
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (
			current.type === "ArrowFunctionExpression" ||
			current.type === "FunctionDeclaration" ||
			current.type === "FunctionExpression"
		) {
			return current;
		}
		current = current.parent;
	}
	return null;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
	if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
	if (key.type === "Literal") return String(key.value);
	return sourceCode.getText(key);
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
	if (owner === null) return "anonymous function";
	if (owner.id !== null) return owner.id.name;
	const parent = owner.parent;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
		return parent.id.name;
	if (parent.type === "MethodDefinition") return sourceKeyName(sourceCode, parent.key);
	return "anonymous function";
}

function isEmptyObjectExpression(expression: ESTree.Expression): boolean {
	const unwrapped = unwrapExpression(expression);
	return unwrapped.type === "ObjectExpression" && unwrapped.properties.length === 0;
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
	return destination.kind === "open dictionary" || destination.kind === "generic container";
}

function hasParentAssertion(node: ESTree.Node): boolean {
	return node.parent?.type === "TSAsExpression" || node.parent?.type === "TSTypeAssertion";
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
		},
		messages: {
			widening:
				"The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
		},
	},
	createOnce(context) {
		const environment = createTypeEnvironment();

		// Checks that may need scope analysis wait for Program:exit, when these name sets are
		// complete; a name outside them cannot produce a report. They run in visit order.
		const constNames = new Set<string>();
		const annotatedNames = new Set<string>();
		const predicateNames = new Set<string>();
		let mayHaveUnknownPredicate = false;
		// Pending checks as parallel arrays. A flow stores its destination type, which is classified
		// at exit because the type aliases it may use can be declared later in the file.
		const kinds: Array<number> = [];
		const nodes: Array<ESTree.Node | null> = [];
		const types: Array<ESTree.TSType | null> = [];
		const subjects: Array<ESTree.Node | null> = [];
		const targets: Array<WideningTarget | null> = [];

		const push = (kind: number, node: ESTree.Node | null, type: ESTree.TSType | null, subject: ESTree.Node | null) => {
			kinds.push(kind);
			nodes.push(node);
			types.push(type);
			subjects.push(subject);
		};

		const flow = (
			expression: ESTree.Expression,
			annotation: ESTree.TSTypeAnnotation | null | undefined,
			subjectKind: number,
			subject: ESTree.Node | null,
		) => {
			if (annotation !== null && annotation !== undefined && mayCarryEvidence(expression)) {
				push(subjectKind, expression, annotation.typeAnnotation, subject);
			}
		};

		const subjectText = (kind: number, subject: ESTree.Node | null): string => {
			switch (kind) {
				case BINDING_SUBJECT:
					return `binding \`${(subject as ESTree.BindingIdentifier).name}\``;
				case PROPERTY_SUBJECT:
					return `property \`${sourceKeyName(context.sourceCode, subject as ESTree.PropertyKey)}\``;
				case RETURN_SUBJECT:
					return `return value of \`${functionName(context.sourceCode, subject as FunctionExpression | null)}\``;
				default:
					return "assertion";
			}
		};

		const reportFlow = (expression: ESTree.Expression, destination: WideningTarget, subject: () => string) => {
			if (!hasKnownEvidence(context.sourceCode, expression, constNames)) return;
			context.report({
				node: expression,
				messageId: "widening",
				data: { subject: subject(), target: destination.kind },
			});
		};

		const checkAssignment = (node: ESTree.AssignmentExpression, environment: TypeEnvironment) => {
			if (node.left.type !== "Identifier" || !annotatedNames.has(node.left.name)) return;
			const right = unwrapExpression(node.right);
			if (!isKnownEvidenceExpression(node.right) && (right.type !== "Identifier" || !constNames.has(right.name))) return;
			const variable = resolveVariable(context.sourceCode, node.left);
			if (variable === null) return;
			const declarator = variableDeclarator(variable);
			if (declarator === null || declarator.id.type !== "Identifier") return;
			const destination = annotationTarget(declarator.id.typeAnnotation, environment);
			if (destination === null) return;
			if (isDictionaryAccumulatorTarget(destination) && isEmptyObjectExpression(node.right)) return;
			const name = declarator.id.name;
			reportFlow(node.right, destination, () => `binding \`${name}\``);
		};

		const checkCall = (node: ESTree.CallExpression, environment: TypeEnvironment) => {
			// A report needs a local function with a type predicate (`x is T` or `asserts x`).
			const callee = unwrapExpression(node.callee);
			if (!isFunctionExpression(callee) && (callee.type !== "Identifier" || !predicateNames.has(callee.name))) return;
			const owner = localFunctionForCall(context.sourceCode, node.callee);
			if (owner === null) return;
			const parameterIndex = typePredicateSubjectIndex(context.sourceCode, owner);
			if (parameterIndex === null) return;
			const parameter = owner.params[parameterIndex];
			const argument = node.arguments[parameterIndex];
			if (parameter === undefined || argument === undefined || argument.type === "SpreadElement") {
				return;
			}
			const parameterAnnotation = functionParameterTypeAnnotation(parameter);
			if (
				parameterAnnotation === null ||
				parameterAnnotation === undefined ||
				!containsUnknownType(parameterAnnotation.typeAnnotation)
			) {
				return;
			}
			if (
				!hasKnownCallArgumentEvidence(
					context.sourceCode,
					argument,
					environment,
				)
			) {
				return;
			}
			context.report({
				node: argument,
				messageId: "widening",
				data: {
					subject: `argument for parameter \`${functionParameterBindingName(parameter, context.sourceCode)}\` of \`${functionName(context.sourceCode, owner)}\``,
					target: "unknown",
				},
			});
		};

		const addPredicateFunction = (node: ESTree.Function) => {
			if (mayHaveUnknownPredicate && node.id !== null && isTypePredicateFunction(node)) predicateNames.add(node.id.name);
		};

		return {
			...typeBindingVisitors(environment.typeAliases),
			Program(node) {
				const text = context.sourceCode.text;
				mayHaveUnknownPredicate = (text.includes("unknown") && (text.includes("is") || text.includes("asserts"))) ||
					text.includes("\\u");
				constNames.clear();
				annotatedNames.clear();
				predicateNames.clear();
				kinds.length = 0;
				nodes.length = 0;
				types.length = 0;
				subjects.length = 0;
				resetTypeEnvironment(environment, node, context.sourceCode.visitorKeys);
			},
			VariableDeclarator(node) {
				if (node.init !== null) {
					// Only an initializer with evidence, or another binding, can give a const evidence.
					if (node.parent.type === "VariableDeclaration" && node.parent.kind === "const" && mayCarryEvidence(node.init)) {
						addBindingNames(node.id, constNames);
					}
					if (mayHaveUnknownPredicate && isTypePredicateFunction(unwrapExpression(node.init))) addBindingNames(node.id, predicateNames);
				}
				const annotation = node.id.type === "Identifier" ? node.id.typeAnnotation : null;
				if (annotation === null || annotation === undefined) return;
				push(node.init === null ? DECLARATION : BINDING_SUBJECT, node.init, annotation.typeAnnotation, node.id);
			},
			FunctionDeclaration: addPredicateFunction,
			FunctionExpression: addPredicateFunction,
			TSDeclareFunction: addPredicateFunction,
			PropertyDefinition(node) {
				if (node.value !== null) flow(node.value, node.typeAnnotation, PROPERTY_SUBJECT, node.key);
			},
			AccessorProperty(node) {
				if (node.value !== null) flow(node.value, node.typeAnnotation, PROPERTY_SUBJECT, node.key);
			},
			AssignmentExpression(node) {
				if (node.operator === "=" && node.left.type === "Identifier") push(ASSIGNMENT_CHECK, node, null, null);
			},
			CallExpression(node) {
				if (!mayHaveUnknownPredicate || node.arguments.length === 0) return;
				const callee = unwrapExpression(node.callee);
				if (callee.type === "Identifier" || isFunctionExpression(callee)) push(CALL_CHECK, node, null, null);
			},
			ReturnStatement(node) {
				if (node.argument === null) return;
				const owner = enclosingFunction(node);
				flow(node.argument, owner?.returnType, RETURN_SUBJECT, owner);
			},
			ArrowFunctionExpression(node) {
				if (node.body.type !== "BlockStatement") flow(node.body, node.returnType, RETURN_SUBJECT, node);
			},
			TSAsExpression(node) {
				if (!hasParentAssertion(node) && mayCarryEvidence(node.expression)) push(ASSERTION_SUBJECT, node.expression, node.typeAnnotation, null);
			},
			TSTypeAssertion(node) {
				if (!hasParentAssertion(node) && mayCarryEvidence(node.expression)) push(ASSERTION_SUBJECT, node.expression, node.typeAnnotation, null);
			},
			"Program:exit"() {
				// Classify every destination first: assignments need the complete annotated names.
				targets.length = kinds.length;
				for (let i = 0; i < kinds.length; i++) {
					const type = types[i];
					targets[i] = type === null ? null : classifyWideningTarget(type, environment);
					if ((kinds[i] === BINDING_SUBJECT || kinds[i] === DECLARATION) && targets[i] !== null) {
						annotatedNames.add((subjects[i] as ESTree.BindingIdentifier).name);
					}
				}
				for (let i = 0; i < kinds.length; i++) {
					const kind = kinds[i];
					if (kind === ASSIGNMENT_CHECK) checkAssignment(nodes[i] as ESTree.AssignmentExpression, environment);
					else if (kind === CALL_CHECK) checkCall(nodes[i] as ESTree.CallExpression, environment);
					else if (kind !== DECLARATION) {
						const destination = targets[i];
						const expression = nodes[i] as ESTree.Expression;
						if (destination === null) continue;
						if (isDictionaryAccumulatorTarget(destination) && isEmptyObjectExpression(expression)) continue;
						reportFlow(expression, destination, () => subjectText(kind, subjects[i]));
					}
				}
			},
		};
	},
});
