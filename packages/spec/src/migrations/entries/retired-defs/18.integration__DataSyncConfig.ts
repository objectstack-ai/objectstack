// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/DataSyncConfig` (`strategy`, `direction`, `realtimeSync`,
// `timestampField`, `conflictResolution`, `batchSize`, `deleteMode`,
// `filters`) leaves with its only carrier, `ConnectorSchema.syncConfig`,
// tombstoned in this same major under ADR-0049. No engine ever ran a
// connector-attached sync; a sync is defined on its target `mapping`
// (`connectorSource`), with a `job` for the cadence. See
// `retired-keys/18.integration__Connector__syncConfig.ts` for the retirement
// record.
export const entry = 'integration/DataSyncConfig';
