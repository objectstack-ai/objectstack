---
"create-objectstack": minor
---

feat(create-objectstack): the blank scaffold ships the three generic connector executors by default

`npm create objectstack` now generates an `objectstack.config.ts` that wires the
`rest`, `openapi`, and `mcp` connector executor plugins (ADR-0022/0023/0024 +
ADR-0097) into `plugins:`, alongside `requires: ['automation']`. This closes the
last authoring gap in the ADR-0097 promise that integrations are expressible
**and executable** as pure metadata: an author (human or AI) can now add a
declarative `connectors:` entry naming `provider: 'rest' | 'openapi' | 'mcp'`
and have it materialize into a live, dispatchable connector at boot — with no
host-code edit.

- `plugins:` — `new ConnectorRestPlugin()`, `new ConnectorOpenApiPlugin()`,
  `new ConnectorMcpPlugin()` (zero-arg = contribute the provider factory only).
- `requires: ['automation']` — the automation service performs the
  materialization and owns the registry the executors register into. It is also
  a hard dependency of the connector plugins, so a scaffold that lists them in
  `plugins:` without it fails boot; automation ships transitively via
  `@objectstack/cli`.
- deps — `@objectstack/connector-rest`, `@objectstack/connector-openapi`,
  `@objectstack/connector-mcp`.
- Security (#3055): declarative `mcp` stdio transports stay denied by default —
  opt in per host with `new ConnectorMcpPlugin({ declarativeStdio: ['node'] })`.

Brand connectors (Slack, …) remain marketplace/opt-in.
