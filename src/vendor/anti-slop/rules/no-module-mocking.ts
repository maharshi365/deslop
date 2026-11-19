import { defineRule } from "@oxlint/plugins";

import { resolveVariable } from "../shared/scope.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

function isIdentifierCode(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 36 || code === 95;
}

interface ModuleFacts {
  namespaces: boolean;
  frameworkImport: boolean;
  // Source ranges of `import { vi } from "vitest"`-style specifiers, as [start, end] pairs.
  readonly frameworkSpecifiers: Array<number>;
}

/**
 * Whether every whole-word occurrence of `name` is directly followed by `.` or `[`, or lies in a
 * framework import of that name. A binding is never followed by those, except a dotted namespace
 * name, so callers also require no namespaces.
 */
function onlyUsedAsObject(text: string, name: string, frameworkSpecifiers: ReadonlyArray<number>): boolean {
  search: for (let index = text.indexOf(name); index !== -1; index = text.indexOf(name, index + 1)) {
    if (isIdentifierCode(text.charCodeAt(index - 1)) || isIdentifierCode(text.charCodeAt(index + name.length))) continue;
    const next = text[index + name.length];
    if (next === "." || next === "[") continue;
    for (let i = 0; i < frameworkSpecifiers.length; i += 2) {
      if (index >= frameworkSpecifiers[i] && index < frameworkSpecifiers[i + 1]) continue search;
    }
    return false;
  }
  return true;
}

/** Collect top-level and namespace-nested framework imports, and whether the file has a namespace. */
function scanModule(statements: readonly ESTree.Node[], facts: ModuleFacts): void {
  for (const statement of statements) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "ImportDeclaration") {
      const source = declaration.source.value;
      if (source !== "vitest" && source !== "@jest/globals") continue;
      for (const specifier of declaration.specifiers) {
        if (!isFrameworkImport(source, importedName(specifier))) continue;
        facts.frameworkImport = true;
        // `{ vi }` or `{ vi as other }`: the text `vi` here binds nothing but the framework import.
        facts.frameworkSpecifiers.push(specifier.start, specifier.end);
      }
    } else if (declaration?.type === "TSModuleDeclaration") {
      facts.namespaces = true;
      if (declaration.body?.type === "TSModuleBlock") scanModule(declaration.body.body, facts);
    }
  }
}

function isFrameworkImport(source: string, name: string | null): boolean {
  return (source === "vitest" && name === "vi") || (source === "@jest/globals" && name === "jest");
}

function isTestFrameworkObject(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  facts: FileFacts,
): expression is ESTree.IdentifierReference {
  if (expression.type !== "Identifier") return false;
  // Scope analysis is costly, so first rule out the cases it would only confirm.
  const isFrameworkName = expression.name === "vi" || expression.name === "jest";
  if (!isFrameworkName && !facts.module.frameworkImport) return false;
  if (isFrameworkName && facts.unbound(expression.name)) return true;
  if (
    (expression.name === "vi" || expression.name === "jest") &&
    sourceCode.isGlobalReference(expression)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === "vi" || expression.name === "jest";
  }
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    return isFrameworkImport(definition.parent.source.value, importedName(definition.node));
  });
}

/** Facts about the file being linted, computed once at exit when it has mock calls. */
interface FileFacts {
  readonly module: ModuleFacts;
  /** Whether no binding of this framework name can exist in the file. */
  unbound(name: string): boolean;
}

function fileFacts(sourceCode: SourceCode): FileFacts {
  const module: ModuleFacts = { namespaces: false, frameworkImport: false, frameworkSpecifiers: [] };
  scanModule(sourceCode.ast.body, module);
  const text = sourceCode.text;
  // `\u` escapes can spell a binding name without its text, so they disable the text check.
  const textCheck = !module.namespaces && !text.includes("\\u");
  const vi = textCheck && onlyUsedAsObject(text, "vi", module.frameworkSpecifiers);
  const jest = textCheck && onlyUsedAsObject(text, "jest", module.frameworkSpecifiers);
  return { module, unbound: (name) => (name === "vi" ? vi : jest) };
}

/** The object of a `.mock`, `.doMock`, or `.unstable_mockModule` call, or null. */
function mockCallObject(callee: ESTree.Expression): ESTree.Expression | null {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return null;
  const property = callee.property;
  const method = callee.computed
    ? property.type === "Literal" &&
      (property.value === "doMock" ||
        property.value === "mock" ||
        property.value === "unstable_mockModule")
      ? property.value
      : null
    : property.type === "Identifier"
      ? property.name
      : null;
  return method !== null && moduleMockMethods.has(method) ? callee.object : null;
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    // Mock-method calls in visit order; their objects are checked at exit with one set of file facts.
    const calls: ESTree.CallExpression[] = [];
    const objects: ESTree.Expression[] = [];
    return {
      before() {
        calls.length = 0;
        objects.length = 0;
      },
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        const object = mockCallObject(node.callee);
        if (object === null || object.type !== "Identifier") return;
        calls.push(node);
        objects.push(object);
      },
      "Program:exit"() {
        if (calls.length === 0) return;
        const facts = fileFacts(context.sourceCode);
        for (let i = 0; i < calls.length; i++) {
          if (isTestFrameworkObject(context.sourceCode, objects[i], facts)) context.report({ node: calls[i], messageId: "moduleMock" });
        }
      },
    };
  },
});
