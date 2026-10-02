---
"@objectstack/plugin-sharing": patch
"@objectstack/spec": patch
---

A plain member's share-link list now answers: `GET /api/v1/share-links` is self-scoped for every signed-in caller, as ADR-0111 rules it

Clause-②: no

`ShareLinkService.listLinks` read `sys_share_link` under the caller's context. Both share-link doors force the list's `createdBy` to the caller, but the read still needed an object-level grant on `sys_share_link`, and the platform's member baseline does not grant one. So every plain member's list was refused, with or without an object filter, and the Share dialog, which loads this list when it opens, showed an error for them on every record. An admin's list answered.

- The caller's own list is now read under the system context. This happens only when the caller has a non-empty user identity and the creator filter equals it. The read is constrained server-side to that identity, and each row it returns must pass the creator rule before it leaves.
- One creator rule now serves both `listLinks` and `revokeLink`. It never matches a caller with no user identity. Neither HTTP door reaches that case, because both answer 401 first, so for an internal caller with no user identity, `revokeLink` now refuses a link whose `created_by` is absent or empty instead of treating it as theirs.
- Every other list shape keeps the caller's context, as before: no creator filter, another user as creator, no user identity, or an admin listing someone else's links. A system caller keeps its bypass.
- The rows carry the same columns as before. The token comes back so the console can build the link URL, and the password hash never does.
- `@objectstack/spec`: the `IShareLinkService.listLinks` doc comment now describes the self-scoped own list. It previously said every listing is read under `context`. This is a doc comment only, with no type or export change.
- ⛔ No permission set changes, and no new grant on `sys_share_link`.
