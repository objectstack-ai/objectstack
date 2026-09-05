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
// The three flag arrays are the load-bearing part of the surface, so they are
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
 * All three arrays are the same length as the source, so an offset into any of
 * them indexes the same character in the original text.
 *
 * `comment` flags comment CONTENT (line, block and shebang). `literal` flags
 * the CONTENT of a string, template or regex literal — **not** its delimiters,
 * so a caller still sees the opening and closing quote as code and can pair
 * them. Template interiors are flagged through `${...}` as well.
 *
 * `interpolation` flags the bytes a template interpolation contributes, which
 * the language RUNS as code. Those same bytes are flagged `literal` too — that
 * answer does not move — so a caller wanting the view the language would
 * execute masks `literal && !interpolation`, which is exactly how
 * `scripts/pm/dispatch-gates.mjs` counts an identifier inside `${...}` as a
 * reference. The `${` and its closing `}` stay OUT of it (a bracket counter
 * over the subtracted view stays balanced), and so does a nested template's
 * body inside the interpolation (those bytes really are content).
 */
export interface SourceFlags {
  comment: Uint8Array;
  literal: Uint8Array;
  interpolation: Uint8Array;
}

/**
 * Flag every character of `source` as comment content, literal content and/or
 * interpolation code.
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
 * `source` with its COMMENT spans AND its LITERAL content both blanked.
 * Offsets and line numbers both survive, exactly as under `maskComments`.
 *
 * Pick this when the signal is a bare CODE position (`new SchemaRegistry(`, a
 * property key): under `maskComments` the same spelling inside a string or a
 * template still satisfies it, so the gate reports a finding made of quoted
 * text. Literal DELIMITERS are not literal content, so the quotes survive and
 * a caller can still pair them.
 */
export function maskCommentsAndLiterals(source: string): string;

/**
 * The outcome of walking the body of the regex literal opening at `at`.
 *
 * `closed: true` means `end` is the index of the CLOSING `/`. `closed: false`
 * means the body ran into a LineTerminator or EOF and `end` is where it
 * stopped — what THAT means is the caller's to decide, and the two consumers of
 * this walk decide it differently on purpose (see the module's header).
 */
export interface RegexBodyWalk {
  end: number;
  closed: boolean;
}

/** IdentifierPart, near enough for the ASCII this tree is written in. */
export const IDENT_CHAR: RegExp;

/**
 * Keywords after which a `/` opens a REGEX rather than a division. Shared, so
 * that a second copy cannot drift: dropping `return` from it passes every
 * pinned case and is caught only by the corpus sweep.
 */
export const REGEX_AFTER_KEYWORD: ReadonlySet<string>;

/** LineTerminator — the four the grammar names, which a regex body excludes. */
export function isRegexLineTerminator(c: string): boolean;

/**
 * Walk the body of the regex literal opening at `at`, which the CALLER has
 * already decided sits where an expression may begin.
 */
export function walkRegexBody(src: string, at: number): RegexBodyWalk;

/**
 * Bind a POSITION RULE to the shared walk and get back a recogniser answering
 * "index of the closing `/`, or -1". There is no default rule and omitting one
 * throws — a default would be one of two opposite failure directions, handed
 * silently to whichever caller forgot.
 */
export function makeRegexRecogniser(options: {
  mayBeginAt: (src: string, at: number) => boolean;
}): (src: string, at: number) => number;

/**
 * Drive the scanner over its own fixture corpus, printing a line per case.
 *
 * Returns the module's verdict sentinel, reached only once the success line has
 * been printed — the handshake its own CLI dispatch performs: that dispatch
 * compares the returned value by identity and exits 1 on anything else, so a
 * `return` leaving this function above the verdict cannot be reported as a
 * self-test that passed. A failing case still calls `process.exit(1)`. The
 * sentinel constant is not exported, so `string` is the widest type a caller
 * can name for it.
 */
export function selfTest(): string;
