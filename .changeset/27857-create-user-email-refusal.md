---
'@objectstack/plugin-auth': patch
'@object-ui/app-shell': patch
'@object-ui/auth': patch
'@object-ui/i18n': patch
---

fix(plugin-auth): Create User with no email names Email, and a wrong password on the password-change screen reads in the user's language

Clause-②: no
Metadata-protocol: none

- **The refusal.** Create User with neither an email nor a phone number used to answer "Either email or phoneNumber is required", naming a request key the dialog does not show. It now answers "Email is required", or "Email or phone number is required" where phone sign-in is on. The status (400) and code (`INVALID_REQUEST`) are unchanged.
- **The password-change screen.** A wrong current or temporary password is refused with the code `INVALID_PASSWORD` and the English message "Invalid password", but `createAuthClient`'s `changePassword` threw a bare `Error` that dropped the code, and the screen showed the message as it came. `changePassword` now keeps the code on the thrown error, and the screen shows a translated sentence for that code in every console language pack. Any other refusal still shows the server's message.
