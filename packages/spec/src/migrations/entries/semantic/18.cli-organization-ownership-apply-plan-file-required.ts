// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cli-organization-ownership-apply-plan-file-required',
  surface:
    'os migrate organization-ownership --apply, invoked without --plan-file (the bare --apply --backup-taken that '
    + '@objectstack/cli 18.0.0-next.1 shipped, with or without --fate-supplement)',
  replacement:
    'Run the plan first, `os migrate organization-ownership --out plan.json` (with the same `--fate-supplement`, '
    + 'under the same tenancy posture, against the same database), review the file it writes, then '
    + '`os migrate organization-ownership --apply --backup-taken --plan-file plan.json`. A script or runbook that '
    + 'applies directly gains the plan step and the flag; nothing in a package source or a stored row changes.',
  reason:
    'ADR-0131 D10 makes the ceremony an operator\'s act on a plan the operator reviewed. The apply computes its '
    + 'own plan at apply time, and that plan\'s inputs can move between the review and the run: a different host '
    + 'fate supplement, another release\'s inventory, another tenancy posture or another database. Planning with '
    + 'one supplement and applying with another ran the second one\'s fates unreviewed, including a mirror deletion '
    + 'the reviewed plan never listed. So the apply now reads the plan file the operator reviewed and refuses, before '
    + 'anything is written, when its inventory digest, posture or database differs from the run\'s. Without the '
    + 'file there is nothing to compare, so the bare invocation is refused.',
  acceptanceCriteria:
    'Every invocation of `os migrate organization-ownership --apply` passes `--plan-file` with the file a plan run '
    + 'wrote, and the run reports `reviewedPlan`. A run that answers `plan-file-required`, `plan-digest-mismatch`, '
    + '`plan-posture-mismatch` or `plan-database-mismatch` has written nothing: plan again, review, and pass the new '
    + 'file.',
};
