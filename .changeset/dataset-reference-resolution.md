---
'@objectstack/lint': minor
---

Resolve an ADR-0021 dataset's own references — base object, `include[]`,
`dimensions[].field` / `measures[].field`, and filter KEYS — at
`validate`/`build` (#14105)

A dataset could name a **base object that does not exist**, join a
**relationship that does not exist**, and bind every dimension and measure to
**fields that do not exist**, and `objectstack validate` exited **0** with
`✓ Validation passed`. `objectstack build` also exited 0 and wrote the dangling
dataset into `dist/objectstack.json`.

The sting was that the author-time rule pass **already walked those exact
nodes**. Measured on published 17.2.0, each mutation applied on its own and
confirmed on disk before running:

| mutation                                            | before | after |
|:----------------------------------------------------|:-------|:------|
| dimension `field` → a base field that does not exist | passed | `dataset-field-unknown` |
| dimension `field` → a joined field that does not exist | passed | `dataset-field-unknown` |
| measure `field` → a field that does not exist        | passed | `dataset-field-unknown` |
| measure filter KEY → a field that does not exist     | passed | `dataset-filter-field-unknown` |
| `include[]` → a relationship that does not exist     | passed | `dataset-include-unknown` |
| `object` → an object that does not exist             | passed | `object-reference-unknown` |

The two controls in that measurement — a duplicate measure name
(`DatasetSchema.superRefine`) and a bad date macro in a **measure filter**
(`filter-token-unknown`) — both failed the build, so datasets were
demonstrably in the validation path the whole time. `filter-token-unknown`
already stood at `datasets[1].measures[1].filter.last_update_at.$lt` and
reasoned about the **value**; nothing standing in that same position resolved
the **key**, or the sibling `field` one level up.

This matters more for a dataset than for most metadata because a dataset is the
semantic layer: dashboards and reports bind its dimensions and measures by name
(ADR-0021), and the consumer end of that binding is already guarded
(`widget-dataset-unknown` / `widget-dimension-unknown` / `widget-measure-unknown`,
#7529/#8902). So the surviving hole was the quiet one — every binding resolves,
the board renders, and the charts are empty or subtly wrong because the dataset
underneath addresses columns that do not exist.

**Five verdicts, all `error`.** Four are new rule ids on a new suite member,
`validateDatasetReferences`:

- `dataset-include-unknown` — an `include[]` entry that resolves to nothing, or
  to a field that is not a relationship, so no join can be derived from it.
- `dataset-field-unknown` — a dimension or measure `field` path that resolves to
  no column, on the base object or on any joined object along the path.
- `dataset-field-not-included` — the second real check: a dotted path that
  RESOLVES, but whose relationship prefix was never declared in `include`.
  ADR-0021 D-C joins only declared paths, so the column is out of the query's
  reach however real it is.
- `dataset-filter-field-unknown` — a filter key on `Dataset.filter` or
  `measures[].filter`, in any of the three authored filter shapes.

The fifth, the base object itself, lands on `validateObjectReferences` as a new
`datasets[].object` reference site rather than as a sixth id here. That rule's
charter IS object-name references that are plain `z.string()`, and putting it
there buys the curated cross-package severity ladder: the platform's own
`system.datasets.ts` declares five datasets over `sys_*` objects, three of which
live in packages a stack compiling plugin-auth alone cannot see. All five
resolve through `PLATFORM_PROVIDED_OBJECT_NAMES`; a local "not in this stack ⇒
error" check would have reported every one of them. When the base object does
not resolve, `validateDatasetReferences` skips the dataset entirely, so one typo
yields one finding rather than one per dimension, measure and filter key.

**Skips, so a finding is never a guess** (ADR-0072 D1): an object this stack
does not define, an object with no readable field map (ADR-0015 `external` and
introspected schemas), a registry-injected system column, and any hop *through*
one — an injected `owner_id` is a lookup at the registry whose target is
invisible here, so `owner_id.name` is unanswerable rather than a miss. The
shipped `showcase_task_metrics` dimension `{ field: 'created_at' }` is that skip's
live case, and every shipped dataset in the repo is silent under the new rule.

**Two reusable seams ship with it**, newly exported, because the same two
questions are asked at a dashboard widget's filter keys and `sortBy` and at a
list view's field positions, and three independent copies of a hop-walker drift:

- `object-graph.ts` — `indexObjectGraph` / `resolveFieldPath` / `isUnjudgeable`,
  answering "what does this `relationship[.relationship].field` path resolve to?"
  as a discriminated **verdict** union rather than a boolean, so a caller can
  tell "this hop is not a relationship" from "this leaf does not exist" and write
  the right prescription. Plus `nearestName` / `suggestName` / `listNames`.
- `walkFilterFieldKeys` (`filter-walk.ts`) — the FIELD-KEY half of a filter
  subtree, beside the subtree-finding half that module already owns. It handles
  all three authored shapes (Mongo condition object, `{ field, operator, value }`
  rules, `[field, op, value]` triples), because a reader that handles only one
  shape is the exact bug #3574 was filed against, and it composes a nested
  condition object into one relationship path so `{ account: { region: … } }`
  reports `account.region` rather than a bare `region` resolved against the
  wrong object.

Both hold mechanism only — no rule ids, no severities, no findings.
