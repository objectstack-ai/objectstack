---
'@objectstack/spec': minor
'@objectstack/formula': minor
'@objectstack/lint': minor
'@objectstack/service-automation': minor
---

fix(lint,service-automation): a flow value envelope is typed for the date-text verdicts, so `timestamp(record.<date field>)` in an `update_record` / `create_record` field or an `assignment` value is refused at `os validate` and at `registerFlow`

Clause-②: yes (narrowing) — narrowed: a flow value envelope that registered and published now refuses at `os validate` and at `registerFlow`; owes the contract-review-tier review before the queue, and Tier H via the seat. Widened: the published `ExprSchemaHint` type gains one optional key, `flowValueEnvelope`.
Metadata-protocol: narrowed
Skills-docs: none — no published skill teaches a flow value envelope over a date field; `skills/objectstack-formula/SKILL.md` already states the `timestamp()` / `date-text-call` rule without naming a site, so it now holds for value envelopes as written

<!-- adr-0087: not-required (already-registered formula-timestamp-date-only-refused, formula-date-text-call-refused, formula-date-subtraction-refused) The three semantic entries already carry these verdicts, their codes and their rewrites to the upgrade guide; this change lets the same verdicts reach one more site, a flow value envelope, with the same rewrite, and rewrites each entry's surface in this PR to name that site, its scope (a record-triggered flow or a time-relative sweep of the typed object that rebinds neither record nor previous itself) and its consequence (a stored flow carrying one fails to register at boot on an engine with the object-schema resolver wired until rewritten), and adds to each entry's acceptance criteria how an upgrading operator confirms a stored flow is clear (no failed to register flow warning at boot, and no registerFlow TODO from POST /api/v1/meta/_migrate-stored on the running server; the CLI's os migrate meta --stored boots automation inert, with no object-schema resolver, so it types no value envelope and cannot show it). No id is added, no key is added, removed or re-shaped, and nothing an author wrote is rewritten. -->

The upgrade-guide half of the narrowing (#34661) is completed by this PR: the three ADR-0087 entries above now name the flow value envelope in their `surface`.

**BREAKING** accept-set narrowing, shipped as `minor`. A flow's value envelope (`assignment` `assignments.*`, `create_record` / `update_record` `fields.*`) was validated without field types, so the date-text verdicts never reached it. `isoDate(timestamp(record.borrow_date) + duration('168h'))` written into an `update_record` field passed `os validate`, registered, and failed every run: the runtime holds a `date` field as its `YYYY-MM-DD` text, and `timestamp()` parses only a full ISO-8601 instant.

- **The verdicts.** The envelope is now typed with the object the flow's run binds as `record` (the start node's `objectName`; a time-relative flow's swept object) — on a record-triggered flow, or a time-relative sweep of the typed object, that rebinds neither root the typing reads (no declared variable, node id, output / iterator / index / error variable or `assignment` target named `record`; no node id, output / iterator / index / error variable or `assignment` target named `previous` — the run's seed sets `previous` over a declared variable of that name) — for the date-text family alone: `date-text-call-run-may-fail` and `date-text-arithmetic-run-may-fail`, over `record.<field>` / `previous.<field>` reads. `timestamp(record.<date field>)`, alone or inside `+ duration(…)`, is refused with the shift `isoDate(addDays(record.<date field>, N))`; so are a `date` / `datetime` field handed straight to a timestamp-only call (`isoDate(record.picked_up_at)`) and arithmetic on its text (`record.borrow_date - duration('24h')`).
- **Where.** `@objectstack/lint` `validateStackExpressions` (`os validate`, `os build`, the flow publish door) reports an `error` at the slot. `@objectstack/service-automation` `registerFlow` throws it when an object-schema resolver is wired, and the stored pass (`canonicalizeStoredFlow`) lists it at the slot. The two doors judge the same set of flows. A flow stored with such an envelope stops registering at boot until it is rewritten.
- **Not refused.** Any envelope of a flow whose `record` is not proven to be the typed object's row: an inbound hook (`api`), a schedule, a flow with no trigger (started by hand or by a parent's `subflow` / `map`), a sweep of another object, and a record-triggered flow that declares or assigns its own `record` variable, or assigns or outputs its own `previous` — judged untyped, as before. `timestamp()` over a `datetime` field. A bare field name in an envelope, and an expression reading `input`: neither door can prove what the run binds there. Every other type verdict (`type-mismatch*`, `date-arithmetic*`, `date-duration-value`) and field existence stay out of value envelopes, as before. The run-time evaluator is unchanged.
- **`@objectstack/formula`.** `ExprSchemaHint` gains the optional `flowValueEnvelope` key that both doors pass.
- **`@objectstack/spec`.** The ADR-0087 entries `formula-timestamp-date-only-refused`, `formula-date-text-call-refused` and `formula-date-subtraction-refused` name the flow value envelope in their `surface` (for the subtraction entry, its first two shapes; the formula-only duration value stays out of envelopes). Text only: no id, key or shape changes.

## FROM → TO

| FROM | TO |
|:---|:---|
| `isoDate(timestamp(record.borrow_date) + duration('168h'))` | `isoDate(addDays(record.borrow_date, 7))` |
| `timestamp(record.borrow_date)` | `date(record.borrow_date)` |
| `isoDate(record.picked_up_at)` | `isoDate(date(record.picked_up_at))` |

One-line fix: in a flow value envelope, shift a date field by whole days with `isoDate(addDays(record.<date field>, N))`, never `timestamp(record.<date field>) + duration(…)`.
