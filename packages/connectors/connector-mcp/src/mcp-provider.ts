// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorProviderFactory, ResolvedConnectorAuth } from '@objectstack/spec/integration';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import { createMcpConnector, type McpConnectorOptions, type McpTransport } from './mcp-connector.js';

/**
 * The provider key this package contributes (ADR-0097). A declarative
 * `connectors:` entry with `provider: 'mcp'` is materialized by this factory.
 */
export const MCP_PROVIDER_KEY = 'mcp';

/**
 * Host policy for **declarative** stdio transports (#3055). A stdio transport
 * launches a local child process, and declarative entries arrive through
 * metadata — including a runtime Studio publish — so spawning from them is
 * gated OFF by default:
 *
 *  - `undefined` / `false` — deny (default): a `provider: 'mcp'` entry with a
 *    stdio transport is rejected as a configuration fault.
 *  - `string[]` — allowlist: the transport's `command` must strictly equal one
 *    of the listed commands. NOTE this is a coarse trust boundary — listing a
 *    launcher like `npx` effectively allows any package it can run; list the
 *    specific server binaries you trust. Sandboxed execution is the enterprise
 *    tier (ADR-0024 §4).
 *  - `true` — allow any command (explicit full trust; hosts that treat every
 *    metadata author as an operator).
 *
 * Hand-wired connectors (plugin instance options / `createMcpConnector`) are
 * NOT subject to this policy: their command was written in host code, a
 * different trust anchor than metadata.
 */
export type McpDeclarativeStdioPolicy = boolean | string[];

/** Injectable dependencies for {@link createMcpProviderFactory} (tests). */
export interface McpProviderDeps {
  /** Injected MCP client factory; defaults to the SDK-backed client. */
  clientFactory?: McpConnectorOptions['clientFactory'];
  /** Policy for declarative stdio transports (#3055). Default: deny. */
  declarativeStdio?: McpDeclarativeStdioPolicy;
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
 * Enforce the {@link McpDeclarativeStdioPolicy} for one declarative instance
 * (#3055). Throws a **plain** Error on violation: a security-policy rejection
 * is a configuration fault — fatal at boot, skipped+logged on reload — and must
 * never be classified upstream-unavailable (it cannot be retried into
 * existence).
 */
function assertDeclarativeStdioAllowed(
  policy: McpDeclarativeStdioPolicy | undefined,
  command: string,
  connectorName: string,
): void {
  if (policy === true) return;
  if (Array.isArray(policy)) {
    if (policy.includes(command)) return;
    throw new Error(
      `connector-mcp provider: connector '${connectorName}' declares a stdio transport with command '${command}', ` +
        `which is not in the host's declarativeStdio allowlist [${policy.join(', ')}]. ` +
        `Add the command to new ConnectorMcpPlugin({ declarativeStdio: [...] }) if this server is trusted: a stdio ` +
        `transport launches a local process, so stack metadata may only name a command the host's own code allows.`,
    );
  }
  throw new Error(
    `connector-mcp provider: connector '${connectorName}' declares a stdio transport (command '${command}'), ` +
      `but declarative stdio transports are disabled by default — a stdio transport launches a local process ` +
      `from stack metadata (including runtime Studio publishes). If this server is trusted, opt in deliberately: ` +
      `new ConnectorMcpPlugin({ declarativeStdio: ['${command}'] }) — or use an http transport, which this policy ` +
      `does not gate (ADR-0024 §4).`,
  );
}

/**
 * Build the `mcp` {@link ConnectorProviderFactory} (ADR-0097 / ADR-0024). At boot
 * the automation service invokes it for each `provider: 'mcp'` declarative
 * instance: it connects to the MCP server named by `providerConfig.transport`,
 * lists its tools, and produces the same `{ def, handlers, close }` bundle
 * {@link createMcpConnector} builds for a hand-wired MCP connector — one action
 * per tool, dispatched to the server's `tools/call`.
 *
 * Stdio transports on declarative instances are policy-gated (default deny) —
 * see {@link McpDeclarativeStdioPolicy} (#3055).
 *
 * The connection is opened at materialization. Faults are classified (#3017):
 * an invalid transport shape is a *configuration* fault and throws plain —
 * fatal at boot per the ADR-0097 fail-loud contract — while a connect /
 * `tools/list` failure (server down, refused, timed out) is an *operational*
 * fault and throws {@link ConnectorUpstreamUnavailableError}, which the
 * materializer turns into a degraded instance that is retried with backoff
 * instead of aborting the whole app boot.
 */
export function createMcpProviderFactory(deps: McpProviderDeps = {}): ConnectorProviderFactory {
  return async (ctx) => {
    const cfg = (ctx.providerConfig ?? {}) as McpProviderConfig;
    const transport = normalizeTransport(cfg.transport, ctx.name, ctx.auth);
    if (transport.kind === 'stdio') {
      assertDeclarativeStdioAllowed(deps.declarativeStdio, transport.command, ctx.name);
    }
    const includeList = Array.isArray(cfg.include)
      ? cfg.include.filter((x): x is string => typeof x === 'string')
      : undefined;
    const include = includeList ? (toolName: string) => includeList.includes(toolName) : undefined;

    let bundle;
    try {
      bundle = await createMcpConnector({
        name: ctx.name,
        label: ctx.label,
        description: ctx.description,
        transport,
        include,
        clientFactory: deps.clientFactory,
      });
    } catch (err) {
      // Everything past transport validation is talking to the server (connect,
      // handshake, tools/list) — operational, hence retryable. A credential the
      // server rejects also lands here: indistinguishable from the outside, and
      // retrying it is loud (logged per attempt), never silent.
      throw new ConnectorUpstreamUnavailableError(
        `connector-mcp provider: connector '${ctx.name}' could not reach its MCP server: ${(err as Error).message}`,
        { cause: err },
      );
    }
    return { def: bundle.def, handlers: bundle.handlers, close: bundle.close };
  };
}
