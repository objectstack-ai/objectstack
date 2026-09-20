---
"@objectstack/plugin-security": minor
"@objectstack/plugin-audit": minor
---

The walled boot records platform-admin standing on the existing audit ledger, so «who held administrator standing, and from when» survives the move off the stored grant row (#18412).

Platform-admin standing moved from a **stored grant row** to **config-derived, request-time resolution** (#11663 re-anchor, ADR-0131). The row carried its own history; config carries none. After the migration the only trace of a grant or a revocation was a change to `OS_PLATFORM_OWNER_EMAIL` plus a restart — the product keeps no environment-variable history and an auditor cannot read one. `sys_audit_log` recorded the ACTIONS all along; what had no writer at all was the **basis** of the authority behind them.

The answer was already being computed and thrown away: `resolvePlatformAdminStanding` builds the per-entry summary at every walled boot and the bootstrap logs it at `info`.

- **`@objectstack/plugin-audit`** — `sys_audit_log.action` declares one new value, `platform_admin_standing_change`, WRITER-FIRST (the only way a value is allowed onto that enum). Its rows appear on the shipped, unfiltered `recent` and `all_events` views; ⛔ no new list view, ⛔ no new object, ⛔ no new configuration key.
- **`@objectstack/plugin-security`** — the walled bootstrap compares the resolved standing against the last snapshot already on the ledger and writes **one entry per CHANGE of standing**, plus the **first-boot baseline**. A restarted rig writes nothing. Each row carries, per declared entry, the declared spelling, whether an account exists, whether it is verified, and which user id holds standing; `old_value` and `new_value` state both sides of the delta, and `old_value` is null on the baseline row and only there.
- **The `single` posture is untouched.** It still promotes the first registrant and still writes a durable grant row, so the durability this restores is walled-posture-specific.
- ⭐ **`organization_id` is NULL on this row, deliberately and by maintainer ruling** (2026-09-18, director batch #153 item 2). The record is deployment-level by construction: ADR-0131 §1.5 rejects inventing a platform organization in its own words («it is the natural repair and the wrong one … exists only to give NULL a new name»), a tenant id would file a whole-deployment fact behind one tenant's wall, and the first-boot baseline is written before any `sys_organization` row exists at all. This follows the tree's four existing deployment-level audit writers, and is the shape ADR-0131 D7 will later make structural by dropping the column. The exception is recorded beside the write, on the card, and in a pin — ⛔ it is not a gap waiting to be repaired.
- **Nothing here widens who holds standing or what standing permits.** The derivation site is untouched; this adds a RECORD of authority, never a grant of it.
- **Best-effort, and never fatal to boot.** A deployment that never mounted the optional `@objectstack/plugin-audit` skips silently — an unmounted ledger is a composition choice, not a fault. A ledger read that is REFUSED writes nothing and says so: «cannot tell» is not «first boot», and reading it that way would file a fresh baseline on every restart. A mounted ledger whose insert fails reports a durability degradation on the `error` channel.
