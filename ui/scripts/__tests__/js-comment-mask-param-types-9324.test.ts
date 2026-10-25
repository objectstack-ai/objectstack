import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#9324 — `scripts/js-comment-mask.mjs` is the repo's single answer to
 * "is this span a comment, or code?", and `tsconfig.scripts.json` compiles
 * `scripts/**` with `allowJs: true` and `checkJs: false` on purpose
 * (objectui#3494): a `.ts` consumer's types for these helpers come from
 * inference over the `.mjs` source, steered by JSDoc and by nothing else.
 *
 * Three of the four parameter-taking exports carried no `@param` — `blank` had
 * a one-line prose docblock, `stripComments` and `maskComments` had prose-only
 * multi-line ones — so their parameters inferred `any` and EVERY consumer call
 * site went unchecked. `scanSource` carried `@param {string} source` all along
 * and was checked from the same module under the same config, which is what
 * proved the gap was the missing tag rather than `allowJs` failing to type
 * anything.
 *
 * ## Why this test builds a program instead of grepping for `@param`
 *
 * Asserting the TAG is present asserts the spelling, and a docblock that says
 * `@param` is worth nothing unless TypeScript acts on it. So each case compiles
 * a real call against the real `.mjs`, with the real `tsconfig.scripts.json`
 * options, and asserts the DIAGNOSTIC — a wrong-typed argument must produce
 * TS2345, and the correctly-typed one must produce nothing. A regression that
 * deletes a `@param` makes the wrong-typed case stop erroring, which is the
 * direction a spelling check cannot see.
 *
 * The correctly-typed half is not ceremony: without it, "the wrong call errors"
 * is also satisfied by a signature so narrow that every real call errors too.
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
  return { ...parsed.options, noEmit: true };
}

/**
 * Type-check one snippet as a `scripts/**` file and return its semantic
 * diagnostics. The snippet is served from memory at a real path inside
 * `scripts/__tests__/`, so its relative import of the masker resolves to the
 * genuine `.mjs` on disk rather than to a stub.
 */
function diagnosticsFor(snippet: string): ts.Diagnostic[] {
  const virtualPath = path.join(repoRoot, 'scripts/__tests__/__js-comment-mask-9324-case.ts');
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
  return [...program.getSemanticDiagnostics(source)];
}

/** Render diagnostics compactly so a failure names the codes it actually saw. */
function codesOf(diagnostics: ts.Diagnostic[]): string[] {
  return diagnostics.map(
    (d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 120)}`,
  );
}

const IMPORT = "import { scanSource, blank, stripComments, maskComments } from '../js-comment-mask.mjs';";

/**
 * One export's pair of cases. `wrong` must produce TS2345 and `correct` must
 * produce nothing — the two halves together are what distinguishes "now
 * checked" from both "still `any`" and "typed too narrowly to use".
 */
const CASES: ReadonlyArray<{ name: string; wrong: string; correct: string }> = [
  {
    name: 'maskComments',
    wrong: 'export const x = maskComments(12345);',
    correct: "export const x: string = maskComments('const a = 1; // c');",
  },
  {
    name: 'stripComments',
    wrong: 'export const x = stripComments(12345);',
    correct: "export const x: string = stripComments('const a = 1; // c');",
  },
  {
    name: 'blank (first parameter)',
    wrong: "export const x = blank(12345, new Uint8Array([1]));",
    correct: "export const x: string = blank('abc', new Uint8Array([1, 0, 0]));",
  },
  {
    name: 'blank (second parameter)',
    wrong: "export const x = blank('abc', 'not-a-Uint8Array');",
    correct: "export const x: string = blank('abc', new Uint8Array([1, 0, 0]));",
  },
  {
    // The control that was already correct before objectui#9324 and is left
    // untouched by it. It fires for the same reason the other three now do, from
    // the same module under the same config — so a run where the three below go
    // quiet while this one still fires points at those three `@param` tags, and
    // a run where ALL FOUR go quiet points at `allowJs` or at this harness.
    name: 'scanSource (control — carried `@param` all along)',
    wrong: 'export const x = scanSource(12345);',
    correct: "export const x = scanSource('const a = 1; // c').comment;",
  },
];

describe('js-comment-mask.mjs — its `@param` tags are load-bearing, not decorative (objectui#9324)', () => {
  for (const c of CASES) {
    it(`rejects a wrong-typed argument to ${c.name}`, () => {
      const found = codesOf(diagnosticsFor(`${IMPORT}\n${c.wrong}\n`));
      expect(found.join('\n')).toMatch(/TS2345/);
    });

    it(`still accepts a correctly-typed argument to ${c.name}`, () => {
      expect(codesOf(diagnosticsFor(`${IMPORT}\n${c.correct}\n`))).toEqual([]);
    });
  }
});
