---
'@objectstack/plugin-security': patch
'@objectstack/plugin-sharing': patch
---

feat(plugin-security, plugin-sharing): security and sharing stored references gain a package column, backfilled at boot from the one package that holds the name (ADR-0150 D8 R1, R3, R5, R6, R13)

Clause-②: no
Metadata-protocol: none

Five stored references that name a declared item by its bare name now carry, beside the name, the package that holds it: `sys_user_permission_set.permission_set_package` (R1), `sys_audience_binding_suggestion.permission_set_package` (R3), `sys_sharing_rule.package_id` on package- and platform-managed rows (R5), `sys_queue_member.queue_package` (R6) and `sys_assignment_cursor.rule_package` (R13). Each is nullable, read-only to users, and filled in by the platform.

At every boot, once the registry has sealed its holders, each table's rows that name no package are walked and asked the one ADR-0150 D3 rule with no caller package. A name exactly one package holds is bound to that package. A name two or more packages hold is left null and logged as a warning naming every candidate; it is never bound to the first. A name that only the environment or the platform holds, or that nothing holds, is left null and reported. A row that already names a package is never read again, so a second boot writes nothing and reports the same names. Suggestion rows whose permission set comes from another package than the one that suggested it are logged too.

Nothing reads the new columns yet: who may hold what, which rule shares what, and who a queue routes to answer exactly as before, and no unique key changes. Writers do not stamp the columns yet either; each reader's own card moves its reader and writer together. If the boot pass fails, it logs a warning, leaves its rows as they are and is tried again at the next boot. Rolling back drops nothing a reader needs.
