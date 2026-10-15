---
'@objectstack/core': minor
'@objectstack/runtime': minor
'@objectstack/cloud-connection': minor
'@objectstack/mcp': minor
'@objectstack/service-storage': patch
---

fix(core,cloud-connection,mcp)!: every API-key admission names its owner-posture source, so a held owner's key is refused at the marketplace install-local doors and on every MCP stdio call

Clause-②: no (narrowing) — no published accept-set widens; two more seams refuse a key whose owner holds an account-scope posture, the owner-posture input of the shared key-admission seam becomes required, and `resolveApiKeyPrincipal` no longer answers a held owner's key with a principal.

<!-- adr-0087: not-required (runtime-interface-only packages/core/src/security/resolve-authz-context.ts#ResolveAuthzInput) An authentication-policy change at runtime TypeScript call sites, not a metadata change. No authorable spec key, stored shape or metadata surface moves, so `objectstack migrate meta` has nothing to rewrite. The input that becomes required lives on a runtime interface and on two runtime functions of `@objectstack/core` (`resolveApiKeyAdmission`, `resolveApiKeyPrincipal`), none of them a metadata surface; the affected party is a TypeScript caller, and the compiler names its call site. The packages publish (not unpublished), no ADR-0087 id covers this and none is added (not registered or already-registered). -->

**BREAKING** (an accept-set narrowing at two API-key doors, and a required input on the shared key-admission seam), shipped as `minor` under the launch-window convention for breaking changes.

Ruling C′ on #23287, item 1: "a held user's API key is refused at every seam with the same code". Item 4: "The refusal is not a revocation: the key resumes the moment the user enrols (or the account posture clears)". `AUTH_GATE_SCOPES` decides which posture holds a key: `MFA_REQUIRED` (scope `account`) holds it; `PASSWORD_EXPIRED` and `PASSWORD_RESET_REQUIRED` (scope `credential`) do not.

- **The marketplace install-local doors (`@objectstack/cloud-connection`).** The resolver behind all five doors now hands the shared resolver the auth service's per-user posture computation and refuses on the posture it decided for whichever credential admitted the caller. A key whose owner holds `MFA_REQUIRED` gets `403 MFA_REQUIRED` with the session's message, before any effect. It used to be served there.
- **The MCP stdio transport (`@objectstack/mcp`).** `OS_MCP_STDIO_API_KEY` is resolved with the owner's posture on every call of a live session, and a held owner's call is refused before any read or write with the envelope REST answers (`code` `MFA_REQUIRED`, `status` 403, the session's remediation message). A data tool's error and the record resource carry that message, as they carry every other refusal on this transport. A held key still starts the transport and says so once in a warning: the key is valid, and the next call after the owner enrols is served with no restart.
- **The owner-posture input is required (`@objectstack/core`).** `ResolveAuthzInput.userAuthGates`, and the `tenancyPosture` and `userAuthGates` parameters of `resolveApiKeyAdmission` and `resolveApiKeyPrincipal`, are now required; `undefined` is a value passed on purpose. A seam that forgets the source no longer compiles, which is how the two seams above were missed. `@objectstack/runtime` re-exports these, so its importers see the same change.
- **`resolveApiKeyPrincipal` collapses a held owner's key to no principal.** A principal-or-nothing answer cannot carry the posture's code, so a host that answers requests should read `resolveApiKeyAdmission` and refuse its `held` outcome with `gate.code`.
- **The storage download authorizer (`@objectstack/service-storage`)** names the same source. The storage family's door already refused a held owner's key on the same request, so nothing changes on the wire.

What changes for you:

- **Refused now:** an API key whose owner owes MFA enrolment past the grace window gets `403 MFA_REQUIRED` at the install-local doors, and every principal-bound MCP stdio call it makes is refused with the same code and message. It works again the moment the owner enrols, with nothing reissued.
- **Unchanged:** a key whose owner's password expired, or whose administrator forced a password change, keeps working on both.
- **Code that calls `resolveAuthzContext`, `resolveApiKeyAdmission` or `resolveApiKeyPrincipal` directly** now passes the owner-posture source explicitly: `userAuthGates: userAuthGateSourceOf(authService)` wherever the kernel's `auth` service is reachable, or `undefined` on a kernel composed without `plugin-auth`. The two positional functions also take `tenancyPosture` explicitly (`undefined` when no `tenancy` service is registered).
