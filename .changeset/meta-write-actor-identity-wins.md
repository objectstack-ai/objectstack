---
'@objectstack/rest': minor
---

**Audit attribution change — the recorded actor on `/meta` writes is now the authenticated identity, and `X-Actor` is ignored.** All five `/meta` write sites (save, delete/reset, publish, rollback, compound save) stamp `sys_metadata_audit.actor` and `sys_metadata_history.recorded_by` with the identity the request was actually authorized as. A request that sends `X-Actor` is recorded against its own authenticated caller, not the header's value. Maintainer ruling 2026-08-12 on #7941, re-confirmed 2026-08-15.

Why: the header used to outrank the authenticated identity. That ordering was inert for as long as the other limb produced nothing — `req.user` / `req.userId` are never set on this transport — so nothing depended on it. Fixing that producer (#7749) made the precedence load-bearing for the first time, and what it then meant was that any caller already holding `manage_metadata` could sign somebody else's name to a metadata write: the compliance trail answered "who *claimed* to change this" rather than "who changed this", which is the question #7749 was filed to make answerable. Attribution now cannot drift from authorization, because both read the same `resolveExecCtx` the route's own capability gate reads.

The header limb is **removed rather than reordered**. The ruling permitted keeping it for genuine machine/system callers with no authenticated user, but only if a consumer census showed that shape exists — it does not, so a caller cannot choose the recorded name in any shape, including on the machine-write path where there is no identity for the header to lose to.

Deliberately unchanged:

- **Real impersonation still attributes correctly.** The platform's impersonation is session-level (better-auth admin plugin, `sys_session.impersonated_by`), so `resolveExecCtx` already resolves to the impersonated user and their metadata writes are recorded against them. Nothing in that path went through `X-Actor`.
- **Machine and anonymous writes.** No resolved principal still means no actor, so the protocol's own `'system'` / `NULL` defaults apply exactly as before — a machine write is never stamped with a real user.
- **Sending `X-Actor` is not an error.** It is ignored, not rejected; no request that succeeds today starts failing.

Who is affected: any caller that relied on `X-Actor` to attribute a `/meta` write to somebody other than itself. The census over `objectstack` and `objectui` found no such caller — `objectui`'s `MetadataClient` can send the header through an optional `options.actor`, but nothing in that repo ever passes one, leaving that option inert against this server.
