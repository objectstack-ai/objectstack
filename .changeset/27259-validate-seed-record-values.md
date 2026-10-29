---
'@objectstack/cli': minor
'@objectstack/objectql': minor
---

fix(cli)!: `os validate` and `os build` refuse a seed record value the seed load would refuse, with the load's own code and sentence, located at the record's field (#27259)

Clause-②: no (narrowing) — `os validate` and `os build` refuse a stack whose seed record carries a value the record validator refuses at seed load (a currency written `{ value, currency }`, an unreadable number, a value outside a field's options, an unreadable date), which both commands passed before. What the runtime stores and refuses does not move: every row refused here was already refused when the seed loaded. Nothing is widened.
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. The refusal moves earlier, from the seed load to the authoring commands, with the load's own wording: a seed row it names was already dropped at load, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing at `os validate` and `os build` (`@objectstack/cli`); one new export on `@objectstack/objectql`.

- **Before.** A seed record such as `budget: { value: 10, currency: 'USD' }` on a currency field passed `os validate` with "Validation passed" (exit 0) and `os build` emitted the artifact. The row was refused only when the seed loaded, by the record validator: `Budget is a currency amount: write it as a bare number …`, one dropped row in the boot log.
- **Now.** Both commands judge every seed record value with the judge the load runs, and refuse with that judge's code and sentence, located at the value: `data[0].records[4].budget: Budget is a currency amount: write it as a bare number … (invalid_number)`, exit 1. `--json` carries each issue as `{ location, object, field, code, message }`.
- **One judge.** The verdict is `validateInsertValues` (`@objectstack/objectql`, new): the insert write's own normalizations (a blank on a typed field is `null`, a numeric string is its number, a scalar on a multi-value field is wrapped) and then the same record-validator call the insert path makes. The field map is the runtime registry's, built from the stack's objects and picklists. So a value the load accepts after a rewrite (`'10'` on a number field) still passes.
- **Left to the load.** `required` (a default or a hook may fill the value), a field the object does not declare (`defineSeed` already refuses it), and every value the load rewrites or a deployment decides: an expression envelope (the `cel` template), a `seedFile(path)`, a reference, file or structured-JSON field, a field bound to a picklist another package declares, and a dataset whose object another package declares.
- **Who sees it.** A stack shipping a seed row the load already drops. The four example apps in this repository (`app-todo`, `app-crm`, `app-showcase`, `app-multi-package`) carry none and pass unchanged.

**The remedy.** Write the value in the shape the message names, for a currency a bare number such as `10`, with the currency in the field's `currencyConfig`.
