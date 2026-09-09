// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 twin of the D2 conversion `connector-sync-schedule-removed` — the one
// of the seven #16320 cron-typed retirements whose family carries BOTH shapes.
// The #15954 ruling (director decision batch #56, 2026-09-06) names this
// family's D3 entry as the carrier of the author-population reading:
// "`connectors[].syncConfig.schedule` is the one stack-collection member: its
// D3 entry says so and names the measured zero in-repo authors and the
// NOT-MEASURED out-of-repo population." The strip is the D2's (mechanical,
// `retiredFromLoadPath`, one notice per authoring `connectors[]` entry); what
// no conversion can carry — the cadence the author meant, and the population
// this repo cannot measure — lives below, on the fields that PROJECT: `reason`
// → `spec-changes.json` `rationale`, the upgrade guide's "Why not automatic"
// and `os migrate meta`'s `why:`; `acceptanceCriteria` → "Done when" and
// `verify:`. A code comment projects nowhere, which is why the sentence is here.
export const entry: SemanticMigration = {
  id: 'connector-sync-schedule-retired',
  surface:
    'connector sync cron: `connectors[].syncConfig.schedule` (`DataSyncConfig.schedule`, '
    + '`integration/connector.zod.ts`) — the one stack-collection member of the #16320 family',
  replacement:
    'delete the key — the D2 conversion `connector-sync-schedule-removed` lists that edit for '
    + 'every `connectors[]` entry that authored it (the `os migrate meta` mechanical edit list, '
    + 'from 17) and replays it over stored 17.x rows. What the conversion cannot write is the '
    + 'cadence the author meant: '
    + 'a sync on a cadence is a `job` (`Job.schedule.expression`, `system/job.zod.ts` — the one '
    + 'cron slot the platform evaluates) whose handler drives the connector, and that job is '
    + 'yours to declare. `realtimeSync` and every other `syncConfig` key are unchanged',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-06 on #15954 (director decision '
    + 'batch #56, option A — retire — per family), executed by #16320. `DataSyncConfig.schedule` '
    + 'was parsed into the cron envelope and read by NOTHING: `syncConfig` has no reader outside '
    + '`packages/spec`, no engine schedules a connector sync, and `@objectstack/formula`\'s '
    + 'cronEngine has zero consumers outside its own package (the ADR-0058 D7 ledger row '
    + '`cron-declared-unwired` recorded it `unevaluated`). This is the ONE of the seven retired '
    + 'positions a stack manifest reaches (`stack.connectors[]` → `Connector.syncConfig`), so it '
    + 'is the one with a D2 conversion — and the one whose D3 entry the ruling names as the '
    + 'carrier of the population reading. Why a D3 beside the D2: the strip is lossless for the '
    + 'SCHEMA, not for the author — the cadence a connector declared has no mechanical '
    + 'destination (a `job` is a different def, with a handler to write), so deleting the key '
    + 'is the tool\'s half and re-declaring the cadence where it was wanted is yours. Measured '
    + 'author population: ZERO in-repo authors — `examples/**`, `skills/**`, hand-written '
    + '`content/docs/**`, `apps/**` and every package outside `packages/spec` swept for '
    + '`syncConfig` beside `schedule`, with the declaring file lighting the control; objectui at '
    + 'the pinned sha `53ded82bf7a4` has none (its `syncConfig` hits are the react offline '
    + 'hook\'s own key). Out-of-repo stacks and stored `sys_metadata` rows are NOT MEASURED '
    + 'from this repo and are not claimed zero — that population is the residue this entry '
    + 'delegates to you.',
  acceptanceCriteria:
    'Verify YOUR population by hand, since this repo could not: `os migrate meta` (from 17) '
    + 'over your stack lists zero remaining `connector-sync-schedule-removed` edits, and a grep '
    + 'of your sources for `syncConfig` beside `schedule` finds nothing — then, for every '
    + 'connector that had declared a cadence, decide whether a `job` (`Job.schedule.expression`) '
    + 'driving it is wanted, and declare it if so. TypeScript authors get the refusal at compile '
    + 'time (the key is typed `never`); a value reaching the parse — through '
    + '`Connector.syncConfig`, `stack.connectors[]` or the `/meta/connector` door — is refused '
    + 'with the prescription (`invalid_type` at path `syncConfig.schedule`). ⚠️ Runtime '
    + 'behaviour is deliberately UNCHANGED and must be verified as such: nothing ever read the '
    + 'key, so no sync that ran before stops — none ran on a cadence before, and none does after.',
};
