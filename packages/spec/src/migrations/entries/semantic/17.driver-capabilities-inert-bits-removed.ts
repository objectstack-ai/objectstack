// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'driver-capabilities-inert-bits-removed',
  surface:
    'data.DriverCapabilities.create / data.DriverCapabilities.read / '
    + 'data.DriverCapabilities.update / data.DriverCapabilities.delete / '
    + 'data.DriverCapabilities.bulkCreate / data.DriverCapabilities.bulkUpdate / '
    + 'data.DriverCapabilities.bulkDelete / data.DriverCapabilities.transactions / '
    + 'data.DriverCapabilities.savepoints / data.DriverCapabilities.isolationLevels / '
    + 'data.DriverCapabilities.queryFilters / data.DriverCapabilities.queryAggregations / '
    + 'data.DriverCapabilities.querySorting / data.DriverCapabilities.queryPagination / '
    + 'data.DriverCapabilities.queryWindowFunctions / data.DriverCapabilities.querySubqueries / '
    + 'data.DriverCapabilities.queryCTE / data.DriverCapabilities.joins / '
    + 'data.DriverCapabilities.fullTextSearch / data.DriverCapabilities.jsonQuery / '
    + 'data.DriverCapabilities.geospatialQuery / data.DriverCapabilities.streaming / '
    + 'data.DriverCapabilities.jsonFields / data.DriverCapabilities.arrayFields / '
    + 'data.DriverCapabilities.vectorSearch / data.DriverCapabilities.schemaSync / '
    + 'data.DriverCapabilities.migrations / data.DriverCapabilities.indexes / '
    + 'data.DriverCapabilities.connectionPooling / data.DriverCapabilities.preparedStatements / '
    + 'data.DriverCapabilities.queryCache',
  replacement:
    '(removed — delete the keys. A driver advertises a capability by implementing the '
    + 'corresponding IDataDriver method; the three bits that survive because method '
    + 'presence cannot carry the signal are `queryDateGranularity`, `autonumber` and '
    + '`batchSchemaSync`)',
  reason:
    'The #4484 findStream close-out found `DriverCapabilities.streaming` pointing at a '
    + 'capability the contract no longer declares, and the follow-up audit (#4634) checked '
    + 'every bit in the record the same way, across objectstack and cloud (objectui '
    + 'confirmed clean): of 34 declared bits, THREE have a decision-making reader — '
    + '`queryDateGranularity` (engine aggregate dispatch + checkDateBucketParity), '
    + '`autonumber` (engine defers generation to the driver), `batchSchemaSync` (engine '
    + 'ANDs it with method presence, because a subclass can inherit `syncSchemasBatch` '
    + 'from a base whose transport batches while its own cannot) — and THIRTY-ONE were '
    + 'written by every driver and read by nothing. Their `.describe()` strings promised '
    + 'engine adaptation ("if false, ObjectQL will filter/sort/paginate in memory") that '
    + 'was never built, and zero readers let the values go WRONG unnoticed: SqlDriver '
    + 'declared `streaming: false` while implementing `findStream`; InMemoryDriver '
    + 'declared `streaming: true` over a full-table read (ADR-0078 false affordance, on '
    + 'the capability record itself). The real mechanism everywhere else is METHOD '
    + 'presence: transactions gate on `driver.beginTransaction`, aggregate pushdown on '
    + '`typeof driver.aggregate`, schema sync on `typeof driver.syncSchema`, and the '
    + 'REQUIRED CRUD/bulk methods are called unconditionally. A driver is CODE, never '
    + 'stack metadata — `supports` literals live in driver classes and '
    + '`DriverConfig.capabilities` is plugin TS configuration, neither ever a '
    + '`sys_metadata` shape (the stack-tree neighbour, `datasource.capabilities`, was '
    + 'retired separately in #4583) — so there is no source for the D2 chain to rewrite '
    + 'and this entry is the D3 record. The keys are tombstoned rather than deleted '
    + 'because `DriverCapabilitiesSchema` is not `.strict()` and IS parsed '
    + '(DriverConfigSchema / SQLDriverConfigSchema / NoSQLDriverConfigSchema embed it): '
    + 'a plain delete would silently strip a vendor\'s authored bit, replacing one '
    + 'silent no-op with another. `batchSchemaSync` also drops its `.default(false)` '
    + 'for `.optional()` — absence already meant false at both readers, and the default '
    + 'forced every capability object to spell out 30+ bits. ADR-0049 / ADR-0078, #4634.',
  acceptanceCriteria:
    'No `supports` literal or `DriverConfig.capabilities` object authors any of the 31 '
    + 'retired bits — a driver class that still writes one fails tsc against '
    + '`IDataDriver.supports` (the bit is `never`), and a parsed config fails with the '
    + 'per-key prescription. The three in-repo drivers (memory / mongodb / sql) declare '
    + 'only live bits; cloud\'s TursoDriver keeps compiling via its `...super.supports` '
    + 'spread (its stale explicit overrides are cleanup, tracked cloud-side). Engine '
    + 'behaviour is byte-identical: every removed bit had zero readers, and the three '
    + 'live bits keep their readers (engine.ts autonumber defer / aggregate dispatch, '
    + 'plugin.ts + engine.ts batched schema sync, verify date-bucket parity).',
};
