---
'@objectstack/skills': patch
---

docs(skills): the integration recipes say the connector `auth` union declares `oauth2` and `app-credential`, held degraded until a server runs the grant, and that `signed` signs `aliyun-acs3` and `tencentcloud-tc3` requests

Clause-②: no
Metadata-protocol: none

This text shipped in PR #28290 (#28226), which carried a changeset for `@objectstack/lint` only and missed its `@objectstack/skills` one; this entry carries it.

- **`objectstack-automation/references/integration-recipes.md`**: an OAuth-protected vendor declares `oauth2` (`authorization_code` / `client_credentials`) or `app-credential` (`feishu` / `dingtalk` / `wecom`), but no server runs the grant yet, so the instance is held degraded and calls no upstream. `signed` on `openapi` / `rest` (scheme `aliyun-acs3-hmac-sha256` or `tencentcloud-tc3-hmac-sha256`, with a `keyId`) signs each request; an RSA-signing vendor (Alipay, WeChat Pay) stays blocked on the request-signing card.
