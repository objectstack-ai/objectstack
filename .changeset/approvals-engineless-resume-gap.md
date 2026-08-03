---
"@objectstack/plugin-approvals": patch
---

fix(approvals): an approval decision can no longer strand a flow run silently when no automation engine is attached (#4420)

#4420's fix closed every path by which a decision could be recorded while its
flow stayed parked — except one, and it is the one where none of the new guards
could run. Every guard it added (`assertRunResumable`'s pre-flight, the
`RESUME_TARGET_LOST` refusal, the `RESUME_FAILED` throw) hangs off the
automation engine. In a process where **no engine is attached**, all of them
were skipped by the same `typeof this.automation?.resume === 'function'`
condition that wrapped the resume itself — so the decision was written, the
mirrored status field advanced, and the call answered HTTP 200 with
`resumed: false` and **nothing logged at all**. That is #4420's reported
symptom exactly, reproduced in the one composition its fix could not see.

The composition is reachable the same way the original bug was: a flow parks at
an `approval` node in a process that has the automation service, and the
decision arrives in one that does not (the plugin failed to init, or the host
was recomposed between releases). The request row still carries a
`flow_run_id` — which is the row's own declaration that a run is parked on this
decision.

**What changes.** The decision still stands. Rolling it back is not on the
table (a human really decided, and the row is durable by then), and refusing
every such call would break the standalone approvals compositions the
pre-flight deliberately protects — so `finalized` and `resumed` are unchanged
for every existing caller. What changes is that the gap is no longer silent:

- it is logged at **`error`**, per the durability rule in `AGENTS.md` —
  persisted state and runtime state disagree while nothing looks broken from
  the outside, which is the class that rule exists for;
- the response carries **`resumeError`**, so `resumed: false` arrives with its
  reason and the stranded run's id instead of leaving the caller to guess
  whether a resume was even attempted.

It reuses the already-registered `RESUME_FAILED` code and the existing resume
message shape rather than introducing a new vocabulary — the fact being
reported (an outcome recorded whose run did not advance) is the same one.

Applied at all five sites that resume a recorded outcome: `decide`, the
revision-limit auto-rejection, `sendBack`, `resubmit`, and both branches of
`recall` (whose revise-window path needs `cancelRun` rather than `resume`).

A request that names **no** run is unaffected and stays quiet — there is
nothing parked on it, and reporting one there would be the mirror-image
failure that trains operators to skim `error`.
