---
'@objectstack/formula': patch
'@objectstack/lint': patch
'@objectstack/service-automation': patch
---

fix(lint,service-automation): a flow value envelope is typed for the date-text verdicts, so `timestamp(record.<date field>)` in an `update_record` / `create_record` field or an `assignment` value is refused at `os validate` and at `registerFlow`

Clause-②: no (narrowing: a flow value envelope that registered and published now refuses at `os validate` and at `registerFlow`; owes the contract-review-tier review before the queue, and Tier H via the seat)
Metadata-protocol: none

<!-- adr-0087: not-required (already-registered formula-timestamp-date-only-refused, formula-date-text-call-refused, formula-date-subtraction-refused) The three semantic entries already carry these verdicts, their codes and their rewrites to the upgrade guide; this change lets the same verdicts reach one more site, a flow value envelope, with the same rewrite. No key is added, removed or re-shaped, and nothing an author wrote is rewritten. -->

**BREAKING** accept-set narrowing, shipped as `patch`. A flow's value envelope (`assignment` `assignments.*`, `create_record` / `update_record` `fields.*`) was validated without field types, so the date-text verdicts never reached it. `isoDate(timestamp(record.borrow_date) + duration('168h'))` written into an `update_record` field passed `os validate`, registered, and failed every run: the runtime holds a `date` field as its `YYYY-MM-DD` text, and `timestamp()` parses only a full ISO-8601 instant.

- **The verdicts.** The envelope is now typed with the object the flow's run binds as `record` (the start node's `objectName`; a time-relative flow's swept object), for the date-text family alone: `date-text-call-run-may-fail` and `date-text-arithmetic-run-may-fail`, over `record.<field>` / `previous.<field>` reads. `timestamp(record.<date field>)`, alone or inside `+ duration(…)`, is refused with the shift `isoDate(addDays(record.<date field>, N))`; so are a `date` / `datetime` field handed straight to a timestamp-only call (`isoDate(record.picked_up_at)`) and arithmetic on its text (`record.borrow_date - duration('24h')`).
- **Where.** `@objectstack/lint` `validateStackExpressions` (`os validate`, `os build`, the flow publish door) reports an `error` at the slot. `@objectstack/service-automation` `registerFlow` throws it when an object-schema resolver is wired, and the stored pass (`canonicalizeStoredFlow`) lists it at the slot. A flow stored with such an envelope stops registering at boot until it is rewritten.
- **Not refused.** `timestamp()` over a `datetime` field. A bare field name in an envelope, and an expression reading `input`: neither door can prove what the run binds there. Every other type verdict (`type-mismatch*`, `date-arithmetic*`, `date-duration-value`) and field existence stay out of value envelopes, as before. The run-time evaluator is unchanged.
- **`@objectstack/formula`.** `ExprSchemaHint` gains the optional `flowValueEnvelope` key that both doors pass.

## FROM → TO

| FROM | TO |
|:---|:---|
| `isoDate(timestamp(record.borrow_date) + duration('168h'))` | `isoDate(addDays(record.borrow_date, 7))` |
| `timestamp(record.borrow_date)` | `date(record.borrow_date)` |
| `isoDate(record.picked_up_at)` | `isoDate(date(record.picked_up_at))` |

One-line fix: in a flow value envelope, shift a date field by whole days with `isoDate(addDays(record.<date field>, N))`, never `timestamp(record.<date field>) + duration(…)`.
