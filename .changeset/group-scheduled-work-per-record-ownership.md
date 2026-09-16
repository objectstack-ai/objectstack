---
"@objectstack/types": minor
"@objectstack/spec": minor
"@objectstack/trigger-schedule": minor
---

feat(spec,types,triggers)!: `group` runs package-authored scheduled work without a declaration, owning each run's writes per record (#18378)

<!-- adr-0087: not-required (already-registered schedule-flow-acting-organization-required) This amends the EXISTING semantic entry rather than adding one: same authorable key, same deployment switch, same surface, and the entry predates this diff at the merge base. Nothing is renamed, retired or re-typed — the start node's `config` is an open record (ADR-0018), so every flow that parses today parses byte-identically afterwards and `objectstack migrate meta` has nothing new to rewrite. What moves is the BIND-time accept set (it WIDENS) and the RUN-time organization such a flow's writes carry; the entry's own surface/replacement/reason/acceptanceCriteria each gained their `group` row in this diff. -->

`Clause-②: yes (widening)`

**ADR-0087 disposition — `not-required (already-registered)`, not `registered`.**
The ledger entry this change belongs to already exists
(`schedule-flow-acting-organization-required`, entry 18) and predates this diff
at the merge base, so `registered` would assert a registration this PR did not
make. The entry's `surface`, `replacement`, `reason` and `acceptanceCriteria`
each gained their `group` row here, the rejected bootstrap-organization arm
included — recorded because it is the one a later reader will re-propose.

**Marked breaking (`!`) for the behaviour change, not for a narrowing.** Nothing
that worked stops working and nothing that was admitted becomes refused — the
accept set WIDENS in one cell. What earns the banner is the other direction: on a
`group` deployment with the switch already on, flows that were refused at bind
now arm and run, so clock-driven work appears where an operator had none. That is
worth reading before upgrading even though no consumer has to change anything.

## What changes

With `OS_AUTOMATION_SCHEDULED_WORK_ENABLED` on and tenancy posture `group`, a
time-triggered flow that declares no `config.organization` now **binds and
runs**, where it was previously refused at bind. The organization its writes
carry follows the record:

| posture | declaration | a bound run's writes act as |
|---|---|---|
| `single` | not read | nothing — the install's one organization resolves beneath each write |
| `group` | **optional** | declared ⇒ the declaration; undeclared ⇒ **the swept record's own organization** |
| `isolated` | **required** | the declaration; undeclared ⇒ not armed, unchanged |

A `timeRelative` sweep under `group` reads group-wide — inherent to the posture
(ADR-0105 D1) — and stamps each run it launches with that record's organization:
sweep contracts across four plants and each plant's contract yields a run acting
as that plant, whose notifications reach that plant's inboxes.

## Why this is not a fallback that guesses

It is the order `sys_automation_run` was **already** ruled to use.
`ObjectStoreSuspendedRunStore` resolves a run's organization as
`organizationOf(<subject record>) ?? ctx.tenantId` — subject first, acting
context as the fallback and never the primary. Before this change those two
halves disagreed under `group`: the history row was stamped from the record while
the inbox and delivery rows followed an acting context that could not exist
there, so they were refused while the tick summarised itself as healthy.

⛔ A record-less run under `group` that declared nothing still resolves
**nothing** and is refused at its first tenant-scoped write (`walled-posture`,
ADR-0112), loudly and by name. The rejected alternative was a fallback to the
bootstrap organization (`slug='default'`): under a wall that organization is
minted admin-keyed by the enterprise organizations runtime and may not exist at
all, and where it does it is whichever organization the platform owner
registered under — plausibly one plant of many, not the group's head office.

## Upgrading

**Most deployments: nothing to do.** The switch this depends on is OFF by default
and ships unreleased alongside this change, so the `group`-is-walled behaviour
being amended has never appeared in a published version — no released consumer
can be relying on it.

If you run posture `group` **and** turn the switch on, read your boot log: each
time-triggered flow's bind line now names which of the three shapes it bound as
("as organization '…'", "with per-record acting organization", or "with NO
acting organization"). Two things to check:

- A flow you expected to act as ONE organization but which binds per-record is
  missing its `config.organization`. Add it — declaring still narrows, bounding
  the sweep's query as well as its identity.
- A plain `schedule` cron flow that binds "with NO acting organization" has no
  record to derive one from. If it writes notifications, inbox messages or any
  other per-organization row, declare `organization` on its start node; the bind
  line says so, and so does the refusal at the first tick.

**API:** `ScheduledWorkPolicy` gains `runOwnership: 'unscoped' | 'per-record' |
'declared'`, and `requiresActingOrganization` narrows from "any walled posture"
to `isolated` only. The two are deliberately separate axes: the boolean decides
whether BIND refuses, `runOwnership` decides what a run that DID bind carries.
`@objectstack/trigger-schedule` exports `describeScheduleRunOwnership` so both
triggers describe one deployment identically.
