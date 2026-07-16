// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorProviderFactory, ResolvedConnectorAuth } from '@objectstack/spec/integration';
import { createMcpConnector, type McpConnectorOptions, type McpTransport } from './mcp-connector.js';

/**
 * The provider key this package contributes (ADR-0096). A declarative
 * `connectors:` entry with `provider: 'mcp'` is materialized by this factory.
 */
export const MCP_PROVIDER_KEY = 'mcp';

/** Injectable dependencies for {@link createMcpProviderFactory} (tests). */
export interface McpProviderDeps {
  /** Injected MCP client factory; defaults to the SDK-backed client. */
  clientFactory?: McpConnectorOptions['clientFactory'];
}

/** Shape of `providerConfig` for a `provider: 'mcp'` declarative instance. */
interface McpProviderConfig {
  /** How to reach the MCP server (stdio or streamable-http). */
  transport?: unknown;
  /** Optional tool-name allowlist — only these tools become actions. */
  include?: unknown;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

/**
 * Fold the resolved instance `auth` into an MCP **http** transport's headers
 * (ADR-0024 keeps MCP credentials with the transport). `credentialRef` has
 * already been resolved upstream, so this only maps the static credential to the
 * right header. Not applied to stdio transports — a stdio server receives its
 * credentials through `transport.env`.
 */
function applyAuthToHeaders(
  auth: ResolvedConnectorAuth | undefined,
  headers: Record<string, string>,
): void {
  if (!auth || auth.type === 'none') return;
  switch (auth.type) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${auth.token}`;
      return;
    case 'basic':
      headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
      return;
    case 'api-key':
      // Header-based only for MCP http (query-param keys are not part of the transport).
      if (!auth.paramName) headers[auth.headerName ?? 'X-API-Key'] = auth.key;
      return;
  }
}

/** Validate + normalize `providerConfig.transport`, injecting resolved auth for http. */
function normalizeTransport(
  raw: unknown,
  connectorName: string,
  auth: ResolvedConnectorAuth | undefined,
): McpTransport {
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `connector-mcp provider: connector '${connectorName}' requires providerConfig.transport ` +
        `({ kind: 'stdio', command, ... } or { kind: 'http', url, ... }).`,
    );
  }
  const t = raw as Record<string, unknown>;
  if (t.kind === 'stdio') {
    if (typeof t.command !== 'string' || t.command.length === 0) {
      throw new Error(
        `connector-mcp provider: connector '${connectorName}' stdio transport requires a 'command' string.`,
      );
    }
    return {
      kind: 'stdio',
      command: t.command,
      args: Array.isArray(t.args) ? t.args.map((a) => String(a)) : undefined,
      env: isStringRecord(t.env) ? t.env : undefined,
    };
  }
  if (t.kind === 'http') {
    if (typeof t.url !== 'string' || t.url.length === 0) {
      throw new Error(
        `connector-mcp provider: connector '${connectorName}' http transport requires a 'url' string.`,
      );
    }
    const headers: Record<string, string> = { ...(isStringRecord(t.headers) ? t.headers : {}) };
    applyAuthToHeaders(auth, headers);
    return { kind: 'http', url: t.url, headers: Object.keys(headers).length > 0 ? headers : undefined };
  }
  throw new Error(
    `connector-mcp provider: connector '${connectorName}' providerConfig.transport.kind must be 'stdio' or 'http'.`,
  );
}

/**
 * Build the `mcp` {@link ConnectorProviderFactory} (ADR-0096 / ADR-0024). At boot
 * the automation service invokes it for each `provider: 'mcp'` declarative
 * instance: it connects to the MCP server named by `providerConfig.transport`,
 * lists its tools, and produces the same `{ def, handlers, close }` bundle
 * {@link createMcpConnector} builds for a hand-wired MCP connector — one action
 * per tool, dispatched to the server's `tools/call`.
 *
 * The connection is opened at materialization; an unreachable server or invalid
 * transport therefore fails boot loudly (ADR-0096 fail-loud contract). Prefer a
 * fail-soft plugin instantiation for an *optional* server.
 */
export function createMcpProviderFactory(deps: McpProviderDeps = {}): ConnectorProviderFactory {
  return async (ctx) => {
    const cfg = (ctx.providerConfig ?? {}) as McpProviderConfig;
    const transport = normalizeTransport(cfg.transport, ctx.name, ctx.auth);
    const includeList = Array.isArray(cfg.include)
      ? cfg.include.filter((x): x is string => typeof x === 'string')
      : undefined;
    const include = includeList ? (toolName: string) => includeList.includes(toolName) : undefined;

    const bundle = await createMcpConnector({
      name: ctx.name,
      label: ctx.label,
      description: ctx.description,
      transport,
      include,
      clientFactory: deps.clientFactory,
    });
    return { def: bundle.def, handlers: bundle.handlers, close: bundle.close };
  };
}
