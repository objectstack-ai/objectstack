---
'@objectstack/runtime': patch
---

fix(runtime): the dispatcher's `/packages` doors scope a caller to the organization the identity step vetted, not the session's stored claim (#20477)

Clause-②: no

The runtime dispatcher's nine organization-scoped `/packages` doors took the caller's organization from the auth session's `activeOrganizationId` as stored. Under a wall-enforcing tenancy posture (`isolated` or `group`), the identity step drops that claim when no membership backs it any more, and the request resolves with no active organization (the maintainer's ruling B on #15409). The doors never saw the drop. So a member removed from an organization kept that organization's packages for the rest of the session: its commit history and whole-package export were served to them, and their publish-drafts, discard-drafts, commit revert, rollback, adopt-orphans, duplicate and uninstall ran inside it.

The doors now read the vetted organization on the request's execution context, the value `RestServer` scopes by and the dispatcher's `/meta` doors already read. The fix is in the one source the nine doors share (`HttpDispatcher`'s `resolveActiveOrganizationId`), so every door changes together, on both HTTP entries (the `createHonoApp` catch-all and the dispatcher plugin's explicit package routes).

- **A removed member whose session still names the organization they left:** every door is handed no organization. Reads and writes reach only the env-wide package state, as for any session with no active organization. An uninstall is refused `400 TENANT_SCOPE_REQUIRED` and deletes nothing. The left organization's rows are neither read nor written.
- **A caller authenticated by an API key:** the doors now use the organization the key is bound to. The session read found no session for a key, so these doors used to get no organization for it.
- **Unchanged:** a current member reaches their own organization exactly as before, a member who switched to an organization they belong to reaches that one, and an anonymous caller is refused `401` before any package operation. Single-posture deployments are unchanged, because no claim is dropped there.
