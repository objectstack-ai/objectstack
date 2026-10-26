---
'@objectstack/spec': minor
---

feat(spec)!: an SLA escalation's `escalateTo` naming a `team:`, `department:`, `org_membership_level:` or `role:` address is refused at registration

Clause-②: no (narrowing) — `ApprovalEscalationSchema.escalateTo` refuses values it used to accept. Nothing is widened.

Metadata-protocol: narrowed (an approval node's `escalation.escalateTo` written as a `team:`, `department:`, `org_membership_level:` or `role:` address is refused)

<!-- adr-0087: registered approval-escalation-dead-target-refused -->

`escalateTo` was a bare string. The approvals service resolves it as a position machine name and falls back to the value as written, and a person acts on a pending slot only under their user id, their email or `position:<name>` for a position they hold. So a `team:`, `department:` or `org_membership_level:` literal, or the `role:` spelling ADR-0090 D3 retired, names nobody under any escalation action: a `reassign` on timeout would hand the request to no one (the runtime now keeps the slate and notifies it instead), and a `notify` reaches no one through it. The schema accepted it and every build door exited 0.

`ApprovalEscalationSchema` now refuses those four prefixes at `escalateTo`, under every action and with surrounding whitespace trimmed as the runtime trims it. The refusal names the value and the shapes that are accepted. It reaches every door that judges an approval node's config: `FlowSchema.parse` (`defineStack`, `defineFlow`, `objectstack validate` / `compile`, the metadata save door) and `AutomationEngine.registerFlow`. A user id, an email, a position machine name and `position:<name>` stay accepted; whether they resolve is directory state, judged by the runtime on timeout. The D3 entry `approval-escalation-dead-target-refused` carries the judgment for `os migrate meta`; there is no D2 conversion, because only the author knows which position or person was meant.

**BREAKING** for an author whose approval node escalates to a team, department, membership tier or `role:` address.

- **Before.** `escalation: { timeoutHours: 24, action: 'reassign', escalateTo: 'team:night_shift' }` parsed, and on timeout the request was handed to no one.
- **Now.** The flow is refused at `nodes.N.config.escalation.escalateTo`, with a message naming the value and what to write instead.
- **Fix.** Name a target someone acts under: `escalateTo: 'night_shift_lead'` (a position its people hold), `'position:night_shift_lead'`, or a person's user id or email. Write `role:<name>` as `position:<name>`.
