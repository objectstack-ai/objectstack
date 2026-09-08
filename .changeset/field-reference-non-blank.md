---
"@objectstack/spec": minor
---

fix(spec): `FieldSchema` refuses a WHITESPACE-ONLY `reference` on `lookup` / `master_detail`

**BREAKING** accept-set narrowing on `FieldSchema`, shipped as `minor` under the
repo's launch-window convention for breaking changes — the same grade the nearest
tightening precedents shipped with, including #13632, the narrowing this one
finishes.

#13632 closed the declared-but-unenforced gap on `FieldSchema.reference` in 17.3.0,
but spelled its emptiness test as an equality against `''`, so a whitespace-only
target (`reference: '   '`) passed a door whose whole purpose is to name an object.
Measured on the built artifact before this change: absent and `''` were refused,
`'   '` and `'\t\n'` were **accepted**, at both the field level (`FieldSchema`) and
the document level (`ObjectSchema`), on `lookup` and `master_detail` alike.

A blank target names no object either. The declared grammar for an object name is
`/^[a-z_][a-z0-9_]*$/` (`ObjectSchema`'s own `fields` key schema), so no
whitespace-bearing string can ever resolve to one, and all three consequences the
existing refusal message lists hold verbatim for `'   '`: the record picker has no
object to query, `$expand` has nothing to resolve, and no relationship index can be
built. It is also the state a cleared target picker emits — `''` and `'   '` are one
authoring gesture that was getting opposite verdicts.

What newly gets rejected: `type: 'lookup'` or `type: 'master_detail'` whose
`reference` is present but consists only of whitespace. It joins absent and `''`
under the same `custom` issue, on the same `reference` path, with the same
prescriptive message — no new message and no new error shape. The notion of blank
is `.trim()`, the same one `EvaluatedExpressionSchema` applies to `source`, not a
third one.

Everything else is untouched. Trimming is applied to the TEST only, never to the
stored value: a target with surrounding whitespace (`' company '`) is still accepted
and still round-trips byte-identically. A non-string `reference` still answers
`invalid_type` from the base schema, not the custom message — that distinction is
deliberate and pinned. Non-relationship types never carried the requirement, and the
`Field.lookup()` / `Field.masterDetail()` helpers take the target as their first
positional argument, so helper-authored fields cannot produce this shape.

The measured population of affected authored sources is zero: one repo-wide census
over all tracked files found a single whitespace-only `reference` in the tree, an
objectql test fixture cast past Zod on the documented `registerObject` path that
skips schema validation by design — it does not reach this door, and it is green
after the change. The census and its positive controls are recorded on the PR.
Downstream, objectui's two metadata writers already refuse this shape with
`reference.trim() !== ''`; upstream trimming turns their declared divergence into
contract-following, and that note can now be retired.

<!-- adr-0087: not-required (no-migration-prescription) A validity narrowing over an existing key: `reference` is not removed, renamed or re-shaped, so there is no tombstone and nothing mechanical for `objectstack migrate meta` to rewrite. The parse refusal is the channel that reaches an affected author, at the parse site, carrying the remedy; which target object a blank `lookup` / `master_detail` was meant to point at is authoring intent no migration entry can decide on an upgrader's behalf — and the measured population of affected sources is zero across all tracked files (census on the PR). Mirrors the disposition of #13632, whose emptiness test this completes. -->
