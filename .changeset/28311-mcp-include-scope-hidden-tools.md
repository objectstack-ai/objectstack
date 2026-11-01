---
'@objectstack/connector-mcp': patch
'@objectstack/service-automation': patch
---

fix(connector-mcp): when a server that was sent the instance's credential does not list an `include`d tool, the instance is degraded as a credential refusal instead of failing the boot as a declaration fault

Clause-②: no
Metadata-protocol: none

Some MCP servers list only the tools the credential they are sent may use: GitHub's hides each tool a classic personal access token's scopes do not cover. Its `tools/list` answer says nothing about what it hid, so a tool missing from it may be hidden from this credential or may not exist on the server at all.

- **Before.** When `providerConfig.include` named a tool the server did not list, the `mcp` provider refused with a plain configuration fault in every case. With the credential in an environment variable, the whole boot failed. With a credential stored through the credential door, the instance was degraded with a reason telling the administrator to fix the app's declaration.
- **Now.** When the handshake carried the instance's `auth` credential (an `http` transport, the credential sent as a header), the refusal is a `ConnectorCredentialRejectedError` with status `403`. Its message names the missing tools and the tools the server does list for that credential, and it names both causes with the fix for each: give the credential the scopes those tools need and set it again, or fix `providerConfig.include`. The materializer handles it as it handles a `401` / `403`: the instance is degraded and the boot does not fail. A stored credential is marked `rejected` and held until it is set again; an environment or vault credential is retried on the backoff, so widening the token's scopes where it was issued recovers the instance without a restart.
- **Unchanged.** An instance whose handshake carried no static credential (no `auth`, an `api-key` sent as a query parameter, a `stdio` transport, or a grant-bearing `oauth2` / `app-credential` instance, whose token is borrowed per request from an organization's connection) keeps the plain configuration fault, fatal at boot, with the same message as before.
- **Where it reads.** The `sys_connector_credential.status` field description (`@objectstack/service-automation`) now names this second way a stored credential becomes `rejected`.
