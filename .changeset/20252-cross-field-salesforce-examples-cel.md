---
"@objectstack/spec": patch
---

The two `cross_field` "Salesforce Examples" in the `CrossFieldValidationSchema` TSDoc (`packages/spec/src/data/validation.zod.ts`) now show a `condition` the evaluator accepts, so an author or agent who copies the documented "ObjectStack Equivalent" gets a rule that evaluates, and Example 1's rule fires on the records it names as invalid (#20252).

Clause-②: no

- Example 1, "Close Date Must Be In Current or Future Month": `MONTH(close_date) >= MONTH(TODAY()) AND YEAR(close_date) >= YEAR(TODAY())` becomes `date(record.close_date) < addDays(today(), 1 - today().getDate())`. The old string did not parse (`AND` is not CEL, and `close_date` had no `record.` root). It was also inverted: a `cross_field` condition that evaluates TRUE is the violation, and the old condition was TRUE on the records the rule should accept. The new condition is TRUE when the close date falls before the first day of the current month. It uses only the formula stdlib's `date()`, `today()` and `addDays()` plus CEL's built-in `getDate()` timestamp accessor.
- Example 3, "Opportunity Must Have Products": `products = null AND stage = "closed_won"` becomes `isBlank(record.products) && record.stage == "closed_won"`. A lone `=` is a CEL parse error and `AND` is not CEL. The direction is unchanged.

The Salesforce-formula side of each example is unchanged. This is TSDoc text only, with no schema, behaviour or export change.
