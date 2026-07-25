---
"@objectstack/service-automation": patch
---

fix(service-automation): bind `previous` (as null) on the create leg so start conditions can discriminate create vs update (#3427)

The engine bound `previous` into the flow condition scope only when it was
truthy, so on a record insert (`record-after-create`, and the create leg of
`record-after-write`) `previous` was an **unknown** CEL variable. Any reference to
it — including the documented `previous == null` create-discrimination — threw
`condition failed to evaluate as CEL: Unknown variable: previous`, failing the
whole start condition and dropping the run.

`previous` is now always bound, to `null` when there is no prior row. So
`previous == null` is the create leg and `previous != null` / `previous.<field>`
the update leg — the pattern the `record-after-write` docs and the Studio flow
designer advertise. Update-triggered flows are unaffected (`previous` was, and
stays, the prior row there).
