// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B. `NoSQLQueryOptions.timeout`
// said "Query timeout (ms)" in prose and nothing else, directly beside
// `batchSize`, a plain row COUNT: two bare numbers side by side, one carrying a
// unit and one not, with nothing at the call site to tell them apart. Renamed
// to `timeoutMs`; the value is unchanged. Tombstoned with `retiredKey()`; the
// shape is not `.strict()`, so a bare deletion would strip in silence and the
// query would run without the limit its author set. No D2 conversion: query
// options are a per-call driver argument reached only through
// `AggregationPipeline.options`, which no `stack.zod.ts` collection declares
// and no `sys_metadata` row stores. See `data-nosql-query-options-timeout-unit-in-key`.
export const entry = 'data/NoSQLQueryOptions:timeout';
