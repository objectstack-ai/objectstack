---
"@objectstack/spec": patch
"@objectstack/objectql": patch
"@objectstack/rest": patch
"@objectstack/platform-objects": patch
---

feat(rest): `treatAsHistorical` import option — skip the state machine for historical-data migration (#3479)

Sibling of #3433 (seed exemption), one entry point over. #3165's `initialStates` enforced
the FSM entry point on every INSERT, so importing established historical facts —
a batch of already-`closed` tickets, `closed_won` deals, `completed` projects —
was rejected row-by-row with `invalid_initial_state`, blocking the core
data-migration path. Unlike the seed case it was visible (per-row errors), but it
still functionally blocked a legitimate use.

- **spec**: `ExecutionContext.skipStateMachine` — a general, server-set flag (the
  seed-specific `seedReplay`'s sibling) that skips the `state_machine` rule for a
  write; `ImportRequestSchema.treatAsHistorical` (default `false`) — the user-facing
  import option.
- **objectql**: the engine now skips the state machine for `seedReplay` OR
  `skipStateMachine` (one helper), covering both seed replay and historical import.
- **rest**: the import runner sets `skipStateMachine` on the write context iff the
  request opts into `treatAsHistorical`; default off, so a normal import still walks
  the FSM (the strict behavior is the default). Import **undo** now also carries
  `skipStateMachine`, since restoring a prior snapshot re-writes an earlier state
  that need not be a legal transition from where the row is now.
- **platform-objects**: `sys_import_job.treat_as_historical` audit column (additive).

Scope is identical to the seed exemption: ONLY the `state_machine` rule is skipped;
field shape, `format`, `cross_field`, `script` all still run. The objectui import
wizard checkbox is a separate follow-up.
