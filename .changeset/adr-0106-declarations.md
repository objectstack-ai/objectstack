---
"@objectstack/spec": minor
---

feat(spec): declare `metadata.maskObjectFields` and `getMetadataReadableFields` (#6622)

ADR-0106's metadata-plane field-level security shipped in #6612 with two members
**honoured but undeclared** — deliberately, because `packages/spec` is the spec
seat's surface and the implementing PR did not touch it. Both now have a
declared seat. This is the declaration half only: no runtime behaviour changes,
in either direction, in any deployment.

**`MetadataEndpointsConfigSchema.maskObjectFields`** — `z.boolean().default(true)`
(ADR-0106 D8). The per-server switch for masking served object schemas to the
calling user's readable fields. It was already read by `@objectstack/rest`'s
`normalizeConfig` through a cast, following the `api.enableOpenApi` /
`api.enableSearch` precedent, so a deployment that sets it has always been
honoured. What the declaration adds is that the key is now **type-safe in
`objectstack.config.ts`**, carries its documentation with it, appears in the
generated config schema and reference docs, and — the part that was a real gap —
**survives a parse**. `MetadataEndpointsConfigSchema` strips keys it does not
declare, so an author who ran their config through the schema before handing it
to the server lost the opt-out silently; that hole is closed. The default is
`true`, matching the shipped behaviour, so no deployment moves.

**`ISecurityService.getMetadataReadableFields?`** (ADR-0106 D7). The
metadata-plane sibling of `getReadableFields`: identical except that a caller
resolving to **zero** permission sets goes through the same fallback-set
resolution `/auth/me/permissions` uses instead of falling open to the full field
set — so a guest-facing deployment's schema exposure is a deliberate
permission-set decision rather than an accidental everything-default.
`@objectstack/plugin-security` has implemented it since #6612 and
`@objectstack/metadata-core` already feature-detects it, falling back to
`getReadableFields`.

The member is **optional**, following the precedent #6841 set on this same
contract: absence is a defined, handled state (a security service that predates
ADR-0106 keeps its pre-ADR behaviour), so a required declaration would assert
something the codebase deliberately declines to rely on — `packages/rest` types
the whole service as `Partial<ISecurityService>`, and this contract's own header
instructs consumers to feature-detect. Optional also prevents the mistake
structurally: the unguarded call does not compile, so a consumer cannot skip the
fallback by accident.
