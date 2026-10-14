---
'@objectstack/service-datasource': minor
'@objectstack/plugin-sharing': minor
'@objectstack/plugin-webhooks': minor
'@objectstack/service-storage': minor
---

fix(services)!: the datasource admin, share-link, webhook redeliver and storage families refuse a session the ADR-0069 authentication policy holds

Clause-②: no (narrowing) — a session ADR-0069 holds out of protected resources is refused by families that answered it; core's existing exports only, no published schema or export moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at four families of routes mounted directly on the host server, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a session the policy does not hold receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which sessions these families serve: a session whose user carries the ADR-0069 posture (an expired password, or enforced MFA not yet enrolled) is now refused with the gate's 403 before any of the family's logic runs. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled, until they remediate. REST and the runtime dispatcher already refuse such a session. Four families of routes mounted straight on the host server never asked, so they served it as an ordinary signed-in caller:

- **`@objectstack/service-datasource`**: the datasource admin family (`registerDatasourceAdminRoutes`). Its door now asks the shared decision (`evaluateAuthGate`, `@objectstack/core`) about the session it already reads, before the anonymous floor and the capability check.
- **`@objectstack/plugin-sharing`**: the share-link family (`registerShareLinkRoutes`). Every route, the two capability-token routes included, is now mounted through one door that refuses a context carrying `authGate`. `SharingServicePlugin`'s resolver now puts the session's posture on that context, as REST does.
- **`@objectstack/plugin-webhooks`**: the redeliver door (`WebhookOutboxPlugin`), on both of its faces: the route the plugin mounts, and the `webhooks` service's `handleRedeliver`.
- **`@objectstack/service-storage`**: the storage family, the two capability-token raw-transfer routes included. Every route is now mounted through one door. The posture is bound where every other storage gate is bound, so both the plugin's own mount and the host door `mountStorageRoutes` carry it. When a gate feature is active, the door reads the session and refuses a held one. When the gate is active but the session cannot be read, the door answers the declared `503` (`SERVICE_UNAVAILABLE`), as REST does. A direct call of `registerStorageRoutes` mounts the family exactly as before, because like the other storage gates this one is bound by the package's composition. No exported declaration changes.

- **Refused now:** a held session gets `403` with the gate's own `code` (`PASSWORD_EXPIRED` or `MFA_REQUIRED`) and `message`, in each family's declared error envelope, before the family does anything else. This is the answer REST gives the same session.
- **Unchanged:** a session the policy does not hold is served exactly as before, and an API-key caller is unaffected because it has no session to hold. A CORS preflight is answered as before.

What changes for you. A user the policy holds must remediate (change the password, or enroll an authenticator) before these routes answer them, as on every other protected route. If you mount the storage routes through `mountStorageRoutes`, the gate is bound from the kernel's `auth` service with nothing to configure. If you mount `registerShareLinkRoutes` yourself with your own `contextFromRequest`, set `authGate` on the context it returns for a held session; the door refuses on that field.
