# Data Source Adapters

This directory holds the `DataSource` adapters that ship **inside
`@object-ui/core`** — the backend-agnostic ones, with no external SDK
dependency. They are what a schema's `viewData` block resolves to at runtime.

> **Looking for the ObjectStack adapter?** It is not in this directory.
> `ObjectStackAdapter` / `createObjectStackAdapter` ship as their own package,
> **[`@object-ui/data-objectstack`](../../../data-objectstack/README.md)**,
> whose README owns the ObjectStack material — connection handling, metadata
> caching, error hierarchy, and the filter-operator and query-parameter
> translation tables.

## Available Adapters

Every export below is re-exported from the package root, so consumers import
them from `@object-ui/core`.

| Export | Kind | Role |
| --- | --- | --- |
| `ApiDataSource` | class | raw HTTP against the `HttpRequest` configs it is constructed with — built in code, never from a `ViewData` block |
| `ValueDataSource` | class | `provider: 'value'` — an in-memory array; no network at all |
| `resolveDataSource` | function | builds the adapter a `ViewData` config asks for (`object` / `value`) |
| `runBatchTransaction` / `emulateBatchTransaction` | functions | ordered cross-object save — the adapter's own `batchTransaction` when it has one, a sequential non-atomic emulation when it does not |

Backend-specific adapters live in their own packages rather than here; today
that is `@object-ui/data-objectstack`.

### `ApiDataSource`

Built in code from an `ApiDataSourceConfig` — the console's approvals inbox is
one such caller. It is not a `ViewData` mode: the view-level `provider: 'api'`
is retired in `@objectstack/spec` (objectstack#23082), so `resolveDataSource`
never builds one, and a metadata-declared API call is the page element's
`dataSource` binding instead. The endpoint comes from the `HttpRequest` configs, not
from the `resource` argument — `find`/`findOne` use `read`, and
`create`/`update`/`delete` use `write` (falling back to `read` when `write` is
absent). `QueryParams` are flattened onto the query string.

```typescript
import { ApiDataSource } from '@object-ui/core';

const dataSource = new ApiDataSource({
  read: { url: 'https://api.example.com/users', method: 'GET' },
  write: { url: 'https://api.example.com/users' },
  defaultHeaders: { Authorization: 'Bearer …' },
  // fetch: customFetch,   // optional; defaults to globalThis.fetch
});

const { data, total } = await dataSource.find('users', { $top: 20 });
```

A generic HTTP endpoint exposes no metadata, so `getObjectSchema()` returns a
minimal stub (`{ name, fields: {} }`) and `getView()` / `getApp()` return
`null` — enough that schema-dependent components do not crash.

### `ValueDataSource`

For `provider: 'value'`. Everything runs against an in-memory array, which is
deep-cloned on construction so the caller's array is never mutated. Useful for
static content, fixtures, and previews.

The clone is a **`structuredClone`**, not a JSON round-trip (objectui#9175). It
is an aliasing barrier and nothing more: `ViewData.items` is
`z.array(z.unknown())` in `@objectstack/spec`, so **an inline row does not have
to be serializable** (objectui#6018). A `Date` arrives as a `Date`, a key whose
value is `undefined` keeps its key, `Map` / `Set` / `RegExp` / `BigInt` /
`NaN` / a cyclic record graph all survive as themselves. What
`structuredClone` cannot copy — a function, a DOM node — throws
`DataCloneError` at construction: **loud, on purpose**, and there is no
fallback to the round-trip, because a fallback would restore the silent
flattening this replaced.

```typescript
import { ValueDataSource } from '@object-ui/core';

const dataSource = new ValueDataSource({
  items: [
    { id: '1', name: 'Alice', age: 30 },
    { id: '2', name: 'Bob', age: 24 },
  ],
  // idField: 'id',   // optional; defaults to `id`, then `_id`
});

const { data, total } = await dataSource.find('people', {
  $filter: { age: { $gte: 25 } },
  $orderby: { name: 'asc' },
});
```

It implements `$filter` (MongoDB-style objects, FilterNode AST arrays, and the spec's
`ViewFilterRule[]` — see below), `$search`, `$orderby`, `$skip`, `$top` and `$select`
locally, plus `bulk()`,
`aggregate()` and `onMutation()`. `getAll()` returns a cloned snapshot — the
same `structuredClone` rule as the constructor — and `count` the current
length.

#### What `$filter` executes, and what it refuses

`find()` picks a matcher on the SHAPE of `$filter` — a FilterNode **array** goes
to the AST matcher, an **object** to the `$`-dialect matcher — and since
objectui#8447 the two answer the same question and refuse in the same way.

The array arm **lowers before it matches** (objectui#10767). A spec
`ViewFilterRule[]` — `[{ field: 'status', operator: 'equals', value: 'open' }]`, the
ONLY form the spec's converged `filter` doors accept (objectui#6206 B) — goes through
`toFilterNode` (`../utils/filter-converter.ts`), the same sink the grid, the list and
every other lowering caller use before a wire query, and arrives at the AST matcher as
the comparison tuple its operator spells. So the operator vocabulary is the spec's own
`VIEW_FILTER_OPERATORS`, folded through the spec's `normalizeFilterOperator`; no second
table lives here. An AST array passes through the sink untouched, an empty array is
"no filter" (as it is on the wire), and an operator the spec does not know passes
through VERBATIM so the refusal below still names it. A rule the lowering itself
refuses — an ARRAY on a single-valued operator (objectui#8557), an empty or non-string
`icontains` comparand (objectui#9048) — is excluded and logged once like every other
refusal here, never thrown from `find()`: the producers that call `toFilterNode` before
a wire query throw because they are deciding whether to send a query at all; this
matcher is deciding about rows.

The object dialect executes one arm per member of the spec's `FILTER_OPERATORS`:

```text
$eq  $ne  $gt  $gte  $lt  $lte  $in  $nin  $between
$contains  $icontains  $notContains  $startsWith  $endsWith  $null  $exists  $empty
```

That is **every member** — nothing the spec declares is refused by name. What is held
to the spec is the matcher's case table, not this list:
`ValueDataSource.dollarFilterVocabulary.test.ts` reddens when a release adds an
operator it has no case for. Nothing re-checks the list above.

`$contains`, `$notContains`, `$startsWith` and `$endsWith` are **case-sensitive**;
`$icontains` is the one case-insensitive member, its fold is **ASCII-only**, and its
comparand must be a **non-empty string** — any other comparand shape is refused in the
table below rather than folded (objectui#8748).
`$null` takes its direction from the value: `$null: true` is IS NULL, `$null: false`
is IS NOT NULL. `$exists` is its exact inverse — `$exists: true` is IS NOT NULL — which
is the lowering `convertFiltersToAST` already performs, not a reading invented here.

`$empty` (objectui#11094) is not a null test. `$empty: true` selects a row whose value
is null, absent, `''` or `[]`, and `$empty: false` is its exact complement; a flag that
is not a boolean is refused. The AST twins are `is_empty` / `is_not_empty`, which the
spec stopped folding onto `is_null` / `is_not_null` (objectstack#20570). The answer is
the spec's own `isEmptyFilterValue`, called without a field declaration, because this
adapter holds none: the spec's ruled table is keyed on a field's declared type (a
text-like field is empty when null or `''`, a multi-value field when null or `[]`,
every other type when null), and a face with no declarations judges by value, as
`@objectstack/formula`'s matcher does. The two readings differ only on a value the
declared type does not predict, such as `''` stored in a number column.

A stored value that is **not a string** never satisfies `$contains`, `$icontains`,
`$startsWith` or `$endsWith`, and always satisfies `$notContains` — the number `5`
does not contain the substring `"5"`, so it is on the negation side. That is
objectstack#14079 (maintainer ruling 2026-09-05, option A), and it is what makes the
operator and its negation a **partition**: before objectui#8452 both arms carried the
type test, so a numeric column answered NO to `$notContains` as well and those rows
appeared in no filter answer at all. The stored value is never coerced to text —
searching `String(50)` would answer a query nobody wrote, in a spelling the storage
class chose. A `null` and an absent key take the same side of the same predicate.

A `Date` condition — `{ created: someDate }` — is a **comparand, not an operator map**
(objectui#10829). It is read as implicit equality, which is how `convertFiltersToAST`
lowers it (`['created', '=', someDate]`, objectui#8555), so the object filter and its
lowered array answer the same rows. Before that, a `Date`, which has no own keys,
reached the operator loop, the loop ran zero times, and the field added no constraint.
The gate is the spec's `isAcceptedFilterComparand`, the predicate the converter lowers a
`Date` through.

**Two `Date`s compare their instant** in every equality and membership position of both
dialects — implicit equality, `$eq` / `$ne` / `$in` / `$nin`, and `=` / `!=` / `in` /
`nin` — through one helper (objectui#10829). They used to compare by identity, and the
adapter clones the rows it is constructed with, so over those rows a `Date` equality
matched nothing, not even the row holding that instant, while `$gte` and `$lte` both
matched it; only a row written through `create` / `update`, which copy shallowly, could
hold the caller's own instance. An invalid `Date` equals nothing. A `Date` comparand is
**not** coerced to another storage form: a row holding the same instant as an ISO string
or as epoch milliseconds does not equal it, because `@objectstack/spec`'s
`FILTER_COMPARAND_TYPE_CASES` declines to assert a `Date` row set — what it matches
"legitimately differs per storage form (ADR-0053)" — and this matcher has no field types
to read a storage form from. `$gt` / `$gte` / `$lt` / `$lte` / `$between` compare a
`Date` by its number, as before. Membership reads `===` where it read `includes`'
SameValueZero, so a stored number `NaN` is no longer a member of `[NaN]` — the answer
`{ x: NaN }` already gave.

#### Grouped filters — `$and` and `$or`

Both are **executed** in the object dialect (objectui#8513), matching the
semantics the five platform backends already answer to. A group is one ENTRY of
the condition object, so it ANDs with its sibling keys:
`{ status: 'open', $or: [ … ] }` is "status AND the group". Groups nest.

The empty-group answers are the **boolean identity elements** ruled by
objectstack#5322 — and they are not a special case in the code, they are what
`Array.prototype.every` and `Array.prototype.some` already answer for an empty
array:

| filter | rows | why |
| --- | --- | --- |
| `{ $and: [] }` | **every** row | the AND identity is TRUE |
| `{ $or: [] }` | **no** row | the OR identity is FALSE |
| `{ $or: [ … , {} ] }` | **every** row | a `{}` branch is a TRUE disjunct and absorbs its `$or` |
| `{ $and: [ … , {} ] }` | the other branches | a `{}` branch drops out of an `$and` |

The identities matter in practice because `convertFiltersToAST` hands them back
**unlowered** — it returns the original object when a filter reduces to no
conditions — so `{ $and: [] }` reaches this matcher as an object even from
callers that lower everything else. Before objectui#8513 it answered zero rows
for a filter whose ruled answer is every row.

This is pinned against the spec's own cross-backend table
(`FILTER_LOGIC_CASES`), not against a local fixture, in
`ValueDataSource.filterLogicConformance-8513.test.ts`. A malformed group — a
non-array `$and`, or a member that is not a condition object — is refused like
anything else below.

#### An empty operator map refuses the whole filter

`{ field: {} }` names a field and no operator; `@objectstack/spec` ruled it REJECTED
wherever it appears (objectstack#5240). On this face it is judged BEFORE
any row is matched wherever the matcher executes (objectui#10817) — under `$not`,
which is refused per node, the walk does not look: the object arm walks the filter's
field entries and the members of
`$and` / `$or`, and hands each field whose condition is an object with no own keys to
`toFilterNodeSafely`, so the converter decides what that condition is, in its own
wording. The field is judged alone, as `{ [field]: condition }`, not inside the whole
filter: `{ status: ['a'], created: {} }` names `created` here and `status` before a
wire query. `{ $or: [{}, { created: {} }] }` is refused on both paths: since
objectui#10789 the converter reads every `$or` member before a `{}` absorbs the group,
so it refuses the `created` member in either order, as this face does. A
refusal answers the whole filter with no rows and logs the
converter's reason once — the way the array arm answers a rule its lowering refuses —
so `{ $or: [{ status: 'b' }, { created: {} }] }` answers no rows, not the `'b'` rows.
A `RegExp`, `Map` or `Set` comparand has no own keys either and gets the converter's
exotic-comparand refusal (objectui#8567); a `Date` lowers, so it reaches the matcher,
which matches the rows holding the same instant as a `Date` (objectui#10829, above).

Anything else is **refused**: the row is excluded and the reason is logged once per
distinct refusal per `find()` — never passed through as "no constraint", which is
what an unrecognised operator used to mean here. Refused on purpose, each with a
prescription in the message:

| spelling | why | write instead |
| --- | --- | --- |
| `$like` / `$ilike` | declared, but staged out of `FILTER_OPERATORS`; no pattern engine in memory | `$contains` / `$icontains` |
| `$regex` / `$options` | retired from the protocol | `$icontains` |
| `$startswith`, `$notcontains`, `$notin`, `$ncontains` | non-canonical spellings | the camelCase spelling |
| `$not` | ruled upstream (objectstack#5146), but this repo's own `convertFiltersToAST` still refuses it: the AST has no negation keyword and rewriting the negation inward is silently partial | `$ne` / `$nin` / `$notContains` |
| `{ relation: { field: … } }` | this matcher does not descend into relations | filter on the stored key |
| an **array** comparand outside `$in` / `$nin` / `$between` | the spec leaves it unruled and the sibling in-memory matcher refuses it; a reference comparison excluded every row, and on `$ne` selected every row (objectui#8514) | `{ field: { $in: [ … ] } }` |
| an **empty** or **non-string** `$icontains` / `icontains` comparand | `FILTER_TEXT_CASES` carries both as REJECTION rows — an empty comparand constrains nothing, a coerced one answers a query nobody wrote (objectui#8748) | a non-empty string comparand, or drop the condition |
| `{ $field }` in an `$in` / `$nin` member or a `$between` endpoint | removed from those positions because no backend resolved one (objectstack#7596) | a scalar comparison |
| `{ $field, addDays }` | the offset is defined against the column's temporal class, which this schema-less matcher cannot read (objectstack#14104) | shift the value at the producer |
| `{ $field: 'a.b' }` (dotted) | this matcher addresses a flat record, so a dotted reference would not mean what a dotted field name means | a same-record column |
| `{ field: { $field: … } }` (implicit) | reads as an operator named `$field`, not a comparand (objectstack#7597) | `{ field: { $eq: { $field: … } } }` |

#### Cross-field comparands

A `{ $field: 'other_column' }` comparand is **executed**, in both dialects, as the
whole comparand of the six scalar comparisons (`$eq` `$ne` `$gt` `$gte` `$lt`
`$lte` and their AST spellings) — the positions `FieldReferenceSchema` declares
it for. It resolves against the record being matched, so
`{ amount: { $lte: { $field: 'budget' } } }` selects the rows whose `amount` is
within their own `budget` (objectui#8515). Every other position is refused, in
the rows above.

### `resolveDataSource`

Turns a `ViewData` config into a concrete adapter. This is the function a
renderer calls; components do not branch on `provider` themselves.

```typescript
import { resolveDataSource } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';

// The `DataSource` the renderer already holds from context. It is what
// `provider: 'object'` resolves to, and the fallback for every other case.
declare const contextDataSource: DataSource;

const dataSource = resolveDataSource(
  { provider: 'value', items: [{ id: '1', name: 'Ada' }] },
  contextDataSource, // used for `provider: 'object'`, and as the fallback
);
```

| `viewData.provider` | Result |
| --- | --- |
| `'object'` | the `fallback` — the `DataSource` from context, typically `ObjectStackAdapter` |
| `'value'` | a new `ValueDataSource` over `items` |
| unknown (the retired `'api'` included), or no `viewData` | the `fallback`, else `null` |

### `runBatchTransaction` / `emulateBatchTransaction`

The single entry point for an ordered **cross-object** save (the master-detail
case). `runBatchTransaction` calls the adapter's native `batchTransaction` when
it implements one — `ObjectStackAdapter` does, and against a backend
advertising `capabilities.transactionalBatch` that is a real server
transaction — and otherwise falls back to `emulateBatchTransaction`. Callers
stay ignorant of which one ran.

```typescript
import { runBatchTransaction } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';

// The adapter the view resolved to — see `resolveDataSource` above.
declare const dataSource: DataSource;

// `{ $ref: 0 }` resolves to the id minted by operation 0 (the parent).
await runBatchTransaction(dataSource, [
  { object: 'invoice',      action: 'create', data: { no: 'INV-1' } },
  { object: 'invoice_line', action: 'create', data: { invoice: { $ref: 0 }, amount: 10 } },
]);
```

⚠️ The emulation is **not** atomic. It runs the operations in order and, on
failure, best-effort deletes the records it created (children before parent)
before rethrowing; updates and deletes that already ran cannot be undone, and a
create's side effects (hooks, rollups, webhooks) are not undone by a later
delete. It exists so a save is still possible against a backend without server
atomicity — see
[`@object-ui/data-objectstack`](../../../data-objectstack/README.md#cross-object-atomic-batch-batchtransaction)
for the capability negotiation that decides which path is taken.

## Creating Custom Adapters

To create a custom adapter, implement the `DataSource<T>` interface. It requires
**six** members — `find`, `findOne`, `create`, `update`, `delete` and
`getObjectSchema` — and everything else on it is optional. `getObjectSchema` is
easy to miss and is not optional: schema-dependent components call it before they
render, which is why `ApiDataSource` answers it with a minimal stub rather than
omitting it.

```typescript
import type { DataSource, QueryParams, QueryResult } from '@object-ui/types';

export class MyCustomAdapter<T = any> implements DataSource<T> {
  // ── The six members `DataSource<T>` requires ───────────────────────────────

  async find(resource: string, params?: QueryParams): Promise<QueryResult<T>> {
    throw new Error(`find(${resource}) is not implemented yet`);
  }

  async findOne(
    resource: string,
    id: string | number,
    params?: QueryParams,
  ): Promise<T | null> {
    throw new Error(`findOne(${resource}, ${id}) is not implemented yet`);
  }

  async create(resource: string, data: Partial<T>): Promise<T> {
    throw new Error(`create(${resource}) is not implemented yet`);
  }

  async update(
    resource: string,
    id: string,
    data: Partial<T>,
    opts?: { ifMatch?: string },
  ): Promise<T> {
    throw new Error(`update(${resource}, ${id}) is not implemented yet`);
  }

  async delete(
    resource: string,
    id: string | number,
    opts?: { ifMatch?: string },
  ): Promise<boolean> {
    throw new Error(`delete(${resource}, ${id}) is not implemented yet`);
  }

  /**
   * Required. Return the object's metadata, or a minimal stub
   * (`{ name, fields: {} }`) when your backend exposes none — see
   * `ApiDataSource` above.
   */
  async getObjectSchema(objectName: string): Promise<any> {
    return { name: objectName, fields: {} };
  }

  // ── Optional: implement only what your backend actually supports ───────────

  async bulk?(
    resource: string,
    operation: 'create' | 'update' | 'delete',
    data: Partial<T>[],
  ): Promise<T[]> {
    throw new Error(`bulk(${resource}, ${operation}) is not implemented yet`);
  }
}
```

The bodies above **throw** rather than fall off the end: a method annotated
`Promise<QueryResult<T>>` that returns nothing is a type error, and a template
that does not type-check is one a reader copies into a class that does not
satisfy the interface it claims to implement. Replace each `throw` as you go and
the class stays checkable at every step.

## Related Packages

- `@object-ui/types` — the `DataSource`, `QueryParams` and `ViewData` definitions these adapters implement
- `@object-ui/data-objectstack` — the ObjectStack Protocol adapter, and the owner of the ObjectStack documentation
- `@objectstack/client` — ObjectStack Client SDK (a dependency of `@object-ui/data-objectstack`, not of `@object-ui/core`)
- `@objectstack/spec` — ObjectStack Protocol Specification
