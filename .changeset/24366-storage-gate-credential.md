---
'@objectstack/service-storage': minor
---

fix(service-storage)!: the storage family gate and the route judge the same credential

Clause-②: no (narrowing) — a session the ADR-0069 policy holds is refused on every storage route whatever else the request carries; no published schema, export or option moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at the storage route family mounted directly on the host server, not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped, and a session the policy does not hold receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which requests the family serves: a session whose user carries the ADR-0069 posture is now refused with the gate's 403 whatever else the request carries. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); and no published interface or type changes (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled, until they remediate, and every route of the storage family is one. The family's gate and its routes now judge the same credential: the gate judges every credential a route of the family can serve.

- **Refused now:** a session the policy holds gets `403` with the gate's own `code` (`PASSWORD_EXPIRED`, `PASSWORD_RESET_REQUIRED` or `MFA_REQUIRED`) and `message` on every storage route, whatever else the request carries, before the family does anything else. While a gate is active, a session that cannot be read is the family's declared `503` (`SERVICE_UNAVAILABLE`), whatever else the request carries.
- **Unchanged:** a session the policy does not hold is served exactly as before, apart from that outage answer; an API key whose owner holds an `account`-scope posture is refused with that posture, as before; and while no gate feature is active nothing changes.

What changes for you. A user the policy holds must remediate (change the password, or enroll an authenticator) before any storage route answers them, whatever else their request carries. There is nothing to configure.
