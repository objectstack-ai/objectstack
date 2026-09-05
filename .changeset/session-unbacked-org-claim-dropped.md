---
'@objectstack/core': patch
---

A session whose active organization is no longer one the user belongs to now resolves with no active organization instead of that one's data.

Under a wall-enforcing tenancy posture (`isolated` / `group`), `resolveAuthzContext` took a browser session's stored `activeOrganizationId` as the request tenant without ever comparing it to the user's current memberships — the framework's only such comparison was gated on an API-key principal. A session whose owner had been removed from an organization therefore kept reading that organization's rows and writing into it until the session expired on its own (7 days by default), including when the removal went through the product's own offboarding path.

That claim is now vetted: if it is not in the caller's `accessible_org_ids`, it is dropped and the context resolves with no active organization at all, which the tenant wall already fails closed on (reads resolve to nothing; a tenant-scoped write is refused by ADR-0123 D2). The principal is **not** refused — a session is a person who may hold memberships elsewhere, so they stay signed in and can switch to an organization they are actually in. The API-key arm is unchanged: a key is its organization binding and is still refused outright. The wire is unchanged; the drop is reported to the operator as a single server-side `warn`.
