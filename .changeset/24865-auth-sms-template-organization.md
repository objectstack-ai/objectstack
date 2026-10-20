---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): the phone OTP and invitation SMS read their template row in the organization the send resolves to

Clause-②: no

`sys_notification_template` is organization-owned (ADR-0131: organization ownership is total). The phone OTP and invitation SMS are deployment-level sends whose callbacks carry no organization, so their template row is now read in the organization that act resolves to, the tenancy service's `defaultOrgId()` (ADR-0093 D3), the same answer the membership reconciler binds a new user to:

- **`single`:** the Default Organization's `sys_notification_template` row for `(auth.phone_otp | auth.phone_invite, sms, locale)` decides the text, as an operator authored it in Setup.
- **`isolated` and `group`:** no organization is resolved, so no template row is read and the built-in text is sent. No organization's row decides the text a user receives.
- **No tenancy service, or a failed resolution:** the built-in text. A template outage still never blocks a send.
- **Unchanged:** the locale ladder (the recipient's stored locale, then the deployment default, then `en`), how a deactivated or blank row passes its rung on, the built-in texts themselves, and the rendered holes.
