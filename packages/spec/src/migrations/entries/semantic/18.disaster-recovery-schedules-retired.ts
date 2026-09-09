// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'disaster-recovery-schedules-retired',
  surface:
    'backup / DR-testing cron positions: `BackupConfig.schedule` / '
    + '`DisasterRecoveryPlan.testing.schedule` (`system/disaster-recovery.zod.ts`)',
  replacement:
    'nothing to re-declare — delete the keys. No backup engine and no DR-test runner exist on '
    + 'the platform, so there is no live mechanism to declare a backup or test cadence to. The '
    + 'one cron slot the platform evaluates is `Job.schedule.expression` (`system/job.zod.ts`): '
    + 'a backup or DR test on a cadence is a job whose handler you write',
  reason:
    'ADR-0049 enforce-or-remove; maintainer ruling 2026-09-06 on #15954 (director decision '
    + 'batch #56, option A — retire — per family), executed by #16320. Both positions were '
    + 'parsed into the cron envelope and read by NOTHING: neither `BackupConfigSchema` nor '
    + '`DisasterRecoveryPlanSchema` has a consumer outside `packages/spec` (the ADR-0058 D7 '
    + 'ledger row `cron-declared-unwired` recorded both `unevaluated`), so an operator who '
    + 'wrote `schedule: \'0 2 * * *\'` held a nightly backup the platform never took. Why D3 '
    + 'semantic and not a D2 conversion: a disaster-recovery plan is operator configuration, '
    + 'never a stack collection member or a `sys_metadata` row, so a conversion would be a '
    + 'transform with no seam that ever runs (the `kernel/MetadataPluginConfig:additionalTypes` '
    + 'precedent). The prescriptions therefore carry no `os migrate meta` sentence.',
  acceptanceCriteria:
    'No `BackupConfig` literal — standalone or as `DisasterRecoveryPlan.backup` — carries '
    + '`schedule`, and no `DisasterRecoveryPlan.testing` block does. TypeScript authors get the '
    + 'refusal at compile time (each key is typed `never`); a value reaching the parse is '
    + 'refused with the prescription (`invalid_type` at path `schedule` / `testing.schedule`). '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED and must be verified as such: nothing '
    + 'ever read the keys, so removing them removes no behaviour.',
};
