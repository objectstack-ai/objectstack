---
"@objectstack/spec": minor
"@objectstack/core": patch
"@objectstack/service-print": patch
---

feat(spec): `AuthSessionApi.getSession`'s result declares the fields its in-process readers read

Clause-②: yes (widening)

- **`@objectstack/spec/contracts` — `AuthSessionApi.getSession`'s result gains five optional members**, each declared for a named reader and typed as that reader takes it: `user.email` and `session.id` / `session.token` (read by `resolveAuthzContext`'s session arm in `@objectstack/core`), `user.authGate` as `unknown` (the ADR-0069 posture, which `normalizeAuthGate` validates against the closed posture vocabulary), and `session.impersonatedBy` as `string | null` (read by the print door's `impersonatorOf` in `@objectstack/service-print`). Before this, those reads went through `any` or a cast, so a field better-auth dropped or renamed compiled and read `undefined`. For `impersonatedBy`, that would have silently turned off the impersonation refusal. Every member is optional, so every implementer and caller typechecks unchanged.
- **`@objectstack/core`**: `resolveAuthzContext`'s session arm reads the session through the declared type instead of `any`. `ResolveAuthzInput.getSession`'s own type is unchanged. Runtime behaviour is unchanged.
- **`@objectstack/service-print`**: `impersonatorOf` reads `session.impersonatedBy` through the declared type instead of a cast. Runtime behaviour is unchanged.
