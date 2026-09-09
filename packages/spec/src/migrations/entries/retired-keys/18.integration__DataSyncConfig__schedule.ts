// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — ADR-0049 enforce-or-remove on the seven cron-typed positions nothing
// reads (#15954 ruling, decision batch #56, 2026-09-06: option A — retire — per
// family). Connector family: `DataSyncConfig.schedule`, the cron slot on
// connector-attached sync (`ConnectorSchema.syncConfig`). Declared, parsed into
// the cron envelope and read by NOTHING — `syncConfig` has no reader outside
// `packages/spec`, no engine schedules a connector sync, and
// `@objectstack/formula`'s cronEngine has zero consumers outside its package.
// Tombstoned with `retiredKey()` (non-strict `z.object`, ADR-0104); the
// tombstone reaches every carrier — `Connector.syncConfig`,
// `DeclarativeConnectorEntry` (`stack.connectors[]`) and the `/meta/connector`
// door — through the one `DataSyncConfigSchema` they all nest.
//
// THE ONE POSITION OF THE SEVEN A STACK MANIFEST REACHES (`stack.zod.ts`
// `connectors: z.array(DeclarativeConnectorEntrySchema)` → `syncConfig`), so
// unlike its six siblings this family takes the `connector-error-mapping-removed`
// shape: a D2 conversion, `connector-sync-schedule-removed` (one strip per
// `connectors[]` entry that authored the key, `retiredFromLoadPath`), wired
// into the step-18 chain, and the house `os migrate meta --from 17` sentence
// on the prescription — which must be true of the tool, and here is. No D3
// semantic entry: the strip is fully mechanical, and the chain's `semantic`
// list is the residue D2 cannot express.
//
// Measured author population (the only family whose entry owes one, since it
// is the only stack-collection member): zero in-repo authors — `examples/**`,
// `skills/**`, `content/docs/**` (generated references excluded) and every
// package outside `packages/spec` swept for `syncConfig` + `schedule`, with the
// declaring file lighting the control; objectui at the pinned sha
// `53ded82bf7a4` has no `syncConfig.schedule` (its `syncConfig` hits are the
// react offline hook's own key, `ui/offline.zod.ts`). Out-of-repo stacks are
// NOT MEASURABLE from this repo and are not claimed zero.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
export const entry = 'integration/DataSyncConfig:schedule';
