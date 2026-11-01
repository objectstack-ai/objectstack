// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/connector-mcp
 *
 * A generic adapter that turns *any* Model Context Protocol (MCP) server into a
 * {@link Connector} registered on the automation engine (ADR-0024). On connect
 * it lists the server's tools and maps each one to a connector action; the
 * baseline `connector_action` node then dispatches calls to the server's
 * `tools/call`. One adapter unlocks the entire MCP ecosystem with no per-server
 * code — and, because MCP is itself an LLM tool protocol, every imported tool
 * doubles as an AI tool under ADR-0011.
 *
 * Open-source scope: the MCP client adapter (stdio + http transports),
 * `tools/list` → actions, `tools/call` dispatch, operator-supplied static
 * credentials passed through the transport, and — over http — an OAuth-protected
 * server's per-dispatch token through the host's credential handle, one MCP
 * session per organization (ADR-0143 D4; the host runs the MCP authorization
 * flow when an administrator connects the instance). A curated server
 * registry, sandboxed stdio execution and the rest of ADR-0024 §4 stay the
 * enterprise tier.
 */

export {
    createMcpConnector,
    type McpConnectorOptions,
    type McpConnectorBundle,
    type McpTransport,
    type McpToolDescriptor,
    type McpClientLike,
} from './mcp-connector.js';
export {
    ConnectorMcpPlugin,
    type ConnectorMcpPluginOptions,
    type ConnectorRegistrySurface,
} from './connector-mcp-plugin.js';
export {
    createMcpProviderFactory,
    MCP_PROVIDER_KEY,
    type McpProviderDeps,
    type McpDeclarativeStdioPolicy,
} from './mcp-provider.js';
