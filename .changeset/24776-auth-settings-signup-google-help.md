---
'@objectstack/service-settings': patch
---

fix(service-settings): Setup → Authentication says what the sign-up and Google toggles do beside the audience and the credentials (#24776)

Clause-②: no

Two controls on the Authentication settings page read as contradicting the system on a fresh install. Their wording changes; no default, `visible` rule, `required` flag, option or stored key moves, and no deployment admits or signs in anyone it did not before.

- **`auth.signup_enabled`** is now labelled *Allow email sign-up* (it was *Allow self-service registration*) and carries help text. It is the email-and-password sign-up form's own switch, and the *Self-registration audience* decides who the form admits: under `invite_only`, only an address holding a pending invitation; under `email_domain`, the allowlisted domains and invited addresses; under `open`, anyone. Off closes the form under every audience, invitations included. So ON beside *Invitation only* means the form is open to invited addresses.
- **`auth.google_enabled`** help now says that Google sign-in is offered only once a client ID and a client secret both resolve, saved on the page or set as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server (which win over saved values). Until then the login page shows no Google button, even while the toggle is on. Off withdraws Google sign-in even when the server sets both.

The English, Chinese, Japanese and Spanish bundles carry the new label and help.
