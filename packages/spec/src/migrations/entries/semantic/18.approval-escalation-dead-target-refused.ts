// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for `ApprovalEscalationSchema.escalateTo` refusing, by shape, a
// target no approver acts under. It narrows a value accept set; no key is
// removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. There is
// no D2 conversion either: which position or person a team, department or
// membership tier was meant to stand for is the author's judgment.
export const entry: SemanticMigration = {
  id: 'approval-escalation-dead-target-refused',
  surface:
    'an approval flow node escalation.escalateTo written as a team:, department:, '
    + 'org_membership_level: or role: address (ApprovalEscalationSchema). Reachable wherever a flow '
    + 'is authored or stored: defineStack({ flows }) sources, defineFlow(), an exported stack passed '
    + 'to objectstack validate or objectstack compile, a flow saved from the Studio flow designer, and '
    + 'a flow row already sitting in sys_metadata',
  replacement:
    'a target someone can act under: the user id or email of a person, a position machine name, or '
    + '`position:<name>`. For a team, department or membership tier, name a position its people hold '
    + '(or create one and assign them). `role:<name>` is the retired spelling of a position address, '
    + 'so write `position:<name>` or the bare position name',
  reason:
    'The approvals service resolves `escalateTo` as a position machine name and falls back to the '
    + 'value as written. A person acts on a pending slot only under their user id, their email or '
    + '`position:<p>` for a position they hold, so a `team:`, `department:` or '
    + '`org_membership_level:` literal, or the `role:` spelling ADR-0090 D3 retired, names nobody '
    + 'under any action. A `reassign` escalation used to move the request onto that literal, a slate '
    + 'only the privileged override could decide; the runtime now keeps the slate and notifies it '
    + 'instead, and a `notify` escalation reaches no one through it. The schema accepted the value '
    + 'and every build door exited 0, so the SLA the author declared never did what they meant. '
    + 'The shape alone settles it, so the contract refuses it at registration (`FlowSchema.parse`, '
    + 'the build doors and `AutomationEngine.registerFlow` share that judge); whether a user id names '
    + 'an account or a position has a holder is directory state, judged by the runtime on timeout. '
    + 'No D2 conversion: the platform cannot know which position or person the author meant. Where '
    + 'such a node already sits, the whole flow is refused like any approval node its contract '
    + 'refuses. Ships at once, no grace window. ADR-0087, ADR-0090.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files, and boot every deployed '
    + 'stack. A refused target is reported at `nodes.N.config.escalation.escalateTo`; replace it per '
    + 'the replacement. Two proofs. (1) For a stack authored in config files, `objectstack validate` '
    + 'is clean. (2) Boot the stack and confirm each flow REGISTERS: no `failed to register flow` '
    + 'warn for it, the locator for a row that exists only in `sys_metadata`. An escalation whose '
    + 'target is a user id, an email, a position name or `position:<name>` parses and registers '
    + 'byte-identically to before.',
};
