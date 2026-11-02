---
'@object-ui/auth': patch
---

fix(auth): under SSO enforcement the sign-in card offers the SSO email field and "Sign in with SSO" on first paint

Clause-②: no
Metadata-protocol: none

On a deployment that enforces SSO (`features.ssoEnforced`) and advertises SSO (`features.sso`), the sign-in card first showed only the SSO-only sentence and a "Use a password instead" link. The email-routed "Sign in with SSO" button, the deployment's only working way in, sat inside the password form and appeared only after that link was clicked.

`LoginForm` now draws the email field and the "Sign in with SSO" button in the SSO-only view itself, with no password field. "Use a password instead" still reveals the password form for the break-glass admin, and "Back to single sign-on" returns to the SSO view. A deployment with federated providers only, a server without enforcement, and the password-off states are unchanged. No new label: the field reuses `emailLabel` and `emailPlaceholder`, the button `ssoButton`.

What to do: nothing.
