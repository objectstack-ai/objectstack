---
'@objectstack/connector-rest': minor
'@objectstack/connector-openapi': minor
'@objectstack/service-automation': minor
---

feat(connectors): the built-in `rest` and `openapi` providers serve `oauth2` and `app-credential` instances through the per-dispatch credential handle, and the Feishu, DingTalk and WeCom app-credential exchanges run (ADR-0143 S2, part of #26702)

Clause-②: yes (widening)
Metadata-protocol: semantic

ADR-0143 S1 (#28317) served an `oauth2` instance only on a provider that asks the credential handle, and none of the built-in providers did; every `app-credential` instance was held degraded. Now:

- **`rest` and `openapi` ask the handle.** Both plugins register their provider with `{ credentialHandle: true }`. A grant-bearing instance on either one is served: every request asks the handle for the run's organization, sends the token where the handle places it (an `Authorization: Bearer` header, or a vendor's header or query parameter), refreshes once and retries once on an upstream `401`, and a second `401` is the dispatch's `503` naming the instance. A thrown transport error has the token removed from its message first. A handle beside a static credential or a request signer is refused when the instance is built: a request is authenticated one way.
- **`openapi` reads the document's `security`.** An operation whose effective `security` is `[]` is anonymous: the handle is not asked and no token is sent. On a grant-bearing instance, a parameter that an `apiKey` scheme the operation requires names is filled by the platform and is no longer an input of the action. An `oauth2` scheme's flows stay documentation: the instance's own `auth` names the token endpoint.
- **`app-credential` exchanges run** (`@objectstack/service-automation`), each as its vendor documents it: Feishu's `client_credentials` token at `accounts.feishu.cn` (sent as a bearer token), DingTalk's v1.0 `accessToken` API (sent in `x-acs-dingtalk-access-token`; the legacy `oapi` APIs that take `access_token` in the query are not served), and WeCom's `gettoken` (sent as the `access_token` query parameter). The token is held in memory only, refreshed inside the 30 second skew margin, and concurrent asks share one exchange. The token request never follows a redirect. No answer, `429` or `5xx` is `CONNECTOR_UPSTREAM_UNAVAILABLE`; a refusal is a `503` naming the vendor's error code only, never the secret.
- **WeCom early invalidation.** WeCom answers an invalidated token inside an ordinary answer (`errcode` `40014` or `42001`). A WeCom instance's actions treat that as the `401` rule does: the token is obtained afresh once and the call is repeated once; a second refusal is the `503`.
- **The guard.** An `app-credential` instance is served on a provider that asks the credential handle and held degraded, naming the provider, on one that does not. `mcp` does not ask the handle yet, so an `oauth2` or `app-credential` instance on `mcp` stays degraded.
