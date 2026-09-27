---
"@objectstack/spec": patch
---

Every example predicate in `packages/spec/src/data/validation.zod.ts` now reads fields through the `record.` root and describes the violation, so an author or agent who copies one gets a rule that evaluates and fires on the records it names as invalid. The fix covers the three `cross_field` "Salesforce Examples" in the `CrossFieldValidationSchema` TSDoc, the header `script` example, and the `.describe()` example on `CrossFieldValidationSchema.condition` (#20252).

Clause-②: no

- Example 1, "Close Date Must Be In Current or Future Month": `MONTH(close_date) >= MONTH(TODAY()) AND YEAR(close_date) >= YEAR(TODAY())` becomes `date(record.close_date) < addDays(today(), 1 - today().getDate())`. The old string did not parse (`AND` is not CEL, and `close_date` had no `record.` root). It was also inverted: a `cross_field` condition that evaluates TRUE is the violation, and the old condition was TRUE on the records the rule should accept. The new condition is TRUE when the close date falls before the first day of the current month. It uses only the formula stdlib's `date()`, `today()` and `addDays()` plus CEL's built-in `getDate()` timestamp accessor.
- Example 2, "Discount Validation": `discount > (amount * 0.40)` becomes `record.discount > (record.amount * 0.40)`. The bare fields were unknown variables. The direction is unchanged.
- Example 3, "Opportunity Must Have Products": `products = null AND stage = "closed_won"` becomes `isBlank(record.products) && record.stage == "closed_won"`. A lone `=` is a CEL parse error and `AND` is not CEL. The direction is unchanged.
- The header `script` example: `discount_percent > 0.40` becomes `record.discount_percent > 0.40`. The bare field was an unknown variable. The direction is unchanged.
- The `CrossFieldValidationSchema.condition` description: its example `record.end_date > record.start_date` refused every valid end-after-start range, because a TRUE condition is the violation. It becomes `record.end_date < record.start_date`, and the description now says that a TRUE condition fails validation.

The Salesforce-formula side of each example is unchanged. This changes documentation text only (TSDoc and one `.describe()` string, with the generated reference page regenerated to match). There is no schema, behaviour or export change.
