---
'@objectstack/connector-mcp': minor
'@objectstack/lint': patch
---

Clause-②: yes (widening)
Metadata-protocol: added

`provider: 'mcp'`: a stdio MCP server can now take its credential from the secrets layer instead of a literal in `transport.env`. Declare the instance's `auth` with a `credentialRef` as for an http server, and name the environment variable the server reads in the new `providerConfig.transport.credentialEnv` key: the host resolves the reference (environment, Setup → Connector credentials, the host's resolver) and the provider hands the resolved secret (the `bearer` token, the `api-key` key, or the `basic` password) to the child in that variable. The value is never stored, logged, served on a metadata read or put in a message; a reference that resolves to nothing degrades the instance naming the reference and the server is not started.

```ts
providerConfig: { transport: { kind: 'stdio', command: 'repo-mcp-server', credentialEnv: 'REPO_MCP_TOKEN' } },
auth: { type: 'bearer', credentialRef: 'REPO_MCP_TOKEN' },
```

Refused at materialization as configuration faults (a failed boot for the host's own entry): a `credentialEnv` that is not an environment-variable name, one on an `http` transport, one with no `bearer` / `api-key` / `basic` `auth`, and one naming a variable `transport.env` also sets. A stdio transport that names no `credentialEnv` is unchanged: it does not apply `auth`.

`@objectstack/lint`: the `connector-credential-literal` advisory's finding for a credential literal in `transport.env` now steers to this route (`auth.credentialRef` with `transport.credentialEnv`) instead of telling the author to move to an http transport.
