---
"@objectstack/metadata-protocol": patch
---

fix(data): an unknown field inside `where` / `$filter` / a filter AST is rejected, not answered with an empty list (#7534)

`POST /api/v1/data/showcase_invoice/query` with `{"where":{"not_a_field":"x"}}`
answered `200 {"records":[],"total":0}` — no `code`, no mention of the unknown
name — and identically through the `$filter` door and the filter-AST door. The
bare-key door on the same object with the same field name, in the same run,
answered `400 INVALID_FIELD`.

So one endpoint family gave **two verdicts for one mistake**, chosen by which
door the caller used, and the losing verdict is indistinguishable from "no
data". That is the exact failure #4134 was filed about: an unknown name is
lowered into a field-equality predicate that can only match zero rows.

This is **not** a regression of #4134 — that gate still holds on the door it
covers (measured at the branch point alongside the three failures). It is the
sibling door its fix never reached: `assertQueryParamsAreFields` gated only the
**implicit** filters `findData` derives from leftover query parameters, while
the **explicit** axes reached the driver ungated — even though
`resolveQueryFields` was written as "ONE resolution shared by all four read
axes".

**The gate.** A new `assertFilterFieldsExist` calls that same existing
resolution — additively; `resolveQueryFields` itself is unchanged — on the
normalized `where`. One call covers all three doors because they are not three
code paths: `where` / `filter` / `filters` / `$filter` resolve to one slot at
the #3795 fold, and a filter AST is lowered by `parseFilterAST` — the single
sink for that sugar — before the gate runs. The gate therefore reads the same
`FilterCondition` the driver will read, which is what keeps "the field the gate
saw" from drifting away from "the column that reached the driver".

Rejections carry the envelope the write path and the bare-key door already
produce — `400 INVALID_FIELD` + `field` + `fields` + `object` — plus `param`
naming the caller's own wire spelling (`$filter`, not `where`), and a message
that states the zero-row consequence, since that is the part a caller cannot
infer from a `200`.

**Deliberately unchanged.**

- **Precedence.** The gate runs *after* the #4134 param gate, so a request that
  gets both a bare key and its filter wrong answers exactly as it did before;
  and *before* the #4164 implicit/explicit merge, which is what still lets it
  name the axis the caller actually used.
- **Reach.** Structure is discarded — `$and` / `$or` / `$not` are recursed
  into — but a field key's VALUE is not descended into: it is either an operator
  bag (`{$gte: 18}`) or a nested-relation condition (`{owner_id: {region:
  'NA'}}`) whose keys belong to a *different* object. Judging those against this
  object's field map would refuse legitimate relation filters. A dotted path is
  judged on its head segment, the same reach the bare-key door has on
  `owner_id.name`. An unrecognised `$`-combinator is skipped without descending —
  a hole rather than a false rejection, the right failure direction for a gate
  that exists to stop wrong answers.
- **The honest zero.** A real field that genuinely matches nothing is still a
  `200` with `total: 0`. A filter that cannot be *run* at all is still
  `INVALID_FILTER` (#4121 / #4181), which answers first; this gate answers only
  "does this field exist".
