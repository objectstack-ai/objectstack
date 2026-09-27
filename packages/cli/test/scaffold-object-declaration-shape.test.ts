// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every door this package opens onto a `*.object.ts` writes the ONE
 * authorised declaration shape, and they all write the SAME one.
 *
 * ## The ruling
 *
 * Ruling 5644350230 (director seat, decision batch #122 item 1) made
 * `ObjectSchema.create({ … })` the one authorised shape for a `*.object.ts`.
 * The factory parses the declaration against `ObjectSchema` when the file is
 * evaluated, so a mistake surfaces where it was written; a
 * `Data.ServiceObject`-annotated literal defers every check to a build the
 * author may never run. `os init` (both object-bearing `TEMPLATES`) and
 * `os generate object` were the outliers: `create-objectstack`'s starter,
 * `schema-design.mdx` ("Every object definition follows this pattern") and the
 * in-repo object files already stood on the factory.
 *
 * ## Why parity is a pin and not a comment
 *
 * `generate.ts`'s object generator declares that it emits what the `os init`
 * templates emit, so "the two doors an author can arrive through agree". That
 * sentence held the `sharingModel` VALUE for years while both doors kept a
 * declaration SHAPE nobody compared. A shape moved at one door and not the
 * other is the exact drift this file turns red on.
 *
 * ## What is read, and with what
 *
 * The TypeScript parser, over the exact bytes each emitter returns — the same
 * instrument `emitted-source-parses.ts` uses, and for the same reason: a regex
 * over the source is a second opinion about the grammar. The file's shape is
 * reduced to a signature:
 *
 *   - how `ObjectSchema` is imported from `@objectstack/spec/data` — a VALUE
 *     import is load-bearing, because `import type` is erased at compile time
 *     and the emitted module would throw on its first evaluation;
 *   - each top-level declaration: whether it carries a type annotation, and
 *     what its initializer is;
 *   - what the file default-exports. Both barrels (`os init`'s
 *     `src/objects/index.ts` and the line `os generate` appends) re-export
 *     `default`, so the default export must stay the declared binding.
 *
 * ## The controls
 *
 * A reader that cannot tell the two shapes apart would pass every emitter.
 * So the pre-ruling annotated literal is read by the same function and must
 * be refused, and a type-only factory import must be refused too — each
 * proves one half of the judgement can go red.
 */

import { describe, expect, it } from 'vitest';
import { ts } from 'ts-morph';
import { TEMPLATES, sanitizeNamespace } from '../src/commands/init.js';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';

const SPEC_DATA = '@objectstack/spec/data';

/** The declaration shape of one emitted `*.object.ts`, binding names abstracted. */
interface DeclarationShape {
  /** `ObjectSchema` from `@objectstack/spec/data`: a value import, a type-only one, or none. */
  factoryImport: 'value' | 'type-only' | 'absent';
  /** Every top-level `const`/`let`/`var` declarator, in source order. */
  declarations: Array<{ binding: string; annotated: boolean; initializer: string }>;
  /** What `export default` names: `binding` when it is the declared binding, else the node kind. */
  defaultExport: string | null;
}

function readShape(source: string): DeclarationShape {
  const file = ts.createSourceFile('emitted.object.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let factoryImport: DeclarationShape['factoryImport'] = 'absent';
  const declarations: DeclarationShape['declarations'] = [];
  let defaultExport: string | null = null;
  let defaultName: string | null = null;

  for (const stmt of file.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const spec = ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : '';
      const bindings = stmt.importClause?.namedBindings;
      if (spec !== SPEC_DATA || !bindings || !ts.isNamedImports(bindings)) continue;
      const named = bindings.elements.find((e) => (e.propertyName ?? e.name).text === 'ObjectSchema');
      if (!named) continue;
      factoryImport = stmt.importClause!.isTypeOnly || named.isTypeOnly ? 'type-only' : 'value';
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const init = decl.initializer;
        let initializer = init ? ts.SyntaxKind[init.kind] : 'none';
        if (init && ts.isCallExpression(init)) {
          const callee = init.expression.getText(file).replace(/\s+/g, '');
          const arg = init.arguments.length === 1 && ts.isObjectLiteralExpression(init.arguments[0]);
          initializer = `${callee}(${arg ? '{…}' : '?'})`;
        }
        declarations.push({ binding: decl.name.getText(file), annotated: decl.type !== undefined, initializer });
      }
    } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      defaultName = ts.isIdentifier(stmt.expression) ? stmt.expression.text : null;
      defaultExport = defaultName ?? ts.SyntaxKind[stmt.expression.kind];
    }
  }
  if (defaultName !== null && declarations.some((d) => d.binding === defaultName)) defaultExport = 'binding';
  return { factoryImport, declarations, defaultExport };
}

/** Every way `shape` departs from the authorised declaration. Empty = conforming. */
function shapeFindings(shape: DeclarationShape): string[] {
  const findings: string[] = [];
  if (shape.factoryImport !== 'value') {
    findings.push(`\`ObjectSchema\` is not value-imported from '${SPEC_DATA}' (${shape.factoryImport})`);
  }
  if (shape.declarations.length !== 1) {
    findings.push(`expected exactly one top-level declaration, found ${shape.declarations.length}`);
  }
  for (const d of shape.declarations) {
    if (d.initializer !== 'ObjectSchema.create({…})') {
      findings.push(`\`${d.binding}\` is initialised by ${d.initializer}, not ObjectSchema.create({…})`);
    }
    if (d.annotated) findings.push(`\`${d.binding}\` carries a type annotation`);
  }
  if (shape.defaultExport !== 'binding') {
    findings.push(`the default export is ${shape.defaultExport ?? 'absent'}, not the declared binding`);
  }
  return findings;
}

/** The shape with binding names dropped, so two doors compare on shape alone. */
function signature(shape: DeclarationShape): string {
  return JSON.stringify({
    factoryImport: shape.factoryImport,
    declarations: shape.declarations.map(({ annotated, initializer }) => ({ annotated, initializer })),
    defaultExport: shape.defaultExport,
  });
}

// ── The roster: derived, both halves ─────────────────────────────────────

const PROJECT_NAME = 'my-app';
const namespace = sanitizeNamespace(PROJECT_NAME);

const INIT_DOORS = Object.entries(TEMPLATES).flatMap(([key, template]) =>
  Object.entries(template.srcFiles ?? {})
    .filter(([file]) => file.endsWith('.object.ts'))
    .map(([file, render]) => ({ door: `os init -t ${key} → ${file}`, source: render(PROJECT_NAME, namespace) })),
);

const GENERATE_DOORS = GENERATOR_SCAFFOLD_TARGETS
  .filter((g) => g.type === 'object')
  .map((g) => ({ door: `os generate ${g.type} order_line`, source: g.generate('order_line') }));

const DOORS = [...INIT_DOORS, ...GENERATE_DOORS];

describe('the roster is derived and covers both commands', () => {
  it('reads every `os init` object template and the `os generate object` emitter', () => {
    // `app` and `plugin` each emit one object file today; a template added
    // tomorrow joins the roster by being in `TEMPLATES`, not by being listed.
    expect(INIT_DOORS.length).toBeGreaterThanOrEqual(2);
    expect(GENERATE_DOORS).toHaveLength(1);
  });
});

describe('every door writes `ObjectSchema.create({ … })`', () => {
  it.each(DOORS)('$door', ({ source }) => {
    expect(shapeFindings(readShape(source))).toEqual([]);
  });
});

describe('`os init` and `os generate object` write the SAME declaration shape', () => {
  it('one signature across every door', () => {
    const signatures = new Map(DOORS.map((d) => [d.door, signature(readShape(d.source))]));
    expect(new Set(signatures.values()).size, JSON.stringify(Object.fromEntries(signatures), null, 2)).toBe(1);
  });
});

describe('controls — the reader can refuse each half', () => {
  it('refuses the pre-ruling `Data.ServiceObject`-annotated literal', () => {
    const legacy = [
      "import * as Data from '@objectstack/spec/data';",
      '',
      'const myAppItem: Data.ServiceObject = {',
      "  name: 'my_app_item',",
      '  fields: {},',
      '};',
      '',
      'export default myAppItem;',
      '',
    ].join('\n');
    const findings = shapeFindings(readShape(legacy));
    expect(findings).toContain('`ObjectSchema` is not value-imported from \'@objectstack/spec/data\' (absent)');
    expect(findings).toContain('`myAppItem` is initialised by ObjectLiteralExpression, not ObjectSchema.create({…})');
    expect(findings).toContain('`myAppItem` carries a type annotation');
  });

  it('refuses a type-only factory import, which is erased before the module runs', () => {
    const typeOnly = [
      "import type { ObjectSchema } from '@objectstack/spec/data';",
      '',
      "const myAppItem = ObjectSchema.create({ name: 'my_app_item', fields: {} });",
      '',
      'export default myAppItem;',
      '',
    ].join('\n');
    expect(shapeFindings(readShape(typeOnly))).toEqual([
      '`ObjectSchema` is not value-imported from \'@objectstack/spec/data\' (type-only)',
    ]);
  });
});
