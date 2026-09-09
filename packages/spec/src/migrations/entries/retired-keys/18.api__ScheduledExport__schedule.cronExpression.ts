// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16320 — ADR-0049 enforce-or-remove on the seven cron-typed positions nothing
// reads (#15954 ruling, director decision batch #56, maintainer 「其他同意」,
// 2026-09-06: option A — retire — per family). Export-schedule family, first
// of two positions: `ScheduledExport.schedule.cronExpression`. Declared, parsed
// into the `{ dialect: 'cron', source }` envelope and read by NOTHING — the
// whole `ExportJobApiContracts` family has zero consumers, rest-server serves
// no `/api/v1/data/export` route, and `IExportService` has no provider binding
// (its own header records that), so `POST /api/v1/data/export/schedules` is a
// declared contract nothing implements and the cron inside it never fired.
// Tombstoned with `retiredKey()`: the schema is a non-strict `z.object`, so a
// bare deletion would be a silent strip (ADR-0104).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention) and the
// prescription lives at the major boundary where `migrate meta` users look.
//
// Registered here but NOT in `src/conversions/registry.ts`, for the reason
// `kernel/MetadataPluginConfig:additionalTypes` gives: the conversion chain
// walks a normalized STACK and `applyConversionsToStoredItem` maps a metadata
// type onto one of its collections; an export schedule is an API body and is
// neither, so a MetadataConversion would be a transform with no seam that ever
// runs. The prescription therefore carries no `os migrate meta` sentence (it
// must be true of the tool) and reaches authors through the tombstone (`tsc` +
// the parse) and the D3 semantic entry named below.
//
// A NESTED site: the authorable-surface ratchet walks top-level def
// properties only (`api/ScheduledExport:schedule` is the row), so no
// `[RETIRED]` row exists for the cron itself and gate (b) of
// `build-schemas.ts` neither demands nor refuses this entry — it is here for
// the spec-changes / upgrade-guide projection, spelled the way
// `api/BatchEndpointsConfig:operations.upsertMany` is.
// D3 semantic entry: `export-schedule-cron-retired`.
export const entry = 'api/ScheduledExport:schedule.cronExpression';
