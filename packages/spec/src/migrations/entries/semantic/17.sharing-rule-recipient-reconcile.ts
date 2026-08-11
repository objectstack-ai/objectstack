// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'sharing-rule-recipient-reconcile',
  surface:
    'security.sharingRule.sharedWith.type `group` / `guest`, and owner-type rules '
    + '(`type: owner` + `ownedBy`)',
  replacement:
    '`group` → `team` (the enforced runtime vocabulary); `guest` → delete the rule and expose '
    + 'the records through a public form or a share link; `type: owner` → rewrite as a '
    + '`type: criteria` rule. `business_unit` is newly authorable for the single-unit case',
  reason:
    'The authoring `ShareRecipientType` enum had drifted behind both the ADR-0090 D3 rename '
    + 'and the enforced runtime, in both directions at once. It still offered the pre-rename '
    + '`group`, which the seed path silently SKIPPED, while omitting two recipients the '
    + 'runtime and bootstrap already enforced (`team` via `sys_team` / `sys_team_member`, and '
    + '`business_unit`). It also offered `guest`, which had no runtime recipient mapping at '
    + 'all. Each of those is a rule that validated and then materialised nothing — the '
    + 'ADR-0078 shape, and on a SECURITY surface, where the failure is silent under-sharing: '
    + 'the author sees a valid rule and believes a set of people can reach the records, and '
    + 'no error ever contradicts them. Owner-type rules go for a different and sharper '
    + 'reason: they depend on live team / position membership, which the static materialiser '
    + 'cannot track, so they could not be made to work by fixing a name. They return as an '
    + 'enforced form only if membership-reactive re-materialisation is designed. This is a '
    + 'semantic entry rather than a mechanical conversion because only one of the three '
    + 'rewrites is a rename: `group` → `team` is mechanical, but `guest` and `type: owner` '
    + 'have no target — the author has to decide who was actually meant to reach those '
    + 'records and say so in a form the runtime enforces, and a transform that guessed would '
    + 'be inventing an access grant. After this change every authorable recipient and rule '
    + 'type on the SharingRule surface is enforced; the `queue` recipient stays '
    + 'runtime-reserved and deliberately non-authorable (there is no `sys_queue` yet). Note '
    + 'the two neighbouring conversions cover DIFFERENT faces of this schema and not this '
    + 'one: `sharing-recipient-role-to-position` is the ADR-0090 role → position rename and '
    + '`sharing-rule-access-level-full-to-edit` is the access-level vocabulary. Registered by '
    + 'the #6350 stock reconciliation. ADR-0078 / ADR-0090 D3 / ADR-0087, #1878 (backfilled '
    + '#6350).',
  acceptanceCriteria:
    'No sharing rule names `group` or `guest`, and none carries `type: owner`; stale '
    + 'definitions now FAIL parse with the valid options listed, so the sweep is "fix until '
    + 'nothing raises". ⚠️ Parsing clean is the weaker half — verify the SHARES, because a '
    + 'rule that was silently materialising nothing looked exactly like one that worked. For '
    + 'every rule that named `group`, confirm the `sys_team` it now resolves to has the '
    + 'membership you expected, and that records reach the people the rule was written for. '
    + 'Each former `guest` rule needs an explicit decision about anonymous access — a public '
    + 'form grant or a share link, or knowingly no access at all — and each former owner-type '
    + 'rule needs a `criteria` predicate that names the same population, checked against a '
    + 'representative record. Where a single business unit was meant, use `business_unit`; '
    + '`unit_and_subordinates` is the subtree and grants strictly more.',
};
