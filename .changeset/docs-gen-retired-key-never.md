---
"@objectstack/spec": patch
---

fix(spec): the reference generator prints a `retiredKey()` tombstone as `never`, not `any` (#5606)

`retiredKey()` is `z.never()`, which `z.toJSONSchema` emits as `{ "not": {} }` —
a node with no `type`, no `$ref` and no `enum`. `formatType()` had no branch for
it, so every one of the ~28 tombstones in the spec fell through to the
`prop.type || 'any'` tail and the generated reference pages typed a **removed**
key as **`any`**.

That is the worst available rendering for a retirement. These pages are the
primary input for an upgrading author — very often an AI one (ADR-0033) — and
`heading?: any` does not read "this key was deleted", it reads "this slot exists
and nothing validates it": strictly *more* inviting than the `heading?: string`
it replaced. The author writes it, the parse rejects it with the `[REMOVED]`
prescription, and the prescription arrives only after a wrong metadata file
already exists.

Two changes, both in `scripts/lib/format-type.ts`:

- **`{ not: {} }` now renders as `never`.** Accurate TypeScript — the key's
  `z.input` type *is* `never` — and, unlike `any`, self-evident with no prose
  to lean on.
- **Tombstones are dropped from an inline shape summary before
  `INLINE_KEY_LIMIT` counts.** A summary cell prints `k?: type` for the first
  four declared keys and has no description column, so a nested tombstone had
  nowhere to put its prescription at all: `ui/theme.mdx` advertised
  `{ base?: string; heading?: any; mono?: any }` with both prescriptions
  appearing NOWHERE on the page. Retired keys are no longer authorable surface,
  so they no longer spend one of the four slots — nor push a key the author
  must write behind the `…`. The known workaround of moving a tombstone to the
  bottom of the shape cannot cover this: #5248 retired `IndexSchema` down to
  three live keys, and with a limit of four the first tombstone is then
  *mathematically* guaranteed into the summary.

Per-key table rows are unaffected and keep carrying the full `[REMOVED]`
prescription in their description column; their type cell simply now says
`never` instead of `any`.
