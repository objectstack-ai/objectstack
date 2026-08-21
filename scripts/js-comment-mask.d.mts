// Types for the code/prose separator `js-comment-mask.mjs` exports to other
// gates — the same problem, and the same fix, as `check-regen-pending.d.mts`
// next door (#5475).
//
// The module itself stays `.mjs`: it carries a `--self-test` entry point run
// with bare `node`, and every root script here is authored that way. What
// changed is that a gate under
// `packages/spec/scripts/` now imports it (`check-browser-reachable-entries.ts`,
// #10199), and since #5475 that directory is inside a tsc program
// (`tsconfig.scripts.json`), where an untyped `.mjs` import is TS7016 — the
// scanner silently becomes `any`, and reading `.comment` off a misspelled
// property would type-check clean.
//
// The two flag arrays are the load-bearing part of the surface, so they are
// typed precisely: a caller that confuses them inverts the very question this
// module exists to answer once (see the module's header on the two failure
// families).
//
// Declared rather than inferred (no `allowJs`) because the module sits at the
// repo root, outside the consuming program's `rootDir`. Keep this file in step
// with the module by hand, and keep it small enough that doing so stays trivial.

/**
 * Per-character flags from one left-to-right pass over a JS source.
 *
 * Both arrays are the same length as the source, so an offset into either
 * indexes the same character in the original text.
 *
 * `comment` flags comment CONTENT (line, block and shebang). `literal` flags
 * the CONTENT of a string, template or regex literal — **not** its delimiters,
 * so a caller still sees the opening and closing quote as code and can pair
 * them. Template interiors are flagged through `${...}` as well.
 */
export interface SourceFlags {
  comment: Uint8Array;
  literal: Uint8Array;
}

/**
 * Flag every character of `source` as comment content and/or literal content.
 *
 * @param source JavaScript (or TypeScript-shaped) source text.
 */
export function scanSource(source: string): SourceFlags;

/**
 * Replace every character flagged in `flags` with a space, keeping newlines —
 * so both byte offsets and line numbers survive the mask.
 */
export function blank(source: string, flags: Uint8Array): string;

/**
 * `source` with its COMMENT characters REMOVED and every newline kept: line
 * numbers survive, byte offsets do NOT, and the text gets much shorter.
 *
 * Pick this when the caller feeds a scanner and reports neither an offset nor a
 * column — a lazy regex over the whitespace that `maskComments` leaves behind
 * is quadratic in the comment bytes (measured: 6.4s → 5m27s on one gate).
 */
export function stripComments(source: string): string;

/**
 * `source` with its COMMENT spans blanked and strings, templates and regex
 * literals left INTACT. Offsets and line numbers both survive.
 */
export function maskComments(source: string): string;

/**
 * Drive the scanner over its own fixture corpus, printing a line per case.
 *
 * Returns nothing: a failing case calls `process.exit(1)` rather than reporting
 * a value, so there is no verdict for a caller to forget to read.
 */
export function selfTest(): void;
