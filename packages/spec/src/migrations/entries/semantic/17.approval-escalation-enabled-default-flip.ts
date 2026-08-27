// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'approval-escalation-enabled-default-flip',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
  surface:
    'automation.ApprovalEscalation.enabled — an OMITTED value inside an approval '
    + "node's escalation block",
  replacement:
    'nothing, for the common intent (escalate on timeout): an escalation block '
    + 'carrying timeoutHours is live by default. To declare an SLA OFF while keeping '
    + 'its configuration, write enabled: false explicitly — which is now the spelling '
    + 'the escalation sweep actually reads',
  reason:
    'A DECLARED-DEFAULT CORRECTION plus the enforcement that makes the key real '
    + "(#12278, maintainer ruling 2026-08-27) — the same category as protocol 17's "
    + '`import-run-automations-declared-default-corrected`: the schema promised '
    + '`enabled` defaults to `false` (SLA off) while the plugin-approvals sweep never '
    + 'read the key at all — any escalation block with a positive `timeoutHours` '
    + 'escalated, and with `action: \'auto_approve\'` that silently approved requests '
    + 'their author had declared off the clock. The flip moves the default to `true` '
    + 'and, in the same change, the sweep starts honouring an explicit '
    + '`enabled: false`. The feature-level switch is whether an `escalation` block '
    + 'exists at all; within a block carrying `timeoutHours`, escalation is on unless '
    + 'explicitly turned off. Deployed metadata that OMITS `enabled` does not change '
    + 'behaviour: it escalated before (the sweep ignored the key) and escalates after '
    + '(the parse materializes `true`). Stored request snapshots written before the '
    + 'flip carry a MATERIALIZED `enabled: false` (the approval-node executor parses '
    + 'config through the old schema before snapshotting), so the sweep keeps a '
    + 'read-side legacy window keyed on the snapshot\'s `created_at`: pre-flip '
    + 'snapshots keep escalating exactly as they do today, and the window retires '
    + 'itself as those pending requests drain. What DOES change is that an explicit '
    + '`enabled: false` finally binds — a flow that authored it (e.g. the console '
    + 'toggle switched off after a timeout was set) stops escalating on requests '
    + 'opened after the upgrade, which is the declared intent being honoured.',
  acceptanceCriteria:
    'A flow whose approval node omits `enabled` inside `escalation` still escalates '
    + 'on timeout (no metadata edit needed). A flow that writes `enabled: false` '
    + 'stops escalating for newly opened requests — verify one such request stays '
    + 'pending past its `timeoutHours` with no `escalate` audit row and no '
    + 'auto-decision. Requests opened BEFORE the upgrade keep their pre-upgrade '
    + 'behaviour (they escalate) regardless of the stored `enabled` bit. Clients '
    + 'that parse metadata through the published JSON Schema now materialize '
    + '`enabled: true` where they materialized `false`; a client that needs the SLA '
    + 'off must write it explicitly.',
};
