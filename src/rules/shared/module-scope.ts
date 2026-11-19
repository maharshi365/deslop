import type { ESTree } from "@oxlint/plugins";

/** Add every name a binding pattern declares. */
export function addBindingNames(pattern: ESTree.Node, names: Set<string>): void {
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

/**
 * Collect the names a module's top-level scope declares, as scope analysis would: imports and
 * top-level declarations, plus `var` declarations hoisted out of nested blocks. Returns null for a
 * file with a namespace, `export as namespace`, or another form this does not model; callers then
 * use scope analysis.
 */
export function moduleScopeNames(program: ESTree.Program): Set<string> | null {
	const names = new Set<string>();
	for (const statement of program.body) if (!addStatementNames(statement, names, true)) return null;
	return names;
}

function addStatementNames(node: ESTree.Node | null | undefined, names: Set<string>, topLevel: boolean): boolean {
	if (node === null || node === undefined) return true;
	switch (node.type) {
		case "ImportDeclaration":
			for (const specifier of node.specifiers) names.add(specifier.local.name);
			return true;
		case "TSImportEqualsDeclaration":
			names.add(node.id.name);
			return true;
		case "ExportNamedDeclaration":
			return addStatementNames(node.declaration, names, topLevel);
		case "ExportDefaultDeclaration": {
			const declaration = node.declaration;
			if (
				(declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration" ||
					declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSDeclareFunction") &&
				declaration.id !== null
			) {
				names.add(declaration.id.name);
			}
			return true;
		}
		case "VariableDeclaration":
			if (topLevel || node.kind === "var") for (const declarator of node.declarations) addBindingNames(declarator.id, names);
			return true;
		case "FunctionDeclaration":
		case "TSDeclareFunction":
		case "ClassDeclaration":
			if (topLevel && node.id !== null) names.add(node.id.name);
			return true;
		case "TSTypeAliasDeclaration":
		case "TSInterfaceDeclaration":
		case "TSEnumDeclaration":
			if (topLevel) names.add(node.id.name);
			return true;
		case "TSModuleDeclaration":
		case "TSNamespaceExportDeclaration":
			return false;
		// `var` declarations in these statements belong to the module scope.
		case "BlockStatement":
			for (const statement of node.body) if (!addStatementNames(statement, names, false)) return false;
			return true;
		case "IfStatement":
			return addStatementNames(node.consequent, names, false) && addStatementNames(node.alternate, names, false);
		case "ForStatement":
			return addStatementNames(node.init?.type === "VariableDeclaration" ? node.init : null, names, false) && addStatementNames(node.body, names, false);
		case "ForInStatement":
		case "ForOfStatement":
			return addStatementNames(node.left.type === "VariableDeclaration" ? node.left : null, names, false) && addStatementNames(node.body, names, false);
		case "WhileStatement":
		case "DoWhileStatement":
		case "LabeledStatement":
		case "WithStatement":
			return addStatementNames(node.body, names, false);
		case "TryStatement":
			return addStatementNames(node.block, names, false) && addStatementNames(node.handler?.body, names, false) && addStatementNames(node.finalizer, names, false);
		case "SwitchStatement":
			for (const switchCase of node.cases) for (const statement of switchCase.consequent) if (!addStatementNames(statement, names, false)) return false;
			return true;
		default:
			return true;
	}
}
