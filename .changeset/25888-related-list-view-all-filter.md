---
'@object-ui/react': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

fix(app-shell): a related list's "View all" opens the rows the list showed, its own `filter` included, or is not offered

Clause-②: yes (an optional member on the exported `ResolveRelatedRecordActionsInput` of `@object-ui/react` widens its public type surface, additive; the seat owes a TIER_DEFAULT review record before the queue; re-declared if the PR changes no exported type)
Metadata-protocol: none

- **The defect.** A `record:related_list` "View all" link opened the child object's list scoped by the list's relationship alone and dropped the list's own `filter`. The full list was wider than the tab, and on `sys_approval_request` it was empty: the request read gate admits a record reader only on a read that pins both `object_name` and `record_id`, so a reader who saw the requests on a record's Approvals list saw none on "View all".
- **The fix.** The destination now carries every condition of the list's `filter`, resolved the way the list resolved it for its own query (`{current_user_id}`, `{record_id}` and the date macros), ANDed with the relationship. When the list route has no spelling for a condition (an `or`, a set or text operator, a boolean comparand), or a condition names a field the viewer cannot read, no link is drawn: the route would drop that condition and open a wider list.
- **The type.** `ResolveRelatedRecordActionsInput` gains an optional `filter`, the list's own resolved scope filter. A host implementing `resolve` reads it to scope any destination it builds for the list's rows; a host that ignores it keeps compiling.

What to do: nothing. A related list without a `filter` opens the same destination as before.
