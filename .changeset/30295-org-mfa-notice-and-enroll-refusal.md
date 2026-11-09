---
'@object-ui/app-shell': patch
'@object-ui/auth': patch
'@object-ui/i18n': patch
---

fix(app-shell,auth,i18n): the organization form says requiring MFA needs two-factor on, an accepted save says who must enroll and when, and the enrollment screen names a two-factor-off deployment in the user's language

Clause-②: yes (widening)
Metadata-protocol: none

- **Organization form, before saving.** While two-factor is off on the deployment (`features.twoFactor: false` in `/api/v1/auth/config`), the `sys_organization` edit form says, under its title, that Require Multi-Factor Auth needs two-factor, that a save with it ticked is refused, and how to turn two-factor on (Require multi-factor authentication in Setup → Authentication, or `OS_AUTH_TWO_FACTOR=true`). When the save is refused, the server's refusal shows on the field, as before.
- **Organization form, after an accepted save.** A save that turns `require_mfa` on for a row that stored it off adds a line to the saved toast: every member without an authenticator app must set one up, and is blocked from data once the MFA grace period ends (7 days unless changed in Setup → Authentication), counted from their first use after the change. A save of a row that already required it says nothing new.
- **Enrollment screen.** `enrollTotp` and `verifyTotp` of `@object-ui/auth` now reject with the HTTP `status` and the server's `code` on the error (the message is unchanged). The authenticator step reads a `404` (the `/two-factor/*` endpoints are not mounted while two-factor is off) as a translated sentence saying enrollment is not available and who can turn it on, instead of `Two-factor enable failed (404)`, and `INVALID_PASSWORD` as the password screen's sentence. Any other refusal keeps the server's message.
- **The widening.** `@object-ui/i18n` gains `auth.remediation.mfa.unavailable`, `console.organizationMfa.needsTwoFactor` and `console.organizationMfa.nowRequired` in all ten language packs. The two enrollment rejections gain the optional `status` and `code` properties.
