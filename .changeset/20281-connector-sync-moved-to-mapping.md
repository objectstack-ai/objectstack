---
'@objectstack/spec': minor
---

feat(spec)!: connector-attached sync leaves the connector — `syncConfig` and `fieldMappings` are retired, and a `mapping` gains the `connectorSource` pull binding (#20281)

**BREAKING** — `connector.syncConfig` (the `DataSyncConfig` block: `strategy`,
`direction`, `realtimeSync`, `timestampField`, `conflictResolution`, `batchSize`,
`deleteMode`, `filters`) and `connector.fieldMappings` (the `ConnectorFieldMapping`
list: `source`, `target`, `defaultValue`, `dataType`, `required`, `syncMode`) are
removed from `ConnectorSchema` and `DeclarativeConnectorEntrySchema` — so from
`defineConnector`, `stack.connectors[]`, the `PUT /api/v1/meta/connector/:name` door
and `AutomationEngine.registerConnector`. The `DataSyncConfigSchema`,
`SyncStrategySchema`, `ConnectorConflictResolutionSchema` and
`ConnectorFieldMappingSchema` exports (and their `DataSyncConfig`, `SyncStrategy`,
`ConnectorConflictResolution`, `ConnectorFieldMapping` types and `…Parsed` aliases)
leave `@objectstack/spec/integration` with them. ADR-0049, ruled ENFORCE on the
maintainer's criterion for a declared-but-unenforced family, with the definition
MOVED: every mainstream platform binds a sync to its TARGET, not to the connection.

Measured before removal: no engine ever ran a connector-attached sync or moved a
value through a connector field mapping — outside the spec package `syncConfig`
appeared only in two comments and `fieldMappings` nowhere, the automation service's
declared-connector item carried neither key, and the def a provider registers is its
own. The `latest_wins` and `soft_delete` defaults read as configured policy and did
nothing; the platform has no soft delete.

**Added:** `mapping.connectorSource` — the pull
binding on the target side, beside the mapping's existing `targetObject`,
`fieldMapping`, `mode` and `upsertKey`: `connector` (a `rest` or `openapi`
connector instance), `action` (the action that reads the records), optional
`input`, optional `recordsPath`, and an optional `watermark` (`field` on the
record, `param` on the request) for a timestamp-incremental pull. Version 1 is a
one-way pull. It carries no cadence (a `job` sets that), no credential (the
connector instance holds it) and no delete or conflict policy. The connector sync
executor, `@objectstack/service-automation`'s `pullConnectorSource` (#20919), reads
it; nothing schedules a pull until the `job` stage lands.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `connector.syncConfig` | delete the key. A sync you still want is a `mapping` on its target object, with `connectorSource` naming the connector and its read action, `watermark` for an incremental pull, and a `job` for the cadence. `direction`, `conflictResolution` and `deleteMode` have no counterpart: the pull is one-way and writes through `mode` / `upsertKey`. |
| `connector.fieldMappings` | delete the key, and carry its `source` → `target` pairs into that mapping's `fieldMapping` (a `defaultValue` becomes a `constant` transform). |
| `DataSyncConfigSchema`, `SyncStrategySchema`, `ConnectorConflictResolutionSchema`, `ConnectorFieldMappingSchema` and their types | no replacement — nothing parsed a sync or a connector field mapping into anything that ran. |

**The one-line fix: delete `syncConfig:` and `fieldMappings:` from every connector.**
`os migrate meta --from 17` lists the mechanical edits for existing sources.

⚠️ Runtime behaviour is deliberately **unchanged**: no connector sync ever ran.
What changes is the answer an author gets — both keys are refused at parse with a
prescription naming the target-side binding, and in `tsc` (their input type is
`never`), instead of being saved with no effect.

### The retirement kit

- **Tombstones.** `syncConfig` and `fieldMappings` are `retiredKey()` tombstones on
  the private `ConnectorBaseSchema` both published carriers wrap (the schema is not
  `.strict()`, so a bare deletion would be a silent strip, ADR-0104).
  `RETIRED_KEYS_BY_MAJOR[18]`: `integration/Connector:syncConfig`,
  `integration/Connector:fieldMappings`,
  `integration/DeclarativeConnectorEntry:syncConfig` and
  `integration/DeclarativeConnectorEntry:fieldMappings`. Neither key had a default,
  so no retired-default residue is owed.
- **Four defs leave whole** (`RETIRED_DEFS_BY_MAJOR[18]`): `integration/DataSyncConfig`,
  `integration/SyncStrategy`, `integration/ConnectorConflictResolution`,
  `integration/ConnectorFieldMapping`. The two `RENAMED_DEFS` entries that targeted
  them left the rename table.
- **D2 conversion `connector-sync-keys-removed`** (step 18, retired from the load
  path): strips both keys from `connectors[]` and from stored `sys_metadata`
  connector rows (the rehydration seam replays it), one notice per key, as a
  lossless delete. It never writes a `mapping`: a pulled mapping would start writes
  that never happened.
- **D3 entry `connector-sync-keys-retired`** carries the family's judgement: which
  syncs should now exist as target-side mappings, and what an author who relied on
  `export`, `bidirectional`, `soft_delete` or a conflict policy does without them.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is
published, so this is breaking for consumers no telemetry was consulted for.

Clause-②: yes (narrowing)

<!-- adr-0087: registered connector-sync-keys-removed, connector-sync-keys-retired -->
