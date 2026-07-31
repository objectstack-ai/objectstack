---
"@objectstack/lint": patch
"@objectstack/cli": patch
---

fix(lint,cli): `os lint` no longer passes a flow the other two commands refuse

`validateReadonlyFlowWrites` was hand-wired into `os validate` and `os compile`
and never into `os lint`. Measured on the showcase app with one planted
violation — a `runAs:'user'` `update_record` writing a static-`readonly` field:

| | `os lint` | `os validate` |
|---|---|---|
| before | **exit 0 — passed** | exit 1 — refused |
| after | exit 1 — refused | exit 1 — refused |

That rule **gates** (a static `readonly` + literal field is a certain no-op:
the engine strips it from the UPDATE payload while the step still reports
success, #2948/#3425), so the divergence was not a missing warning — `os lint`
green-lit a build `os validate` stops.

It now joins `REFERENCE_INTEGRITY_RULES`, and both hand-wired call sites are
deleted with it, so the three commands share one answer by construction rather
than by three people remembering. This is the drift the suite was created to end
(#3583 §5 D5) and which its own header cited this rule as the standing proof of.

Two things made the wiring indefensible rather than merely untidy:

- `validateFlowNodeWrites` (#4369) walks the **same** `config.fields` map to ask
  the other half of the question — "does this field exist?" against "is it
  writable?" — and is already a suite member. One map, two checks, two different
  command sets.
- The two hand-wired sites did not even agree with each other on their input:
  `validate` passed the PRE-parse `normalized` stack, `compile` the POST-parse
  `result.data`. Verified equivalent for this rule before collapsing them onto
  the suite's post-parse input, so no finding is lost.

No rule behaviour changes: same ids, same severities, same messages.
