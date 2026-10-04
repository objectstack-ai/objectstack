---
'@objectstack/plugin-security': patch
---

fix(plugin-security): a permission set the environment cloned no longer logs `permission_set_declaration_unowned` on every boot (#21669)

Clause-②: no

The declared-permission seeding pass walks every `permission` item in the engine registry. That registry also holds the permission sets an environment authored itself, which boot hydration loads from their `sys_metadata` rows. A set made with Setup's **Clone** action is one of them, and it carries no package id because it has none. The pass judged "no owning package" before it looked at the set's row, so on every boot, and on every `metadata:reloaded`, it logged one warning per cloned set: `[permission_set_declaration_unowned] declared permission set "…" has no owning package — not materialized … the Setup admin surface reads sys_permission_set and cannot see this set`. That is false for a clone. Its row exists (`managed_by: admin`), and Setup lists it and edits it.

The pass now checks the row first. A registry item with no package id whose `sys_permission_set` row the environment owns (`managed_by` other than `package`) is the environment's own set. It is counted as `skippedEnvAuthored`, the count a package declaration over an environment row already gets, and no warning is logged. The pass reads that row from the existence read it already makes, so no query is added. On a per-organization pass, the environment door's organization-less row counts too.

Unchanged: a declaration with no owning package and no environment row still logs `permission_set_declaration_unowned`, with the same text, and still counts as `skippedUnowned`. If the row could not be read, the warning still fires, because an unreadable row does not prove the environment owns the set. The publish-time materializer is unchanged. Nothing is written or granted differently: only the false warning stops, and the clone moves from the `skippedUnowned` count to the `skippedEnvAuthored` count in the pass's summary line.
