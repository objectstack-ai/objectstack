---
"@objectstack/lint": minor
---

A sharing rule whose `condition` compares a field with a `json` or `multiple` field is refused when it is authored, at `os validate` / `os build` / `os lint`, instead of being seeded and then granting nothing (#19886).

**BREAKING** — an accept-set narrowing, shipped by `@objectstack/lint` as `minor` under the repo's launch-window convention for accept-set narrowings. The hand-migration prescription is already registered under protocol major 18 as `cel-predicate-one-value-comparand-refused`, whose surface names `sharingRules[].condition` and this class.

Clause-②: no (narrowing)

`record.status != record.tags`, with `tags` a `json` field or a `multiple` lookup, lowers to a legal filter shape, because the CEL lowering sees the condition's text and not the object's field types, so the seeder seeds the rule. Measured before this change: 72 conditions (`==`, `!=`, `!(==)`, `>`, `>=`, `<`, `<=`; a `json`, `address`, `multiselect`, `multiple` lookup and `multiple` user field; both operand orders; plus a list-against-list and a compound spelling) were all accepted by the real `os validate`. The runtime refused every one of them, measured through the real plugin-sharing on driver-sql and driver-sqlite-wasm: the rule was seeded into `sys_sharing_rule`, every criteria query it ran answered `INVALID_FILTER` / 400, `SharingRuleService` read that as matching no record, and no `sys_record_share` grant was written, at boot or on a later insert or update. The recipient read nothing. The only signal was one WARN line per rule in the server log.

What changes:

- `@objectstack/lint`: `validateSharingRuleEnforceability` reports `sharing-rule-unlowerable-condition` for a condition that lowers but compares two fields (`==`, `!=`, `>`, `>=`, `<`, `<=`, on either side, under `!` too) where either column is DECLARED to hold a list or an object. It uses the same classification as the row-level-security rule's arm for this class (`listHoldingComparisons`, now exported from `validate-rls-predicate-enforceability.ts`), which reads the spec's value-shape classes, the same two driver-sql refuses such a comparison by: a structured JSON type (`json`, `composite`, `repeater`, `record`, `location`, `address`, `vector`), or a multi-valued field (`multiselect`, `checkboxes`, `tags`, or `select` / `radio` / `lookup` / `user` / `file` / `image` with `multiple: true`). The finding names each comparison and the declaration behind it, and states the run-time consequence. It keeps the unlowerable id because the fix is the same rewrite of the condition, and the literal spelling of the same class (`record.status == ['a', 'b']`) is already reported under that id.
- Inactive rules are judged too, as the rule already does for every condition: the seeder seeds them regardless of `active`.

Not changed: a field compared with a single-valued field (`record.status != record.owner_name`, `record.amount > record.budget`), a `json` or `multiple` field compared with a literal or tested against `null`, and any column the stack does not declare (an anchor object from another package, an object with no field map, an undeclared name), which the rule does not judge. No row-level-security verdict changes. The rule still runs only at the CLI doors; the metadata save door for a `sharing_rule` does not run it, as before.

No shipped condition moves: the 3 declared sharing-rule conditions in this repository's packages and examples compare a field with a literal, the cloud repository declares none, and the real `os validate` over `app-crm`, `app-multi-package`, `app-showcase` and `app-todo` reports no new `sharing-rule-*` finding.

**What to change.** A field compared with a `json` or `multiple` field has no row-filter form: compare with a single-valued column, or with a literal ("one of these values" is `record.status in ['open', 'pending']`), or keep the value the rule keys on in a single-valued field and compare with that.

<!-- adr-0087: not-required (already-registered cel-predicate-one-value-comparand-refused) The entry's surface already names sharingRules[].condition and this exact class ("a field compared with another field (==, !=, or an ordering operator) where either column holds a list or an object on the record, as a json column or a multiple lookup does"), and its replacement carries the prescription ("A field compared with a json or multiple field has no pushdown form: compare with a single-valued column"). This change moves where that registered class is refused on a sharing rule, from a silent zero-share at run time to authoring time; it adds no class and no prescription the entry does not already hold, and it rewrites no stored metadata. -->
