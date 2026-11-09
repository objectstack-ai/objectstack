---
"@objectstack/core": patch
"@objectstack/plugin-security": patch
---

A permission-set grant (`sys_user_permission_set`) and an audience-binding suggestion (`sys_audience_binding_suggestion`) are now read by their `permission_set_package` column (ADR-0150 D8 rows R1 and R3). A set column resolves that exact (package, name) through the core security catalog; a null column keeps today's resolution rule, where a name held by two or more packages is refused, naming every candidate and the `os migrate stored-references bind` fix, and confers nothing. One write seam per table stamps the column on every write that names a set, by the same rule the boot backfill uses. The install gate is unchanged: a permission-set name is still held by one package per environment.

Clause-②: no
Metadata-protocol: none
