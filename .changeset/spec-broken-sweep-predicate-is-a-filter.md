---
"@objectstack/spec": patch
---

docs(spec): qualify the broken-sweep predicate in `FlowRunSummary` / `ConnectorActionEffect` TSDoc (#12722)

Text only — no behaviour, no schema, no accept-set change. These doc blocks ship
in `.d.ts`, so a consumer reading the type got the sentence #12685 measurably
disproved.

`selected > 0 AND acted = 0 AND unmeasured = 0` was stated as *the* broken-sweep
signal / query / alert across three doc blocks in two files. It is the FIRST
FILTER, not a verdict: a healthy idempotent sweep — re-select the same records,
gate each one on "already handled" — satisfies it on every run while that work
stands, so "over N consecutive runs" does not separate it from a dead gate
either (consecutiveness filters flapping, which is a different failure). What
discriminates is the per-node fold: a healthy skip is accounted for by a read
the run performed (`runs > 0` and `selected > 0` in `nodes[]`), while a dead
gate skips just as often with nothing behind it (`runs: 0`, or `selected: 0`).

The wording mirrors what #12721 landed on `sys_automation_run`'s field
descriptions and `content/docs/automation/flows.mdx`, so the schema doc and the
object description now say the same thing — the point of the card, since the
schema doc is what a platform author actually reads. A corrected sentence in one
surface and a wrong one in the other is the state most likely to produce the
failure #12685 names: an operator wires an alert to the documented predicate, it
fires during normal operation, and it gets muted — leaving a dead sweep
unmonitored while looking monitored.

The `unmeasured` clause's own point is unchanged, and now explicit: a run with
uncountable effects has an INCOMPLETE `acted` count, not a zero one.
