---
'@objectstack/plugin-auth': patch
'@objectstack/plugin-email': patch
---

feat(plugin-auth, plugin-email): under the `open` and `email_domain` postures, a sign-up for an address that already has an account answers like a new sign-up and mails that address, while mail is really delivered

Clause-②: yes
Metadata-protocol: none

The public email-and-password sign-up changes its answer in one case. Under the `open` and `email_domain` audience postures, a sign-up for an address that already has an account was refused explicitly. Now, when the deployment's mail transport really delivers, it answers exactly as a successful sign-up does on that deployment, and the address's holder receives a mail saying the address already has an account, with a link to sign in and a link to reset the password. Nothing is written: no new user, credential or session. The caller can no longer tell from the answer whether the address was registered.

- **When the explicit refusal stays, unchanged.**
  - The mail would not be delivered: the email service says its transport is not live (`IEmailService.isConfigured()` answers `false`, which plugin-email answers for its `log` transport in every environment), the email service does not implement `isConfigured()`, or no email service is wired. A success with no mail behind it is what the refusal replaced, so it is never answered.
  - The posture is `invite_only`. A stranger still learns nothing there, and an invited person whose address already has an account is still refused.
  - The posture is `open` with email verification declared off (and auto sign-in left on). A new sign-up there is signed in at once, and an existing address cannot get that answer without a session for someone else's account.
- **Read at sign-up time.** The transport is asked on every sign-up, so a transport saved from the Mail settings applies to the next sign-up without a restart.
- **The mail.** plugin-email ships a new built-in template, `auth.existing_account_sign_up`, in `en-US`, `zh-CN`, `ja-JP` and `es-ES`. It is registered like the other built-in auth templates, so an app declaration or a Studio save overrides it. Its variables are `user.name` (optional), `user.email`, `signInUrl`, `resetPasswordUrl` and `appName` (optional). The two links are the Console's sign-in and forgot-password pages and carry no token. `BUILTIN_AUTH_TEMPLATES` grows from 28 rows to 32.
- **The mail's language.** The recipient's stored language (`sys_user.locale`), then the deployment default. The language of the browser that asked is never used, because the person signing up may not be the address's holder.
- **For a client of the sign-up door.** In the configurations above, a screen that showed an "already registered" message on the refusal now receives the success answer instead, and should show its usual "check your email" step.
- **A send that fails after the answer.** The answer is still the success, and the server logs one error-level line saying the mail was not sent. A verification mail that fails for a new address leaves the same gap.
- **Unchanged.** A sign-up for a new address, every refusal the audience posture raises, and every other auth mail.
