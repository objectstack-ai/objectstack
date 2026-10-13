---
'@objectstack/plugin-auth': patch
---

A first boot no longer logs a refused `sys_migration` insert, and the owner-bind ledger row records the outcome that happened

Clause-②: no

On every first boot (`os serve` and `os dev`, on `:memory:`, file SQLite and PostgreSQL), *Boot diagnostics* showed `WARN Insert operation failed {"object":"sys_migration", … UNIQUE constraint failed: sys_migration.id}` with a full stack. The one-time default-organization owner bind (`createEnsureDefaultOrganizationOnce`, ADR-0093 D7) re-entered itself: the owner write makes the security plugin grant `organization_admin`, that grant insert is a bootstrap trigger, and the inner call recorded the decision first. It recorded `admin-already-member` with no organization. The outer call's accurate record (`promoted` or `bound`, with the organization id) was then refused. Nothing was bound twice. The ledger row named the wrong outcome.

The gate now marks the decision in flight before its first `await`. A call that finds it in flight still creates a missing Default Organization, but binds nobody and records nothing. The deciding call records its own outcome once. A call that did not act (no platform admin yet, or a refused write) clears the mark, so the next trigger still decides.

- **Nothing you author changes.** No key, export or option is added or removed. The walled `@objectstack/organizations` wiring calls the same gate and gets the same rule.
- **A real ledger write failure is still reported.** Only the gate's own second write is gone; a refused `sys_migration` insert for any other reason still logs at `error`, with the remedy.
- **Rows already written are not rewritten.** A deployment whose first boot recorded `admin-already-member` keeps that row; nothing reads its `details`.
