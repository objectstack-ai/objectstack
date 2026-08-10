// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sharing-execution-context-retired',
  surface:
    '@objectstack/spec: the exported type `SharingExecutionContext` '
    + '(`contracts/sharing-service`), and its re-export from '
    + '@objectstack/plugin-sharing — the six-field context shape '
    + '(`userId` / `tenantId` / `positions` / `permissions` / `systemPermissions` / '
    + '`isSystem`) that sharing, approval and report enforcement signatures used to name',
  replacement:
    '`ExecutionContext` from `@objectstack/spec` — the complete '
    + '`resolveAuthzContext` envelope the contracts have declared since #6523. Every one '
    + 'of the retired type\'s six fields exists on it under the same name and type, so a '
    + 'value that satisfied the old type already satisfies the envelope: only the '
    + 'annotation is rewritten, never the value',
  reason:
    'ADR-0049 enforce-or-remove, completing the #6206 ruling (2026-08-07: enforcement '
    + 'adjudicates on the WHOLE envelope, never a per-site subset). This type was the '
    + 'declared context parameter of 36 signatures across three contracts — '
    + '`ISharingService` / `ISharingRuleService`, `IApprovalService`, `IReportService` — '
    + 'and it omitted four fields those gates need: `accessible_org_ids` (under the '
    + '`group` tenancy posture this IS the Layer 0 wall, ADR-0105 D2), `org_user_ids`, '
    + '`posture` (ADR-0095 D2) and `tabPermissions`. Its damage ran in the MIRROR '
    + 'direction of the share-link twin (#6430 / PR #6511): nothing trimmed the VALUES — '
    + "the engine middleware always handed the whole context down — it was the declared "
    + 'TYPE that was narrow, so an implementation could not READ what it had been given '
    + 'without casting out of its own contract (`const posture = (context as any).posture` '
    + "in plugin-approvals' privileged-override gate). #6523 / PR #7068 converged the "
    + 'contracts, PR #7140 and PR #7206 re-annotated the four implementations, and this '
    + 'card removes the now-unreferenced declaration (#7070, #7218). '
    + 'Why this needs a ledger entry despite nothing in-repo referencing it: it is the '
    + '`export-field-meta-constraints-retired` / `hook-context-session-roles-retired` '
    + 'disposition — a PUBLISHED TypeScript surface with no spec schema, so there is no '
    + '`retiredKey()` tombstone and no parse rejection that could carry the prescription, '
    + 'and the ledger is the only channel that reaches an upgrader. '
    + 'Why D3 semantic and not a D2 conversion: nothing authored or stored changes shape. '
    + 'The name is only ever spelled inside a consumer\'s own TypeScript, so no '
    + '`objectstack migrate meta` transform can reach it, and no `sys_metadata` row '
    + 'carries it. ADR-0049 / ADR-0087, #7218.',
  acceptanceCriteria:
    'No source of yours imports `SharingExecutionContext` from `@objectstack/spec` or '
    + '`@objectstack/plugin-sharing`; each such import becomes `ExecutionContext` from '
    + '`@objectstack/spec` and the build is green. tsc IS a sufficient detector here, '
    + 'unlike the optional-key retirements at this step: the name is gone outright, so '
    + 'every remaining reference is a hard resolution error rather than a silent '
    + '`undefined`. ⚠️ Then check the direction tsc CANNOT see: widening an annotation '
    + 'never rejects a value, so an enforcement path that only ever received a hand-built '
    + 'six-field object still compiles and still under-adjudicates. Confirm each caller '
    + 'passes the context it was HANDED, unchanged, rather than a literal it assembled — '
    + 'and that any gate of yours reading `posture`, `accessible_org_ids`, `org_user_ids` '
    + 'or `tabPermissions` now reads them declared, with no `as any` in the path.',
};
