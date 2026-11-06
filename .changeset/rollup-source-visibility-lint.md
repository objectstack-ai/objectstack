---
'@objectstack/lint': patch
---

feat(lint): warn when a permission set reads a roll-up summary over child data it cannot read

Clause-②: yes (widening) — `@objectstack/lint` exports one new rule function, `validateRollupSourceVisibility`, its two rule-id constants `SECURITY_ROLLUP_SOURCE_UNREADABLE` and `SECURITY_ROLLUP_SOURCE_ROW_SCOPED`, and the `RollupSourceVisibilityFinding` / `RollupSourceVisibilitySeverity` types; nothing that passed before is refused.
Metadata-protocol: none

A `summary` (roll-up) field keeps its documented semantics: the engine recomputes it as the system over the whole child collection, and on read it follows only the parent field's own field-level security. So a permission set that can read the summary field still reads the roll-up when it cannot read the aggregated child field, cannot read the child object, or reads only some child rows. Two new author-time findings now say so, for each permission set and each summary field it can read:

- `security-rollup-source-unreadable` (warning) — the set hides `summaryOperations.field` on the child (`readable: false`), or grants no read on `summaryOperations.object`. A `count` reads no value, so only its child object is judged.
- `security-rollup-source-row-scoped` (info) — the set reads the child, but one of its own read-class `rowLevelSecurity` policies on the child, or the child's `defaultRowScope`, narrows which child rows it reads.

The fix line names the remedy: hide the summary field for that set (`fields: { 'invoice.total': { readable: false } }`) if its value should not be visible. A set that holds View All or Modify All on the child reads every child row and field and is not reported; a summary field the set cannot read is not reported.

Both findings are advisory: they never fail `os lint`, `os validate` or `os build` (only `--strict` promotes a warning), and the rule does not run at the runtime publish gate. `os explain security-rollup-source-unreadable` and `os explain security-rollup-source-row-scoped` print the full reasoning.
