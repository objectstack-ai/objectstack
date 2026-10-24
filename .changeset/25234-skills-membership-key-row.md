---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data skill's `current_user` placeholder table names a declared membership key

Clause-②: no

The security rules' table of the `current_user.*` placeholders the RLS compiler resolves listed only the kernel's keys. It now has a row for `current_user.KEY`, the set an object's `membershipKeys.KEY` declares (for `IN`), so an author reading the catalog alone learns that a declared key resolves.
