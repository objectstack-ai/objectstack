---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(plugin-auth): Create User with no email names Email, the dialog marks Email required, and a wrong password on the password-change screen reads in the user's language

Clause-②: no
Metadata-protocol: none

- **The refusal.** Create User with neither an email nor a phone number used to answer "Either email or phoneNumber is required", naming a request key the dialog does not show. It now answers "Email is required", or "Email or phone number is required" where phone sign-in is on. The status (400) and code (`INVALID_REQUEST`) are unchanged.
- **The required mark.** The `sys_user.create_user` dialog backs its Email field with two params: a required one shown while phone sign-in is off, and an optional one behind the `phoneNumber` feature. The dialog shows and submits one of them, so Email carries a required mark exactly when it is required.
- **The password-change screen.** A wrong current or temporary password is refused with the code `INVALID_PASSWORD` and the English message "Invalid password", and the screen showed that message as it came. It now shows a translated sentence for that code in every console language pack. Any other refusal still shows the server's message.
