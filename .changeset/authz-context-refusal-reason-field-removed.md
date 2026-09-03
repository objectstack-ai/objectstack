---
"@objectstack/core": minor
---

feat(core)!: remove the never-read `authRefusal` member from `ResolvedAuthzContext` — a refused API key resolves to the anonymous envelope and nothing else (#14273)

**BREAKING** published-type narrowing on `@objectstack/core`, shipped as
`minor` under the repo's launch-window convention for breaking changes.

`resolveAuthzContext` used to stamp a refused API key onto the envelope it
returned, as `ctx.authRefusal = { reason, message }`: `organization_required`
when the key carries no organization under a walled tenancy posture (the
admission refusal), `organization_membership_ended` when the key's owner no
longer holds a valid membership in the key's organization (the post-grants
refusal). The member had been declared on the exported `ResolvedAuthzContext`
interface since #8287 and shipped in the package's emitted `dist/index.d.ts`.

It was measured at **zero readers on every transport**. All eight non-test
consumers of the resolver — the REST server, runtime execution-context
resolution, the MCP plugin, plugin-sharing, the service-datasource admin
routes, service-settings, service-storage and cloud-connection — answer a
refused key from `userId` alone: a refused principal has none, so every door
already takes its anonymous path and answers the generic `401 UNAUTHENTICATED`.
The reason was authored, stored on the context and dropped before every wire.
Under ADR-0049 enforce-or-remove that is a declared-but-unread surface, and the
maintainer ruled it removed (2026-09-02, re-affirmed 2026-09-03 with the
carriers a published-type narrowing is owed; verbatim 「同意」).

**What changed.** `ResolvedAuthzContext` no longer declares `authRefusal`, and
neither refusal path writes it. A refused key now resolves to an envelope that
is deep-equal to an anonymous request's: the five empty grant arrays, no
`userId`, no `tenantId`.

**What did NOT change**, pinned on behaviour rather than through the removed
member: the refusals themselves keep firing and keep failing closed. An
org-less key under `isolated` or `group` is still refused at admission and
still does NOT fall through to the session path; an ex-member's key is still
refused after grants, on today's membership set, at zero extra queries; under
`single` no membership wall applies. `ApiKeyRefusalReason` and the
`ApiKeyAdmission.refused` member that carries it are unchanged — that is the
verifier's own verdict (`resolveApiKeyAdmission`) and it stays. No transport
changed; every wire answer is byte-identical to before.

**Migration.** Nothing in this repository read the member, so nothing here
migrates. An out-of-repo TypeScript consumer that read `ctx.authRefusal` fails
at compile time (`Property 'authRefusal' does not exist on type
'ResolvedAuthzContext'`); the fail-closed signal it was reading is
`ctx.userId === undefined`, which was already the only thing every transport
acted on. Disclosing WHY a key was refused is a security-boundary decision the
maintainer explicitly did not take (it would tell a caller probing with a
stolen key that the key was once valid); if an operator-facing reason outlet is
ever wanted, the recorded direction is an audit-only write point on the server
side, never a member on this envelope.

<!-- adr-0087: not-required (runtime-interface-only packages/core/src/security/resolve-authz-context.ts#ResolvedAuthzContext) The narrowed surface is a runtime TypeScript interface in `@objectstack/core`'s security module: `ResolvedAuthzContext` lost its optional `authRefusal` member. No Zod schema changes, no `packages/spec` declaration is added or removed, no authorable key moves, no stored row shape changes and no object definition is edited — a customer's metadata app is byte-for-byte unaffected, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The wire is untouched: every transport already answered a refused key with the anonymous `401 UNAUTHENTICATED` computed from `userId` alone, so no error code and no envelope key changes. The channel that reaches an affected consumer is the compiler (TS2339 at the read site) and this changeset; a ledger entry could not rewrite a TypeScript read of a member that was never metadata. -->
