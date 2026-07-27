---
"@objectstack/plugin-security": patch
"@objectstack/plugin-auth": patch
---

fix(security): resolve the ISSUER's real grants when authorizing invitation
placement (ADR-0105 D8)

Scoped-invitation issuance dry-runs `DelegatedAdminGate` against the
`sys_user_position` rows the acceptance would write. The gate reads authority
off `context.positions` / `context.permissions` — but the invitation hook
handed it a hand-built `{ userId, tenantId }`, which carries neither. Every
delegated administrator therefore resolved to the additive baseline alone and
was refused:

> requires tenant-level administration or a delegated adminScope (ADR-0090 D12)

Fail-closed, but dead: only a tenant admin could ever issue a placement, which
is the one case the feature was not for. Caught by cloud's group-posture
dogfood, which exercises the real HTTP path with a real delegate.

`assertIssuable` now takes `actorUserId` instead of a caller-built
`actorContext` and resolves that user's grants itself through the single authz
resolver (`@objectstack/core` `resolveUserAuthzGrants`) — the same envelope a
transport would have carried, from the same reads. There is no request to
resolve a context from inside a better-auth hook, so the id is what the caller
can honestly supply and the resolution belongs behind the boundary.

A principal-less call still reaches the gate with an empty context on purpose:
the gate owns that refusal too, so the security boundary keeps exactly one
place an issuance can be denied.
