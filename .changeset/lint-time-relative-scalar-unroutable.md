---
"@objectstack/lint": patch
---

`os validate` now reports a `config.timeRelative` that is not a descriptor object

A flow start node whose `config.timeRelative` held a scalar — `timeRelative: 'daily'`
is the natural mistake, from fusing the sweep's **cadence** with its **descriptor** —
was accepted in complete silence at every layer. The node `config` slot is open by
design (ADR-0018) so the schema parsed it; the engine routes a flow to the
time-relative sweep only when `config.timeRelative` is an object, so the flow fell
through that branch and, with no other trigger key on the node, bound to nothing and
never fired. Not one diagnostic was produced anywhere — not even the single bind-time
warn that an object-but-unparseable descriptor gets, because the trigger was never
handed the flow at all.

A new authoring rule, `flow-time-relative-descriptor-unroutable` (warning), reports it
at authoring time with the value, its type, and the consequence — and a hint that
separates the two fused concepts: the descriptor says WHICH records to sweep
(`{ object, dateField, and exactly one of withinDays | offsetDays }`), while HOW OFTEN
is the sibling key `config.schedule`.

Nothing is made tolerant: a scalar is still not a descriptor and the runtime's
behaviour is unchanged. The rule is a separate criterion from
`flow-time-relative-descriptor-invalid` (#5496) rather than a widening of it, and the
two partition the key along the engine's own routing predicate — a value the engine
routes gets the schema's verdict, a value it routes nowhere gets this one, and never
both. Arrays and `Date` are `typeof 'object'`, so they stay with the shape rule.
