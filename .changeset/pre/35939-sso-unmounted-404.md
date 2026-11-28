---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): a kernel without SSO answers 404 again on the SSO discovery endpoints, with no error log

Clause-②: no
Metadata-protocol: none

Since SSO discovery began connecting only to addresses that are public at connect time, a kernel that does not mount SSO (the default without `OS_SSO_ENABLED` or `plugins.sso`) answered `POST /sso/register`, `/sign-in/sso` and `/sso/callback/*` with `503 SERVICE_UNAVAILABLE` ("SSO is unavailable: this server cannot judge its reads of an identity provider") and logged one error line per request. The discovery scope opened on the path alone, while the adapter observer it requires is mounted only with SSO.

The scope now opens only when the built auth instance mounts the vendor's `sso` plugin, read off the composed plugin list rather than the configuration re-read at request time. A kernel without SSO answers the vendor's own 404 on those paths and logs nothing. A kernel that mounts SSO is judged exactly as before: provider reads go through the connect-time guard, and a context whose adapter is not observed is still refused `503` before the endpoint runs. No configuration, export or response shape changes.
