// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#15892) — the project `os create plugin <name>` emits must PARSE, for
 * every name the command accepts.
 *
 * ## The defect
 *
 * `validateProjectName` accepts exactly what npm accepts, on purpose: `.`, `_`
 * and a leading digit are all legal in an npm package name, and
 * `@objectstack/plugin-foo.bar` is publishable. The emitted identifier used to
 * be the same string, copied:
 *
 *     os create plugin foo.bar   ->   export const foo.barPlugin: Plugin = {
 *
 * exit 0, on a file that is not TypeScript — `foo.bar` in a binding position
 * is a property access. The maintainer's ruling (#15892, decision batch #64)
 * is that acceptance stays as npm's and the IDENTIFIER is derived, the way
 * `sanitizeNamespace()` already derives a namespace.
 *
 * ## Why the instrument is TypeScript's own parser
 *
 * "Does it look like an identifier" is the judgement that produced the defect
 * in the first place. `ts.createSourceFile` + `getSyntacticDiagnostics` asks
 * the compiler instead, and asks it about the bytes the template actually
 * emits rather than about a restatement of them.
 *
 * ⭐ The reading is only worth something because it CAN fail. Two controls:
 *
 *   - `my-app` — an ordinary name, which must still yield exactly
 *     `myAppPlugin`. A sanitiser that changes today's correct output is a
 *     regression, not a fix, and a green parse would not notice.
 *   - THE CANARY — the pre-fix bytes (the raw name interpolated back into the
 *     identifier position) must produce at least one syntactic diagnostic. A
 *     harness that resolves nothing, or is handed the wrong text, reports zero
 *     diagnostics and reads exactly like a pass.
 *
 * ⚠️ `a_b` is in the ruling's list but does NOT discriminate on parseability:
 * `a_bPlugin` was always legal TypeScript. It is asserted on the MAPPING
 * instead (`a_b` -> `aB`), which is the half of the ruling it can fail.
 *
 * ## What this pin deliberately does not touch
 *
 * The USER'S STRING survives byte-for-byte into the emitted package name and
 * the emitted directory name (#15816) — asserted below, so a future edit that
 * "fixes" the name instead of the identifier reddens here.
 *
 * ⚠️ What the package name is COMPOSED of is a different question, and it moved
 * under #15530: the standalone default is now an unscoped `plugin-<name>` and
 * only `--in-repo` keeps `@objectstack/plugin-<name>`. That rule is pinned in
 * `create.test.ts`; this file asserts only that whatever the composition is, it
 * carries the typed name through unaltered.
 */

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  DEFAULT_PLACEMENT,
  sanitizeIdentifier,
  templates,
  type ScaffoldPlacement,
} from '../src/commands/create.js';
import { validateProjectName } from '../src/commands/init.js';

/**
 * Syntactic (parse) diagnostics only — no lib, no resolution, no type layer.
 * `noLib`/`noResolve` keep the verdict about the grammar of these bytes, which
 * is the property the defect broke.
 */
function syntacticDiagnostics(fileName: string, source: string): readonly ts.Diagnostic[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const host: ts.CompilerHost = {
    getSourceFile: (requested) => (requested === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === fileName,
    readFile: (f) => (f === fileName ? source : undefined),
  };
  const program = ts.createProgram(
    [fileName],
    { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest },
    host,
  );
  return program.getSyntacticDiagnostics(sourceFile);
}

/** Render one file of the `plugin` template for a name and placement. */
function emit(file: string, name: string, placement: ScaffoldPlacement): string {
  const render = templates.plugin.filesFor(placement)[file];
  if (!render) throw new Error(`the plugin template emits no ${file}`);
  const content = render(name);
  return typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
}

/** The fenced `typescript` block of the emitted README — emission sites 3 and 4. */
function readmeTypescriptFence(readme: string): string {
  const fence = readme.match(/^```typescript\n([\s\S]*?)^```/m);
  if (!fence) throw new Error('the emitted README has no typescript fence');
  return fence[1];
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * The ruling's cases, plus the mapping each one is really about. `my-app` is
 * the control in BOTH directions — it must still produce `myAppPlugin`.
 */
const CASES: ReadonlyArray<{ name: string; identifier: string; why: string }> = [
  { name: 'foo.bar', identifier: 'fooBar', why: 'a dot is legal for npm, illegal in an identifier' },
  { name: '1foo', identifier: 'a1foo', why: 'a leading digit takes the fixed prefix' },
  { name: 'a_b', identifier: 'aB', why: 'an underscore folds the way a hyphen already did' },
  { name: 'my-app', identifier: 'myApp', why: 'CONTROL — today’s correct output must not move' },
];

const PLACEMENTS: readonly ScaffoldPlacement[] = ['standalone', 'in-repo'];

describe('`os create plugin <name>` emits a parseable identifier', () => {
  it('accepts every case below — npm acceptance is unchanged by this fix', () => {
    for (const { name } of CASES) {
      expect(validateProjectName(name), name).toBeNull();
    }
  });

  it.each(CASES)('$name -> $identifier ($why)', ({ name, identifier }) => {
    expect(sanitizeIdentifier(name)).toBe(identifier);
  });

  it.each(CASES)('emitted src/index.ts parses for $name', ({ name, identifier }) => {
    for (const placement of PLACEMENTS) {
      const source = emit('src/index.ts', name, placement);
      const diagnostics = syntacticDiagnostics('index.ts', source);
      expect(
        diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')),
        `${name} @ ${placement}`,
      ).toEqual([]);
      expect(source).toContain(`export const ${identifier}Plugin: Plugin = {`);
      expect(source).toContain(`export default ${identifier}Plugin;`);
    }
  });

  it.each(CASES)('emitted README.md fence parses for $name', ({ name, identifier }) => {
    const readme = emit('README.md', name, DEFAULT_PLACEMENT);
    const diagnostics = syntacticDiagnostics('readme.ts', readmeTypescriptFence(readme));
    expect(
      diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')),
      name,
    ).toEqual([]);
    // The DEFAULT placement is standalone, whose package — and therefore whose
    // import specifier — is unscoped since #15530.
    expect(readme).toContain(`import { ${identifier}Plugin } from 'plugin-${name}';`);
  });

  it.each(CASES)('names the derived identifier in the README prose for $name', ({ name, identifier }) => {
    const readme = emit('README.md', name, DEFAULT_PLACEMENT);
    const prose = readme.replace(/^```[\s\S]*?^```/gm, '');
    expect(prose).toContain(`\`${identifier}Plugin\``);
    expect(prose).toContain(`\`${name}\``);
  });

  /**
   * The ruling's four emission sites: `src/index.ts` x2, `README.md` x2 — plus
   * the one prose mention the ruling also asks for, which is why the README
   * count is three. A new site must be added here deliberately.
   */
  it.each(CASES)('reaches every emission site for $name', ({ name, identifier }) => {
    const index = emit('src/index.ts', name, DEFAULT_PLACEMENT);
    const readme = emit('README.md', name, DEFAULT_PLACEMENT);
    expect(occurrences(index, `${identifier}Plugin`)).toBe(2);
    expect(occurrences(readme, `${identifier}Plugin`)).toBe(3);
    // The defect's own shape, at the two sites that carry a binding. ⛔ Not a
    // bare `${name}Plugin` substring test: `a1foo` legitimately CONTAINS
    // `1foo`, so that spelling fails on a correct emission.
    if (name !== identifier) {
      expect(index).not.toContain(`export const ${name}Plugin`);
      expect(readme).not.toContain(`import { ${name}Plugin }`);
    }
  });

  it.each(CASES)('leaves the emitted package name and directory as typed for $name', ({ name }) => {
    const manifest = JSON.parse(emit('package.json', name, DEFAULT_PLACEMENT)) as { name: string };
    // Unscoped under the DEFAULT placement (#15530) — but still the user's
    // string, unaltered, which is the property this file is about.
    expect(manifest.name).toBe(`plugin-${name}`);
    expect(templates.plugin.dirName(name)).toBe(`plugin-${name}`);
  });

  /**
   * CANARY — the pre-fix bytes. Without this, a harness that parsed the wrong
   * text (or nothing at all) would report zero diagnostics for every case above
   * and read as a pass.
   */
  it('the parser reports the pre-fix emission as broken', () => {
    const fixed = emit('src/index.ts', 'foo.bar', DEFAULT_PLACEMENT);
    const preFix = fixed.split(`${sanitizeIdentifier('foo.bar')}Plugin`).join('foo.barPlugin');
    expect(preFix).toContain('export const foo.barPlugin: Plugin = {');
    expect(syntacticDiagnostics('index.ts', preFix).length).toBeGreaterThan(0);
  });

  /**
   * `~` is npm-legal but `validateProjectName` does not admit it, so it never
   * reaches an emission site. Recorded because the card asserted it does.
   */
  it('a tilde is refused by the validator, not by the sanitiser', () => {
    expect(validateProjectName('foo~bar')).not.toBeNull();
    expect(sanitizeIdentifier('foo~bar')).toBe('fooBar');
  });
});
