---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

fix(objectql, spec)!: a single-object save on a running server refuses a `dynamic` roll-up over a child field that is not a stored home amount, in `defineStack`'s words

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches no `dynamic` roll-up yet (its home roll-up paragraph is owed by follow-up #33714), so no page states which door refuses the wrong one.

<!-- adr-0087: registered summary-dynamic-currency-rollup-home-amount-judged-as-served -->

**BREAKING** for a hand-written object body saved on a running server. A `summary` with `function` `sum` / `min` / `max` / `avg` that declares `currencyMode: 'dynamic'` (or a `currencyConfig` naming no mode) is admitted only when it rolls up a stored home amount: a child field that the `homeAmount.field` of a record-mode amount on the child names. `defineStack` already refused every other one; the engine registry, which a single-object save meets, judged only `record` roll-ups, so a `dynamic` roll-up over a `fixed` EUR amount, a plain number or a formula was stored there and its total drawn with the home currency's symbol.

What moves (each line FROM → TO):

- a published save or publish of an object through the `/meta` doors (`PUT /meta/object/:name`, the runtime `/meta` dispatcher, `POST /meta/object/:name/publish`, a datasource table import) whose `dynamic` roll-up reads a child field that is not a stored home amount, with the child registered: FROM stored, 200 TO refused 422 `INVALID_METADATA`, nothing stored, with the sentence `defineStack` prints (`recordCurrencyDynamicRollupNotHomeError`, `@objectstack/spec/data`). The same holds in the other order: a child saved so that a registered parent's `dynamic` roll-up no longer reads a home amount is refused, naming the parent's roll-up.
- the same roll-up added by an `objectExtensions` entry or an `object_extension` item, or reading a child field an extension adds: judged against the parent and the child as the server serves them, at the end of an install, upgrade or reload run, on a published single save of the item, and in the batch writers (a package publish, a duplicate, an import): FROM installed or stored TO refused 422.
- a `homeAmount` makes a field a stored home amount only where it is valid as declared: on a `record`-mode `currency` amount, naming another field of the same object that is a `currency` field in `dynamic` mode, `readonly: true`, with no `expression`, and claimed by that one amount (`storedHomeAmountSourceOf`, `@objectstack/spec/data`). The object door already guaranteed this for an authored object; a field map merged with an extension's was taken at its word. At `defineStack` and at the engine registry alike, a `dynamic` roll-up over a field an extension's `homeAmount` names without that reading: FROM admitted TO refused.

The fix: roll up the child's stored home amount (the refusal lists them), declare `currencyMode: 'fixed'` with the code when every amount the roll-up reads is in that one currency, or delete `currencyConfig` on the summary. An extension declaring a home amount gives it a `readonly` `dynamic` currency field of its own.

Unchanged: the `dynamic` roll-up of a stored home amount (the shape `currencyMode: 'dynamic'` was admitted for) saves and is served; a summary with no `currencyConfig`, or `fixed`, is not judged by this arm; a `count` roll-up and every `record` case answer exactly as before; a roll-up over a child amount in each row's own currency is still refused by D6's roll-up door first, whatever it declares. Roll-ups stored before this release keep loading at every boot, which is not asked, and a run that leaves such a pair as it found it is not refused over it. `FieldSchema.currencyConfig`'s description now says that every door refuses the roll-ups it names. The latest stable `@objectstack/spec` (18.4.0) never admitted a `dynamic` summary at all; only the `next` snapshot of 2026-11-15 did, before this door judged it.
