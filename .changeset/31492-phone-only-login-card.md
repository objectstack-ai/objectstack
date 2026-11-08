---
'@object-ui/auth': patch
---

fix(auth): with email+password sign-in off, phone sign-in on and no single sign-on, the login card draws the phone way in on first paint instead of a single sign-on view

Clause-②: no
Metadata-protocol: none

`LoginForm` collapsed into the single sign-on view whenever the server turned email+password sign-in off (`emailPassword.enabled: false`), whether or not single sign-on existed. A deployment that signs in by phone only showed its users "Use a password instead" and, behind it, a "Back to single sign-on" button with no single sign-on anywhere. Now, with the password door shut, no single sign-on offered (`features.sso`) or enforced (`features.ssoEnforced`) and a phone way in advertised (`features.phoneNumber` or `features.phoneNumberOtp`), the form is drawn on first paint:

- the identifier field reads "Phone number" (the existing `phoneLabel` / `phonePlaceholder` labels), since the server refuses an email address;
- with phone OTP the only way in, the form opens on the verification-code step and offers no switch to a password form the server refuses;
- no "Back to single sign-on" button, no sign-up link and no password-form description, all of which name a door the server refuses.

A shut password door with single sign-on offered, declared enforcement, the no-method state and a failed config fetch (the password form, break-glass) are unchanged.
