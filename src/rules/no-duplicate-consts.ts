import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

interface SeenConst {
	filename: string;
	name: string;
}

function staticValue(node: ESTree.Expression): string | null {
	if (node.type === "Literal") {
		return JSON.stringify(["literal", typeof node.value, String(node.value)]);
	}
	if (node.type === "TemplateLiteral") {
		return node.expressions.length === 0 ? JSON.stringify(["literal", "string", node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? ""]) : null;
	}
	if (node.type === "UnaryExpression" && (node.operator === "+" || node.operator === "-") && node.argument.type === "Literal" && typeof node.argument.value === "number") {
		return JSON.stringify(["literal", "number", `${node.operator}${node.argument.value}`]);
	}
	if (node.type === "ArrayExpression") {
		const values = node.elements.map((element) => element === null || element.type === "SpreadElement" ? null : staticValue(element));
		return values.some((value) => value === null) ? null : JSON.stringify(["array", values]);
	}
	if (node.type === "ObjectExpression") {
		const properties: Array<[string, string]> = [];
		for (const property of node.properties) {
			if (property.type !== "Property" || property.computed || property.method || property.kind !== "init" || property.key.type !== "Identifier" && property.key.type !== "Literal") return null;
			const value = staticValue(property.value);
			if (value === null) return null;
			const key = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
			properties.push([key, value]);
		}
		return JSON.stringify(["object", properties]);
	}
	return null;
}

/** Report static all-caps constants duplicated by name and value in another file. */
export const noDuplicateConstsRule = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Report all-caps constants duplicated by name and static value across files" },
		messages: { duplicate: "{{name}} duplicates the constant in {{firstFile}}." },
		schema: [],
	},
	createOnce(context) {
		const seen = new Map<string, SeenConst>();
		return {
			Program() {
				// LSPs can re-lint a file in the same worker; discard stale entries first.
				for (const [key, constant] of seen) if (constant.filename === context.filename) seen.delete(key);
			},
			VariableDeclaration(node) {
				if (node.kind !== "const") return;
				for (const declaration of node.declarations) {
					if (declaration.id.type !== "Identifier" || !/^[A-Z][A-Z0-9_]*$/.test(declaration.id.name) || declaration.init === null) continue;
					const value = staticValue(declaration.init);
					if (value === null) continue;
					const key = `${declaration.id.name}:${value}`, first = seen.get(key);
					if (first === undefined) {
						seen.set(key, { filename: context.filename, name: declaration.id.name });
					} else if (first.filename !== context.filename) {
						context.report({ node: declaration, messageId: "duplicate", data: { name: declaration.id.name, firstFile: first.filename } });
					}
				}
			},
		};
	},
});
