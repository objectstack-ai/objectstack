---
'@object-ui/auth': patch
---

fix(auth): a "Sign in with SSO" request that never answers gives the sign-in page back after 20 seconds

Clause-②: no
Metadata-protocol: none

On the login page, when the request behind "Sign in with SSO" got no answer, the button kept spinning and the email field stayed locked until the page was reloaded. The request now runs under the same 20-second limit as the identity-provider buttons: once it passes, the request is cancelled, the page says the sign-in timed out, and the email field and the button can be used again to retry. An answering request still sends the browser to the identity provider as before.
