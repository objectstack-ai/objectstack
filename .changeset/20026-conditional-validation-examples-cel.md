---
"@objectstack/spec": patch
---

Every example predicate in the `ConditionalValidationSchema` TSDoc docblock (all seven Use Cases, plus the ObjectStack side of the "Salesforce Pattern Comparison" block, above the schema in `packages/spec/src/data/validation.zod.ts`) is rewritten in the CEL the evaluator actually accepts, so an author or agent who copies a documented example gets a rule that evaluates instead of one that refuses every write it guards (#20026).

Clause-②: no

17 of the 19 predicates used `=` for comparison (or `AND`/`NOT`/`REGEX(...)` word-form operators) — a CEL parse error, since `@marcbachmann/cel-js` parses `=` as the start of an assignment, not equality, and CEL has no `AND`/`OR`/`NOT` keyword form — and the other 2 (`order_total > 10000`, `approval_amount > 50000`) named a bare field with no `record.` root, an unknown-variable type error. `REGEX(tax_id, "…")` is rewritten to the evaluator's registered `matches(record.tax_id, "…")` stdlib function — the CEL form it accepts, not a literal transliteration. The Salesforce-formula half of the comparison (`IF(ISPICKVAL(...), AND(...), FALSE)`) is deliberately untouched: it documents Salesforce's own syntax, not CEL.

Measured through `ExpressionEngine.evaluate` (`@objectstack/formula`) against a record that makes each rewritten predicate true and one that makes it false; both branches evaluate as expected for all 19 (plus one extra disjunct check on the regex branch) — transcript in the PR body. The strings ship in the published `dist/object.zod-*.d.ts`, confirmed before and after this change with a lit/dark control: every rewritten string is present exactly once and every original broken string is absent.

| old (fails) | new (evaluates) |
|:--|:--|
| `account_type = "enterprise"` | `record.account_type == 'enterprise'` |
| `approval_status = null` | `record.approval_status == null` |
| `requires_shipping = true` | `record.requires_shipping == true` |
| `shipping_address = null OR shipping_address = ""` | `record.shipping_address == null \|\| record.shipping_address == ''` |
| `order_total > 10000` | `record.order_total > 10000` |
| `manager_approval_id = null` | `record.manager_approval_id == null` |
| `payment_method = null` | `record.payment_method == null` |
| `region = "EU"` | `record.region == 'EU'` |
| `gdpr_consent_given = false` | `record.gdpr_consent_given == false` |
| `tos_accepted = false` | `record.tos_accepted == false` |
| `country = "US"` | `record.country == 'US'` |
| `state = "CA"` | `record.state == 'CA'` |
| `tax_id = null OR NOT(REGEX(tax_id, "^\d{2}-\d{7}$"))` | `record.tax_id == null \|\| !matches(record.tax_id, "^\d{2}-\d{7}$")` |
| `is_taxable = true` | `record.is_taxable == true` |
| `tax_code = null OR tax_code = ""` | `record.tax_code == null \|\| record.tax_code == ''` |
| `user_role = "manager"` | `record.user_role == 'manager'` |
| `approval_amount > 50000` | `record.approval_amount > 50000` |
| `type = "enterprise"` (Salesforce comparison) | `record.type == 'enterprise'` |
| `amount > 100000 AND approval = null` (Salesforce comparison) | `record.amount > 100000 && record.approval == null` |

`packages/spec/src/data/validation.test.ts`'s `ConditionalValidationSchema` fixtures that copy seven of these strings verbatim (parse-only — `ValidationRuleSchema.parse(...).not.toThrow()`, no CEL evaluation) move with them: the six exact copies of the original seven, plus `manager_approval = null` (an `order_value_validation` fixture whose message text and structure mirror Use Case 3's manager-approval example one field-name spelling apart), now `record.manager_approval == null`. No schema, behaviour, or public export changes — TSDoc text only, in the same two files the strings already lived in.
