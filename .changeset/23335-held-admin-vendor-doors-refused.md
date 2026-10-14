---
'@objectstack/plugin-auth': minor
---

fix(plugin-auth)!: impersonation, SSO-provider administration and the admin plugin's role-scalar actions refuse a caller the ADR-0069 authentication policy holds

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A runtime authentication narrowing at three doors better-auth serves inside plugin-auth (the re-authorized impersonation endpoint, SSO-provider registration, update and delete, and the admin plugin's own role-scalar actions), not a metadata change. No spec key, option, config field, response field or stored shape is removed, renamed or re-shaped, and a caller the policy does not hold receives the same answers as before, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is which callers these doors serve: a user who holds an ADR-0069 posture (an expired or administrator-forced password, or enforced MFA not yet enrolled, globally or by the organization the session operates in) is now refused with the session gate's 403 before the door acts. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers these doors and this diff adds none (not registered / already-registered); the one added export is an addition, so nothing published is retired or re-typed (not runtime-interface-only / type-surface-only / runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0069 D3 holds a signed-in user out of every protected resource while their password has expired (or an administrator has forced a change) or while enforced MFA is not yet enrolled, until they remediate. REST, the runtime dispatcher and the platform-admin actions plugin-auth mounts on the host server already refuse such a user. Three doors better-auth serves itself did not, because their session is a raw read that never carries the posture:

- **Impersonation** (`POST /admin/impersonate-user`): a held platform administrator could mint a session as another user, and that session is not held, so the hold was bypassed outright.
- **SSO-provider administration** (`POST /sso/register`, `/sso/update-provider`, `/sso/delete-provider`): a held platform administrator could register an identity provider, and rewrite the issuer of, or delete, one they own.
- **The admin plugin's own actions, judged on the legacy `role` scalar** (set-role, get-user, update-user, list-users, list-user-sessions, revoke-user-session, revoke-user-sessions): a held caller carrying `role = 'admin'` was admitted, writes included.

From → to. Before: a held caller passed these doors as if unheld. Now: each door asks the auth service for the caller's posture in the organization their session operates in (the same computation, and the same first entry, the session carries) and refuses a held caller with `403`, `{ success: false, error: { code, message } }`, where `code` is the posture's own (`PASSWORD_EXPIRED`, `MFA_REQUIRED` or `PASSWORD_RESET_REQUIRED`) and `message` names the remedy: the refusal the session gate and `judgePlatformAdmin` already give. No new error code.

- **Order:** an anonymous caller still meets the vendor's `401` first. A held signed-in caller who is not an administrator now meets the posture's `403` code instead of the vendor's `403 YOU_ARE_NOT_ALLOWED_*`: same status, the remedy named.
- **Unchanged:** a caller the policy does not hold is served exactly as before. Stopping an impersonation and the admin plugin's permission question are not held, and sign-in, change-password, two-factor enrollment and sign-out still answer a held session, so remediation works as before. A posture lookup that fails holds no one, as it does for the session.
- **New export:** `judgeHeldSession` (`@objectstack/plugin-auth`), the held refusal `judgePlatformAdmin` gives, now shared with these doors.

What changes for you. An administrator the policy holds must remediate (change the password, or enroll an authenticator) before impersonating a user, registering or changing an SSO provider or using the admin plugin's user actions, as on every other protected route.
