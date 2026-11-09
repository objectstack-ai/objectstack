---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a change-email request notifies the current address whatever way the caller is signed in

Clause-②: no
Metadata-protocol: none

- **The rule.** Every `POST /api/v1/auth/change-email` request that is accepted mails the account's current address the `auth.email_change_notice`, whatever way the caller is signed in. The notice goes to the account the request changes: its address is read from the session the endpoint itself acted on.
- **Unchanged.** The notice's template and text; the confirmation mail to the requested address; a refused request still mails nothing; the notice still never blocks the change.
