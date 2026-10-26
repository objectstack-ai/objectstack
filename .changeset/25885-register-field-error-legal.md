---
'@object-ui/auth': patch
'@object-ui/console': patch
---

fix(auth,console): the sign-up form shows a password mismatch under the confirm field, and the register page links privacy and terms

Clause-②: no
Metadata-protocol: none

- **Mismatch on the field.** `RegisterForm` showed "Passwords do not match" as the error banner at the top of the form, above the name field. The message now sits under the confirm-password input, which carries `aria-invalid` and names the message through `aria-describedby`. Editing either password clears it. The banner still carries what the server refuses (an existing account, a closed registration). The text is the same `labels.passwordMismatchError`, so no locale key changes. Every page that renders `RegisterForm` gets this.
- **Legal links on sign-up.** The console's `/register` now draws the same footer as `/login`: the locale switch, plus the privacy and terms links that `GET /api/v1/auth/config` serves as `features.privacyUrl` / `features.termsUrl`. A link appears only when its URL is served and is an http(s) URL or a same-origin path. Both pages now read the links through one shared reader.
