---
'@objectstack/service-settings': minor
---

fix(service-settings)!: the settings route family refuses a session the ADR-0069 authentication policy holds, and `SettingsContext` declares the posture as an optional `authGate`

Clause-②: yes (narrowing) — an optional `authGate` on the exported `SettingsContext` widens the public surface; the family door's refusal of a held session narrows what it answers.

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at one family of routes mounted directly on the host server, plus one additive optional field on an exported runtime type; not a metadata change. No spec key, export, option, config field, response field or stored shape is removed, renamed or re-shaped. `SettingsContext` gains `authGate?`, typed by `@objectstack/core`'s existing `AuthGate`; every context that type-checked before type-checks unchanged, and a resolver that never sets the field gets the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which sessions the family serves: a session whose user carries the ADR-0069 posture (an expired password, or enforced MFA not yet enrolled) is now refused with the gate's 403 before any settings logic runs. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these routes and this diff adds none (not registered / already-registered); the type change is a widening, not the removal or narrowing those categories describe (not runtime-interface-only / type-surface-only); and no runtime export is retired (not runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 holds a signed-in user out of every protected resource while their password has expired or while enforced MFA is not yet enrolled, until they remediate. REST, the runtime dispatcher and the four sibling families already refuse such a session. The settings family (`registerSettingsRoutes`) resolves its own caller and never asked, so it served a held session as an ordinary signed-in caller.

- **`SettingsContext.authGate`** (new, optional): the caller's posture, `{ code, message }`, the same shape and meaning as `ExecutionContext.authGate`. Present only while the session is held.
- **The family door** asks the shared decision (`evaluateAuthGate`, `@objectstack/core`) about the context it resolved, on every route, before the anonymous floor and before any settings logic.
- **`SettingsServicePlugin`'s resolver** puts the posture on the context through the shared reader (`normalizeAuthGate`), from the same session read that resolves the caller.

- **Refused now:** a held session gets `403` with the gate's own `code` (`PASSWORD_EXPIRED` or `MFA_REQUIRED`) and `message`, in the family's declared error envelope. This is the answer REST gives the same session.
- **Unchanged:** a session the policy does not hold is served exactly as before, an API-key caller is unaffected because it has no session to hold, an anonymous caller gets the same `401`, and a CORS preflight is answered as before.

What changes for you. A user the policy holds must remediate (change the password, or enroll an authenticator) before the settings routes answer them, as on every other protected route. With `SettingsServicePlugin` nothing needs configuring. If you mount `registerSettingsRoutes` yourself with your own `contextFromRequest`, a resolver that sets no `authGate` behaves exactly as before; set `authGate` on the context it returns for a held session (`normalizeAuthGate(session.user)` from `@objectstack/core` reads it), and the door refuses on that field.
