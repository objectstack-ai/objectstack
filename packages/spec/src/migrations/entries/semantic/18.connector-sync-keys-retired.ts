// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 — the D3 entry of the connector-attached sync family:
// `connector.syncConfig` (the `DataSyncConfig` block) and
// `connector.fieldMappings` (the `ConnectorFieldMapping` list), fourteen keys
// no engine ever executed, retired from the connector as one batch because the
// sync definition MOVED to its target (the ruled ENFORCE route: a `mapping`
// whose `connectorSource` names the connector, with a `job` for the cadence).
// One D3 entry per retirement family, even when D2 is lossless (ruling B on
// #17152): the D2 conversion `connector-sync-keys-removed` repairs the data,
// and this entry carries what only the author can judge — above all, that the
// conversion never writes the replacement `mapping`, because a pulled mapping
// would START writes that never happened.
export const entry: SemanticMigration = {
  id: 'connector-sync-keys-retired',
  surface: 'connector.syncConfig (strategy / direction / realtimeSync / timestampField / '
    + 'conflictResolution / batchSize / deleteMode / filters) and connector.fieldMappings[] '
    + '(source / target / defaultValue / dataType / required / syncMode), on a connector and on a '
    + 'stack connectors[] entry',
  replacement: 'A sync is defined on its TARGET: a `mapping` (`targetObject`, `fieldMapping`, '
    + '`mode`, `upsertKey`) whose `connectorSource` names the `rest` or `openapi` connector '
    + 'instance it pulls from (`connector`), the action that reads the records (`action`, with a '
    + 'fixed `input` and a `recordsPath`) and, for a timestamp-incremental pull, a `watermark` '
    + '(`field` on the record, `param` on the request); a `job` sets the cadence. Declared in this '
    + 'protocol step and not yet executed — authoring it warns until the pull executor reads it.',
  reason: 'The D2 conversion `connector-sync-keys-removed` deletes `syncConfig` and '
    + '`fieldMappings` from every connector, stack entry and stored connector row, one notice per '
    + 'key, and the delete is lossless: no engine ever ran a connector-attached sync or moved a '
    + 'value through a connector field mapping, so nothing the upgrade removes was ever happening. '
    + 'Three judgements remain. First, any part of the deployment designed around a connector '
    + 'sync running has never been running, so the author decides which syncs should now exist '
    + 'as target-side mappings; the conversion STRIPS the keys and never writes a `mapping`, '
    + 'because a mapping that is pulled STARTS writes into a table that never received them — '
    + 'its target object, match key and cadence are the author\'s. Second, the retired block '
    + 'named a direction, a conflict policy and a delete policy that no runtime applied — every '
    + 'delete is a hard delete, and `latest_wins` resolved nothing — and the pull that replaces '
    + 'it is one-way (external to local) and writes only through the mapping\'s `mode` and '
    + '`upsertKey`: an author who relied on `export`, `bidirectional`, `soft_delete` or a conflict '
    + 'policy decides what to do without them. Third, a connector field map moved values '
    + 'nowhere; carrying its `source` → `target` pairs into `mapping.fieldMapping` makes them '
    + 'real for the first time, including any `defaultValue`, which the import mapping spells as '
    + 'a `constant` transform, and `required`, which the target field declares.',
  acceptanceCriteria: 'No connector and no stack connector entry carries `syncConfig` or '
    + '`fieldMappings`; the parse refuses either key with its prescription, and no code imports '
    + 'DataSyncConfig, SyncStrategy, ConnectorConflictResolution or ConnectorFieldMapping or '
    + 'their schemas. Every connector registers and dispatches its actions exactly as it did '
    + 'before the upgrade. Each sync the author still wants is a `mapping` whose '
    + '`connectorSource` names a `rest` or `openapi` connector instance, validated at authoring, '
    + 'with a `job` chosen for its cadence.',
};
