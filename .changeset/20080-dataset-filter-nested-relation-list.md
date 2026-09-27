---
"@objectstack/spec": minor
---

fix(spec)!: a dataset or measure filter with a list inside a nested relation is refused when it is saved, not when it is charted (#20080)

**BREAKING**: an accept-set narrowing of a published authoring schema, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is registered under protocol major 18 as `dataset-filter-nested-relation-equality-array-refused-at-save`.

## What changes

`DatasetSchema.filter` and `DatasetMeasureSchema.filter` now refuse an ARRAY in the equality slot of a field inside a nested-relation condition. That covers the implicit form `{ account: { region: ['a'] } }` and the explicit form `{ account: { region: { $eq: ['a'] } } }`, the empty array included, at any relation depth and under `$and` / `$or` / `$not`. So `defineStack`, `os validate` and a save through the metadata protocol (`422 INVALID_METADATA`) refuse such a dataset at the filter's path, for example `filter.account.region` or `measures.0.filter.account.region.$eq`.

Before this change the dataset saved clean. The analytics `where` door, which charts both filters on every path, flattens the relation to the dotted member `account.region` and refuses the list with `INVALID_FILTER` / 400. So every chart built on the dataset failed. Measured on `origin/main` `9e7824a445`: `DatasetSchema.safeParse` answered `success: true` for both forms.

The refusal is the analytics door's sentence: the field, the received list, and the two operators a list in that slot stood in for. The door adds `at where.account.region`. The schema leaves that out, because the issue's `path` already says where it is.

## What does NOT change

- **The shared `FilterConditionSchema` keeps its reach.** Every other schema that carries a `FilterCondition` still accepts a list inside a nested relation, because the engine reads that spec as a deep-equality comparand.
- **Nothing stored is rewritten, and nothing is dropped.** The parse fails and strips nothing. The read path does not re-validate stored rows, so a stored dataset keeps loading, and its next save is refused. Such a filter has failed every chart, so the refusal is a repair.
- A list outside a nested relation is refused as before, once, by `FilterConditionSchema`.
- `$ne` carrying an array is not judged. The list operators keep their arrays, `$in: []` and `$nin: []` included. Every scalar, `null`, a `Date` and a `{ $field }` reference inside a nested relation pass as before.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ account: { region: ['a', 'b'] } }`, meaning "one of these values" | `{ account: { region: { $in: ['a', 'b'] } } }` |
| `{ account: { tags: ['a'] } }`, meaning "the stored list holds `a`" on a multi-value field | `{ account: { tags: { $contains: 'a' } } }` |
| `{ account: { region: ['a'] } }`, meaning one value | `{ account: { region: 'a' } }` |
| `{ account: { region: { $eq: [...] } } }` | any of the rows above |

## Who is affected, measured

Nothing shipped in this repository carries the shape. At `9e7824a445`, the dataset and measure filters of `examples/app-crm`, `examples/app-showcase`, `examples/app-todo` and the platform objects, plus the dataset examples in `content/docs` and `skills`, carry no list inside a nested relation. Deployed datasets were NOT measured. Validating each stack, or re-saving each dataset, finds every instance.

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed, no exported symbol moves, and the operator vocabulary is unchanged. One comparand shape in one position of two carriers, which the analytics door already refused on every chart, is now refused on save as well.

<!-- adr-0087: registered dataset-filter-nested-relation-equality-array-refused-at-save -->
