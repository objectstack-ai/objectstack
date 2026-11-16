---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit)!: `sys_audit_log` records a SCIM user write whose Enterprise `manager` reference names no user, as one bounded `scim_manager_unresolved` row

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) This package adds one ledger action and its writer: no key of any authorable schema is added, removed, renamed or re-shaped and no stored row changes shape, so there is nothing for `objectstack migrate meta` to rewrite. The narrowing the PR declares is plugin-auth's SCIM answer, described in that package's note. -->

**BREAKING** in the SCIM behaviour this row belongs to, not in this package: plugin-auth now refuses with SCIM `400 invalidValue` a manager link the admin endpoint would refuse (self, cycle, depth cap, cross-organization); plugin-auth's note has the details. Nothing this package already wrote or read changes.

**The new row.** `sys_audit_log.action` gains `scim_manager_unresolved` (label "SCIM Manager Unresolved"), written by the SCIM writer on the `audit` slot (`recordScimManagerUnresolved`, beside `recordScimRefusal`, through the same insert). plugin-auth hands it one event when a SCIM user write it served named an Enterprise User `manager` whose reference resolves to no user that connection provisioned: the write is saved, `manager_id` is left as it was, and the event is recorded with one operator warning and this row.

- **Bounded rate.** The row and the warning share one admission: one per SCIM connection per 10-minute window. The next row carries the number held back in between as `metadata.suppressed`.
- **Bounded content.** `actor` is the connection's service principal (`svc:scim:CONNECTION_ID`), `object_name` / `record_id` the `sys_user` the write was about, `tenant_id` the connection's organization, and `metadata` holds `scim_connection_id`, `reference_kind` (`id` or `unreadable`) and `manager_reference`, the reference as the directory sent it, cut to 256 characters (`manager_reference_truncated: true` when it was longer). Nothing else from the request or the user is recorded.
- **Only served writes.** A refused request writes no such row (its `scim_refused` row is unchanged), and the row is written after the response, outside the SCIM transaction.

Find them in the Audit Log under the "SCIM Manager Unresolved" action, or on the user's own audit history.
