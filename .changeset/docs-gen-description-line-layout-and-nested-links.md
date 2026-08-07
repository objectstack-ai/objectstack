---
"@objectstack/spec": patch
---

fix(spec): docs-gen renders a module description as the markdown it was written as (#5553, #6136)

Two independent defects in `scripts/lib/file-description.ts`, both from a
transform applied at the wrong granularity. The block SELECTION rule #5059 added
is untouched: all 185 sources that carried a module header still render one, and
no page gained or lost an opening paragraph.

**#5553 — line layout is content, not decoration.** The renderer dropped every
blank line and joined what survived with `\n\n`, making each SOURCE LINE its own
paragraph. Anything that legitimately wraps across lines was then cut in half by
a paragraph boundary, and an inline code span cannot cross one, so both of its
backticks fell out as literal text — `` `explain(principal, object, `` /
`` operation)` `` on `security/explain`, and three more like it. The same pass
escaped `{` and `}` everywhere including inside code, where a backslash is not
an escape character but a character the reader sees, so pages published
`` `\{ dialect, source \}` ``.

The fix is to stop rewriting the layout: strip the ` * ` gutter and keep the
lines as authored. Markdown's own rules then do what the issue asked for —
consecutive lines are one paragraph, a blank line opens the next — and lists,
headings, tables and code blocks keep working, which the literal space-join the
issue floated would have broken on the 85 sources that write a list. Escaping and
link resolution are now scoped to prose: fenced and indented code blocks are
copied verbatim, and within prose a tokenizer keeps inline code spans out of
reach.

One construct is deliberately NOT reproduced as authored: an indented (4-space)
code block is re-emitted as a fenced one. MDX dropped CommonMark's indented code
blocks so that indentation could lay out JSX, so such a block reaches the MDX
compiler as ordinary prose — and unescaped braces in prose are an expression.
`data/date-macros` and `data/context-tokens` write their placeholder examples
that way and are almost entirely braces; left indented they fail to compile
("Could not parse expression with acorn"), and escaped instead they show `\{` in
what is meant to be code. The target dialect has one spelling for a code block.

Measured over the 185 rendered descriptions: paragraphs with unpaired backticks
8 → 0 (`automation/flow-function`, `security/explain`, `shared/expression`,
`system/settings-client`), and backslash-brace residue inside code 296 → 0 across
33 pages. 32 pages get their fenced `@example` sample back as a real code block
instead of one escaped paragraph per line, and 47 regain the indentation that
made a nested list nested. The issue named five victim pages; `system/doc` is not
among them because #5059 has since found its header documents `DocSchema` and
stopped publishing it.

**#6136 — a rewriter that ran over its own output.** The untitled
`{@link <path>}` branch emits `[<path>](<route>)`, whose link TEXT is the path
itself. The bare-source-path rewriter ran next over the whole string and matched
that text, wrapping it a second time into a link nested in a link. Lookaround
cannot express "not nested inside a link", so the rewriter is now applied per
prose token with formed links excluded. `automation/etl` and
`integration/connector` each get their "See also" back as one clickable link.

169 reference pages are regenerated. No runtime, package export or protocol
semantics change — this is the docs generator only.
