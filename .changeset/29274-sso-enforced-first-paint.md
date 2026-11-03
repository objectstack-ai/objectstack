---
'@object-ui/auth': patch
---

fix(auth): when SSO is the way in, the sign-in card offers the SSO email field and "Sign in with SSO" on first paint

Clause-②: no
Metadata-protocol: none

On a deployment that advertises SSO (`features.sso`) and either enforces it (`features.ssoEnforced`) or has email+password sign-in turned off (`emailPassword.enabled: false`), the sign-in card first showed only the SSO-only sentence and a "Use a password instead" link. The email-routed "Sign in with SSO" button, the deployment's only working way in, sat inside the password form and appeared only after that link was clicked; with the password door shut, that link opened a form whose password half the server refuses.

`LoginForm` now draws the email field and the "Sign in with SSO" button in the SSO-only view itself, with no password field. Under enforcement, "Use a password instead" still reveals the password form for the break-glass admin, and "Back to single sign-on" returns to the SSO view. With email+password sign-in turned off, that link is now offered only when phone+password sign-in is on, since otherwise the form it opens is one the server refuses. A deployment with federated providers only, a server whose password form is shown, and the no-method state are unchanged. No new label: the field reuses `emailLabel` and `emailPlaceholder`, the button `ssoButton`.

What to do: nothing.
