---
'@objectstack/lint': patch
---

docs(lint): `os explain flow-credential-literal` names the `oauth2`, `app-credential` and `signed` connector auth kinds, and says why its fix line never routes to them

Clause-②: no
Metadata-protocol: none

The connector auth union now declares `oauth2` (grant `authorization_code` or `client_credentials`), `app-credential` (vendor `feishu`, `dingtalk` or `wecom`) and `signed` beside the static kinds. The explanation said only that the fix line routes to a variant the schema "really has", which read as if `bearer`, `api-key` and `basic` were the whole list.

- The explanation now names the other kinds, says their secret is also only a `credentialRef`, and says none is a home a literal moves into by shape: `oauth2` and `app-credential` carry a grant whose token the server obtains per dispatch, and until it runs that grant such an instance is held degraded and calls no upstream; `signed` signs each request with its key.
- The `fix:` lines are unchanged and still route to `bearer`, `api-key` or `basic`. The rule's predicate and severity are unchanged.
- The rule's test holds every kind and grant the explanation names to `ConnectorInstanceAuthSchema`.
