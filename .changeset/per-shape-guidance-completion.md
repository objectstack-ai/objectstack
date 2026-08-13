---
"@objectstack/spec": patch
---

docs(spec): a rejection says which shape refused the key, and a select option gets the editability boundary (#8202, #8201)

Two text-face halves finishing the story PR #8199 started. No key is added
anywhere, every spelling rejected before is rejected after, and everything that
parsed before parses identically — only the sentence an author reads moves.

## #8202 — per-shape `surface` strings

`FormFieldSchema`, `FormSectionSchema` and `PageComponentSchema` shared one
surface string, so every rejection opened `Unrecognized key(s) on this view/page
schema`. Harmless while the three answered a key identically; since #8199 they
do not:

- on a **field**, `disabled` gets a rename pointer — *Did you mean `disabled` →
  `readonly`?*
- on a **section** or **page component**, it gets the editability-boundary
  prescription — *write `readonly` on the form field(s) inside instead.*

Those two answers contradict each other by design, and the contradiction only
reads correctly if the message says which shape the author is on. It now does:
`this form field` / `this form section` / `this page component`. Per #8199's
placement rule the strings are filed at the three call sites rather than in the
shared options table — a table shared by three shapes can no more carry one
shape's name than it can carry one shape's prescription. The shared table keeps
the family name, and no live declaration may still report it
(`alias-integrity.test.ts`).

## #8201 — `SelectOptionSchema` inherits the #7887 ruling

The maintainer ruling of 2026-08-12 (a form section / page component gates
visibility only; editability lives on fields) was scoped to two shapes, and
#8199 left the third — a select option — with a bare rejection. It has the
boundary now, on the ruling's own premise re-measured for this shape rather than
by analogy: on objectui `origin/main` @ `aca27fa` the object-field pipeline these
options feed has **zero** per-option `disabled` consumers (`SelectField.tsx:161`
calls the root-level `disabled` "the single authority"; `RadioField.tsx:124`
reads only `props.disabled`). The shown-but-unselectable option that does exist
lives in objectui's SDUI vocabulary, which is not this shape.

Its prescription is **not** the siblings' text, because the siblings'
destination does not exist here — a section redirects to the fields inside, and
an option has no inside. Writing `disabled` on an option now points at the two
things that are real: per-option `visibleWhen` to withdraw that one option (the
only `*When` surface that binds `current_user`, ADR-0068 — and the rule
validator refuses a write of a value whose predicate is false), and
`readonly` / `readonlyWhen` on the **field** to freeze the whole picker. It
states what the platform honours today; a non-selectable field option remains a
spec decision someone may ask for, not a key an author writes.

## Why `patch`, measured rather than inherited

The criterion is whether the prose reaches a consumer:

- **Parse-reachable error string — YES.** Both halves are `unrecognized_keys`
  message text an author reads out of a failed parse, and every claim is pinned
  against a real `safeParse` error rather than against the options table.
- **`dist/**/*.d.ts` hover — YES for #8201.** The boundary paragraph is JSDoc on
  the exported `SelectOptionSchema` const.
- **Generated reference page — NO, measured.** `content/docs/references/data/`
  `field.mdx` is built from the file-level doc block plus per-property
  `.describe()` text; a schema's own JSDoc is not rendered (grepping the page
  for `SelectOptionSchema`'s existing docblock text returns nothing, while its
  per-key `.describe()` string hits). No `.describe()` was touched, so the page
  and `authorable-surface.base.json` do not move.

One reachable consumer is enough and no public export is added, so `patch`.
