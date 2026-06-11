# @objectstack/plugin-mcp-server

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- d8c5374: ai
  - @objectstack/spec@8.0.1
  - @objectstack/core@8.0.1
  - @objectstack/types@8.0.1

## 8.0.0

### Major Changes

- d9f72fe: refactor(mcp)!: rename `@objectstack/plugin-mcp-server` → `@objectstack/mcp` (ADR-0036)

  The outbound MCP-server package drops the legacy `plugin-` prefix and moves to
  the top level (`packages/mcp`), parallel to `@objectstack/rest` — both are "your
  app exposed over a protocol". Inbound MCP (consuming external servers) stays
  `@objectstack/connector-mcp`.

  **Breaking:** the package name changed. Update imports
  `@objectstack/plugin-mcp-server` → `@objectstack/mcp`. The exported API
  (`MCPServerPlugin`, `MCPServerRuntime`, `registerObjectTools`, `McpDataBridge`,
  …) is unchanged. The internal plugin id is now `com.objectstack.mcp`. Pre-launch
  clean break — no compatibility shim (only `@objectstack/cli` depended on it
  internally).

### Minor Changes

- 87cb13c: feat(mcp): generic ObjectStack Agent Skill generator (ADR-0036 Phase 2b)

  Adds `renderSkillMarkdown({ mcpUrl, envName })` — produces a portable
  `SKILL.md` (open Agent Skills standard: Claude Code, OpenAI Codex, Gemini CLI,
  Copilot, Cursor, …) that teaches any skills-capable agent how to drive an
  ObjectStack environment over MCP.

  Per ADR-0036 Amendment C, this is ONE generic skill, not a per-app artifact:

  - the content never enumerates a tenant's schema — it instructs the agent to
    discover live via `list_objects` / `describe_object`, so one install works for
    every app the caller's key can reach and a new app needs no reinstall;
  - only the connection URL is environment-specific, slotted in by the caller;
  - it documents the object-CRUD tools, auth via `x-api-key` (Bearer is session
    auth), and the governance model (every call runs under the caller's
    permissions + RLS — fewer rows / write rejections are expected, not bugs).

  Exported: `renderSkillMarkdown`, `OBJECTSTACK_SKILL_NAME`,
  `OBJECTSTACK_SKILL_DESCRIPTION`, `RenderSkillOptions`. The objectui/cloud
  surfacing layer calls this to offer a one-click skill download alongside the
  env's remote-MCP URL and a show-once key.

- bc0d85b: feat(mcp): Streamable HTTP transport — every app is a network-reachable MCP server (ADR-0036 Phase 2)

  The MCP server plugin spoke **stdio only**, so a remote agent (Claude Desktop /
  Cursor) could not connect to a hosted env. This adds the **Streamable HTTP**
  transport and wires it into the runtime's request path, building on the Phase 1a
  `sys_api_key` auth foundation.

  - **`@objectstack/mcp`** (renamed from `@objectstack/plugin-mcp-server` — see the rename changeset)

    - `MCPServerRuntime.handleHttpRequest(request, { bridge, parsedBody })` —
      serves one MCP request over the Web-standard `WebStandardStreamableHTTPServerTransport`
      (runs on Node 18+, Workers, Deno, Bun). **Stateless**: a fresh, isolated
      `McpServer` + transport is built per request (the SDK-recommended pattern),
      in JSON-response mode so the response is fully buffered — no streaming
      pass-through concerns over the Worker→container hop.
    - New `registerObjectTools` + `McpDataBridge` (`mcp-http-tools.ts`): the
      object-CRUD tool set (`list_objects`, `describe_object`, `query_records`,
      `get_record`, `create_record`, `update_record`, `delete_record`). All
      execution is delegated to an injected, **principal-bound** bridge — the tool
      layer never touches the data engine directly. System (`sys_*`) objects are
      **not exposed** by default (fail-closed guard on every object-scoped tool).
      The internal AI/authoring toolRegistry is deliberately NOT bridged onto the
      external surface.

  - **`@objectstack/runtime`**
    - `HttpDispatcher` serves `/mcp`: **opt-in** via `OS_MCP_SERVER_ENABLED=true`
      (404 when off, so the surface isn't advertised); **fail-closed auth**
      (anonymous → 401 — requires the principal resolved by Phase 1a's API-key
      path or a session). It builds an `McpDataBridge` that runs every operation
      through the existing `callData` path bound to the request's
      `ExecutionContext`, so external agents run under the key's permissions + RLS,
      never a parallel or escalated path. The discovery endpoint advertises `mcp`
      only when enabled.

  Security: every external MCP entry runs as the scoped `sys_api_key` principal
  under existing object permissions + RLS; MCP is opt-in per env; no raw keys or
  secrets cross the wire. Fully unit-tested (transport handshake/tools, gate,
  auth, principal binding).

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

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
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1

## 7.4.0

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
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/types@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3
