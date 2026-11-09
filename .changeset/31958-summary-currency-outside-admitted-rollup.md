---
'@objectstack/spec': minor
---

fix(spec)!: a `summary` field's `currencyConfig` is refused outside the ADR-0144 admitted roll-up: every mode on a `count`, `dynamic` on any summary, and `record` on any roll-up but the one through the `master_detail` its child amounts follow

Clause-②: no (narrowing) — the object schema and `defineStack` refuse a `summary` field's `currencyConfig` they parsed before; nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` teaches no `currencyConfig` on a `summary` (the currency teaching in `skills/objectstack-data/rules/field-types.md` covers `currency` and `formula` fields only; the parent-path teaching is follow-up #31957).

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `currencyConfig` keeps its shape on every field type, and a `summary` keeps every key it had. What moves is which values a summary may carry. A refused config either changed nothing any reader drew (`dynamic`) or labelled a total with a currency it is not in (`record` outside the admitted roll-up, any mode on a count), so there is no rewrite that keeps what the author meant; the refusal names the remedy for each case. -->

**BREAKING** accept-set narrowing, ADR-0144 D6 as amended: "A `summary` rolled up through that same master_detail is single-currency by construction, and is admitted in the parent's currency." Every other roll-up keeps D6's first bullet. The refusal set is the spec seat's ruling (claim amend 1 on #31958), after measuring which modes a reader consumes on a summary.

- **At the object** (`ObjectSchema`, so `os validate`, `os build`, `defineStack` and the metadata save and publish doors):
  - A `count` roll-up refuses `currencyConfig` in every mode, `fixed` included. A count is a number of rows, never an amount.
  - `dynamic` is refused on every `summary`, written or by an absent `currencyMode` (`currencyConfig: {}`). No reader consumes it there: the Console's roll-up faces read no `currencyConfig`, and the analytics layer relays only `fixed` and `record`.
  - `record` is refused on a `summary` whose `summaryOperations` names no child amount.
- **In `defineStack`'s cross-reference pass:** a `sum`, `min`, `max` or `avg` roll-up declaring `currencyMode: 'record'` is refused unless it is the admitted one. That covers a child amount with its own code field, a `fixed` child amount (the refusal prescribes that fixed code), a child amount that declares no currency, a child amount following another object's currency, and a roll-up written through another relation than the `master_detail` its child amount follows. A child object or field the stack does not declare, a child known only through an `objectExtensions` entry, and a relation the pass cannot resolve are not judged.
- **Still accepted.** `fixed` on a `sum`, `min`, `max` or `avg` roll-up, because a reader consumes it: the analytics layer relays its code and refuses a dataset measure labelling it another currency. A fixed roll-up over amounts in that one currency is honest. The admitted `record` roll-up is unchanged, and so is a summary with no `currencyConfig`.
- **Not changed.** A standalone `FieldSchema`, `CurrencyConfigSchema` and an extension's fields parse what they parsed before. A stored object already carrying such a summary keeps registering, as any off-spec stored row does: the registry logs it and badges its reads with `_diagnostics`. Its next save is refused.

**What an author does.** On a `count` roll-up, or under `dynamic`, delete `currencyConfig`. On a roll-up whose amounts are all in one currency, declare `currencyMode: 'fixed'` with that code. To show a roll-up in its parent's currency, make the child amount follow the parent through the `master_detail` the roll-up runs through (`currencyField: 'MASTER_DETAIL_FIELD.CODE_FIELD'`), and declare `currencyMode: 'record'` naming the parent's own code field on the summary.

No in-repo metadata carried a refused shape: a census of the 480 `summary` sites in `examples/**`, the showcase, fixtures, `packages/**`, `ui/**` and `content/docs/**` found two `currencyConfig` declarations, both the admitted roll-up.
