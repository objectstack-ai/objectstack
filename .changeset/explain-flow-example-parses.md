---
'@objectstack/cli': patch
---

Fix `os explain flow`, whose example taught a flow shape the spec rejects and an assignment value nothing resolves.

`os explain` is an authoring aid whose whole audience is authors — increasingly AI authors — writing their first flow, and its catalog is hand-maintained rather than derived from `FlowSchema`. The flow entry had drifted until the sample it printed could not be pasted into a working app:

- `steps` and `trigger` are strict-object **aliases** on `FlowSchema` (for `nodes` and `type`), so authoring either is a loud parse error rather than a working flow. A record-change flow binds its object on the START node's `config` (`{ objectName, triggerType }`), not at the flow top level.
- A node's per-type data lives under `config`, so the sample's top-level `field`/`value` pair were undeclared keys on a `.strict()` node schema, and the required `id` / `label` were absent. `edges` is required, and the sample declared no graph at all.
- The value `'$currentUser'` was a `$`-prefixed sentinel no resolver in the platform recognises. Flow values interpolate with **single braces**, and the acting user is `{$User.Id}` — the filter surface's `{current_user_id}` is a different dialect that does not carry over, because assignment and `fields` values go through `interpolate`, not `interpolateFilter`.
- An `assignment` node sets a flow **variable**, not a record field, so "auto-assign on create" is an `update_record` node. The old sample would not have written `assigned_to` even with a resolving token.

The entry's field list now matches `FlowSchema` (`nodes` / `edges` / the full five-value `type` enum / `status` / `runAs`), and the example is pinned by a test that parses it against `FlowSchema` — the one guard that cannot drift alongside the catalog it checks.
