// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/SyncStrategy` (`full` / `incremental` / `upsert` /
// `append_only`) was the value vocabulary of `syncConfig.strategy` alone, and
// leaves with it. On the target-side binding, full vs incremental is whether
// `connectorSource.watermark` is set, and upsert is the mapping's own `mode`.
// See `retired-keys/18.integration__Connector__syncConfig.ts`.
export const entry = 'integration/SyncStrategy';
