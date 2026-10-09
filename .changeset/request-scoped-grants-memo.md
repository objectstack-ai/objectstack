---
'@objectstack/core': patch
'@objectstack/plugin-auth': patch
---

perf(core,plugin-auth): an authenticated request resolves its caller's grants once, not twice

Clause-②: no

`resolveAuthzContext` learns who the caller is from the transport's `getSession`. Against `@objectstack/plugin-auth` that is better-auth's `getSession`, whose `customSession` hook resolves the principal's grants for the session payload's `positions[]` and `isPlatformAdmin`; `resolveAuthzContext` then resolved the same grants again, with the same arguments, for the request's envelope. Every authenticated request on a door that resolves identity through `resolveAuthzContext` with a better-auth session read (the runtime dispatcher and the REST server among them) paid every grant read twice: eight reads per resolution for a caller in an organization.

`resolveAuthzContext` now runs inside a request-scoped grants memo. A resolution that already completed inside the same call, with the same user, organization and seeds, is served to the next caller that asks for exactly that resolution, so the hook's resolution serves the resolver's own. The decision a request is authorised with is unchanged:

- The memo lives for one `resolveAuthzContext` call (an `AsyncLocalStorage` scope, closed when the call settles). Nothing is cached across requests; the cross-request grants cache keeps its own default-off switch, `OS_AUTHZ_GRANTS_CACHE_TTL_MS`.
- An entry is served only when a fresh read would agree with it: no write through the engine since the first resolution began (the engine's write epoch), no grant validity boundary between the two clocks, and the same organization (the session arm's dropped-claim re-resolution is its own entry). A `bypassGrantsCache` caller is never served, a failed resolution is never stored, and an engine without the write-epoch seam declines entirely.
- `plugin-auth`'s hook now passes the session's email as its seed email, exactly as `resolveAuthzContext` does for the same session, so the two calls ask for the same resolution. The seed reaches only the envelope's `email`, which the hook does not read: the payload's `positions[]` and `isPlatformAdmin` are unchanged, and platform-admin standing still compares the stored `sys_user.email`, never a seed.

A request whose session read writes (the first request on a fresh auth instance generates its signing key) reads the grants twice, as before.
