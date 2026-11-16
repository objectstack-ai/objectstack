---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The published query and hook skill examples now filter on the platform's `owner_id` column with `{current_user_id}`, and the hook `find` example reads the caller's id from `ctx.session?.userId` instead of an unbound variable.
