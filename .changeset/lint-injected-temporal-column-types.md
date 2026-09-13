---
"@objectstack/lint": minor
---

fix(lint): a field-typed rule reads the registry's own type for an injected column, so `created_at` / `updated_at` stop escaping the preset-comparand refusal (#16340)

`@objectstack/lint`'s object graph recorded the registry-injected system columns by NAME only. A path resolving to one came back `{ kind: 'ok', injected: true }` with no `meta`, so every rule asking a SECOND question about the leaf — "is it temporal?" — had to treat it as unanswerable and stay silent. That silence landed on the two most-filtered columns in the platform.

Measured on `origin/main` `d57611dfd3`, one dashboard widget over one object declaring `close_date: date` and authoring no `created_at`:

| authored filter | before | after |
|:--|:--|:--|
| `close_date: 'last_30_days'` (authored `date`) | refused | refused |
| `created_at: { $gte: 'last_30_days' }` (ordering — arm 1) | refused | refused |
| `created_at: 'last_30_days'` | **silent** | refused |
| `created_at: { $eq: 'last_30_days' }` | **silent** | refused |
| `updated_at: { $in: ['last_30_days'] }` | **silent** | refused |
| `stage: 'this_quarter'` (a `select` column) | silent | silent |

The engine already refused all three of those at query time (`INVALID_FILTER` / 400, the registry's field map in hand), so the gap was purely author-time: `objectstack lint` and the runtime publish gate passed a filter the runtime then refused with a 400 on first render — and an AI author's correction loop only sees what fails the build.

## What changed

`GraphObject.injected` is now a `ReadonlyMap<string, GraphField>` rather than a `ReadonlySet<string>`: each injected column carries the registry's own definition. Both halves are DERIVED from one plan — membership from `resolveInjectedSystemColumns`, the slice from `injectedSystemColumnDefs` (`@objectstack/spec/data`, the same tables `applySystemFields` spreads at registration) — so lint never hand-copies "`created_at` is a datetime" and cannot drift from the runtime that provisions it. `resolveFieldPath` populates `meta` for an injected leaf accordingly, and `filter-preset-comparand`'s field-type oracle lost its `verdict.injected` bail: the marker says WHO wrote the column, and the ruling turns on what the column IS.

`id` is the one addressable column with no definition behind it — the DRIVER provisions the primary key — so its slice is empty and a second question about it is still unanswered, truthfully and only there. The `select`-column reading arm 2 exists to protect is untouched: no injected column is a picklist.

**Behaviour change for authors**: a stack that filtered an injected `date` / `datetime` column against one of the thirteen dashboard date-range preset names in an equality or membership position now fails `objectstack lint` and the runtime publish gate where it previously passed. Every such filter was already refused by the engine at query time; the error simply moves to where the filter is written. Write the `{date-macro}` window the message names, or an ISO date.

**Type change for direct consumers of the seam**: `GraphObject.injected` changed from `ReadonlySet<string>` to `ReadonlyMap<string, GraphField>`. `.has(name)` answers exactly as before; code that iterated the set or spread it into one needs `.keys()`. Shipped as `minor` under the repo's launch-window convention.

## Two more rules inherit it, in the same edit

The type reaches every rule that asks a second question about a resolved leaf, which is the whole reason it was fixed at the seam rather than inside `filter-preset-comparand`:

- **`list-view-field-dotted`** now refuses a dotted list-view filter key whose head is an injected column, on the same axis as an authored one. `created_at.x` reads as the `datetime` scalar it is (nothing beneath it for a path to reach) and `owner_id.name` as the `lookup` it is (it stores an id, not an embedded document). `assertFilterIsMaterializable` and the REST ingress have always answered `400 INVALID_FIELD` for both — the linter was silent only because the type was missing here.
- **`dataset-include-unknown`** now judges an `include[]` entry naming an injected column instead of bailing on the marker: `include: ['owner_id']` joins (it is the registry's `lookup`), `include: ['created_at']` is refused (a `datetime` derives no join, so every dimension written against that prefix addresses nothing).

`id` falls through the untyped branch of all three rules — the DRIVER provisions the primary key and no definition table describes it, so an unreadable head is what the door sees too, and none of them invents a refusal there.

A relationship HOP through an injected column stays a skip (`unknowable` / `injected-hop`), deliberately: the slice now carries `reference`, and traversing it would newly judge every path through a platform anchor wherever `sys_user` is compiled into the stack — a widening with its own findings to measure.
