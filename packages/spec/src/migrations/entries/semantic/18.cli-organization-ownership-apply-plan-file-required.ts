// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cli-organization-ownership-apply-plan-file-required',
  // No backticks in `surface`: build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    'os migrate organization-ownership --apply, invoked without --plan-file (the bare --apply --backup-taken that '
    + '@objectstack/cli 18.0.0-next.1 shipped, with or without --fate-supplement)',
  replacement:
    'nothing in 18.0: 18.0 refuses this invocation, as it refuses every plan and apply of '
    + '`os migrate organization-ownership` on every database (exit 1, `NOT_IMPLEMENTED`, nothing read or written). '
    + '18.0 supports fresh installs only and does not upgrade a v17 database: keep a v17 database on a 17.x release '
    + 'until the 18.x release that carries the upgrade path. A script or runbook that applies directly does not run '
    + 'against 18.0 at all. In that 18.x release, run the plan first, `os migrate organization-ownership --out plan.json` '
    + '(with the same `--fate-supplement`, under the same tenancy posture, against the same database), review the file '
    + 'it writes, then `os migrate organization-ownership --apply --backup-taken --plan-file plan.json`: the script or '
    + 'runbook gains the plan step and the flag; nothing in a package source or a stored row changes.',
  reason:
    'ADR-0131 D10 makes the ceremony an operator\'s act on a plan the operator reviewed. The apply computes its '
    + 'own plan at apply time, and that plan\'s inputs can move between the review and the run: a different host '
    + 'fate supplement, another release\'s inventory, another tenancy posture or another database. Planning with '
    + 'one supplement and applying with another ran the second one\'s fates unreviewed, including a mirror deletion '
    + 'the reviewed plan never listed. So the 18.x apply reads the plan file the operator reviewed and refuses, before '
    + 'anything is written, when its inventory digest, posture or database differs from the run\'s. Without the '
    + 'file there is nothing to compare, so the bare invocation is refused. 18.0 itself withholds the whole '
    + 'ceremony: it is knowingly incomplete in 18.0, and an incomplete ceremony must never certify a v17 database '
    + 'that the boot would then serve, so 18.0 refuses plan and apply alike before it reads anything.',
  acceptanceCriteria:
    'On 18.0, no script or runbook runs `os migrate organization-ownership`, and every v17 database stays on a 17.x '
    + 'release. In the 18.x release that carries the upgrade path, every invocation of '
    + '`os migrate organization-ownership --apply` passes `--plan-file` with the file a plan run wrote, and the run '
    + 'reports `reviewedPlan`. A run that answers `plan-file-required`, `plan-digest-mismatch`, '
    + '`plan-posture-mismatch` or `plan-database-mismatch` has written nothing: plan again, review, and pass the new '
    + 'file.',
};
