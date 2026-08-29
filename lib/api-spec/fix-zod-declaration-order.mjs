import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const target = path.resolve(
  import.meta.dirname,
  "..",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);
const sourceText = (await fs.readFile(target, "utf8"))
  .replace(/\bzod\.int\(\)/g, "zod.number().int()")
  .replace(/\bzod\.email\(\)/g, "zod.string().email()");
const source = ts.createSourceFile(
  target,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

const declarations = source.statements.filter((statement) =>
  ts.isVariableStatement(statement)
  && statement.declarationList.declarations.length === 1
  && ts.isIdentifier(statement.declarationList.declarations[0].name),
);
const declarationNames = new Set(
  declarations.map((statement) =>
    statement.declarationList.declarations[0].name.text),
);
const dependencies = new Map();

for (const statement of declarations) {
  const declaration = statement.declarationList.declarations[0];
  const name = declaration.name.text;
  const used = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node) && declarationNames.has(node.text) && node.text !== name) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  if (declaration.initializer) visit(declaration.initializer);
  dependencies.set(name, used);
}

const emitted = new Set();
const pending = [...declarations];
const ordered = [];
while (pending.length) {
  const readyIndex = pending.findIndex((statement) => {
    const name = statement.declarationList.declarations[0].name.text;
    return [...dependencies.get(name)].every((dependency) => emitted.has(dependency));
  });
  if (readyIndex === -1) {
    ordered.push(...pending);
    break;
  }
  const [statement] = pending.splice(readyIndex, 1);
  const name = statement.declarationList.declarations[0].name.text;
  emitted.add(name);
  ordered.push(statement);
}

const nonDeclarations = source.statements.filter((statement) => !declarations.includes(statement));
const updated = ts.factory.updateSourceFile(source, [...nonDeclarations, ...ordered]);
const output = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(updated);
await fs.writeFile(target, output);