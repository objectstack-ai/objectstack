---
'@objectstack/platform-objects': patch
---

fix(platform-objects): Rotate Client Secret's result dialog states the immediate cut-off its confirmation states

Clause-②: no (text only: no accept set, served shape or behaviour moves)

- **Before.** On `sys_oauth_application`, the Rotate Client Secret confirmation said the previous secret "will stop working immediately". The result dialog then told the admin to "update every integration before the previous secret's grace period ends". Only the first is true.
- **What rotation does.** `POST /api/v1/auth/oauth2/client/rotate-secret` is better-auth's own route. It overwrites the client's one stored secret, and client authentication checks a presented secret against that value only. No previous secret is kept, so there is no grace period: the old secret is refused from the moment the rotation completes.
- **Now.** The result dialog reads "Save the new secret now — it is shown only once. The previous secret has already stopped working: update every integration with the new secret." The zh-CN, ja-JP and es-ES translations of that sentence are updated to match. The confirmation, the dialog's title, acknowledgement and secret field are unchanged.
