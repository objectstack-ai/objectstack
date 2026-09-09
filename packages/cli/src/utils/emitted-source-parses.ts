// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Does the TypeScript a scaffolder is ABOUT TO WRITE actually parse? (#16541)
 *
 * ## The defect this exists to end
 *
 * `os generate <type> <name>` derives a code identifier from `name` by
 * camel-casing it, and ran NO validation of any kind on the result. So a name
 * that is legal as a *name* but not as an *identifier* was interpolated
 * straight into a binding position:
 *
 *     os generate object foo.bar          exit 0
 *     src/objects/foo.bar.object.ts   ->  const foo.bar: Data.ServiceObject = {
 *     src/objects/index.ts            ->  export { default as foo.bar } from './foo.bar.object';
 *
 * Two files, neither of them TypeScript, and a command that reported success.
 * The next `tsc` is where the author finds out.
 *
 * ## ⛔ What this is NOT
 *
 * It is NOT a sanitiser and it is NOT a charset. It answers exactly one
 * question — *do the bytes we are about to write parse?* — and the answer
 * comes from the compiler rather than from an opinion about which characters
 * are tasteful. Which names `os generate` should ACCEPT, and whether it should
 * normalise the ones it does, is an open decision (#16541): deriving a
 * legal-looking identifier from a name that should have been refused is the
 * worse of the two failures, so this refuses loudly and rewrites nothing.
 *
 * ## Why the instrument is TypeScript's own parser
 *
 * "Does it look like an identifier" is the judgement that produced the defect
 * in the first place, and every restatement of the grammar is a fresh chance
 * to get it wrong: `${camel}Views` is fine for a name that `const ${camel}`
 * refuses (`class`), a reserved word is legal as an `export { default as … }`
 * alias and illegal as a `const` binding, and a name carrying a quote or a
 * comment terminator breaks the emission without touching the identifier at
 * all. Asking `ts` about the ACTUAL EMITTED BYTES answers all of those at once
 * and restates none of them — the same reasoning, and the same instrument,
 * that `create-plugin-identifier-parses.test.ts` (#15892) uses to pin the
 * sibling door.
 *
 * Syntactic diagnostics only: `noLib` and `noResolve` keep the verdict about
 * the grammar of these bytes. A scaffold references types it cannot resolve in
 * a temp directory by design, and a resolution-aware verdict would refuse
 * every name.
 *
 * ## Why `ts` arrives through a lazy import
 *
 * `ts-morph` is already a CLI runtime dependency and re-exports the full
 * TypeScript compiler namespace, so we use its `ts` rather than adding a
 * direct `typescript` dependency — the same call `detect-free-identifiers.ts`
 * makes, and for the same reason. It is imported *inside* the check rather
 * than at module top because the compiler is a heavy load and `os generate`
 * has no other use for it: a command that is refused pays for the parser, a
 * command that never reaches here does not.
 */

import type { ts as TS } from 'ts-morph';

/** One file a command is about to write, and the bytes it would contain. */
export interface EmittedSource {
  /** Path as the author will see it, e.g. `src/objects/foo.bar.object.ts`. */
  label: string;
  /** The exact bytes that would be written. */
  source: string;
}

/** An emission the compiler cannot parse, with the compiler's own reasons. */
export interface EmissionParseFailure {
  label: string;
  /** TypeScript's syntactic diagnostics, flattened to text, in source order. */
  diagnostics: string[];
}

/**
 * The syntactic diagnostics TypeScript reports for `source`, flattened to text.
 *
 * Exported so a pin can reach the instrument the command actually uses instead
 * of a second copy of it that could drift green.
 */
export function syntacticDiagnostics(ts: typeof TS, source: string): string[] {
  const fileName = 'emitted.ts';
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const host: TS.CompilerHost = {
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
  return program
    .getSyntacticDiagnostics(sourceFile)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

/**
 * Every emission in `emissions` the compiler refuses to parse, in the order
 * given. An empty array means all of them parse — ⛔ never that the check was
 * skipped: `emissions` is built from the same values the command writes.
 */
export async function findEmissionParseFailures(
  emissions: readonly EmittedSource[],
): Promise<EmissionParseFailure[]> {
  const { ts } = await import('ts-morph');
  const failures: EmissionParseFailure[] = [];
  for (const { label, source } of emissions) {
    const diagnostics = syntacticDiagnostics(ts, source);
    if (diagnostics.length > 0) failures.push({ label, diagnostics });
  }
  return failures;
}
