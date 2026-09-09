// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'schedule-state-cron-expression-retired',
  surface: 'flow schedule state cron: `ScheduleState.cronExpression` (`automation/execution.zod.ts`)',
  replacement:
    'nothing to re-declare — delete the key. A scheduled flow declares its cadence on the '
    + 'flow\'s start node (`config.schedule`), which `trigger-schedule/schedule-trigger.ts` '
    + '`normalizeSchedule` reads; `ScheduleState` never fed that path. The one cron slot the '
    + 'platform evaluates is `Job.schedule.expression` (`system/job.zod.ts`)',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-06 on #15954 (director decision '
    + 'batch #56, option A — retire — per family), executed by #16320. The schema\'s REQUIRED '
    + 'cron was parsed into the envelope and read by NOTHING: `ScheduleStateSchema` has no '
    + 'consumer outside `packages/spec`, and the schedule trigger that does run reads a flow '
    + 'start node\'s `config.schedule` — a different shape this key never reached (the ADR-0058 '
    + 'D7 ledger row `cron-declared-unwired` recorded it `unevaluated`). Because a '
    + '`retiredKey()` accepts only absence, the requiredness leaves with the key: `timezone`, '
    + '`status` and `nextRunAt` now describe a cadence the row no longer declares, and they '
    + 'stay because the ruling retires the cron position, not the def. Why D3 semantic and not '
    + 'a D2 conversion: runtime schedule state is not a stack collection member and no '
    + 'metadata type, so a conversion would be a transform with no seam that ever runs (the '
    + '`kernel/MetadataPluginConfig:additionalTypes` precedent). The prescription therefore '
    + 'carries no `os migrate meta` sentence.',
  acceptanceCriteria:
    'No `ScheduleState` literal carries `cronExpression`, and none is REQUIRED to: a state '
    + 'with `id`, `flowName` and `createdAt` alone parses. TypeScript authors get the refusal '
    + 'at compile time (the key is typed `never`); a value reaching the parse is refused with '
    + 'the prescription (`invalid_type` at path `cronExpression`). ⚠️ Runtime behaviour is '
    + 'deliberately UNCHANGED and must be verified as such: nothing ever read the key, so '
    + 'removing it removes no behaviour.',
};
