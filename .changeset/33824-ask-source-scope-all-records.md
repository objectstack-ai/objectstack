---
'@objectstack/spec': minor
---

feat(spec): the Ask data tools' `source` block can state that no row restriction applied (`scope: 'all_records'`)

Clause-②: yes (widening) — `ObjectQuerySourceSchema.scope` accepts a second value, `'all_records'`, beside `'visible_to_you'`; it stays required and closed, and every block that parsed before parses the same
Metadata-protocol: added

`ObjectQuerySourceSchema.scope` (`@objectstack/spec/ai`) is now a closed, required enum of two values. Both are judged by the producer per call from `ISecurityService.getReadFilter(object, ctx)` for the caller and the object the figures were read from, under the context the read ran under:

- `'visible_to_you'`: a row restriction applied, so the figures cover only the records the caller may read. The organization wall counts as one: under the `isolated` and `group` tenancy postures an organization owner reads `'visible_to_you'` on every object that carries `organization_id`.
- `'all_records'`: only when that call resolved to `undefined`, so no row restriction applied. For a caller no row rule or sharing narrows, that is the `single` posture, an object outside tenancy, a platform admin crossing the wall, or a system context.

An absent security service, an absent `getReadFilter`, a call that throws or rejects, or a call made under another context than the read's own states `'visible_to_you'`. "A restriction applied" is the fact the value states; it is not a count of rows the caller could not see. The value speaks for the block's `object` only, not for its `related` lookup paths. A block without `scope`, or with any other value, is still refused.

Before this, `scope` had one value and every answer carried it, so the console's "How this was computed" block told every caller, an organization owner on a `single` deployment included, that the figures covered only the records visible to them. The console reader already draws its access line ("Only records visible to you") for `'visible_to_you'` only, so a block whose scope is `'all_records'` now draws without that line. A reader that switches on `scope` handles the new value; a reader that ignores it needs nothing.

Nothing to migrate.
