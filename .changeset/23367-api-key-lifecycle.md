---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/runtime': minor
'@objectstack/rest': minor
'@objectstack/mcp': minor
'@objectstack/plugin-auth': minor
'@objectstack/plugin-sharing': minor
'@objectstack/service-settings': minor
'@objectstack/service-storage': minor
'@objectstack/service-datasource': minor
'@objectstack/cloud-connection': minor
'@objectstack/platform-objects': minor
---

feat(spec,core,runtime,plugin-auth)!: API keys get a lifecycle: a 90-day default expiry, a one-year ceiling, a 90-day inactivity expiry, a one-year grace for keys created with none, and distinct refusal codes

Clause-②: yes (narrowing) — the published contract widens (four `auth` settings keys, the `IAuthService.resolveApiKeyLifecyclePolicy` member and its `ApiKeyLifecyclePolicy` type, four registered error codes, new `@objectstack/core` exports) and the API-key doors narrow (a signing past the ceiling is refused; an inactive key, a key past its grace, and a revoked or expired key sent beside a session are refused where they were served).

<!-- adr-0087: not-required (no-migration-prescription) An authentication-policy change at the API-key signing door and the shared key-admission seam, not a metadata change. No authorable spec key, stored shape or metadata surface is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite: the four new `auth` settings keys are additive and defaulted, `sys_api_key` gains no column (its existing `expires_at` and `last_used_at` are written by the platform), and `ResolveAuthzInput.apiKeyLifecycle` / the sixth parameter of `resolveApiKeyAdmission` and `resolveApiKeyPrincipal` are server-side wiring no author writes. What narrows is which API keys are served and which signings are accepted; the remedy is a new key or a nearer date, never a rewrite of a package source or a stored row. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing at the API-key doors), shipped as `minor` under the launch-window convention for breaking changes.

Ruling A on #23367: the key store stays `sys_api_key`, and the policy is auth configuration.

- **The policy (`@objectstack/plugin-auth`, `IAuthService.resolveApiKeyLifecyclePolicy`).** Three `auth` settings keys, bound by `bindAuthSettings`: `api_key_default_expiry_days` (90), `api_key_max_expiry_days` (365) and `api_key_inactivity_days` (90; `0` turns it off). A fourth, `api_key_policy_started_at`, is recorded once — on the first boot that runs the policy, at `kernel:bootstrapped` — and anchors the two clocks below; it survives restarts and is never overwritten by the platform.
- **The signing door (`POST /api/v1/keys`).** A signing that names no `expires_at` gets the default life and the response echoes it. An `expires_at` further away than the ceiling is refused `400 API_KEY_EXPIRY_TOO_LONG`, naming the latest date allowed; exactly the ceiling is accepted. A kernel with no auth service signs as before.
- **The key-admission seam (`resolveApiKeyAdmission`, `@objectstack/core`).** A real key its own state refuses is a new outcome, `lifecycle`, with one of three distinct codes: `API_KEY_REVOKED`, `API_KEY_EXPIRED` (past `expires_at`, or past the grace of a key created with none) or `API_KEY_INACTIVE` (no recorded use for longer than the window). `resolveAuthzContext` raises it as the branded `ApiKeyLifecycleRefusalError` (`403`, a located message naming the key's prefix, the date and the remedy). An unknown key is still `none`.
- **`last_used_at` is written.** Its description promised "Automatically updated on each API call", and nothing wrote it. The seam now stamps it on an admitted (or held) call, at most once an hour per key, and the inactivity judgment reads the value as it was BEFORE that call's stamp, so a key's own use cannot revive it. A stamp that fails never fails the request; it is said once, at `error`.
- **Keys created before the policy.** A key with no expiry gets one year from `api_key_policy_started_at`; the date is stamped onto its `expires_at` the first time it is admitted, so the keys page shows it, and the refusal after it names it. A key with no recorded use counts its inactivity from the same anchor (or from its own creation, when later) — never from an earlier `created_at`, since no use was ever recorded before the policy.
- **Every face that admits keys** passes the policy source (`apiKeyLifecyclePolicySourceOf(authService)`, a required input beside `userAuthGates`). Every one of them answers the refusal's `403` and code: the runtime dispatcher (the MCP HTTP endpoint among its routes), the REST data API, the settings routes, the storage download routes, the datasource admin routes, the share-link routes, the marketplace install-local routes and the MCP stdio transport. Each relays the refusal by its brand, so every other identity fault at those doors keeps its existing answer.
- **`OS_CLOUD_API_KEY` is untouched.** It is the runtime's outbound credential to the control plane, never admitted by this seam.

What changes for you:

- **A key created without an expiry now expires.** It used to live until revoked; it now lives 90 days (or the configured default). Pass `expires_at` to choose, and create a new key before it ends.
- **A signing asking for more than a year is refused** `400 API_KEY_EXPIRY_TOO_LONG`, where it used to be accepted. Ask for the date the message names, or an earlier one.
- **A key unused for 90 days is refused** `403 API_KEY_INACTIVE`, where it used to be served. It is not revoked; the remedy is a new key.
- **A key that already existed with no expiry keeps working for one year** from the date the policy took effect on your deployment (`auth.api_key_policy_started_at`), then answers `403 API_KEY_EXPIRED` naming that date. Replace such keys within the year.
- **A revoked or expired key answers its own code** (`403 API_KEY_REVOKED` / `API_KEY_EXPIRED`) on every face that accepts a key, where it used to answer the generic `401`; and a session cookie sent beside such a key no longer answers for it.
- **Hosts calling `resolveAuthzContext`, `resolveApiKeyAdmission` or `resolveApiKeyPrincipal` directly** pass `apiKeyLifecycle: apiKeyLifecyclePolicySourceOf(authService)` (or the sixth argument), or an explicit `undefined` where no auth service exists. A caller of `resolveAuthzContext` that wants the located answer re-raises `ApiKeyLifecycleRefusalError` (`isApiKeyLifecycleRefusalError`) the way it re-raises the store outage. Code switching exhaustively over `ApiKeyAdmission['outcome']` handles the new `lifecycle` outcome.
