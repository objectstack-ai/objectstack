// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'export-axis-opt-in',
  surface:
    'security.permissionSet.objects[].allowExport (ABSENT — a permission set that never '
    + 'declared the key)',
  replacement:
    'an explicit `allowExport: true` on the object entry (or the `*` wildcard) of every '
    + 'permission set whose holders are meant to keep exporting',
  reason:
    'A secure-default FLIP, not a shape change — the same class as '
    + '`rest-requireauth-default-flip` (ADR-0056 D2, protocol 12) and '
    + '`action-descriptor-resume-authority-default-flip`, and it is registered for the same '
    + 'reason those are: the metadata is UNCHANGED and still parses, so no gate anywhere will '
    + 'tell an upgrader that what it MEANS has inverted. Before 17, `allowExport` unset '
    + 'inherited read; from 17 it denies. Reading a record and taking a bulk '
    + 'machine-readable copy of the whole table are different privileges — Salesforce '
    + '"Export Reports", Dynamics "Export to Excel", NetSuite "Export Lists" and SAP `S_GUI` '
    + '61 all separate them — and the axis now says so. This cannot be a mechanical '
    + 'conversion in either direction: writing `allowExport: true` wherever the key is absent '
    + 'would preserve today\'s behaviour while silently defeating the entire point of the '
    + 'flip, and writing `false` would revoke a capability the deployment may legitimately '
    + 'want. Whether a given set\'s holders SHOULD be able to take a bulk copy is exactly the '
    + 'segregation-of-duties judgement the axis exists to make explicit, and it belongs to '
    + 'the operator. Two details decide who is actually affected: package-shipped sets are '
    + 're-seeded on upgrade, so the built-ins are handled — `admin_full_access` and '
    + '`organization_admin` now carry the grant explicitly — while ENVIRONMENT-AUTHORED sets '
    + 'are not and must be edited by hand. `member_default` deliberately does NOT carry the '
    + 'grant, so ordinary authenticated users lose export until an admin grants it; that is '
    + 'the point of the flip, not an oversight. Merge semantics are unchanged and '
    + 'most-permissive, exactly like the CRUD bits: any set granting `true` grants export, '
    + 'and `false` is authoring intent rather than a veto, because permission sets are '
    + 'additive capability containers (ADR-0090). The super-user bits no longer confer it: '
    + '`viewAllRecords` / `modifyAllRecords` are "may see all data", not "may take a bulk '
    + 'copy". Registered by the #6350 stock reconciliation; #3544 / #3710 predate the #6148 '
    + 'completeness gate. ADR-0087, #3544 / #3710 (backfilled #6350).',
  acceptanceCriteria:
    'Every environment-authored permission set has been READ and decided, not just parsed: '
    + 'each object entry whose holders should keep exporting carries `allowExport: true`, and '
    + 'each one that should not is knowingly left without it. The verify loop is behavioural, '
    + 'because nothing fails at parse time — sign in as a holder of each affected set and '
    + 'confirm an export either succeeds or is refused as intended, including the report '
    + 'export path, which this change brought under the same axis. ⚠️ Silence is not success '
    + 'here: a deployment that upgrades without editing anything is VALID metadata whose '
    + 'ordinary users have quietly lost export, and the first sign will be a user report '
    + 'rather than an error. Check `member_default` explicitly — it is the set most likely to '
    + 'have been carrying export by inheritance.',
};
