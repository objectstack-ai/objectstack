// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0049 on `ConnectorSchema.syncConfig` — connector-attached sync, ruled
// ENFORCE on the maintainer's criterion for a declared-but-unenforced family
// (the mainstream has the capability) with the definition MOVED to the target
// side: a `mapping` whose `connectorSource` names the connector it pulls from,
// with a `job` for the cadence. The eight `DataSyncConfig` keys (`strategy`,
// `direction`, `realtimeSync`, `timestampField`, `conflictResolution`,
// `batchSize`, `deleteMode`, `filters`) were read by NOTHING. Measured on
// `origin/main` before the removal: outside `packages/spec` the word
// `syncConfig` appeared only in two comments; the automation service's
// declared-connector item and its re-materialization fingerprint carry
// neither sync key, and the def a provider registers is the provider's own,
// so the key never reached the connector registry — while `retryConfig`, the
// lit control on the same def, is read by the connector fetch policy.
//
// Tombstoned with `retiredKey()` (non-strict schema, ADR-0104); the orphaned
// `integration/DataSyncConfig`, `integration/SyncStrategy` and
// `integration/ConnectorConflictResolution` leave via
// `RETIRED_DEFS_BY_MAJOR[18]`. The key carried no default of its own, so no
// retired-default residue is owed. Sources and stored rows are rewritten by
// the D2 conversion `connector-sync-keys-removed`, which STRIPS the key and
// never writes a `mapping` — that is the author's decision, carried by the D3
// entry `connector-sync-keys-retired`.
export const entry = 'integration/Connector:syncConfig';
