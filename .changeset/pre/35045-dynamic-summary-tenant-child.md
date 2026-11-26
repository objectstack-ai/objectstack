---
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

feat(spec, objectql): a `summary` over a plain `dynamic` currency amount may declare `currencyMode: 'dynamic'`

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/evals/objects-fields-relationships.json (eval 20's expected output still says `dynamic` is admitted only on a roll-up of a home amount; no SKILL.md teaches a summary's currency, and content/docs/data-modeling/currency.mdx is updated here)

A `summary` (`sum`, `min`, `max`, `avg`) that totals a child `currency` field in `dynamic` mode (no `currencyConfig`, or `currencyMode: 'dynamic'`) may now declare `currencyConfig: { currencyMode: 'dynamic' }`, with no `defaultCurrency`. A `dynamic` amount is in the tenant default currency, `localization.currency`, by definition, so its total is too, and the Console's roll-up faces draw it in that currency, as they already draw a roll-up of a stored home amount. Before, `defineStack` (`os validate`, the build) and a save or publish through the metadata API refused it with "… is not a stored home amount, so its rows are not known to be in the home currency", so a total of tenant-currency amounts (a timesheet's cost over its time entries' cost) rendered as a bare number beside currency cells.

Levels follow the metadata protocol: `@objectstack/spec` takes `minor` for the newly accepted declaration and the new export; `@objectstack/objectql` takes `patch` (its door reads the spec predicate, no protocol of its own moves).

Both doors read one new predicate, `isTenantCurrencyAmount` (`@objectstack/spec/data`): a stored `currency` field in `dynamic` mode, of which a stored home amount is one. Unchanged:

- A summary that declares no `currencyConfig` still has no currency: nothing is inferred.
- `dynamic` over a record-mode child amount is refused as before, prescribing its stored home amount (or `currencyMode: 'record'` when the amounts follow this record through the roll-up's master_detail); over a `fixed` child amount it is refused prescribing that code; over a plain `number`, a `formula` or another `summary` it is refused.

The refusal's wording moves with the admitted set: its head now reads "`currencyMode: 'dynamic'` on a summary is admitted only for a roll-up of an amount in the organization's home currency: a child `currency` field in `dynamic` mode (an absent `currencyMode` is `dynamic`), a stored home amount included, …", a child that is not a `currency` field is named by its type ("is a 'number' field, not a `currency` field in `dynamic` mode"), and the prescription lists the child's amounts in the home currency instead of its home amounts alone. The object door's list of admitted roll-up currencies says the same.
