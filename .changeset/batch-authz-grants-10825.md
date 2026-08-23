---
'@objectstack/core': patch
---

`resolveUserAuthzGrants` issues its five independent reads (sys_user, both sys_member reads, sys_user_position, sys_user_permission_set) concurrently (#10825) — 8 sequential round trips become 4 waves on the fullest path (2 on the lightest), with byte-identical rows, filters, limits and tenancy scoping, pinned by a differential golden suite captured from the sequential implementation. No caching; nothing survives a request; authorization semantics unchanged by construction.
