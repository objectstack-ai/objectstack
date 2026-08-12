---
"@objectstack/rest": patch
---

fix(rest): a bearer-authenticated metadata write is attributed to the caller, not to `system` (#7749)

An admin's ordinary `PUT /api/v1/meta/<type>/<name>` was attributed to nobody:
the `sys_metadata_audit` row recorded the sentinel `actor: 'system'` and the
`sys_metadata_history` row recorded `recorded_by: NULL`. The real identity
appeared only if the caller hand-set a non-standard `X-Actor` header — so the
audit trail could not answer "who changed this" for any normal console or API
client.

The cause was a fallback chain with no producer. Five `/meta` write sites
(save, delete, publish, rollback, compound save) each resolved the actor as
`req.headers['x-actor'] ?? req.headers['X-Actor'] ?? req.user?.id ?? req.userId`,
and **nothing on this transport ever sets `req.user` or `req.userId`** — REST
resolves identity through `resolveExecCtx` (better-auth → `resolveAuthzContext`),
which puts it on the returned ExecutionContext, never back onto the raw request.
The token was validated; its identity simply never reached the handlers.

The two dead limbs are replaced — not widened with a third — by a single shared
producer, `resolveMetaWriteActor`, which reads the SAME identity resolution the
route's own `manage_metadata` capability gate reads a few lines earlier. The
caller a write is attributed to can no longer drift from the caller it was
authorized against, and all five sites share one rule rather than five copies.

Unchanged, deliberately: `X-Actor` still outranks the authenticated identity,
exactly as the original expression read — that precedence is a security-semantics
question for the audit contract, tracked on the issue, not something to settle as
a side effect of fixing the producer. Also unchanged: anonymous and internal
system writes resolve no principal, so they still record `'system'` / `NULL`. A
machine write is never stamped with a real user.
