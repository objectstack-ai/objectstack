---
"@objectstack/core": minor
"@objectstack/rest": patch
"@objectstack/service-datasource": patch
"@objectstack/service-settings": patch
"@objectstack/service-storage": patch
"@objectstack/plugin-sharing": patch
"@objectstack/cloud-connection": patch
---

fix(core,rest,services)!: a permission-store read failure now fails LOUD instead of resolving as an authenticated caller holding zero capabilities (#13279)

**BREAKING** runtime behaviour change on the shared authorization resolver,
shipped as `minor` under the repo's launch-window convention.

`resolveAuthzContext`'s per-read helper `tryFind` answered a THROWN read exactly
the way it answered an EMPTY one: `[]`. So an outage of the permission store
resolved as a well-formed context for an authenticated principal holding no
capabilities, and the package-management door answered
`403 FORBIDDEN` — "Reading packages requires the `studio.access` or
`setup.access` capability." That answer was measured byte-identical
(`JSON.stringify` equal, against a control that separates two answers which do
differ) to what a caller who genuinely holds nothing receives. An administrator
was told they lack a capability, during an outage of the store that holds the
capability.

Maintainer ruling 2026-08-30, verbatim 「第一批其余同意」: `tryFind` 区分「无行」
与「读失败」,读失败 fail-loud —— 权限库不可达时不再解析为「已认证零能力」,而是
响亮拒绝(与真实能力拒绝的 403 可区分)。

**What changed.** A permission-store read that is issued and throws now raises
`AuthzStoreUnavailableError`, which carries the EXISTING ADR-0112 wire code
`SERVICE_UNAVAILABLE` and status `503`. No code is added to the closed wire
vocabulary and no response envelope gains or loses a key — only which declared
code an outage selects. Doors that map thrown errors through
`resolveThrownHttpError` answer 503 with no per-door change.

**What did NOT change**, and is pinned:

- A reachable, genuinely EMPTY store (reads return no rows) still resolves to
  zero capabilities.
- A genuine capability denial still answers `403 FORBIDDEN` with its message.
- An ABSENT engine (`ql` unwired, so no read is ever issued) still resolves to
  an empty-but-valid envelope.
- Anonymous requests never reach the store, so an outage cannot make them loud.

⛔ **NOT YET TRUE, and this is why the PR is blocked.** An earlier revision of
this changeset claimed "embedders without a data plane are unaffected". That
claim was too broad and is retracted. The pinned cases above cover an *unwired*
engine and an *empty* one; they do NOT cover the far commoner unprovisioned
shape — a REAL engine whose `sys_*` tables were never created, where `find` is
issued and THROWS `no such table`. That is currently treated as an outage, and
it must not be: with no permission tables provisioned, "zero capabilities" is
the TRUE answer, not a fabrication. Only an UNREACHABLE store — the ruling's own
word — leaves the capability set unknown.

Measured cost of the conflation, all from `no such table` on `sys_user`,
`sys_member`, `sys_user_position`, `sys_user_permission_set`: ordinary CRUD in
`@objectstack/client` answers `503`, batch validation errors that owe `400`
answer `503` because authorization refuses before validation runs, and two
`.integration.test.ts` noise guards report that the driver and engine
diagnostics for `sys_position` stopped being emitted — the eager throw aborts
the resolution before that later read is ever issued, so a change made to stop a
failed read being silent made two other channels silent.

The classifier that draws the boundary correctly already exists and is exactly
right — `isMissingTableError(error, readObject)`, driver-code based rather than
prose-sniffing, documented so that "cannot say" never means "be loud" — but it
lives in `@objectstack/metadata`, which DEPENDS ON `@objectstack/core`, so the
resolver cannot import it; and the SQL driver's `backendStatementFaultError`
deliberately withholds the distinction from the thrown error. Resolving that is
a maintainer decision, not an implementation detail.

**All-transport, not just REST.** Every transport authorizing through
`resolveAuthzContext` inherits this. Six of the eight production transports
wrapped the call in a fail-closed `catch` that would have re-silenced the
outage — measured, not assumed: with the resolver loud but the nets untouched,
the package door answered `401`, i.e. the outage merely changed disguises. Those
`catch` blocks now re-raise via `isAuthzStoreUnavailableError` and keep their
previous behaviour for every other fault. The transport set is rebuilt from
source and audited for set equality on every test run, so a transport added
later cannot inherit the old silence unnoticed.

Callers that treat any throw from `resolveAuthzContext` as "anonymous" should
re-raise `isAuthzStoreUnavailableError(err)` instead: degrading it restores the
disguise this removes.

<!-- adr-0087: not-required (runtime-interface-only packages/core/src/security/resolve-authz-context.ts#ResolvedAuthzContext, packages/core/src/security/authz-store-unavailable.ts#AuthzStoreUnavailableError) The breaking surface is runtime TypeScript in `@objectstack/core`'s security module and nothing else: `resolveAuthzContext` stops always-resolving and raises `AuthzStoreUnavailableError` when a permission-store read is issued and throws. NO metadata surface is touched in either direction. No Zod schema changes, no `packages/spec` declaration is added or removed, no authorable key moves, no stored row shape changes, and no object definition is edited — a customer's metadata app is byte-for-byte unaffected, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The wire vocabulary is likewise untouched: `SERVICE_UNAVAILABLE` is an EXISTING `StandardErrorCode` member that `HttpStatusErrorCodeMap` already maps to 503, so this change only selects a different DECLARED code for an outage rather than adding one. Both named symbols resolve at HEAD as exported declarations whose files are not `*.zod.ts`, are not under `packages/spec/src/contracts/`, are not object definitions and are not `z.input` projections; neither is referenced in code by any metadata surface (the `packages/spec` hits for `resolveAuthzContext` are comment prose describing the envelope, which this gate masks). The channel that reaches an affected consumer is therefore code review and this changeset, never the upgrade guide: a ledger entry could not express "your fail-closed catch should re-raise this error", because there is no metadata for a migration to rewrite. -->
