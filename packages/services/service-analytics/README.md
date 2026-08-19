# @objectstack/service-analytics

The shipped provider for the kernel's **`analytics`** service slot — a cube/dataset
query engine implementing `IAnalyticsService` over a priority-ordered strategy chain.

Slot criticality: `optional` (`ServiceRequirementDef` in `@objectstack/spec/system`).
Without it, `/api/v1/analytics/*` answers 404 rather than degrading.

## Installation

```bash
pnpm add @objectstack/service-analytics
```

## Usage

The entry point is the kernel plugin `AnalyticsServicePlugin`. Construct it and hand
it to the kernel; it registers the service under `'analytics'` during `init`.

```typescript
import { LiteKernel } from '@objectstack/core';
import type { Cube } from '@objectstack/spec/data';
import type { IAnalyticsService } from '@objectstack/spec/contracts';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';

const ordersCube: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  measures: {
    count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
    total_amount: { name: 'total_amount', label: 'Total Amount', type: 'sum', sql: 'amount' },
  },
  dimensions: {
    status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
  },
};

const kernel = new LiteKernel();
kernel.use(new AnalyticsServicePlugin({ cubes: [ordersCube] }));
await kernel.bootstrap();

const analytics = kernel.getService<IAnalyticsService>('analytics');
const result = await analytics.query({ cube: 'orders', measures: ['orders.count'] });
```

`LiteKernel.use()` is synchronous; `ObjectKernel.use()` returns a promise — await it there.

## Plugin options

Every field of `AnalyticsServicePluginOptions` is optional. The plugin bridges the
host's engine into `AnalyticsServiceConfig`; anything left unset falls back to what
the plugin can auto-discover from the kernel.

| Option | Type | Default | Purpose |
|:---|:---|:---|:---|
| `cubes` | `Cube[]` | none | Cube definitions registered at init. |
| `queryCapabilities` | `(cubeName: string) => AnalyticsDriverCapabilities` | in-memory only | Which execution paths a cube's backing driver supports. |
| `executeRawSql` | `(objectName, sql, params) => Promise<Record<string, unknown>[]>` | auto-bridged to the ObjectQL engine | Enables `NativeSQLStrategy`. |
| `executeAggregate` | `(objectName, options) => Promise<Record<string, unknown>[]>` | auto-bridged to the ObjectQL engine | Enables `ObjectQLStrategy`. |
| `getReadScope` | `(objectName, context?) => FilterCondition \| null \| undefined \| Promise<…>` | auto-bridges to a registered `'security'` service exposing `getReadFilter` | Per-object tenant/RLS read scope (ADR-0021 D-C). |
| `getAllowedRelationships` | `(cubeName: string) => Set<string> \| undefined` | supplied by compiled datasets | Join allowlist per cube. |
| `debug` | `boolean` | `false` | Server-side log verbosity only. |
| `debugSql` | `boolean` | development only (`NODE_ENV === 'development'`) | Echo the executed statement back to callers in `AnalyticsResult.sql`. |

`debug` and `debugSql` are deliberately separate: raising log verbosity must never
widen what travels to a tenant.

## Service API

`IAnalyticsService` (from `@objectstack/spec/contracts`) declares four members — two
required, two optional:

```typescript
import type { IAnalyticsService } from '@objectstack/spec/contracts';

// query(query, context?)             -> Promise<AnalyticsResult>     (required)
// getMeta(cubeName?)                 -> Promise<CubeMeta[]>          (required)
// generateSql?(query, context?)      -> Promise<{ sql, params }>     (optional)
// queryDataset?(dataset, selection, context?, options?)              (optional)
```

This package implements all four. Pass the caller's `ExecutionContext` as the second
argument: without it the per-object read scope resolves to no filter and the query
runs unscoped.

### AnalyticsQuery

`AnalyticsQuery` is a **strict** schema (`AnalyticsQuerySchema`, `@objectstack/spec/data`)
with exactly these fields; `measures` is the only required one, and an undeclared key
is rejected rather than dropped.

| Field | Type | Notes |
|:---|:---|:---|
| `cube` | `string?` | Optional when supplied by the request wrapper. |
| `measures` | `string[]` | Required. |
| `dimensions` | `string[]?` | |
| `where` | `FilterCondition?` | Canonical Query DSL filter — the same shape `find()` takes. |
| `timeDimensions` | `{ dimension, granularity?, dateRange? }[]?` | Also strict per item. |
| `order` | `Record<string, 'asc' \| 'desc'>?` | |
| `limit` | `number?` | |
| `offset` | `number?` | |
| `timezone` | `string?` | IANA name. No default — an absent timezone means the engine resolves it. |

There is no `filters` key and no `aggregations` key. `filters` is rejected at the REST
door with a 400 naming `where`; per-metric filtering lives on the cube metric's own
`filters`.

```typescript
const revenueByStatus = await analytics.query({
  cube: 'orders',
  measures: ['orders.total_amount'],
  dimensions: ['orders.status'],
  where: { is_active: true },
  order: { 'orders.total_amount': 'desc' },
  limit: 10,
});
// result.rows  — Record<string, unknown>[]
// result.fields — column metadata (name, type, label?, format?, currency?, percentScale?)
```

## Strategy chain

`AnalyticsService` delegates to a priority-ordered chain; the first strategy whose
`canHandle` returns true serves the query.

| Priority | Strategy | Condition |
|:---:|:---|:---|
| 10 | `NativeSQLStrategy` | driver supports raw SQL (`executeRawSql`) |
| 20 | `ObjectQLStrategy` | driver supports aggregate AST (`executeAggregate`) |
| 30 | custom strategies, or the internal delegate added when `fallbackService` is set | injected by the host |

`InMemoryStrategy` is **not** built in — it ships from `@objectstack/driver-memory` and
is injected through `AnalyticsServiceConfig.strategies` (or `fallbackService`).

## REST API

Served by the runtime dispatcher's `/analytics` domain when this service occupies the
slot. These four routes are the whole surface:

```
POST   /api/v1/analytics/query           # execute an AnalyticsQuery
GET    /api/v1/analytics/meta[?cube=]    # cube metadata for discovery
POST   /api/v1/analytics/sql             # generate SQL without executing (dry-run)
POST   /api/v1/analytics/dataset/query   # run a dataset selection (ADR-0021)
```

`POST /analytics/sql` answers 404 when the slot's occupant does not implement the
optional `generateSql`.

## Exports

```typescript
import {
  AnalyticsService, AnalyticsServicePlugin, CubeRegistry, DatasetExecutor,
  NativeSQLStrategy, ObjectQLStrategy,
  compileDataset, compileScopedFilterToSql,
  combineFilters, evaluateDerivedMeasures, fillEmptyGroups, mergeByDimensions, shiftRange,
  createOrderLabelResolver, pickDisplayField, resolveDimensionLabels, withLabelFetchCache,
} from '@objectstack/service-analytics';
```

Types: `AnalyticsServiceConfig`, `AnalyticsServicePluginOptions`, `AnalyticsStrategy`,
`StrategyContext`, `AnalyticsDriverCapabilities`, `CompiledDataset`,
`DatasetCompileOptions`, `DatasetSelection`, `CompareTo`, `DerivedMeasureSpec`,
`RelationshipResolver`, `RelationshipTarget`, `DimensionLabelDeps`, `FieldMetaLite`,
`OrderLabelResolver`.

## Advanced: constructing the service directly

`AnalyticsService` is exported for hosts that wire their own kernel integration.
`AnalyticsServiceConfig` is the wider surface the plugin builds — it adds `logger`,
`strategies`, `fallbackService`, `coerceTemporalFilterValue`,
`coerceTemporalFilterColumn`, `isExternalObject`, `getObjectDatasource`,
`isRegisteredObject` and the dataset resolvers on top of the plugin options above.

```typescript
import { AnalyticsService, CubeRegistry } from '@objectstack/service-analytics';

const registry = new CubeRegistry();
registry.registerAll([ordersCube]);

const service = new AnalyticsService({ cubes: [ordersCube] });
```

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/objectql](../../objectql/)
- [@objectstack/driver-memory](../../drivers/driver-memory/) — ships `InMemoryStrategy`
- [Analytics Guide](https://docs.objectstack.ai/docs/data-modeling/analytics)
