---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/rest': minor
'@objectstack/runtime': minor
'@objectstack/plugin-auth': minor
'@objectstack/plugin-sharing': minor
'@objectstack/service-datasource': minor
'@objectstack/service-settings': minor
'@objectstack/service-storage': minor
'@objectstack/platform-objects': minor
---

feat(spec,core,plugin-auth)!: an API key answers as its owner's session does when the ADR-0069 policy holds the account, the forced reset gets its own code and an explicit revocation switch

Clause-②: yes (narrowing) — the published contract widens (the posture codes become a closed vocabulary with a declared scope, a new `PASSWORD_RESET_REQUIRED` code, a per-user posture member on the auth service contract, new `@objectstack/core` exports) and the API-key door narrows (a key whose owner holds an account-scope posture is refused where it was served).

<!-- adr-0087: not-required (no-migration-prescription) An authentication-policy change at the API-key admission seam plus one new error code, not a metadata change. No authorable spec key, stored shape or metadata surface is removed or renamed, so `objectstack migrate meta` has nothing to rewrite. `ExecutionContext.authGate.code` narrows from a bare string to the closed posture vocabulary, but that field is server-constructed only and never authored; its one producer already wrote only members of it. What narrows is which API keys are served (a key whose owner owes MFA enrolment is refused with 403 MFA_REQUIRED), and the administrator-forced password change answers its own code. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing at the API-key door, and a changed code for the administrator-forced password change), shipped as `minor` under the launch-window convention for breaking changes.

Ruling C′ on #23287: posture codes are a closed vocabulary, and each code declares what it holds.

- **The vocabulary and its scope (`@objectstack/spec/kernel`).** `AuthGateCodeSchema` is the closed set of codes an `authGate` may carry: `PASSWORD_EXPIRED`, `PASSWORD_RESET_REQUIRED` and `MFA_REQUIRED`. `AUTH_GATE_SCOPES` declares each code's scope once: `MFA_REQUIRED` holds the **account** (every credential of the user); `PASSWORD_EXPIRED` and `PASSWORD_RESET_REQUIRED` hold the **credential** (password sign-in alone). `ExecutionContext.authGate.code` is typed against the vocabulary, and `PASSWORD_RESET_REQUIRED` is registered for `@objectstack/plugin-auth` in the error-code ledger.
- **One per-user posture computation (`@objectstack/plugin-auth`, `IAuthService.resolveUserAuthGates`).** It answers every posture a user holds, most urgent first, keyed by user id and the organization the credential operates in. The session gate shows its first entry, as before.
- **One judgment at the shared key-admission seam (`@objectstack/core`).** `resolveApiKeyAdmission` asks that computation for the key's owner and holds the key on an account-scope posture (a new `held` outcome). `resolveAuthzContext` resolves a held key as a held principal: the owner, `credential: 'api_key'`, and the posture on `authGate`. Both new inputs are optional (`userAuthGates`), and `userAuthGateSourceOf(authService)` binds one from an auth service.
- **REST and the runtime dispatcher** judge a key-admitted request by the key's answer, and re-read the session cookie for the gate only when a session admitted the caller. The declared-endpoint fallback does the same.
- **The raw-host families** take the same answer through the shared seam: datasource admin, share links, settings, and the storage family's door. The webhook-redeliver door admits no API key at all, and still does not.
- **The forced reset (`POST /api/v1/auth/admin/set-user-password`, the `set_user_password` action).** `must_change_password` now answers `PASSWORD_RESET_REQUIRED` instead of reusing `PASSWORD_EXPIRED`. The act carries `revokeSessionsAndKeys`, **on by default**: it ends every live session of the user and revokes every API key they own, and the response reports what landed (`revoked: { sessions, apiKeys, failed, complete }`).

What changes for you:

- **Refused now:** an API key whose owner owes MFA enrolment past the grace window gets `403 MFA_REQUIRED`, with the message the session gets, on every face that admits keys. It works again the moment the owner enrols, with nothing reissued: the refusal is not a revocation.
- **Unchanged:** a key whose owner's password expired, or whose administrator forced a password change, keeps working. A session sent beside an API key no longer answers for the key.
- **A forced password change answers `PASSWORD_RESET_REQUIRED`.** A client that recognises `PASSWORD_EXPIRED` to show its change-password flow should recognise `PASSWORD_RESET_REQUIRED` the same way.
- **An administrator's password reset now signs the user out everywhere and revokes their API keys by default.** For a routine reset, pass `revokeSessionsAndKeys: false` (or clear the switch in the Set Password dialog). Revoked keys stay revoked after the password change; the owner mints replacements.
- **Hosts calling `resolveAuthzContext` or `resolveApiKeyAdmission` directly** pass `userAuthGates: userAuthGateSourceOf(authService)` to have the key's owner asked. Code switching exhaustively over `ApiKeyAdmission['outcome']` handles the new `held` outcome.
