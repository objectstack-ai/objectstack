---
'@objectstack/spec': patch
---

The field designer no longer offers a `master_detail` a `deleteBehavior` the schema refuses

#9689 made `deleteBehavior: 'set_null'` authored on a `master_detail` field a
named parse-time rejection. The two shipped metadata forms that let a Studio
author pick that value did not move with it, so the designer kept offering
"Set null" for a `master_detail` — the author picked it and learned only at
publish, from a 422, that the choice was never legal. Declared-vs-enforced, one
seam earlier than the parse door.

Both forms failed the same way through **different option sources**, which is
why the repair is not one edit twice:

- `object.form.ts` declared an inline `options` array carrying all three values
  behind a single `visibleWhen` that named both `lookup` and `master_detail`.
- `field.form.ts` declared **no** `options` at all. That is not a narrower
  offer — it is the renderer's derived source: with no inline list the
  metadata-admin form falls through to the JSON Schema `enum`, which is
  `['set_null','cascade','restrict']` and additionally advertises
  `default: 'set_null'`. A Zod enum has no per-type narrowing to give, so the
  derived path re-offers the refused value by construction, and `master_detail`
  can only be served by an explicit list.

Both now declare the control **twice, with disjoint `visibleWhen`** — `lookup`
keeps all three outcomes, `master_detail` is offered `cascade` and `restrict`
only. Nothing is taken away from `lookup`, where all three remain legal:
`object.form.ts` keeps its three-value list unchanged, and `field.form.ts`'s
`lookup` branch keeps deriving from the enum exactly as before, so its labels
and their translation are untouched. The two branches are mutually exclusive, so
no author ever sees both.

**Per-option `visibleWhen` was the tighter-looking spelling and was measured and
rejected.** `SelectOptionSchema` does declare it (ADR-0068), so it reads as
existing vocabulary, but it is not reachable from a metadata form in either
direction: the metadata-admin renderer maps `fieldSpec.options` straight to
select items and never consults it, so writing one would ship an ADR-0049
declared-but-unenforced key; and on the runtime surface that *does* honor it,
the per-option evaluator binds `record` and never `data`, so a `data.`-rooted
predicate there is an unbound identifier whose visibility fails **open**,
keeping the option. Either way the author would still have been offered
"Set null" — a fix that silently does nothing. Field-level `visibleWhen` is the
predicate the renderer already evaluates for every other type-conditional
control in these files, so the split uses it and the form DSL is unchanged.

The pinning test asserts more than the absent value: it requires **exactly one**
visible control per type, because two declarations of one key can fail by
overlapping (two selects writing one key) as well as by leaving a gap (the
control vanishes for that type).
