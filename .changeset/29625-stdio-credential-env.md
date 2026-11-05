---
'@objectstack/skills': patch
---

docs(skills): the automation skill's OAuth recipe names a stdio MCP server's credential route as `transport.credentialEnv`

Clause-②: no
Metadata-protocol: none

Recipe 6 of `objectstack-automation/references/integration-recipes.md` said a `stdio` server's credentials ride `transport.env` — the literal-in-metadata route the `connector-credential-literal` advisory warns against. It now says what the `mcp` provider does: the grant-bearing kinds stay `http` only; a `stdio` server takes a static `auth: { type: 'bearer', credentialRef }`, handed to the child process in the variable `transport.credentialEnv` names, never a literal in `transport.env`. Paid inside the file's token ceiling by dropping the opening paragraph's restatement of two facts that keep their homes: the packaged spec (SKILL.md § Integrations are declared, not coded) and where an `api` hook's secret goes (SKILL.md's `secretRef` row and recipe 4). No eval asserted the old route; none changes.
