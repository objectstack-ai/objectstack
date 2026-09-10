---
"@objectstack/service-automation": patch
---

fix(service-automation): a `null` / `undefined` envelope is refused attributed, not as a raw `TypeError` (#16439)

`AutomationEngine.evaluateValueEnvelope` derives its verdict from `valueEnvelopeRefusals` — the same call `registerFlow` makes — so registration's reject set and evaluation's reject set are one set by construction. That covered every malformed **envelope**, and exactly two shapes fell outside it: `null` and `undefined`. Neither published primitive judges them (the shape rule is a no-op on anything not `isExpressionEnvelopeShaped`, and `validateExpression` reads an absent `source` as "not authored"), so both returned no findings and the method went on to read `envelope.source` off nothing — `TypeError: Cannot read properties of null (reading 'source')`, with no `where`, no source and no rule. Driven across the ten shapes the card enumerates, eight failed attributed and only these two did not.

Both now fail attributed like the other eight, led by the published `ASSIGNMENT_VALUE_ENVELOPE_REFUSAL` sentence and carrying the `where` and the source. The rule is stated in the **shared** refusal, never as a guard in the evaluator: a reject reason living only on the evaluation side would end the very property this design has.

Refused rather than admitted, and the asymmetry with the predicate path is deliberate: `structuralConditionRefusal` admits `null` / `undefined` because the condition *field* is optional, so absence there means "the author wrote no predicate". A value slot's envelope **is** the value, so an absent one is a caller handing nothing where a value was required.

**Why `patch`, not `minor` and not nothing.** Nothing changes for authored metadata: the only production call site guards with `isExpressionEnvelopeShaped`, which neither shape satisfies, and the value-role feeder emits only envelope-shaped objects, so `registerFlow` never presents a nullish value to the shared refusal — measured, and pinned. An authored `null` in an `assignments` slot is still a literal, still parses and still registers. What does move is the runtime behaviour of a **public method on an exported class**: a direct caller that passed a nullish envelope used to get a language-level `TypeError` and now gets an attributed `Error`. That is a published surface, so it is not silent — but it adds no API, no option and no capability, and no correct caller has to adapt, which is what makes it a patch rather than a minor.
