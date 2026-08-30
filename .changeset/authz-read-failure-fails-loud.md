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

- A reachable, genuinely EMPTY store still resolves to zero capabilities.
- A genuine capability denial still answers `403 FORBIDDEN` with its message.
- An ABSENT engine (`ql` unwired) still resolves to an empty-but-valid envelope
  — "no engine" is not a failed read, and embedders without a data plane are
  unaffected.
- Anonymous requests never reach the store, so an outage cannot make them loud.

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
