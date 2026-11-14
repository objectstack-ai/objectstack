---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a browser refused at `/oauth2/authorize` by the environment-access gate is sent back to the environment, or shown a readable page, instead of a raw JSON 403

Clause-②: no
Metadata-protocol: none

When the host's `oidcAuthorizeGate` refuses a signed-in account at `/oauth2/authorize` (an account that is not a member of the environment's organization), the answer now depends on who is asking. The refusal itself, and who it applies to, are unchanged.

- A browser navigating to the URL (`Sec-Fetch-Dest: document`, or `Accept: text/html` with no Fetch Metadata), when the request's `redirect_uri` is registered for the client exactly as written: `302` to that `redirect_uri` with `error=access_denied`, `error_description`, the request's `state` and `iss` (RFC 6749 §4.1.2.1, RFC 9207). The environment's own sign-in page then shows the refusal.
- A browser navigating to the URL with no such `redirect_uri` (none sent, one the client never registered, a disabled client, or a loopback URI on a port other than the registered one): a `403` HTML page that names the signed-in account and offers "Switch account" (the provider's `/oauth2/end-session`) and "Back to console". An unregistered `redirect_uri` is never followed.
- Every other caller, including the Console's own post-sign-in `fetch` (`Accept: application/json`), a bearer API client and a bare `curl`: the same `403` with `code: ENV_ACCESS_DENIED` and the same message as before.

A request with no signed-in account is still not judged, and still goes to the provider's sign-in page.
