---
"@objectstack/connector-mcp": minor
---

feat(connector-mcp): a declarative stdio MCP transport runs in the declaring app's root, so its relative command and args resolve there wherever the server was started

Clause-②: yes (widening)

- **What changes.** For a declarative `provider: 'mcp'` connector with a stdio transport, the `mcp` provider factory now sets the child process's working directory to the app's root. It reads that root from the host through `ConnectorProviderContext.resolvePackagePath('.')`. Relative paths in the entry now resolve against the same root as the app's other relative refs, such as the `openapi` provider's `providerConfig.spec`. That covers a relative `command` path (`./bin/server`) and a script the launched program opens itself (`args: ['./scripts/server.mjs']` with `command: 'node'`). Before this change they resolved against the directory the server was started from. A boot from any other directory, such as `os verify --app examples/app-showcase/objectstack.config.ts` from the repository root, therefore registered the connector degraded, with no actions.
- **What does not change.** A bare executable (`node`, `npx`) is still looked up on `PATH`, and an absolute command or argument resolves as before. The `declarativeStdio` policy judges the `command` string exactly as written, and it runs before the root is resolved. `providerConfig.transport` gains no key: the working directory comes from the host, and an authored `cwd` there is not used. A host that does not provide `resolvePackagePath` starts the child exactly as before, in the host's current directory. A server that opens relative files of its own now opens them under the app's root.
- **New on the exported type.** The stdio variant of `McpTransport` gains an optional `cwd`, which the default client passes to the MCP SDK's `StdioClientTransport`. A hand-wired transport (`new ConnectorMcpPlugin({ transport })` or `createMcpConnector`) may set it. Left out, the child inherits the host's current directory, as before.
- **Nothing to migrate.** An app that started its server from its own directory sees no difference, because both anchors were the same directory.
