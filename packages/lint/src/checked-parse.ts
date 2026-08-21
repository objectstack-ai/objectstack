// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `@objectstack/lint`'s ONE answer to "did this source actually parse?" (#10653).
//
// ## The defect this closes — and it is NOT the `try/catch` it replaced
//
// **`ts.createSourceFile` never throws.** Hand it merge-conflict markers, an
// unterminated comment or a truncated body and it returns a `SourceFile` built
// by error recovery, indistinguishable from any other: the errors are parked on
// `parseDiagnostics`, which nothing in this package read. A validator then walks
// that wreckage, finds none of the shapes it is looking for, and returns an
// empty finding list — **a source the validator could not read, reported as a
// source with nothing to report.**
//
// The three call sites this module was extracted from each carried a
// `try/catch` around the parse, and two of them read as if the catch were the
// guard. It never ran. Measured here on 2026-08-21 against TypeScript 6.0.3 —
// every one of these returns a tree, throws nothing, and is walked as if clean:
//
//   source                        ScriptKind.TS   ScriptKind.TSX   threw?
//   ---------------------------   -------------   --------------   ------
//   merge-conflict markers        3 diagnostics   3 diagnostics     no
//   truncated function body       1 diagnostic    1 diagnostic      no
//   unterminated string           1 diagnostic    1 diagnostic      no
//   unterminated block comment    1 diagnostic    1 diagnostic      no
//   a JSX element                 1 diagnostic    0                 no
//
// The last row is the same defect wearing the `ScriptKind` hat, and it is why
// the answer lives in one module rather than three: the question "did this
// parse?" has one right answer and three places that were getting it wrong in
// slightly different ways. `checked-parse.test.ts` pins the measurement so the
// premise above cannot rot into a comment nobody re-ran — including the row
// that matters most, that the diagnostics are REACHED (see the non-vacuity
// case there, and `parseDiagnostics` below).
//
// ## Why a returned FINDING rather than a refusal
//
// `scripts/ts-parse.mjs` answers the same question for repo tooling and answers
// it by REFUSING — correct there, because a `scripts/**` gate audits a tree its
// own author controls. A publish-time validator is in the opposite position: it
// is handed metadata by someone else, and ending the process on their input is
// not its call. So this module reports, and every caller turns the report into
// a finding the author receives at authoring time. Nothing here throws, and
// nothing here decides severity — that belongs to the rule.
//
// ## Why lint-local, and not the two neighbours it could have been
//
//   • NOT `scripts/ts-parse.mjs`: `@objectstack/lint` is PUBLISHED and packs
//     `dist, README.md, CHANGELOG.md`. A published package that asks repo
//     tooling whether something parsed trades this bug for a worse one — the
//     objection `invoked-as.mjs` already argued for its own `packages/cli`
//     sibling, and the reason #10606 existed at all.
//   • NOT a new shared `@objectstack/…` package: a published dependency built
//     for four call sites, argued down in the same place.
//
// The TypeScript module is a PARAMETER, never an import: `@objectstack/lint`
// sits on the kernel boot path and `typescript` is ~9 MB of CJS, so every
// caller here loads it lazily and only when a source actually needs parsing.
// This module must therefore stay type-only in its imports (`lazy-deps.test.ts`
// is the guard).
import type ts from 'typescript';

/**
 * `parseDiagnostics` is where the parser parks syntax errors, and it is not on
 * the public `SourceFile` type — the property is internal to the compiler and
 * reached here by a narrowing cast rather than by `as any`.
 *
 * Declaring it OPTIONAL is deliberate: if a future TypeScript renames or drops
 * it, this reads `undefined` and every checked parse silently returns to the
 * behaviour this module exists to remove — a green line about a source nobody
 * could read. That failure mode is invisible by construction, so it is pinned
 * in `checked-parse.test.ts` instead of being trusted here.
 */
interface SourceFileWithParseDiagnostics {
  readonly parseDiagnostics?: readonly ts.Diagnostic[];
}

/** What a caller needs to tell an author WHICH source went unread, and where. */
export interface SourceParseFailure {
  /** The first parse diagnostic, in the compiler's own wording, flattened to one line. */
  message: string;
  /** 1-based line, in the AUTHORED source's coordinates (see `synthesizedLinesBefore`). */
  line: number;
  /** 1-based column. */
  column: number;
  /** How many parse diagnostics in total — `message` is the first of `count`. */
  count: number;
}

/** A parse plus the verdict on whether it succeeded. `failure` absent ⇒ it parsed. */
export interface CheckedParse {
  /**
   * The tree, ALWAYS returned — including when `failure` is set. Error recovery
   * produces a partial tree, and a caller that already reports findings from it
   * keeps doing so: the fix here is the missing SIGNAL, not the removal of
   * whatever the recovered tree could still be read for.
   */
  sourceFile: ts.SourceFile;
  /** Set when the parser reported at least one syntax diagnostic. */
  failure?: SourceParseFailure;
}

export interface CheckedParseOptions {
  target: ts.ScriptTarget;
  setParentNodes: boolean;
  scriptKind: ts.ScriptKind;
  /**
   * Lines the CALLER synthesised ahead of the authored source, subtracted from
   * the reported position so it lands in the author's coordinates.
   *
   * `validate-hook-body-writes.ts` parses an L2 hook body wrapped in
   * `async function __body(ctx) {\n…\n}` — the shape the runtime compiles it
   * into — so its diagnostics are one line low. The reported line is clamped to
   * at least 1, so a diagnostic that lands on a synthesised line is attributed
   * to the nearest AUTHORED line and never to a line the author did not write.
   */
  synthesizedLinesBefore?: number;
}

/**
 * `ts.createSourceFile`, with the diagnostics READ.
 *
 * Never throws and never exits: the verdict comes back as data.
 */
export function createSourceFileChecked(
  tsc: typeof ts,
  fileName: string,
  source: string,
  options: CheckedParseOptions,
): CheckedParse {
  const sourceFile = tsc.createSourceFile(
    fileName,
    source,
    options.target,
    options.setParentNodes,
    options.scriptKind,
  );
  const diagnostics = (sourceFile as unknown as SourceFileWithParseDiagnostics).parseDiagnostics;
  if (!diagnostics || diagnostics.length === 0) return { sourceFile };

  const first = diagnostics[0]!;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(first.start ?? 0);
  const offset = options.synthesizedLinesBefore ?? 0;
  return {
    sourceFile,
    failure: {
      message: tsc.flattenDiagnosticMessageText(first.messageText, ' '),
      line: Math.max(1, line + 1 - offset),
      column: character + 1,
      count: diagnostics.length,
    },
  };
}

/**
 * The one wording every caller's message embeds, so three findings about the
 * same defect do not describe it three ways.
 */
export function describeParseFailure(failure: SourceParseFailure): string {
  const more = failure.count > 1 ? `; ${failure.count} syntax errors in total` : '';
  return `line ${failure.line}, column ${failure.column}: ${failure.message}${more}`;
}

/**
 * The hint every caller's finding carries. It says what the finding IS — a
 * statement about what the checker could read, not a second syntax verdict —
 * because a source that does not parse is not scored, and an author who reads
 * "no problems found" about it would be reading a green line that lied.
 */
export const PARSE_FAILURE_HINT =
  'The source is parsed (never executed) so it can be checked. A source with syntax errors is only ' +
  'partially recovered, so the checks that follow may have skipped real problems — fix the syntax ' +
  'error and re-run to get a verdict that covers the whole source.';
