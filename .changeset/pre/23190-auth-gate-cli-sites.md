---
'@objectstack/runtime': minor
'@objectstack/rest': minor
'@objectstack/cloud-connection': minor
---

fix(runtime,rest,cloud-connection)!: the declared-endpoint fallback, REST's direct-mounted publish and federation routes, and cloud-connection's session doors refuse a session the ADR-0069 authentication policy holds

Clause-②: no (narrowing) — a session ADR-0069 holds out of protected resources is refused by doors that answered it; core's existing exports only, no published schema or export moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at three groups of doors, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a session the policy does not hold receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which sessions these doors serve: a session whose user carries the ADR-0069 posture (an expired password, or enforced MFA not yet enrolled) is now refused with the gate's 403 before the door's own logic runs. The other categories are closed on facts: the three packages publish (not unpublished); no ADR-0087 id covers these doors and this diff adds none (not registered / already-registered); and no published interface or type changes, the new fields living on package-internal types only (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled, until they remediate. REST's `enforceAuth` and the runtime dispatcher already refuse such a session. Three groups of doors that resolve a session on their own never asked, so they served it as an ordinary signed-in caller:

- **`@objectstack/runtime`**: the declared-endpoint fallback (app-declared `apis:` endpoints, served by the dispatcher plugin's fallback seam). Its policy chain now asks the shared decision (`evaluateAuthGate`, `@objectstack/core`) before `authRequired` and before the endpoint's target runs, on every declared endpoint, an `authRequired: false` one included, because the target runs as the caller. While a gate feature is active the chain reads the session for this, and when an active gate cannot read the session the request is answered `503` (`SERVICE_UNAVAILABLE`), as REST answers it. No declared path is handed to the allow-list, so no endpoint can exempt itself through the prefix it sits under.
- **`@objectstack/rest`**: the direct-mounted package publish door (`registerPackageRoutes`) and the external-datasource federation family (`registerExternalDatasourceRoutes`). Each refuses on the `authGate` the REST resolver already puts on the execution context it hands them.
- **`@objectstack/cloud-connection`**: `CloudConnectionPlugin`'s seven session doors (bind, poll, unbind, install, and the three installed-state reads) and all five `MarketplaceInstallLocalPlugin` doors (install, list, uninstall, reseed, purge). Each plugin asks the gate once, where it resolves the session, and every door that resolves one refuses on it.

- **Refused now:** a held session gets `403` with the gate's own `code` (`PASSWORD_EXPIRED` or `MFA_REQUIRED`) and `message`, in each door's declared error envelope, before the door does anything else. This is the answer REST gives the same session.
- **Unchanged:** a session the policy does not hold is served exactly as before, an API-key caller is unaffected because it has no session to hold, and an anonymous caller gets the same `401`. `CloudConnectionPlugin`'s status read and `MarketplaceProxyPlugin`'s catalog proxy resolve no session and answer every caller alike, so they are unchanged.

What changes for you. A user the policy holds must remediate (change the password, or enroll an authenticator) before these doors answer them, as on every other protected route. Nothing needs configuring: the posture comes from the kernel's `auth` service, as it does for REST and the dispatcher.
