---
'@objectstack/lint': patch
---

Clause-②: no
Metadata-protocol: none

fix(lint): `connector-credential-literal` now also warns when a stdio MCP server's credential goes nowhere, or when a credential is typed into `transport.credentialEnv`

Two new findings on the existing advisory. Both are warnings, so nothing is refused and every save still lands. They reach `os validate`, `os build`, `os lint` and the connector save door (`PUT /meta/connector/:name`), the same doors the rule already runs on.

- **A stdio `auth` that reaches nothing.** Take a `provider: 'mcp'` entry with a stdio transport and a `bearer`, `api-key` or `basic` `auth`, but no `providerConfig.transport.credentialEnv`. Its reference is still resolved, and a missing one still degrades the instance. But the provider hands the credential to a stdio server only in the variable `credentialEnv` names, so the credential was dropped and nothing said so. The finding sits at `auth` and names the fix. Add `credentialEnv`, or drop `auth` if the server takes no credential:

  ```ts
  providerConfig: { transport: { kind: 'stdio', command: 'repo-mcp-server', credentialEnv: 'REPO_MCP_TOKEN' } },
  auth: { type: 'bearer', credentialRef: 'REPO_MCP_TOKEN' },
  ```

- **A credential in `transport.credentialEnv`.** That key holds the name of an environment variable, and it is served on every metadata read. The rule now warns when the value reads as a credential instead of a name. That means it opens with an auth scheme (`Bearer …`), or it has a run of 16 or more letters and digits that switches between the two at least four times, the way a generated token does. A conventional name such as `REPO_MCP_TOKEN`, or a long capital name, never draws. The finding names the key and never echoes the value.
