// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'stored-reference-package-bind-reviewed',
  surface:
    'a stored row that names a flow, permission set, sharing rule, queue, assignment rule, connector or email '
    + 'template by its bare name, whose package column the upgrade backfill (ADR-0150 D8) left null because the '
    + 'one resolution rule refuses the name: `sys_user_permission_set.permission_set_package`, '
    + '`sys_audience_binding_suggestion.permission_set_package`, a managed `sys_sharing_rule.package_id`, '
    + '`sys_queue_member.queue_package`, `sys_approval_request.process_package`, `sys_automation_run.flow_package`, '
    + '`sys_flow_credential.flow_package`, `sys_connector_connection.connector_package`, '
    + '`sys_assignment_cursor.rule_package` and a legacy `sys_email_template.package_id`; a bare '
    + '`sys_flow_dispatch` key; and a packaged picklist field whose list the rule refuses',
  replacement:
    'Run `os migrate stored-references` after upgrading (read-only; `--json` for a script). It lists each such row '
    + 'with its id and every candidate holder by qualified address. For a row refused as ambiguous, choose the '
    + 'package after review and run `os migrate stored-references bind --table TABLE --id ID --package PACKAGE_ID '
    + '--yes`, one row per run. A suggestion a package wrote naming an environment-authored permission set, or one '
    + 'held only outside the package\'s declared dependencies, is never bound: declare the dependency, or let the '
    + 'suggestion lapse. A bare dispatch key expires with the ledger\'s retention. A picklist field the rule refuses '
    + 'is fixed in the package source (declare the dependency, or the list). Nothing in a package source changes '
    + 'otherwise.',
  reason:
    'ADR-0150 D8 adds a package column beside every stored bare-name reference, and its boot backfill binds a row '
    + 'only when the one D3 rule names exactly one holder. Where two packages hold the name, it never picks: the '
    + 'row stays null and resolves environment-wide as before, and until now the only trace was one boot log line '
    + 'per name, with no row id and no way to bind it. D10 gives the operator the report and a reviewed bind that '
    + 'asks the same rule again at write time, so a stale choice writes nothing, and leaves a `sys_audit_log` row.',
  acceptanceCriteria:
    '`os migrate stored-references --json` lists every row whose package column is null and whose name the rule '
    + 'refuses, with every candidate, and prints the same bytes on a second run. After '
    + '`os migrate stored-references bind` the chosen row carries the chosen package, one `sys_audit_log` row '
    + 'records the change, the report no longer lists it, and a second bind of that row writes nothing '
    + '(`already-bound`). A bind whose package is not a candidate the rule names now, or whose name now resolves '
    + 'to one holder, is refused and writes nothing.',
};
