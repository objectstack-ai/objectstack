# @object-ui/data-objectstack

Official ObjectStack data adapter for Object UI.

## Overview

This package provides the `ObjectStackAdapter` class, which connects Object UI's universal `DataSource` interface with the `@objectstack/client` SDK.

This enables strictly typed, metadata-driven UI components to communicate seamlessly with ObjectStack backends (Steedos, Salesforce, etc.).

## Installation

```bash
npm install @object-ui/data-objectstack
```

**Note:** `@objectstack/client` is a regular dependency of this package — it is installed and resolved along with it, so there is nothing to install separately.

## Usage

### Basic Setup

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';
import { SchemaRenderer } from '@object-ui/react';
import type { DeclaredNode } from '@object-ui/types';

declare const mySchema: DeclaredNode;

// 1. Create the adapter
const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-api-token' // Optional if effectively handling auth elsewhere
});

// 2. Pass to the Renderer
function App() {
  return (
    <SchemaRenderer 
      schema={mySchema} 
      dataSource={dataSource} 
    />
  );
}
```

### Advanced Configuration

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({
  baseUrl: 'https://api.example.com',
  token: 'your-api-token',
  // Configure metadata cache
  cache: {
    maxSize: 100,      // Maximum number of cached schemas (default: 100)
    ttl: 5 * 60 * 1000 // Time to live in ms (default: 5 minutes)
  },
  // Configure auto-reconnect
  autoReconnect: true,           // Enable auto-reconnect (default: true)
  maxReconnectAttempts: 5,       // Max reconnection attempts (default: 3)
  reconnectDelay: 2000           // Initial delay between reconnects in ms (default: 1000)
});
```

## Features

- ✅ **CRUD Operations**: Implements `find`, `findOne`, `create`, `update`, `delete`.
- ✅ **Shared In-Flight Reads**: Concurrent `find` calls with the same resource and params, and concurrent `findOne` calls with the same resource, id and params, share one request. The entry is dropped when the read settles, so a later call reads again (this is not a response cache), and a failed read is not remembered. A write through the adapter drops the pending `findOne` reads of the resource it wrote, so a read asked after a save never gets an answer sent before it. `MetadataClient` shares its `listTypes`, `list`, `listDrafts`, `get` and `getDraft` reads the same way. Calls with the same method, URL and headers on clients built with the same `fetch` share one request, and every caller gets an answer no other caller holds. A save, publish or reset through any of those clients drops the reads still pending.
- ✅ **Metadata Caching**: Automatic LRU caching of schema metadata with TTL expiration.
- ✅ **Metadata Fetching**: Implements `getObjectSchema` to power auto-generated forms and grids.
- ✅ **Query Translation**: Converts Object UI's OData-like query parameters to ObjectStack's native query format.
- ✅ **Bulk Operations**: Supports optimized batch create/update/delete with detailed error reporting.
- ✅ **Error Handling**: Comprehensive error hierarchy with unique error codes and debugging details.
- ✅ **Connection Monitoring**: Real-time connection state tracking with event listeners.
- ✅ **Auto-Reconnect**: Automatic reconnection with exponential backoff on connection failures.
- ✅ **Batch Progress**: Progress events for tracking bulk operation status.

## Query Translation

`find()` accepts Object UI's OData-style `QueryParams` and translates them into
ObjectStack's native query format, so a schema never has to be written in the
protocol's own shape:

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// Query with filters (MongoDB-like operators)
const result = await dataSource.find('tasks', {
  $filter: {
    status: 'active',
    priority: { $gte: 2 },
  },
  $orderby: { createdAt: 'desc' },
  $top: 20,
  $skip: 0,
});

// Escape hatch: reach the underlying ObjectStack client for anything
// the DataSource interface does not cover
const client = dataSource.getClient();
const metadata = await client.meta.getItem('object', 'task');
```

### Query Parameter Mapping

| Object UI (`$`) | ObjectStack | Description |
|--------------|-------------|-------------|
| `$select` | `select` | Field selection |
| `$filter` | `filters` (AST) | Filter conditions (converted to FilterNode AST) |
| `$orderby` | `sort` | Sort order |
| `$skip` | `skip` | Pagination offset |
| `$top` | `top` | Limit records |

### Filter Conversion

The adapter converts MongoDB-like filter operators into **ObjectStack FilterNode
AST format**. This is what keeps it compatible with the ObjectStack Protocol
(v0.1.2+).

#### Supported Filter Operators

Every row below is decided by `@object-ui/core`'s `convertFiltersToAST`, and
this package's `src/readme-filter-operator-table.test.ts` runs each worked
example through it on every test run, so a row cannot drift from the code
unnoticed again (objectui#8558). Every spelling below is the spec's own
(`FILTER_OPERATORS` in `@objectstack/spec`'s `data/filter.zod.ts`) and there are
no aliases: the four lowercase spellings this table used to list beside the
camelCase keys — `$notin`, `$notcontains`, `$startswith`, `$endswith` — were
retired by objectui#8568 and moved to the refused table below.

`$icontains` is the case-insensitive member of the `$contains` family, and its
ObjectStack spelling is the SAME word: `icontains` is itself a member of the
spec's `VALID_AST_OPERATORS`, so nothing is squashed on the way down. It had no
row here at all until objectui#8976 — `convertFiltersToAST` refused it as an
unknown operator while `ValueDataSource` executed it and this repo's own filter
builder emitted it. The pin now holds these two tables complete against the
spec's `FILTER_OPERATORS` as well as against the code, so a canonical operator
that is documented NEITHER as supported NOR as refused fails the suite instead
of going unnoticed.

| MongoDB Operator | ObjectStack Operator | Example |
|------------------|---------------------|---------|
| plain value (no operator) | `=` | `{ status: 'active' }` → `['status', '=', 'active']` |
| `$eq` | `=` | `{ status: { $eq: 'active' } }` → `['status', '=', 'active']` |
| `$ne` | `!=` | `{ status: { $ne: 'archived' } }` → `['status', '!=', 'archived']` |
| `$gt` | `>` | `{ age: { $gt: 18 } }` → `['age', '>', 18]` |
| `$gte` | `>=` | `{ age: { $gte: 18 } }` → `['age', '>=', 18]` |
| `$lt` | `<` | `{ age: { $lt: 65 } }` → `['age', '<', 65]` |
| `$lte` | `<=` | `{ age: { $lte: 65 } }` → `['age', '<=', 65]` |
| `$in` | `in` | `{ status: { $in: ['active', 'pending'] } }` → `['status', 'in', ['active', 'pending']]` |
| `$nin` | `nin` | `{ status: { $nin: ['archived'] } }` → `['status', 'nin', ['archived']]` |
| `$between` | `between` | `{ age: { $between: [18, 65] } }` → `['age', 'between', [18, 65]]` |
| `$contains` | `contains` | `{ name: { $contains: 'John' } }` → `['name', 'contains', 'John']` |
| `$notContains` | `notcontains` | `{ name: { $notContains: 'test' } }` → `['name', 'notcontains', 'test']` |
| `$startsWith` | `startswith` | `{ email: { $startsWith: 'admin' } }` → `['email', 'startswith', 'admin']` |
| `$endsWith` | `endswith` | `{ email: { $endsWith: '@example.com' } }` → `['email', 'endswith', '@example.com']` |
| `$icontains` | `icontains` | `{ name: { $icontains: 'john' } }` → `['name', 'icontains', 'john']` |
| `$null` | `is_null` / `is_not_null` | `{ email: { $null: true } }` → `['email', 'is_null', true]` |
| `$exists` | `is_not_null` / `is_null` | `{ email: { $exists: true } }` → `['email', 'is_not_null', true]` |
| `$empty` | `is_empty` / `is_not_empty` | `{ email: { $empty: true } }` → `['email', 'is_empty', true]` |

`$null`, `$exists` and `$empty` read their boolean: `$null: false` lowers to
`is_not_null`, `$exists: false` to `is_null` and `$empty: false` to
`is_not_empty`. The lowered node's value slot is always `true` — the direction
comes from the operator name, which is how the spec's `data/filter.zod.ts`
reads it. `$empty` takes ONLY a boolean: any other flag throws `INVALID_FILTER`
/ 400 at lowering time, which is how the spec's own doors treat it.

`$empty` is not `$null`. objectstack#20446 admitted it to the spec's
`FILTER_OPERATORS` and flipped the view operators `is_empty` / `is_not_empty`
to lower to it; they lowered to `$null` before. Its meaning is the spec's ruled
per-type table: a text-like field is empty when null or `''`, a multi-value
field when null or `[]`, and any other field when null. Which backend applies
that table, and how, is listed in the docblock of the spec's
`FILTER_OPERATORS`, not here. Until objectui#11094 `convertFiltersToAST`
refused `$empty` as an unknown operator.

`$icontains` constrains its **comparand**, which no other row in this table
does: `@objectstack/spec`'s `FILTER_TEXT_CASES` declares an empty or non-string
comparand REFUSED, so an empty box or an uncoerced number throws
`INVALID_FILTER` / 400 at lowering time instead of sending a predicate that
constrains nothing or a question nobody wrote (objectui#9001). The operator is
supported exactly as the row says — write a non-empty string, or drop the
condition.

#### Logical combinators

`$and` and `$or` take an array of filter conditions and lower to an AST group
node whose members are lowered with the table above. Sibling keys of one
object are still combined with `and` (see "Complex Filter Examples" below). An
empty `$and` is TRUE and is dropped rather than emitted as an empty group —
`['and']` is not a filter, so emitting it would widen the result set — and an
empty `$or` is FALSE and matches no row.

| MongoDB Key | AST Keyword | Example |
|-------------|-------------|---------|
| `$and` | `and` | `{ $and: [{ status: 'open' }, { priority: { $gte: 2 } }] }` → `['and', ['status', '=', 'open'], ['priority', '>=', 2]]` |
| `$or` | `or` | `{ $or: [{ status: 'open' }, { status: 'blocked' }] }` → `['or', ['status', '=', 'open'], ['status', '=', 'blocked']]` |

#### Refused at lowering time

These shapes throw a `FilterOperatorError` (`code: 'INVALID_FILTER'`,
`httpStatus: 400`) from `convertFiltersToAST` instead of reaching the wire. The
refusal names the field and the value, so a filter that carries one fails at
the call site rather than as a `400` from the server or as an empty list.

| Shape | Why | Example |
|-------|-----|---------|
| `$regex` | The spec has no `$regex`, and it is not downgraded to `contains`: a pattern match and a substring match are different questions, not stronger and weaker forms of one. Use `$contains` for a case-sensitive substring, `$icontains` for a case-insensitive one, or `$startsWith` / `$endsWith`. | `{ name: { $regex: '^J' } }` → throws `INVALID_FILTER` |
| `$not` | The AST has no negation keyword, and rewriting the negation inward would be silently partial. Use a negated operator instead: `$ne`, `$nin`, `$notContains`. | `{ $not: { status: 'open' } }` → throws `INVALID_FILTER` |
| a bare array as a field's value | The AST has no array-equality node, and the array is deliberately not read as `$in` (see below). | `{ tags: ['a', 'b'] }` → throws `INVALID_FILTER` |
| `$notin` / `$notcontains` / `$startswith` / `$endswith` | Retired lowercase aliases (objectui#8568). The `$` dialect follows `@objectstack/spec`'s spellings, and this repo's in-memory matcher already refused these; accepting them here made one authored filter behave differently depending on the data source behind the view. The refusal names the canonical spelling for the alias you wrote — rename the key, the operator is unchanged. | `{ email: { $startswith: 'a' } }` → throws `INVALID_FILTER` |
| any other `$` key in operator position | Unknown operator; the error message lists the supported ones. | `{ age: { $foo: 1 } }` → throws `INVALID_FILTER` |

A bare array as a field's value — `{ tags: ['a', 'b'] }` — is **refused** at
lowering time with a `FilterOperatorError` (`INVALID_FILTER` / 400) naming the
field and the comparand, not read as `$in` (objectui#8530): the ObjectQL AST
has no array-equality node, so `['tags', '=', ['a', 'b']]` was answered by a
`400` from the wire or an empty list from every in-memory matcher. Spell
membership as `{ tags: { $in: ['a', 'b'] } }` (or `$nin` for its negation).

An **exotic object** as a field's value — a `RegExp`, a `Set`, a `Map`, a `URL`,
any class instance — is refused the same way (objectui#8567). It has no row in
the table above because the table's examples are executed as JSON literals and
none of these shapes can be written as one; the refusal is no less real for
that. `{ name: /abc/ }` used to lower to **nothing at all**: `Object.entries` of
a `RegExp` is `[]`, so the operator loop ran zero times and the `name` condition
was dropped from the filter entirely, silently widening the result set. The spec
rules these out — a comparison value must be a string, number, bigint, boolean,
null or `Date` (`ACCEPTED_FILTER_COMPARAND_TYPES`), and
`normalizeFilterComparandTypes` answers `400 INVALID_FILTER` for a `RegExp` —
so the refusal now lands at lowering time instead of the field vanishing. Spell
a text match as `{ name: { $contains: 'abc' } }` (`$startsWith` / `$endsWith`), a
membership test as `{ name: { $in: [...] } }`, and a date bound as
`{ created: { $gte: someDate } }`. A `Date` comparand is **not** exotic: the spec
accepts it and it lowers as an equality node (objectui#8555). An **empty
operator object** — `{ created: {} }`, a field with no operator — is refused too,
alone or beside other keys, with a `FilterOperatorError` naming the field
(objectui#9164 alone, objectui#10788 beside other keys). `@objectstack/spec` records
`{ field: {} }` as REJECTED (objectstack#5240), and beside a key that lowers it
used to be dropped the same silent way: `{ status: 'a', created: {} }` sent
exactly what `{ status: 'a' }` sends. Give the field an operator (`$eq`, `$in`,
`$null`, …) or remove the key.

#### Complex Filter Examples

**Multiple conditions** are combined with `'and'`:

```typescript
// Input
const $filter = {
  age: { $gte: 18, $lte: 65 },
  status: 'active',
};

// Converted to AST
const ast = [
  'and',
  ['age', '>=', 18],
  ['age', '<=', 65],
  ['status', '=', 'active'],
];
```

#### Rule-shaped arrays, on `find()` **and** `aggregate()`

Server-driven view configs store their conditions as an array of rules
(`ViewFilterRule[]`), not as a MongoDB-style object:

```typescript
const filter = [{ field: 'stage', operator: 'equals', value: 'won' }];
```

Both read paths lower that array to the same AST before it reaches the wire —
`find()` via `$filter`, and `aggregate()` via the analytics `where`. They share
one translator, so a stored filter cannot mean one thing on a list and another
on a KPI:

```typescript
// find():      filter=["stage","=","won"]
// aggregate(): { ..., where: ["stage", "=", "won"] }
```

Operator aliases (`equals`, `greater_than_or_equal`, `not_in`, `before`, ...)
map to the canonical AST symbols, and rules spread into a logical node
(`['and', ...rules, ...tuples]`) are lowered at depth. A rule that cannot be
translated raises `MalformedFilterError` rather than being dropped — dropping
one condition of an `and` would widen the result set and report success.

An `icontains` rule constrains its **comparand** here exactly as `$icontains`
does in the object form: `@objectstack/spec`'s `FILTER_TEXT_CASES` declares an
empty or non-string comparand REFUSED, so a rule such as
`{ field: 'name', operator: 'icontains', value: '' }` — or one whose `value` is
a number, `null` or missing — throws `MalformedFilterError` (`INVALID_FILTER` /
400) before any request is sent, instead of sending a predicate that constrains
nothing or a question nobody wrote (objectui#9048). The reason is the spec's
own, the one the object form's refusal carries (objectui#9001), and the message
names the operator spelling that arrived (`icontains`, `ICONTAINS`, …) beside
the `$icontains` spelling the contract uses. The rule is refused wherever it
sits — at the top level, in a nested group, or spread into a logical node — and
on both `find()` and `aggregate()`. Write a non-empty string, or drop the rule.

Non-array filters are passed through unchanged on the aggregate path: a
MongoDB-style object is already what `/analytics/query` accepts.

#### `aggregate({ where })` does NOT lower — it refuses

The lowering above is the `filter` parameter, on the analytics path.
`aggregate()` has a second, spec-shape branch — entered when the params carry
an array `groupBy`, an array `aggregations`, or **any** `where` key — which
posts `where` to `POST /data/:object/query` verbatim. That `where` is the spec
Query DSL's `where`, so it must ALREADY be lowered, and since objectui#6825 an
array that the spec's own `isFilterAST` gate rejects is refused here rather
than shipped:

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// ✅ lowered — reaches the wire unchanged
await dataSource.aggregate('opportunity', {
  groupBy: ['stage'],
  aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
  where: ['stage', '=', 'won'],
});

// ⛔ throws UnloweredAggregateWhereError — authoring sugar, not a filter
await dataSource.aggregate('opportunity', {
  groupBy: ['stage'],
  aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
  where: [{ field: 'stage', operator: 'equals', value: 'won' }],
});
```

This is a producer-side refusal of a value the server already refused (`is not
a filter`, `400 INVALID_FILTER`): the point is that you now find out at the call
site, with the offending value named, instead of on the wire — or not at all,
with a chart quietly rendering unfiltered numbers. Lower the rules in whatever
built the params, or use the analytics branch (`filter` + the legacy `field` /
`function` / `groupBy` params), which lowers for you.

Two shapes are deliberately NOT refused, because the receiving door accepts
them: a `FilterCondition` object (`{ stage: 'won' }` — what `QuerySchema.where`
declares), and an empty array (`[]` means "no filter").

#### The two shapes are alternatives, not a mixture

The spec-shape branch reads exactly four keys — `groupBy`, `aggregations`,
`where`, `limit` — and `filter` / `field` / `function` are the **analytics**
branch's own parameters. Until objectui#6864 they were neither read nor
reported on the spec-shape branch: they simply were not in the body that went
out. Since #6864 they are refused, by name:

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// ⛔ throws AnalyticsKeysOnSpecShapeError — an ARRAY `groupBy` selects the
// spec-shape branch, and these three keys would have vanished from the query:
// no filter, and no measure at all.
await dataSource.aggregate('opportunity', {
  field: 'amount',
  function: 'sum',
  groupBy: ['stage'],
  filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
});

// ✅ the analytics shape, unchanged — a STRING `groupBy` keeps this call on the
// analytics branch, where all three keys are read and `filter` is lowered for you
await dataSource.aggregate('opportunity', {
  field: 'amount',
  function: 'sum',
  groupBy: 'stage',
  filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
});
```

Pick one shape per call. A key that is present but nullish (`filter: undefined`)
carries nothing to drop and is not refused, so params built by spreading
possibly-absent authored values keep working. Keys outside those three are not
refused either — the gate names `filter`, `field` and `function`, and only
those.

### Group headers for server-side grid grouping

`queryGroupHeaders(resource, query)` answers a grouped list view's **group
header query** — the `EngineAggregateOptions` that `@objectstack/spec/ui`'s
`compileListViewGroupQuery` compiles from the view's `grouping` (and its column
summaries). It is how a grouped `object-grid` gets its group set and every
header number from the server instead of bucketing a fetched page
(objectui#7189): one row per group, each grouped field under its own name
holding the raw stored value (`null` for the empty group), and the group's
total row count under `count`.

The query is posted **verbatim** to the existing `POST /data/:object/query`
door (the same one the spec-shape `aggregate()` branch uses), and the answer is
its `records`. Unlike `aggregate()`, it never degrades to a client-side
reduction: a refusal is thrown with the server's code and status, and an answer
without a `records` array is refused rather than read as "no groups". The rows
inside a group are an ordinary `find()` with the group's compiled row query
(`compileListViewGroupRowsQuery`).

### Sorting

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// OData-style
await dataSource.find('users', {
  $orderby: {
    createdAt: 'desc',
    name: 'asc',
  },
});

// Converted to ObjectStack: ['-createdAt', 'name']
```

## Metadata Caching

The adapter includes built-in metadata caching to improve performance when fetching schemas:

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({ baseUrl: 'https://api.example.com' });

// Get cache statistics
const stats = dataSource.getCacheStats();
console.log(`Cache hit rate: ${stats.hitRate * 100}%`);
console.log(`Cache size: ${stats.size}/${stats.maxSize}`);
console.log(`Fetches coalesced onto an in-flight request: ${stats.coalesced}`);

// Manually invalidate cache entries
dataSource.invalidateCache('users'); // Invalidate specific schema
dataSource.invalidateCache();        // Invalidate all cached schemas

// Clear cache and statistics
dataSource.clearCache();
```

### Cache Configuration

- **LRU Eviction**: Automatically evicts least recently used entries when cache is full
- **TTL Expiration**: Entries expire after the configured time-to-live from creation (default: 5 minutes)
  - Note: TTL is fixed from creation time, not sliding based on access
- **Memory Limits**: Configurable maximum cache size (default: 100 entries)
- **Request Coalescing**: Concurrent `get` calls for the same uncached key share a single
  fetch. The first caller invokes the fetcher; every caller that arrives while that promise
  is still in flight is handed the same promise instead of starting a second request, and
  each one increments the `coalesced` counter in `getCacheStats()` — so the saving is
  something you can read off the adapter, not just a claim in this page.
  - The in-flight slot is released in a `finally`, so a rejected fetch is not cached and
    does not poison the key: the next call starts a fresh fetch.

## Connection State Monitoring

The adapter provides real-time connection state monitoring with automatic reconnection:

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({ baseUrl: 'https://api.example.com' });

// Monitor connection state changes
const unsubscribe = dataSource.onConnectionStateChange((event) => {
  console.log('Connection state:', event.state);
  console.log('Timestamp:', new Date(event.timestamp));
  
  if (event.error) {
    console.error('Connection error:', event.error);
  }
});

// Check current connection state
console.log(dataSource.getConnectionState()); // 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

// Check if connected
if (dataSource.isConnected()) {
  console.log('Adapter is connected');
}

// Unsubscribe from events when done
unsubscribe();
```

### Connection States

- `disconnected` - Not connected to server
- `connecting` - Attempting initial connection
- `connected` - Successfully connected
- `reconnecting` - Attempting to reconnect after failure
- `error` - Connection failed (check event.error for details)

### After the First Connect

Once the first connection has succeeded, the state follows the outcome of the
requests your app already makes. The adapter adds no timer, heartbeat or
request of its own:

- **A request with no HTTP answer** (refused, reset, unreachable) moves the state
  to `reconnecting`. When the retry window is spent, it moves to `error`. The
  window is the same `autoReconnect` / `maxReconnectAttempts` budget as below,
  counted in unanswered requests. With `autoReconnect: false` the first
  unanswered request moves the state straight to `error`.
- **The next answered request** moves it back to `connected`.
- **An answered HTTP error does not move it.** A 4xx or 5xx means the server is
  reachable. A request its caller aborted does not move it either.

Every request goes through the adapter's one fetch, including those made
through `getClient()`, except `uploadFile` / `uploadFiles`. Those two call the
global `fetch`, so an upload's outcome does not move the state. The response or
rejection reaches your code unchanged.

### Auto-Reconnect

The adapter automatically attempts to reconnect on connection failures:

- **Exponential Backoff**: Delay increases with each attempt (delay × 2^(attempts-1))
- **Configurable Attempts**: Set `maxReconnectAttempts` (default: 3)
- **Configurable Delay**: Set `reconnectDelay` for initial delay (default: 1000ms)
- **Automatic**: Enabled by default, disable with `autoReconnect: false`

## Batch Operation Progress

Track progress of bulk operations in real-time:

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({ baseUrl: 'https://api.example.com' });

declare const largeDataset: Array<Record<string, unknown>>;

// Monitor batch operation progress
const unsubscribe = dataSource.onBatchProgress((event) => {
  console.log(`${event.operation}: ${event.percentage.toFixed(1)}%`);
  console.log(`Completed: ${event.completed}/${event.total}`);
  console.log(`Failed: ${event.failed}`);
});

// Perform bulk operation
const users = await dataSource.bulk('users', 'create', largeDataset);

// Unsubscribe when done
unsubscribe();
```

### Progress Event Properties

- `operation` - Operation type ('create' | 'update' | 'delete')
- `total` - Total number of items
- `completed` - Number of successfully completed items
- `failed` - Number of failed items
- `percentage` - Completion percentage (0-100)

## Error Handling

The adapter provides a comprehensive error hierarchy for better error handling:

### Error Types

```typescript
import {
  ObjectStackError,        // Base error class
  MetadataNotFoundError,   // Schema/metadata not found (404)
  BulkOperationError,      // Bulk operation failures with partial results
  ConnectionError,         // Network/connection errors (503/504)
  AuthenticationError,     // Authentication failures (401/403)
  DataApiValidationError,  // Data validation errors (400). Its runtime `name` is
                           // still 'ValidationError' — that string is the wire
                           // discriminator shared with @objectstack/client. The
                           // SYMBOL is prefixed because @objectstack/spec/kernel
                           // owns `ValidationError` for a { field, message, code? }
                           // record (objectui#3160).
  MalformedFilterError,    // A filter rule that cannot be translated (400
                           // INVALID_FILTER) — thrown rather than dropped,
                           // because dropping one condition of an `and` widens
                           // the result set and reports success. Also thrown,
                           // before any request, for an `icontains` rule whose
                           // `value` is empty or not a string, naming the
                           // spelling that arrived. See "Rule-shaped arrays".
  UnloweredAggregateWhereError, // aggregate()'s spec-shape `where` was an array
                           // the spec's filter-AST gate rejects (400
                           // INVALID_FILTER). See "aggregate({ where }) does
                           // NOT lower" above.
  AnalyticsKeysOnSpecShapeError, // aggregate()'s spec-shape branch was handed the
                           // ANALYTICS branch's keys (`filter` / `field` /
                           // `function`), which it does not read (400
                           // INVALID_FILTER). See "the two shapes are
                           // alternatives, not a mixture" above.
  isMalformedFilterError,  // Recognises ALL THREE of the above, and the server's
                           // own version of the same refusal.
} from '@object-ui/data-objectstack';
```

### Error Handling Example

```typescript
import {
  ObjectStackError,
  MetadataNotFoundError,
  ConnectionError,
  AuthenticationError,
  type ObjectStackAdapter,
} from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

try {
  const schema = await dataSource.getObjectSchema('users');
} catch (error) {
  if (error instanceof MetadataNotFoundError) {
    console.error(`Schema not found: ${error.details?.objectName}`);
  } else if (error instanceof ConnectionError) {
    console.error(`Connection failed to: ${error.url}`);
  } else if (error instanceof AuthenticationError) {
    console.error('Authentication required');
  }

  // Every error this adapter throws carries the same shape
  if (error instanceof ObjectStackError) {
    console.error({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: error.details,
    });
  }
}
```

### Bulk Operation Errors

Bulk operations provide detailed error reporting with partial success information:

```typescript
import { BulkOperationError, type ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

declare const records: Array<Record<string, unknown>>;

try {
  await dataSource.bulk('users', 'update', records);
} catch (error) {
  if (error instanceof BulkOperationError) {
    const summary = error.getSummary();
    console.log(`${summary.successful} succeeded, ${summary.failed} failed`);
    console.log(`Failure rate: ${summary.failureRate * 100}%`);
    
    // Inspect individual failures
    summary.errors.forEach(({ index, error }) => {
      console.error(`Record ${index} failed:`, error);
    });
  }
}
```

### Error Codes

All errors include unique error codes for programmatic handling:

- `METADATA_NOT_FOUND` - Schema/metadata not found
- `BULK_OPERATION_ERROR` - Bulk operation failure
- `CONNECTION_ERROR` - Connection/network error
- `AUTHENTICATION_ERROR` - Authentication failure
- `VALIDATION_ERROR` - Data validation error
- `INVALID_FILTER` - A request the adapter refuses to send (`MalformedFilterError`,
  `UnloweredAggregateWhereError`, `AnalyticsKeysOnSpecShapeError`); matches the data
  API's own code for the same refusal
- `UNSUPPORTED_OPERATION` - Unsupported operation
- `NOT_FOUND` - Resource not found
- `UNKNOWN_ERROR` - Unknown error

## Batch Operations

The adapter supports optimized batch operations with automatic fallback:

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// Batch create
const newUsers = await dataSource.bulk('users', 'create', [
  { name: 'Alice', email: 'alice@example.com' },
  { name: 'Bob', email: 'bob@example.com' },
]);

// Batch update (uses updateMany if available, falls back to individual updates)
const updated = await dataSource.bulk('users', 'update', [
  { id: '1', name: 'Alice Smith' },
  { id: '2', name: 'Bob Jones' },
]);

// Batch delete
await dataSource.bulk('users', 'delete', [
  { id: '1' },
  { id: '2' },
]);
```

### Performance Optimizations

- Automatically uses `createMany`, `updateMany`, `deleteMany` when available
- Falls back to individual operations with detailed error tracking
- Provides partial success reporting for resilient error handling
- Atomic operations where supported by the backend

## Cross-Object Atomic Batch (`batchTransaction`)

`bulk()` above operates on **one** object. To persist a set of **cross-object**
writes as a single all-or-nothing unit — the master-detail case, where a parent
and its children must commit or roll back together — use `batchTransaction`:

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// Create a parent and a child that references it, atomically.
// `{ $ref: 0 }` resolves to the id minted by operation 0 (the parent).
await dataSource.batchTransaction([
  { object: 'invoice',      action: 'create', data: { no: 'INV-1' } },
  { object: 'invoice_line', action: 'create', data: { invoice: { $ref: 0 }, amount: 10 } },
]);
```

On a supporting backend this is one `POST /api/v1/batch` that commits or rolls
back the whole set in a single server transaction — no orphaned parent if a
child write fails.

### Declarative capability negotiation (`transactionalBatch`)

Whether the adapter can rely on server atomicity is decided **at connect time**,
not by firing a batch and reading the failure. `connect()` reads the
`capabilities.transactionalBatch` flag from `GET /api/v1/discovery`
([framework #3298](https://github.com/objectstack-ai/objectstack/issues/3298)),
which the server sets to `true` only when the `/batch` route is mounted **and**
the runtime engine can honour a transaction (`declared === enforced`):

| Discovery `capabilities.transactionalBatch` | `batchTransaction` behaviour |
| --- | --- |
| `true` | **Trusts server atomicity.** Calls `/batch`; any failure — including `404`/`405`/`501` — surfaces as a real error. No non-atomic client-side fallback. |
| `false` | Backend can't do an atomic batch (route absent, or a runtime without transactions) → falls back to the non-atomic client-side emulation below. |
| *absent* | Backend predates #3298 and advertises nothing → the legacy runtime probe stays: try `/batch`, and on `404`/`405`/`501` fall back to emulation. |

The hierarchical wire shape (`{ transactionalBatch: { enabled: true } }`) and the
flat form the client SDK normalizes to (`{ transactionalBatch: true }`) are both
accepted.

### Non-atomic fallback

When the capability is `false` or absent, the adapter degrades to a client-side
emulation (`@object-ui/core`'s `emulateBatchTransaction`): the operations run in
order and, on failure, it best-effort deletes the records it created (children
before parent) before rethrowing. This is **not** a transaction — a create's
side effects (hooks, rollups, webhooks) are not undone by a later delete, and a
mid-batch network drop leaves no chance to compensate. It exists only so a save
is still possible against a backend that lacks server atomicity; removing it
would turn "saves, less safe" into "no save path" on older backends
([objectui #2679](https://github.com/objectstack-ai/objectui/issues/2679)).

### Minimum supported backend

Atomic cross-object saves are **guaranteed only against ObjectStack backends on
the 16.x line that advertise `capabilities.transactionalBatch: true`** — the
endpoint landed in [framework #1604](https://github.com/objectstack-ai/objectstack/issues/1604)
and its discovery capability in
[framework #3298](https://github.com/objectstack-ai/objectstack/issues/3298).
ObjectUI does not hard-require it: against an older backend a master-detail save
still succeeds, but non-atomically via the fallback above. Treat the advertised
capability as the floor for the atomicity guarantee, not as a connection
prerequisite.

## Object-Metadata Write Guard

`MetadataClient.save` refuses an `object` document whose `fields` carry either
of two incomplete fields, **before** issuing the request:

- a relationship field (`lookup`, `master_detail`) with a missing, empty or
  whitespace-only `reference`;
- a choice field (`select`, `radio`) with no option source: neither a non-empty
  `options` list nor a shared `picklist`. `options: []` counts as none.

```ts
import { MetadataClient } from '@object-ui/data-objectstack';

const client = new MetadataClient({ baseUrl: '/api/v1' });

await client.save('object', 'account', {
  name: 'account',
  fields: { owner: { type: 'lookup', label: 'Owner' } },
});
// throws: The object was not saved: the field
// `owner` is a `lookup` and carries no `reference` key at all ...
```

For the relationship rule, nothing that previously succeeded now fails.
`@objectstack/spec` refuses the same document at the server with a 422 on
`fields.owner.reference`, and that refusal blocks every *later* save of the
object for as long as the half-filled field rides along in the draft. The guard
moves the identical refusal earlier, names the field while it is still on screen,
and leaves the draft in the client.

The choice rule is different, and on purpose: it holds a document the installed
server still stores. It is the objectui half of the maintainer's ruling A on
[objectstack#20827](https://github.com/objectstack-ai/objectstack/issues/20827),
which refuses such a field at the `FieldSchema` door and has objectui stop
sending it first. A `select` added in Studio, and saved before its first option,
now waits in the client, with the field named, until it has one:

```ts
import { MetadataClient } from '@object-ui/data-objectstack';

const client = new MetadataClient({ baseUrl: '/api/v1' });

await client.save('object', 'deal', {
  name: 'deal',
  fields: { stage: { type: 'select', label: 'Stage', options: [] } },
});
// throws: The object was not saved: the field
// `stage` is a `select` with no options ...
```

Writes of every other metadata type are untouched, and the guard never strips
the offending field — a dropped field reported as saved would be a silent
deletion.

Hosts that write object metadata through their own transport can apply the same
invariant at their own door:

```ts
import { assertObjectMetadataWritable } from '@object-ui/data-objectstack';

async function uploadObject(name: string, body: unknown) {
  assertObjectMetadataWritable('object', body, 'uploadObject');
  await fetch(`/api/v1/meta/object/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

`RELATIONSHIP_TYPES_REQUIRING_REFERENCE`, `CHOICE_TYPES_REQUIRING_OPTIONS` and
`OBJECT_METADATA_TYPE` are exported beside it. Both type sets are derived from
the installed `@objectstack/spec` by this package's own pin (the choice set from
its `field/choice-without-options` completeness rule), so they follow the
contract rather than a remembered list.

## Showing a Refused Metadata Save

When the server's spec check refuses a metadata save, it answers `422
INVALID_METADATA`. The error's `message` is a headline: a count of issues and
where they are. What the author should do is in the structured issues, which
`MetadataClient` puts on the thrown error's `issues`. Show the error through
`formatMetadataError`, not through `message` alone:

```ts
import { MetadataClient, formatMetadataError } from '@object-ui/data-objectstack';

const client = new MetadataClient({ baseUrl: '/api/v1' });

try {
  await client.save('object', 'account', {
    name: 'account',
    fields: { 'Bad Name': { type: 'text', label: 'Bad' } },
  });
} catch (err) {
  showBanner(formatMetadataError(err));
  // • fields.Bad Name — Invalid key in record
  // • fields.Bad Name — Field names must be lowercase snake_case (e.g., "first_name", …)
}

declare function showBanner(text: string): void;
```

It writes one line per issue, naming the field, and falls back to the error's
`message` when there are no issues. Render the text with a class that keeps
newlines (`whitespace-pre-line`). `formatMetadataIssue(issue)` is the same
one-line format for a single issue, for code that lists several failures, such
as a publish response's `failed[]`.

## Asking Why a Metadata Item Is Not Listed

The server filters metadata lists per caller. An app, a dashboard or a list view
the caller may not open is left out of their list, exactly like a name that does
not exist. `probeMetaItemAccess(type, name)` asks the by-name route which one it
is:

```ts
import { ObjectStackAdapter, type MetaItemAccess } from '@object-ui/data-objectstack';

const adapter = new ObjectStackAdapter({ baseUrl: '/api/v1' });

const access: MetaItemAccess = await adapter.probeMetaItemAccess('dashboard', 'legal_board');
// { verdict: 'denied', message: "You do not have permission to open the 'legal_board' dashboard." }
```

`verdict` is `granted`, `denied`, `not_found`, `unreachable` (no answer was
obtained) or `unknown` (nothing was asked). Only `denied`, read from the
`PERMISSION_DENIED` code and never from the status, is a permission refusal,
and only then does `message` carry the server's sentence. The probe never
throws and caches nothing. `probeAppAccess(name)` is the same probe for an app,
returning the verdict alone.

## Saving an Object You Read From the Server

A select field can name a shared picklist (`picklist: 'industry'`) instead of
carrying its own options. The server *serves* such a field with both keys:
`picklist`, and the `options` it resolved from the list. The server's authoring
check refuses the two together, with `422 INVALID_METADATA` at
`fields.FIELD.options`, and that refuses the whole object. So code that reads an
object, edits it, and saves the whole document back must drop those resolved
options first. `dropServedPicklistOptions` does that:

```ts
import { MetadataClient, dropServedPicklistOptions } from '@object-ui/data-objectstack';

const client = new MetadataClient({ baseUrl: '/api/v1' });

const account = await client.get<Record<string, unknown>>('object', 'account');
const edited = { ...account, label: 'Customer' };
await client.save('object', 'account', dropServedPicklistOptions(edited));
```

It removes `options` from every field that names a picklist, and touches
nothing else: a field without `picklist` keeps its inline `options`, and every
other key is kept. It never mutates its input, and it returns the same object
when there is nothing to remove.

Apply it only to a body built from a served read. `MetadataClient.save` does
not apply it for you: the client cannot tell a served copy from an author who
wrote `picklist` and `options` together, and that second case should stay the
server's refusal, which says which key to delete.

## Saving Only Over the Version You Read

Two editors of one metadata item overwrite each other unless each save says
which stored row it was built on. `MetadataClient.save` takes that precondition
as one of two options, never both:

- `ifMatch: version`, sent as `If-Match`: save only over that row. The token is
  the `version` the `/meta` door served for the same address (type, name,
  `packageId`, and the draft or active lifecycle): from the item read
  (`getDraft` hands back the envelope, `version` included), from a save
  receipt, or as `currentVersion` on a `409 METADATA_CONFLICT` refusal.
- `ifNoneMatch: '*'`, sent as `If-None-Match: *`: save only where no row of that
  lifecycle exists yet. A create sends it, and so does the first draft save of
  an item with no pending draft, or one whose read served `version: null`.

```ts
import { MetadataClient } from '@object-ui/data-objectstack';

const client = new MetadataClient({ baseUrl: '/api/v1' });

const read = await client.getDraft<{ item: Record<string, unknown>; version?: string | null }>(
  'object',
  'account',
  { packageId: 'com.acme.crm' },
);
// No pending draft, or none at this address: the save creates the draft row.
// A server that serves no `version` at all leaves the save unpinned.
const pin =
  read === null || read.version === null
    ? { ifNoneMatch: '*' as const }
    : read.version
      ? { ifMatch: read.version }
      : {};
await client.save('object', 'account', { name: 'account', label: 'Customer' }, {
  mode: 'draft',
  packageId: 'com.acme.crm',
  ...pin,
});
```

Read at the package the save writes: a read that names no package serves a
package-bound draft with `version: null`, which says nothing about a save that
names the package. A save that sets both options throws before any request;
the door refuses the pair with a `400`. A save whose pin no longer holds is
refused `409 METADATA_CONFLICT`, and nothing is written.

## Reading a Draft and Who Changed It

`MetadataClient.getDraft(type, name, { packageId })` answers the draft read's
wire envelope (`{ type, name, item, version }`, plus `draftChanges` when the
server recorded them), or `null` when nothing is pending. Read it through the
package's readers rather than by hand: `extractDraftBody` answers the body
with the read decorations removed; `readDraftChanges` answers the per-key
provenance, one `{ path, by, actor, at }` per changed key path, or `null` when
the key is absent, which means not recorded, never "nothing changed";
`governingDraftChange(changes, path)` answers the entry that governs a key, the
longest path that is the key or one of its ancestors, with `[]` standing for
the whole body and segments compared whole; and `draftChangesUnder(changes,
path)` answers the entries strictly under the key. A save names the surface it
is made through with the `surface` option, `'studio' | 'api'`, sent once as
`?surface=` and recorded as `by` on each key path a draft save changes; a save
that omits it is recorded as `api`, and `copilot` is the server's own (its
HTTP door refuses it), so this client cannot send it.

## User-Scoped State Adapter

In addition to the main `DataSource` adapter, this package ships
`createObjectStackUserStateAdapter` — a small factory that lets Object UI
persist per-user UI state (favorites, recent items) into ObjectStack.

```typescript
import { createObjectStackUserStateAdapter, type ObjectStackAdapter } from '@object-ui/data-objectstack';
import { useAttachUserStateAdapters } from '@object-ui/app-shell';

declare const dataSource: ObjectStackAdapter;
declare const user: { id: string };

const favoritesAdapter = createObjectStackUserStateAdapter({
  dataSource,             // the ObjectStack DataSource
  userId: user.id,
  key: 'ui.favorites',    // or 'ui.recent', 'ui.grid.account.state', ...
  // resource: 'sys_user_preference',  // default — the unified per-user KV store
  // onError: (op, err) => console.warn(`[user-state] ${op} failed`, err),
});

const attach = useAttachUserStateAdapters();

attach('favorites', favoritesAdapter);
```

### Backend contract

The adapter writes to the platform's unified per-user KV store —
`sys_user_preference` — shipped by every `@objectstack/plugin-auth`
environment. One row per `(user_id, key)` pair:

```yaml
object: sys_user_preference
fields:
  - { name: user_id,    type: lookup(sys_user), indexed: true }
  - { name: key,        type: string,           indexed: true }
  - { name: value,      type: json }
  - { name: updated_at, type: datetime }
unique: [user_id, key]
```

By convention, namespace UI-trace keys under `ui.*` (e.g. `ui.favorites`,
`ui.recent`, `ui.grid.<object>.state`, `ui.sidebar.collapsed`) so they
stay easy to tell apart from user-facing preferences (`theme`, `locale`).

If the backend doesn't yet expose `sys_user_preference`, every call
404s and the UI silently degrades to localStorage-only persistence. See
[User-Scoped State Persistence](../../content/docs/guide/user-state-persistence.md)
for the full design.

### Key families

Some state is one row per subject, and which subjects exist is only known
from the rows: the console keeps each object's list state under
`ui.list.<object>`. `createObjectStackUserPreferenceFamily` loads every row
whose key starts with a prefix, and writes one key's row at a time:

```typescript
import { createObjectStackUserPreferenceFamily, type ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;
declare const user: { id: string };

const lists = createObjectStackUserPreferenceFamily<{ viewOrder?: string[] }>({
  dataSource,
  userId: user.id,
  prefix: 'ui.list.',
});

const rows = await lists.load();                 // { 'ui.list.account': { viewOrder: [...] }, ... }
await lists.save('ui.list.account', { viewOrder: ['account.mine', 'account.all'] });
```

A family's `load()` joins the same shared read as the per-key adapters' loads
issued in the same tick, so the console's slots and its families are still
ONE request per load. That read asks for its keys or the prefix, and its
`$top` is the key count plus `PREFERENCE_FAMILY_ROW_LIMIT` rows per prefix.
When an answer fills that `$top`, a key whose row is missing from it reads
its own row. Only rows whose value is a JSON object are returned. A failed
read loads as `{}`, and a failed write is reported to `onError` and
swallowed. A key outside the family is refused and nothing is written.

## API Reference

### ObjectStackAdapter

#### Constructor

<!-- doc-snippet: fragment — the constructor SIGNATURE in prose notation, not a statement: `new ObjectStackAdapter(config: { ... })` names the parameter type where a call would carry a value. Measured TS1005x10. -->

```typescript
new ObjectStackAdapter(config: {
  baseUrl: string;
  token?: string;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  cache?: {
    maxSize?: number;
    ttl?: number;
  };
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
})
```

#### Methods

- `connect()` - Establish connection to ObjectStack server
- `find(resource, params?)` - Query multiple records
- `findOne(resource, id, params?)` - Get a single record by ID
- `create(resource, data)` - Create a new record
- `update(resource, id, data)` - Update an existing record
- `delete(resource, id)` - Delete a record
- `bulk(resource, operation, data)` - Batch operations (create/update/delete)
- `batchTransaction(operations)` - Cross-object atomic batch (master-detail); atomic when the backend advertises `transactionalBatch`, else non-atomic client-side fallback
- `getObjectSchema(objectName)` - Get schema metadata (cached)
- `getCacheStats()` - Get cache statistics
- `invalidateCache(key?)` - Invalidate cache entries
- `clearCache()` - Clear all cache entries
- `getClient()` - Access underlying ObjectStack client
- `getConnectionState()` - Get current connection state
- `isConnected()` - Check if adapter is connected
- `onConnectionStateChange(listener)` - Subscribe to connection state changes (returns unsubscribe function)
- `onBatchProgress(listener)` - Subscribe to batch operation progress (returns unsubscribe function)

## Best Practices

1. **Enable Caching**: Use default cache settings for optimal performance
2. **Handle Errors**: Use typed error handling for better user experience
3. **Batch Operations**: Use bulk methods for large datasets
4. **Monitor Cache**: Check cache hit rates in production
5. **Invalidate Wisely**: Clear cache after schema changes
6. **Connection Monitoring**: Subscribe to connection state changes for better UX
7. **Auto-Reconnect**: Use default auto-reconnect settings for resilient applications
8. **Batch Progress**: Monitor progress for long-running bulk operations

## Troubleshooting

### Common Issues

#### Schema Not Found

```typescript
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare const dataSource: ObjectStackAdapter;

// Error: MetadataNotFoundError
// Solution: Verify object name and ensure schema exists on server
const schema = await dataSource.getObjectSchema('correct_object_name');
```

#### Connection Errors

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

// Error: ConnectionError
// Solution: Check baseUrl and network connectivity
const dataSource = createObjectStackAdapter({
  baseUrl: 'https://correct-url.example.com',
  token: 'valid-token'
});
```

#### Cache Issues

```typescript
import { createObjectStackAdapter } from '@object-ui/data-objectstack';

const dataSource = createObjectStackAdapter({ baseUrl: 'https://api.example.com' });

// Clear cache if stale data is being returned
dataSource.clearCache();

// Or invalidate specific entries
dataSource.invalidateCache('users');
```

## Links

- 📚 [Documentation](https://www.objectui.org/docs/guide/data-source)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/data-objectstack)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
