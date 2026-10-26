// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `comment-swallow/no-code-inside-block-comment`. The root `eslint.config.mjs`
// registers it over `COMMENT_SWALLOW_FILES`; `test/comment-swallow.test.ts`
// carries the pinned cases that used to run where the config loads.
//
// The comments below moved verbatim from `eslint.config.mjs`; "above" and
// "below" in them refer to that file.

// ---------------------------------------------------------------------------
// issue #9758 — a statement swallowed by an unterminated block comment.
// ---------------------------------------------------------------------------
//
// A block comment that is never closed is NOT a syntax error. The next comment
// terminator in the file closes it — normally the docblock of the following
// declaration — so the file parses, every gate stays green, and the only
// symptom is a statement that quietly stopped existing. #9640 is one instance:
// `export { maskComments };` in `scripts/pm/dispatch-gates.mjs` had been comment
// TEXT, while that module's own header went on claiming the re-export.
//
// The class is invisible to review and trivial to parse: the swallowed line
// looks like code (textually it IS code) and the terminator looks like it
// belongs to the docblock below. ESLint already visits every file with a real
// parser and hands a rule the comment nodes for free, so the checker is the
// predicate below and nothing else.
//
// ## Why a rule here and not a `check:*` family — #9758's question, measured
//
// #9758 recorded the class at 1 instance in 4,595 files and asked whether that
// base rate earns a checker at all. Re-derived on this tree — 4,679 files, a
// real parser rather than the repo masker — the count is 0: #9640 was the
// singleton and its PR repaired it.
//
// A zero base rate is a real argument against a new gate FAMILY: a script, a
// workflow step, a required context, its own self-test and watch hints, and one
// more line of reader attention in every dispatch derivation, all to hold a
// class nobody trips. It is not an argument against THIS, which is one rule in
// the file that already carries three inline plugins, under a `pnpm lint` that
// already parses all 4,679 files. Zero new CI steps, zero new required
// contexts, zero new check families, zero new dispatch leads.
// `verify-stand-in/no-asserted-driver-argument` below is the precedent for a
// guard that starts at a zero baseline: the state worth having is that the
// count stays 0, and holding a 0 is what a rule is for.
//
// ## The false-positive surface, which is the whole risk — measured
//
// Commented-out code is legitimate and common, so a predicate that flags every
// code-shaped line inside a block comment is unshippable. Two facts bound it,
// both measured over this tree's 21,007 multi-line block comments:
//
//   • all 240,529 of their interior source lines carry the `*` prose marker —
//     not most, all. So exempting marker lines costs no recall on real prose,
//     and it is what makes the predicate quiet: 540 interior lines ARE
//     code-shaped (`@example` blocks — `* import { createHonoApp } from …`,
//     `* export default app;`) and every one of them is a marker line. Without
//     the exemption those 540 are false positives; with it they are invisible.
//   • the predicate matches statement SHAPES, not statement keywords. `let`,
//     `class`, `type`, `import` and `export` are ordinary English words, and a
//     keyword test flags prose that opens with one. `let us assume…` does not
//     match `let <ident> [:=]`; `class hierarchies are…` does not match
//     `class <ident> (extends|implements|{|<)`; `import lists are…` does not
//     match an import form. Those three are in the pinned cases below.
//
// Against those two, plus the block-comment OPENER signature (comments do not
// nest, so a `/*` at the head of a line inside a comment span is the structural
// signature of "never closed"), a sweep over 261,536 candidate lines in 4,679
// files reports 0. So the rule ships with no baseline and no ignores beyond the
// build directories — there is nothing to grandfather.
//
// ## What it cannot see, stated rather than implied
//
// ESLint never sees a file that does not parse, so this rule's domain is
// exactly the SILENT half of the class. When the swallowed span happens to
// leave behind text that is not valid JavaScript — a glob literal such as
// `packages/` + `**` + `/*.ts` carries a comment terminator and closes a
// phantom span mid-token — the parser rejects the file loudly and no checker is
// needed. That split is also why the predicate is allowed to be narrow: the
// loud half is already covered, by the compiler.
//
// The other half it cannot see is a swallowed line that is neither
// statement-shaped nor a comment opener — a bare call, a JSX fragment, an
// object continuation. Widening to "any line inside a block comment without a
// `*` marker" would catch those and measures 0 on this tree too, but it is a
// STYLE claim wearing a defect's clothes: it would reject a perfectly ordinary
// marker-less `/*  TODO: …  */` block, and this repo lints with
// `--no-inline-config`, so there would be no per-site escape from it. The
// escape that does exist is the house style itself — prefix the line with `*`.


export const COMMENT_SWALLOW_MESSAGE =
  'This line is inside a block comment, and it is shaped like code. That is the signature of a ' +
  'block comment that was never closed: an unterminated opener is not a syntax error — the next ' +
  'comment terminator in the file closes it, usually the docblock of the following declaration — ' +
  'so the file parses, every gate stays green, and a statement quietly stops existing while the ' +
  'header above it goes on describing it (#9640: `export { maskComments };` was comment text for ' +
  'as long as nobody looked). Add the missing terminator to the comment above. If the line really ' +
  'is prose or a deliberately commented-out example, prefix it with the `*` marker every one of ' +
  "this tree's 240,529 block-comment lines already carries — that is the exemption, and it is the " +
  'house style rather than an opt-out. See issues #9640 and #9758.';

/**
 * Statement SHAPES, not statement keywords — see the false-positive section
 * above. Each pattern is anchored on the punctuation that makes the line code
 * rather than a sentence that happens to open with a reserved word.
 */
export const COMMENT_SWALLOW_PATTERNS = [
  // `export { a };` / `export * from './x';` / `export default f;`
  /^export\s*(?:\{|\*|default\b)/,
  // the four import forms, and none of `import lists are checked elsewhere,`
  /^import\s*(?:\{|\*|type\s|['"]|[A-Za-z_$][\w$]*\s*(?:,|from\b))/,
  // a binding: `const x =`, `let { a } =`, `export var n:` — never `let us …`
  /^(?:export\s+)?(?:const|let|var)\s+(?:[{[]|[A-Za-z_$][\w$]*\s*[:=])/,
  // `function f(`, `async function* g<`, `export default function h(`
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*[A-Za-z_$][\w$]*\s*[(<]/,
  // `class C {` / `export abstract class C extends D` — never `class hierarchies …`
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Za-z_$][\w$]*\s*(?:extends\b|implements\b|\{|<)/,
  // the TypeScript declaration shapes
  /^(?:export\s+)?(?:declare\s+)?interface\s+[A-Za-z_$][\w$]*\s*(?:extends\b|\{|<)/,
  /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+[A-Za-z_$][\w$]*\s*\{/,
  /^(?:export\s+)?type\s+[A-Za-z_$][\w$]*\s*[=<]/,
  // CommonJS, which `scripts/` still writes
  /^(?:module\.exports|exports\.[A-Za-z_$][\w$]*)\s*=/,
  // a block-comment OPENER. Comments do not nest, so one that begins a line
  // inside a comment span is the structural signature of "never closed" — and
  // in the #9640 shape it is the docblock of the declaration below, which is
  // exactly the thing that made the defect unreadable.
  /^\/\*/,
];

/**
 * True when this source line, taken on its own, reads as code rather than
 * prose. The caller supplies the fact that the line lies inside a block-comment
 * span; this half decides nothing about spans and everything about shape.
 *
 * @param {string} sourceLine
 */
export function looksLikeSwallowedCode(sourceLine) {
  const text = sourceLine.trim();
  if (!text || text.startsWith('*')) return false;
  return COMMENT_SWALLOW_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The extension list is load-bearing and DELIBERATELY wider than the
 * `verify-stand-in` block's: it carries `js`/`jsx`/`mjs`/`cjs`. The only
 * instance this class has ever had on this tree was `scripts/pm/
 * dispatch-gates.mjs`, a `.mjs` file, and a block copied from the
 * `{ts,tsx,mts,cts}` sibling below would have covered every file except the
 * one kind that has actually carried the defect. `test/comment-swallow.test.ts`
 * pins it, so the narrowing cannot happen quietly.
 */
export const COMMENT_SWALLOW_FILES = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];

/** @type {{ rules: Record<string, import('eslint').Rule.RuleModule> }} */
export const commentSwallowPlugin = {
  rules: {
    'no-code-inside-block-comment': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Ban a code-shaped line inside a block-comment span — the signature of a block ' +
            'comment that was never closed.',
        },
        schema: [],
        messages: { swallowed: COMMENT_SWALLOW_MESSAGE },
      },
      create(context) {
        return {
          Program() {
            const { sourceCode } = context;
            const lines = sourceCode.lines;
            for (const comment of sourceCode.getAllComments()) {
              if (comment.type !== 'Block') continue;
              const { start, end } = /** @type {import('eslint').AST.SourceLocation} */ (comment.loc);
              if (end.line === start.line) continue;
              // From the line AFTER the opener through the terminator's own
              // line. The opener's line is excluded because whatever precedes a
              // `/*` on it is live code; the terminator's line is INCLUDED
              // because a span can close mid-line, on a line that is otherwise
              // a statement — a regex or a glob literal a few lines down
              // carries a terminator and ends the phantom span right there.
              for (let line = start.line + 1; line <= end.line; line++) {
                const text = lines[line - 1];
                if (text === undefined || !looksLikeSwallowedCode(text)) continue;
                context.report({
                  loc: { start: { line, column: 0 }, end: { line, column: text.length } },
                  messageId: 'swallowed',
                });
              }
            }
          },
        };
      },
    },
  },
};
