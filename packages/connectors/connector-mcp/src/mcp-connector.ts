// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector } from '@objectstack/spec/integration';

/**
 * MCP connector — a *generic* adapter that turns any Model Context Protocol
 * server into a {@link Connector} (ADR-0024). Where `connector-rest` and
 * `connector-slack` are concrete, per-service connectors, this one is a single
 * adapter that adopts the entire MCP ecosystem with **no per-server code**:
 *
 *   1. connect to the MCP server over the configured transport,
 *   2. call `tools/list` and map each tool to a connector action
 *      (`name → key`, `description → label/description`, `inputSchema → inputSchema`),
 *   3. build an ordinary `type: 'api'` {@link Connector} once, and
 *   4. dispatch each `connector_action` call to the server's `tools/call`.
 *
 * After construction the registry, the `connector_action` node, the discovery
 * route, and the Studio palette all see a plain connector — they never know it
 * is backed by MCP (ADR-0024 §2).
 *
 * **Credentials live with the MCP server, not in `ConnectorSchema`** (ADR-0024
 * §3). The operator supplies `env` (stdio) / `headers` (http) which we pass
 * straight to the transport; they are never copied into the serialized `def`
 * (which is exposed via discovery) and must never be logged.
 *
 * **Trust:** launching a stdio server runs a local process. Sandboxed,
 * multi-tenant execution and managed secrets are the enterprise tier (ADR-0024
 * §4); the open adapter runs an operator-provided server with operator-provided
 * credentials and documents that trust assumption.
 */

/** How to reach the MCP server. */
export type McpTransport =
    | {
          kind: 'stdio';
          /** Executable to launch (e.g. `npx`). */
          command: string;
          /** Arguments passed to the command. */
          args?: string[];
          /** Environment variables for the child process — carries credentials. */
          env?: Record<string, string>;
      }
    | {
          kind: 'http';
          /** Streamable-HTTP endpoint of the MCP server. */
          url: string;
          /** Headers sent on every request — carries credentials (e.g. a bearer token). */
          headers?: Record<string, string>;
      };

/** A tool as advertised by an MCP server's `tools/list`. */
export interface McpToolDescriptor {
    name: string;
    description?: string;
    /** JSON Schema for the tool's arguments. */
    inputSchema?: Record<string, unknown>;
    /** JSON Schema for the tool's result (optional — many servers omit it). */
    outputSchema?: Record<string, unknown>;
}

/**
 * The minimal slice of an MCP client the adapter needs. Kept structural so
 * tests can inject a fake and the real SDK stays an implementation detail
 * (mirrors `fetchImpl` injection in `connector-rest`).
 */
export interface McpClientLike {
    /** List the server's tools (`tools/list`). */
    listTools(): Promise<McpToolDescriptor[]>;
    /** Invoke a tool (`tools/call`); returns the raw MCP result. */
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
    /** Close the connection / tear down the transport. */
    close(): Promise<void>;
}

export interface McpConnectorOptions {
    /** Connector machine name (snake_case). Defaults to a slug of `label`, else `mcp`. */
    name?: string;
    /** Human-readable label. Defaults to a title derived from `name`. */
    label?: string;
    /** Connector description for the palette. */
    description?: string;
    /** Icon identifier. Defaults to `plug`. */
    icon?: string;
    /** How to reach the MCP server. */
    transport: McpTransport;
    /** Only expose tools whose name matches (allowlist) — keeps the palette lean. */
    include?: (toolName: string) => boolean;
    /** Identifies this client to the MCP server during the handshake. */
    clientInfo?: { name: string; version: string };
    /**
     * Injected for tests; defaults to the real SDK-backed client. Receives the
     * configured transport and returns a connected {@link McpClientLike}.
     */
    clientFactory?: (transport: McpTransport, clientInfo: { name: string; version: string }) => Promise<McpClientLike>;
}

/**
 * A connector definition + handlers, ready for `engine.registerConnector()`,
 * plus a `close()` for the connection lifecycle (called by the plugin's stop()).
 */
export interface McpConnectorBundle {
    def: Connector;
    handlers: Record<
        string,
        (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
    >;
    /** Tear down the MCP client/connection. */
    close(): Promise<void>;
}

const DEFAULT_CLIENT_INFO = { name: 'objectstack-connector-mcp', version: '1.0.0' } as const;

/** Slugify a label into a valid connector `name` (`/^[a-z_][a-z0-9_]*$/`). */
function slugify(input: string): string {
    const slug = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!slug) return 'mcp';
    // The name must start with a letter or underscore.
    return /^[a-z_]/.test(slug) ? slug : `mcp_${slug}`;
}

/** Title-case a snake_case name for a default label (`github_issues` → `Github Issues`). */
function titleize(name: string): string {
    return name
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

/**
 * Normalise an MCP `tools/call` result into the connector handler's return
 * shape, mirroring the `{ ok, … }` envelope the other connectors expose. An MCP
 * result carries `content` blocks and an optional `isError` flag /
 * `structuredContent`; we surface `ok` from `isError` (never throwing on a
 * logical tool error so the flow author can branch on `${node.ok}`).
 */
function normalizeResult(raw: unknown): Record<string, unknown> {
    const result = (raw ?? {}) as Record<string, unknown>;
    const isError = result.isError === true;
    const out: Record<string, unknown> = {
        ok: !isError,
        content: result.content ?? [],
    };
    if (result.structuredContent !== undefined) out.structuredContent = result.structuredContent;
    if (isError) out.isError = true;
    return out;
}

/**
 * Default per-request timeout (ms) for MCP calls (P1-1). Without it, a hung or
 * unresponsive MCP server stalls the agent turn indefinitely. The SDK aborts the
 * request once this elapses.
 */
const MCP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The default {@link McpClientLike} — lazily imports the official MCP SDK so it
 * is only loaded when a real connection is made (tests inject their own client).
 */
async function defaultClientFactory(
    transport: McpTransport,
    clientInfo: { name: string; version: string },
): Promise<McpClientLike> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const client = new Client(clientInfo, { capabilities: {} });

    if (transport.kind === 'stdio') {
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        await client.connect(
            new StdioClientTransport({
                command: transport.command,
                args: transport.args,
                env: transport.env,
            }),
        );
    } else {
        const { StreamableHTTPClientTransport } = await import(
            '@modelcontextprotocol/sdk/client/streamableHttp.js'
        );
        await client.connect(
            new StreamableHTTPClientTransport(new URL(transport.url), {
                requestInit: transport.headers ? { headers: transport.headers } : undefined,
            }),
        );
    }

    return {
        async listTools() {
            const res = await client.listTools(undefined, { timeout: MCP_REQUEST_TIMEOUT_MS });
            return (res.tools ?? []) as McpToolDescriptor[];
        },
        async callTool(name, args) {
            return client.callTool({ name, arguments: args }, undefined, { timeout: MCP_REQUEST_TIMEOUT_MS });
        },
        async close() {
            await client.close();
        },
    };
}

/**
 * Connect to an MCP server, discover its tools, and build a {@link Connector}
 * whose actions dispatch to the server's `tools/call`. The connection is held
 * open for the lifetime of the bundle; call {@link McpConnectorBundle.close} to
 * tear it down.
 */
export async function createMcpConnector(opts: McpConnectorOptions): Promise<McpConnectorBundle> {
    const clientInfo = opts.clientInfo ?? DEFAULT_CLIENT_INFO;
    const factory = opts.clientFactory ?? defaultClientFactory;

    const client = await factory(opts.transport, clientInfo);

    let tools: McpToolDescriptor[];
    try {
        tools = await client.listTools();
    } catch (err) {
        // Discovery failed after connecting — release the connection rather than
        // leaking it, then surface the error to the caller (the plugin fail-soft).
        await client.close().catch(() => {});
        throw err;
    }

    const include = opts.include ?? (() => true);
    const selected = tools.filter((t) => include(t.name));

    const name = opts.name ?? slugify(opts.label ?? 'mcp');
    const label = opts.label ?? titleize(name);

    const handlers: McpConnectorBundle['handlers'] = {};
    const def: Connector = {
        name,
        label,
        type: 'api',
        description:
            opts.description ?? `MCP connector exposing ${selected.length} tool(s) from a Model Context Protocol server.`,
        icon: opts.icon ?? 'plug',
        // MCP servers own their own auth (passed via transport env/headers); we
        // do not model the upstream's credentials in ConnectorSchema (ADR-0024 §3).
        authentication: { type: 'none' },
        // Defaulted by ConnectorSchema; set explicitly so the literal satisfies
        // the (post-parse) Connector output type.
        status: 'active',
        enabled: true,
        // `connectionTimeoutMs` — REMOVED with the spec key (ADR-0049): it was
        // written here only so the literal satisfied the post-parse type, and
        // the platform never applied it as a connect deadline.
        requestTimeoutMs: 30000,
        actions: selected.map((tool) => ({
            key: tool.name,
            // MCP tool names are machine names; derive a readable label and keep
            // the server's description verbatim (ADR-0024 `description → label/description`).
            label: titleize(slugify(tool.name)),
            description: tool.description,
            // The MCP inputSchema is already JSON Schema — pass it straight through.
            inputSchema: tool.inputSchema,
            // Many servers omit outputSchema; leave it unset when absent (as the
            // REST connector does for untyped responses).
            outputSchema: tool.outputSchema,
        })),
    };

    for (const tool of selected) {
        handlers[tool.name] = async (input) => normalizeResult(await client.callTool(tool.name, input));
    }

    return {
        def,
        handlers,
        close: () => client.close(),
    };
}
