---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

feat(spec,service-automation): a run says when its `acted` count is incomplete, instead of guessing (#4354)

#4354 shipped `selected` / `acted` counts on every flow run, sourced from the
executors that know what they did. Four node types were left out — and the gap
was not cosmetic: `connector_action`, `http` and `script` are how a flow acts on
anything *outside* the platform, so a sweep whose whole job runs through them
reported `acted: 0` and looked exactly like the dead sweep the counter exists to
find. A detector that fires on healthy runs is worse than no detector: operators
tune it out, and then it is not watching the flows that really did stop.

Closing it needed a third answer, because for two of those nodes the platform
genuinely cannot know:

**`connector_action` — unknowable, and now it says so.**
`ConnectorActionDescriptor` declares `key` / `label` / `description` /
`inputSchema` / `outputSchema` and *nothing* about whether the action reads or
writes, so `crm.push_opportunity` and `crm.lookup_account` are the same shape to
the runtime. `acted: 0` understates the create; `acted: 1` overstates the
lookup and makes the alert never fire — #4354's original bug, one layer out.
The executor reports `metrics: { unmeasuredEffect: true }` instead, and the run
carries an `unmeasured` tally. Filed #4395 to let a connector declare its effect
kind, which would turn this into a real count.

**`http` — knowable, and now counted.** The method says it:
`GET`/`HEAD`/`OPTIONS` report a real `acted: 0` (a read cannot write); a mutating
call the upstream accepted reports `acted: 1`; `durable: true` reports `acted: 1`
because the outbox row is a durable effect this run caused. A mutating call that
was *rejected or timed out* reports `unmeasured` — a 500 can arrive after the
write landed, and claiming zero there would let a run swear it changed nothing
when it had.

**`script` — deliberately unchanged.** A registered function is contractually
pure ("Data I/O stays on the flow graph — the function itself does no writes"),
so every write it causes is a downstream node counting itself and "reports no
record metrics" is accurate rather than a guess. Nothing *enforces* that purity,
so a function that writes behind the platform's back under-reports its run —
filed as #4396 rather than papered over here, because a blanket
`unmeasuredEffect` on `script` would suppress the signal on every flow that
calls any function in order to accommodate one contract violation.

**The alert gains a clause.** `selected > 0 AND acted = 0` becomes
`selected > 0 AND acted = 0 AND unmeasured = 0`, and `sys_automation_run` gains
an `unmeasured_count` column to serve it. Without that third clause the alert
fires on every healthy connector-driven flow. The log line gains
`unmeasured=N` — only when non-zero, since its *presence* is what a reader must
not miss: `acted=0` on a line that also says `unmeasured=3` means "cannot tell",
not "did nothing".

`unmeasured` propagates through `subflow` and `map` roll-ups (and through
`creditChildRun` for a child that paused), so a parent whose child dispatched an
uncountable effect knows its own `acted` is incomplete. N uncountable effects in
a child collapse to one flag on the parent's step — the child keeps the real
count in its own run row, and the question this feeds is boolean.

`FlowRunSummary.unmeasured` is optional and `undefined` is **not** `0`: a run
recorded before this existed did not track uncountable effects at all, and
defaulting it to zero would tell an operator "fully measured" about a run nobody
measured. Same rule the `null` count columns already follow.

Additive: new optional fields only, no new exports, no execution behaviour
changes.

Verified: `@objectstack/service-automation` **546 tests / 47 files** (21 new),
`@objectstack/spec` **7193 / 281** (2 new); all 8 `check:generated` gates plus
the seven pure audits (liveness, empty-state, variant-docs, strictness-ledger,
react-conformance, skill-examples, exported-any); `check:nul-bytes` and eslint
clean.
