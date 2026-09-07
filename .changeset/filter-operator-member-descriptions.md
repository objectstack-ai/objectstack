---
"@objectstack/spec": patch
---

Every filter-operator member now carries a `.describe()`, so the published `data/filter` reference documents all of them instead of a subset.

The Description column of `content/docs/references/data/filter.mdx` is filled from `prop.description` — the JSON-Schema projection of a Zod `.describe()`. A JSDoc block above a member never reaches that column, so members documented by JSDoc alone rendered with an empty Description cell on a published reference page, including operators whose semantics an earlier correction campaign existed to fix.

Seven cells on that page were blank and are now filled: `EqualityOperator.$eq` / `$ne`, `StringOperator.$contains` / `$notContains` / `$startsWith` / `$endsWith`, and `QueryFilter.where`.

The descriptions are prose about behaviour that already ships — no operator semantics, accept-set, export or authorable key moved, and the JSDoc blocks are kept as-is:

- `$eq` / `$ne` state the default-operator role, the SQL and MongoDB lowerings, the `{ $field }` comparand position, and that `{ "$eq": null }` / `{ "$ne": null }` are the has-no-value / **has-a-value** predicates — the value question, never a key-presence one.
- The four case-sensitive `$contains`-family members state their case contract, their SQL lowering, and the comparand contract they share: `%` and `_` are ordinary characters because the family escapes and anchors the comparand for the caller, which is what separates them from `$like` / `$ilike`.
- `where` states the condition-tree shape plus the two semantics that were ruled rather than inherited — `$not` is NULL-safe, and empty `$and` / `$or` are the boolean identities.

Each description is now a module-level constant read by **both** copies of its operator — the documentation schema (`EqualityOperator`, `StringOperator`, `RangeOperator`, `SpecialOperator`) and the enforced `FieldOperatorsSchema` — extending the pairing `ORDERING_COMPARAND_DESCRIPTION` and `SET_MEMBER_DESCRIPTION` already gave the ordering and set slots. The two copies now share the text rather than a description of it, so an operator can no longer be documented in one and blank in the other.
