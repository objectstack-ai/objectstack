---
'@objectstack/plugin-approvals': patch
---

Every `sys_user` lookup the approvals plugin writes now holds a user id or nothing: the SLA and dead-run sweeps record no actor instead of a `system:` placeholder, notifications name only the person who acted, and `reassign_from` / `reassign_to` become slot-address text columns; stored placeholders are cleared at the next boot

Clause-②: no

Under ADR-0118 D1 a lookup to `sys_user` holds a user id or null, never a placeholder value. Four writers broke that, and a lookup holding a non-id drops the row from every join and report on it, silently.

**This supersedes the "The SLA sweep keeps its reserved `system:sla` actor for now" sentence of the unreleased `21411-approval-actor-person` changeset.** Both ship in one release; from it, the sweep records no actor.

- **Machine actors record no actor.**
  - The SLA sweep's `escalate` row, and the `approve` / `reject` an `auto_approve` / `auto_reject` escalation then records, have `actor_id` empty. Before, both held `system:sla`. The `escalate` row's comment still names the configured action.
  - The dead-run sweep's `recall` row has `actor_id` empty. Before, it held `system:dead-run`. Its comment still names the dead run and its status, and a submitter's own recall still records the submitter.
- **Notifications name only a person.** The actor the plugin hands to `sys_notification.actor_id` (and so to each `sys_inbox_message.actor_id`) is the user the action's context vouches for, or nothing.
  - Before, a reassign, reminder, request for information, comment or send-back taken under a named position or email forwarded that address as the actor.
  - Before, every SLA notification forwarded `system:sla`. It now forwards no actor, as the out-of-office notifications already did.
- **`reassign_from` / `reassign_to` are slot addresses.** A reassignment moves a pending-approver slot, so both columns hold the slot's address in its stored spelling: a user id, an email, or `position:<name>`. They are now text columns (max 255 characters, like `acted_as`) instead of `sys_user` lookups, which matches what they already stored.
  - Existing values need no rewrite, and an existing database keeps its columns as they are. On SQLite and PostgreSQL 16, booting the new declaration over a table created by the old one issues no DDL, keeps every stored value, and reports no schema drift for either column. A new database creates them as `text`, as it does `acted_as`.
  - The action log still resolves `reassign_from_name` / `reassign_to_name` where an address names an account: a user id, or an email an account carries. A position address has no name.
- **Stored rows.** The boot-time repair that moves slot literals out of `actor_id` now also clears `system:sla` and `system:dead-run` from it, in the same pass and in the same idempotent way. A cleared sentinel gets no `acted_as`, because a sweep takes no slot. The boot log line reports the count as `sentinelsCleared`.
- **For a report or integration that read these values:**
  - To find the SLA sweep's actions, read the `escalate` rows, and the decision that directly follows an `escalate` row whose comment names `auto_approve` or `auto_reject`. Do not test `actor_id` for `system:sla`.
  - To find a dead-run release, read the `recall` row whose comment names the run. Do not test `actor_id` for `system:dead-run`.
  - Read `reassign_from` / `reassign_to` as slot addresses. Do not expand them as `sys_user` references.
