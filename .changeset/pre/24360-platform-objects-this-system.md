---
'@objectstack/platform-objects': patch
---

Clause-②: no

fix(platform-objects): `sys_metadata_activation`'s description and its `package_id` field description say "authored in this system"

- **What changed.** The activation ledger's object description and the description of its `package_id` field described an item no package ships as "authored in this environment". Both now say "authored in this system". Inside the running system, user-facing copy names the system the user is in as "this system".
- **Unchanged.** The object's fields, their types and every stored value.
