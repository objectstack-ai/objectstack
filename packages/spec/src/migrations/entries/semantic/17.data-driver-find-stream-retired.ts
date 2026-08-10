// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'data-driver-find-stream-retired',
  surface: 'contracts.IDataDriver.findStream / data.DriverInterfaceSchema.findStream',
  replacement:
    'find() with limit/offset — the paged read whose determinism IS enforced '
    + '(IDataDriver.find, data/pagination-conformance.ts)',
  reason:
    '`findStream` was a REQUIRED contract method documented as "optimized for large '
    + 'datasets to avoid memory overflow", and in two of its three implementations it '
    + 'delivered the opposite: `SqlDriver` and `InMemoryDriver` both awaited `find()` for '
    + 'the ENTIRE result set and then yielded it row by row, so the peak memory a caller '
    + 'was promised protection from was already reached before the first yield. The third '
    + '(`MongoDBDriver._findStream`) did walk a cursor, but it was the one read path in '
    + 'that driver never routed through `buildFindOptions`, so it hardcoded '
    + '`projection: { _id: 0 }` and silently discarded `query.fields`. None of it was ever '
    + 'observed, because the method had NO caller in either repository: the engine exposes '
    + 'no stream entry, and the REST export, import and bulk-read paths all go through '
    + '`find()`. The ~20 driver test doubles that existed only to satisfy a required '
    + 'method almost all threw `not implemented`, and nothing ever noticed — which is the '
    + 'proof, not the anecdote. Being REQUIRED, it also taxed every new driver and every '
    + 'test double with an implementation of a capability the platform does not have. '
    + 'Rather than build a caller to justify three implementations, the method is retired; '
    + 'a real cursor-based read should return WITH the caller that needs it (ADR-0049 '
    + 'enforce-or-remove). This is a TS/API contract surface — a driver is CODE, never '
    + 'stack metadata — so there is no source for the chain to rewrite, and deliberately '
    + 'no schema tombstone either: nothing ever ran a driver object through '
    + '`DriverInterfaceSchema.parse()`, so a prescription there would have no one to '
    + 'reach. The enforced channel is tsc, and it points at callers. ADR-0049 / '
    + 'ADR-0078, #4484.',
  acceptanceCriteria:
    'No code calls `driver.findStream(...)`; large reads page through `find()` with '
    + '`limit`/`offset` (which guarantees a total order across the whole walk) or go '
    + 'through the export surface. Drivers and test doubles no longer implement the '
    + 'method — one left behind still compiles and is simply never reached, so removing '
    + 'it is cleanup rather than a break, while a CALLER of it no longer type-checks.',
};
