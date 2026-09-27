// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A row-level policy's `check` is refused where it can never run: on a policy
// whose `operation` is `select` or `delete`. Recorded as a semantic TODO, not a
// D2 conversion, because which rewrite is right depends on what the author meant
// the predicate to guard, and a rewrite made on their behalf would change which
// rows the policy admits.
export const entry: SemanticMigration = {
  id: 'rls-check-on-select-or-delete-policy-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'security.PermissionSet rowLevelSecurity[].check (RowLevelSecurityPolicySchema) on a policy whose '
    + 'operation is select or delete. A blank check (empty or whitespace only) declares nothing and is '
    + 'not refused',
  replacement:
    'what the predicate was meant to guard, written where it runs. To limit which rows a select policy '
    + 'lets a caller read, or which rows a delete policy lets a caller delete, write the predicate as '
    + '`using` on that policy (remove `check`; if the policy already has a `using`, AND the two with &&). '
    + 'To validate rows as they are written, declare the `check` on a policy whose `operation` is '
    + '`insert`, `update` or `all` instead. The refusal lands at rowLevelSecurity[N].check, names the '
    + 'operation, and states both rewrites',
  reason:
    'ADR-0049 enforce-or-remove and ADR-0058 D4. A `check` judges the post-image of a write: the new '
    + 'row of an insert, the changed row of an update. A select or delete writes no row, and the '
    + 'plugin-security write gate collects only the policies whose operation is the write\'s own or '
    + '`all`, so a `check` on a select or delete policy was accepted, stored and never evaluated. '
    + 'Measured on main before this change: a policy carrying only check record.status != '
    + '\'archived\' on select or delete admitted every insert and update of an archived row, and beside '
    + 'a USING-only `all` sibling it did not replace that sibling\'s `using` default the way a `check` '
    + 'on an insert, update or all policy does. An author (an AI author above all) who wrote a check '
    + 'on a delete policy believed deletes were guarded by it. The refusal is a non-transforming '
    + 'refinement on the policy schema, so it reaches every door that parses a permission set: '
    + 'defineStack, os validate, and the metadata save path, whose permission type validates '
    + 'against PermissionSetSchema. Metadata AT REST is not '
    + 'rewritten and this entry adds no D2 conversion: dropping the key would silently discard the '
    + 'predicate the author wrote, and moving it to `using` would start filtering reads or deletes '
    + 'the policy never filtered before — both change which rows the policy admits, which is the '
    + 'policy author\'s decision. Ships at once, no transition window and no advisory lint phase.',
  acceptanceCriteria:
    'Search every authored and stored permission set for a rowLevelSecurity policy whose operation '
    + 'is select or delete and whose check is non-blank — metadata files, sys_metadata permission '
    + 'rows, and the row_level_security column of sys_permission_set. For authored metadata the sweep '
    + 'is mechanical: PermissionSetSchema.safeParse answers one custom issue at '
    + 'rowLevelSecurity[N].check whose message begins "`check` is never evaluated on a `select` '
    + 'policy" (or `delete`). For each, decide what the predicate was meant to guard: reads or '
    + 'deletes ⇒ express it in that policy\'s `using`; writes ⇒ move it to an insert, update or all '
    + 'policy. Then re-check the policy set\'s behaviour rather than assuming it is unchanged: the '
    + 'removed check never ran, so dropping it changes nothing, but a predicate moved into `using` '
    + 'now filters rows it never filtered, and a `check` moved onto an insert, update or all policy '
    + 'now replaces the `using` default of its USING-only siblings for that write. A policy with '
    + '`using` only, and a `check` on an insert, update or all policy, parse exactly as before. The '
    + 'repo, its example apps and the pinned console carried no such policy at the time of the '
    + 'change; two test fixtures that used select incidentally were moved to all and insert.',
};
