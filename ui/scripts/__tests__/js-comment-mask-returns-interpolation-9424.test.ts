import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#9424 — `scanSource`'s `@returns` declared TWO properties while the
 * function returns THREE (`return { comment, literal, interpolation };`).
 *
 * `tsconfig.scripts.json` compiles `scripts/**` with `allowJs: true` and
 * `checkJs: false` on purpose (objectui#3494), so a `.ts` consumer's type for
 * this helper is inferred from the `.mjs` source steered by JSDoc — the
 * docblock IS the type. A declaration narrower than the real return therefore
 * made `scanSource(src).interpolation` a compile error on a property that
 * genuinely exists and is genuinely populated (it is the delimiter-reachability
 * flag array `check-entry-guard.mjs` destructures).
 *
 * ## Why this test builds a program instead of grepping the docblock
 *
 * Asserting the tag names `interpolation` asserts a spelling; a docblock is
 * worth nothing unless TypeScript acts on it. Each case below compiles a real
 * read against the real `.mjs` under the real `tsconfig.scripts.json` options
 * and asserts the DIAGNOSTIC.
 *
 * ## Why the absent-property half is not ceremony
 *
 * "Reading `.interpolation` is clean" is ALSO satisfied by a return type that
 * has been destroyed into `any` (or given an index signature) — every property
 * would then be readable, including ones that do not exist. So each widening
 * case is paired with a genuinely-absent property that must STAY TS2339. The
 * two halves together are what distinguish "widened correctly" from "widened
 * into anything goes", and that is the pair objectui#9424 was accepted on.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'tsconfig.scripts.json');

/** The real options `pnpm type-check:scripts` runs with, parsed by tsc itself. */
function scriptsCompilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'tsconfig.scripts.json must parse',
  ).toBeFalsy();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, configPath);
  expect(parsed.options.allowJs, '`allowJs` is what makes JSDoc load-bearing here').toBe(true);
  expect(parsed.options.checkJs, '`checkJs` off is why the docblock is the only declaration').toBeFalsy();
  return { ...parsed.options, noEmit: true };
}

/**
 * Type-check one snippet as a `scripts/**` file and return its semantic
 * diagnostics. The snippet is served from memory at a real path inside
 * `scripts/__tests__/`, so its relative import of the masker resolves to the
 * genuine `.mjs` on disk rather than to a stub.
 */
function diagnosticsFor(snippet: string): string[] {
  const virtualPath = path.join(repoRoot, 'scripts/__tests__/__js-comment-mask-9424-case.ts');
  const options = scriptsCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);

  host.fileExists = (name) => (name === virtualPath ? true : fileExists(name));
  host.readFile = (name) => (name === virtualPath ? snippet : readFile(name));
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
    name === virtualPath
      ? ts.createSourceFile(name, snippet, languageVersion, true, ts.ScriptKind.TS)
      : getSourceFile(name, languageVersion, onError, shouldCreate);

  const program = ts.createProgram([virtualPath], options, host);
  const source = program.getSourceFile(virtualPath);
  expect(source, 'the case file must be in the program, or a green here measures nothing').toBeDefined();
  return [...program.getSemanticDiagnostics(source)].map(
    (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 200)}`,
  );
}

const IMPORT = "import { scanSource } from '../js-comment-mask.mjs';";

/**
 * Every property the function actually returns. Each must be readable AND must
 * carry the real element type — a bare `expect(...).toHaveLength(0)` on an
 * untyped read would pass against `any`, so every snippet annotates the binding
 * `Uint8Array` and lets the assignment do the checking.
 */
const DECLARED: ReadonlyArray<{ name: string; snippet: string }> = [
  { name: 'comment', snippet: "export const x: Uint8Array = scanSource('const a = 1;').comment;" },
  { name: 'literal', snippet: "export const x: Uint8Array = scanSource('const a = 1;').literal;" },
  { name: 'interpolation', snippet: "export const x: Uint8Array = scanSource('const a = 1;').interpolation;" },
];

/**
 * Names that are NOT on the return shape. They must stay TS2339 — this is the
 * half that fails if the fix ever degrades into `any` or an index signature.
 */
const ABSENT: ReadonlyArray<{ name: string; snippet: string }> = [
  { name: 'nosuchProperty (member read)', snippet: "export const x = scanSource('const a = 1;').nosuchProperty;" },
  {
    name: 'alsoNotThere (destructured)',
    snippet: "const { alsoNotThere } = scanSource('const a = 1;'); export const x = alsoNotThere;",
  },
];

describe("js-comment-mask.mjs — scanSource's @returns declares every property it returns (objectui#9424)", () => {
  for (const c of DECLARED) {
    it(`types \`.${c.name}\` as the Uint8Array it really is`, () => {
      expect(diagnosticsFor(`${IMPORT}\n${c.snippet}\n`)).toEqual([]);
    });
  }

  it('types all three at once when the result is destructured', () => {
    const snippet =
      "const { comment, literal, interpolation } = scanSource('const a = 1;');\n" +
      'export const x: Uint8Array[] = [comment, literal, interpolation];';
    expect(diagnosticsFor(`${IMPORT}\n${snippet}\n`)).toEqual([]);
  });

  for (const c of ABSENT) {
    it(`still rejects \`${c.name}\`, which the function does not return`, () => {
      const found = diagnosticsFor(`${IMPORT}\n${c.snippet}\n`);
      expect(found.join('\n')).toMatch(/TS2339/);
    });
  }

  it('names all three properties in the rejection message for an absent one', () => {
    const found = diagnosticsFor(`${IMPORT}\nexport const x = scanSource('const a = 1;').nosuchProperty;\n`).join('\n');
    for (const prop of ['comment', 'literal', 'interpolation']) {
      expect(found, `the inferred return type must still name \`${prop}\``).toContain(prop);
    }
  });

  it('has the subject file in the program `pnpm type-check:scripts` builds', () => {
    const options = scriptsCompilerOptions();
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, configPath);
    const program = ts.createProgram(parsed.fileNames, options);
    const inProgram = program.getSourceFiles().map((f) => f.fileName);
    const subject = path.join(repoRoot, 'scripts/js-comment-mask.mjs').split(path.sep).join('/');
    expect(inProgram, 'a green above measures nothing if the subject is outside the program').toContain(subject);
    expect(inProgram, 'control with a known direction: an impossible path must be absent').not.toContain(
      path.join(repoRoot, 'scripts/js-comment-mask-nosuchfile.mjs').split(path.sep).join('/'),
    );
  });
});
