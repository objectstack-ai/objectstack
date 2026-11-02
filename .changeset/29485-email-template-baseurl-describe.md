---
'@objectstack/spec': patch
---

docs(spec): `email.defaultTemplateContext` now names `baseUrl` beside `appName` as a key the runtime resolves itself

Clause-②: no
Metadata-protocol: none

The `.describe()` and TSDoc on `EmailServiceConfigSchema.defaultTemplateContext` said every key is passed through as written except `appName`. Since the email plugin started resolving the deployment address for templates, `baseUrl` is resolved too, so the text now names both keys and gives `baseUrl` its chain: `OS_AUTH_URL` (legacy `BETTER_AUTH_URL`), then `OS_BASE_URL`, then the value written in `defaultTemplateContext.baseUrl`, then the local `http://localhost` default on the serve port, with any trailing slash trimmed. A send's own data still wins over both keys.

Text only: the key stays a free-form record, and nothing an author can write changes.
