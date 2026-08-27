---
"@objectstack/spec": minor
"@objectstack/plugin-approvals": minor
---

feat(spec,plugin-approvals): `escalation.enabled` defaults to `true` and the SLA sweep finally reads it (#12278)

**BREAKING** semantic default flip on a published authorable key, shipped as
`minor` under the repo's launch-window convention for breaking changes.
Maintainer ruling 2026-08-27 (Option C), explicitly reversing the 2026-08-26
"spec stays as declared" ruling with fresh analysis.

`ApprovalEscalationSchema.enabled` declared `default(false)` while the
plugin-approvals escalation sweep never read the key: any escalation block
with a positive `timeoutHours` escalated, and with `action: 'auto_approve'`
that silently approved requests their author had declared off the clock —
the ADR-0049 declared-but-unenforced shape, failing open. Worse, the
approval-node executor parses node config through the schema before
snapshotting it onto the request row, so the old default **materialized**
`enabled: false` into storage for every author who omitted the key, making
"authored off" and "defaulted off" byte-identical at the sweep site.

One change, both halves:

- **spec**: `enabled` now defaults to `true` (stays `z.boolean()`; no
  tri-state). The feature-level switch is whether an `escalation` block
  exists at all; within a block carrying `timeoutHours`, escalation is on
  unless explicitly turned off — which is what the runtime, its eleven
  behaviour tests, and every teaching surface have always meant. Declared in
  `DEFAULT_CHANGES_BY_MAJOR` (17) and registered as the
  `approval-escalation-enabled-default-flip` semantic migration entry.
- **runtime**: `runEscalations` skips a request whose snapshot carries an
  explicit `escalation.enabled === false` — the declared switch is enforced.
  Request snapshots created **before** the flip cutoff
  (`ESCALATION_ENABLED_FLIP_CUTOFF_MS`, 2026-08-28T00:00:00Z) ride a
  read-side legacy window and keep escalating exactly as they do today: their
  stored `false` is overwhelmingly the old schema default materialized onto an
  author who never wrote the key, every such stored row is escalating today,
  and the window retires itself as pending requests drain — zero tenant rows
  rewritten.

Deployed metadata that omits `enabled` does not change behaviour (it
escalated before, it escalates after). What changes is that writing
`enabled: false` finally binds for newly opened requests — the declared
intent being honoured. To keep an SLA off, write `enabled: false`; to
escalate on timeout, an `escalation` block with `timeoutHours` is enough.

<!-- adr-0087: registered approval-escalation-enabled-default-flip -->
