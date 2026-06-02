# @objectstack/connector-mcp

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Minor Changes

- 6e4b3f2: MCP Connector (ADR-0024) — adopt any Model Context Protocol server as a connector.

  Adds `@objectstack/connector-mcp`, a single generic adapter that turns _any_
  MCP server into an ordinary `type: 'api'` connector on the automation engine —
  no per-server code:

  - `createMcpConnector({ transport, include?, … })` connects over **stdio** or
    **streamable-HTTP**, calls `tools/list`, and maps each tool to a connector
    action (`name → key`, `description → label/description`,
    `inputSchema → inputSchema`). Handlers dispatch to `tools/call` and normalise
    the result to the shared `{ ok, content, … }` envelope (logical tool errors
    surface as `ok: false` rather than throwing).
  - `ConnectorMcpPlugin` registers the connector via the existing
    `engine.registerConnector()` path (no new engine surface, no `mcp_call` node)
    and tears the MCP connection down on shutdown. Fail-soft: an unreachable
    server or missing automation engine is logged and skipped.
  - Credentials live with the MCP server (transport `env`/`headers`), never in
    `ConnectorSchema` and never in the serialized, discovery-exposed `def`.

  Open-tier scope: client adapter + operator-supplied static credentials. A
  curated server registry, managed secrets, per-tenant lifecycle, and sandboxed
  stdio execution remain the enterprise tier.

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
