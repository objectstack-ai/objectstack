---
'@objectstack/lint': patch
---

feat(lint): warn when a permission set reads a roll-up summary over child data it cannot read

Clause-②: yes (widening) — `@objectstack/lint` exports one new rule function, `validateRollupSourceVisibility`, its two rule-id constants `SECURITY_ROLLUP_SOURCE_UNREADABLE` and `SECURITY_ROLLUP_SOURCE_ROW_SCOPED`, and the `RollupSourceVisibilityFinding` / `RollupSourceVisibilitySeverity` types; nothing that passed before is refused.
Metadata-protocol: none

A `summary` (roll-up) field keeps its documented semantics: the engine recomputes it as the system over the whole child collection, and on read it follows only the parent field's own field-level security. So a permission set that can see the summary field still reads the roll-up when it cannot read the aggregated child field, a child field the roll-up's `filter` tests, or the child object, or when it reads only some child rows. Two new author-time findings now say so, for each permission set and each summary field it can see:

- `security-rollup-source-unreadable` (warning) — the set cannot read `summaryOperations.object`, `summaryOperations.field`, or a top-level field key of `summaryOperations.filter`. A `count` reads no value, so its `field` is not judged; its `filter` is.
- `security-rollup-source-row-scoped` (info) — the set reads all of those, but one of its own read-class `rowLevelSecurity` policies on the child, or the child's `defaultRowScope`, narrows which child rows it reads.

"Can read" follows the runtime's three gates: the object grant (its own entry, otherwise `'*'`, which covers a private object only with View All or Modify All), the field entry (`readable: false`, made inert by View All or Modify All on the object), and the capability gate (an object's or field's `requiredPermissions` against the set's `systemPermissions`, which View All and Modify All do not lift). A set holding View All or Modify All on the child is still reported for a capability-gated child object or field, and for a row policy unless the child is private, has tenancy off or is auth-managed, the postures on which the bypass skips row security. A summary field the set cannot see, through any of the three gates on the parent, is not reported.

The fix line names the remedy and its reach: `fields: { 'invoice.total': { readable: false } }` on the set hides the summary field from every holder of that set, and a co-held set with no entry for it does not restore it; to keep it for some holders, declare `readable: true` on it in the sets they hold.

Both findings are advisory: they never fail `os lint`, `os validate` or `os build` (only `--strict` promotes a warning), and the rule does not run at the runtime publish gate. `os explain security-rollup-source-unreadable` and `os explain security-rollup-source-row-scoped` print the full reasoning.
