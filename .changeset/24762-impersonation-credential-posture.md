---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an administrator's impersonation session is not held by the target's forced password reset or password expiry (#24762)

Clause-②: no

Impersonating a user who must change their password used to strand the administrator: the impersonation session was refused `403 PASSWORD_RESET_REQUIRED` on every protected route, and the console showed the target's change-password screen. An impersonation session is minted from the administrator's own session, which has passed its own posture check, so it is not the user's password sign-in, and a `credential`-scope posture holds the password sign-in alone (`AUTH_GATE_SCOPES`).

- **What moves.** On a session that carries `impersonatedBy`, the session gate (`user.authGate`, stamped in `customSession`) now shows only the first `account`-scope posture the user holds. `PASSWORD_RESET_REQUIRED` and `PASSWORD_EXPIRED` no longer hold it. `MFA_REQUIRED` still does, so an impersonation session of a user who owes MFA enrolment is still refused `403 MFA_REQUIRED`, including when the user also owes a password change.
- **Unchanged.** The user's own sign-in stays held until they change the password. The forced reset's revocation (`revokeSessionsAndKeys`, on by default) still ends every session of the user, impersonation sessions included. API keys, the print door's refusal of an impersonation session, and the impersonation door's own check of the administrator's posture are unchanged.
