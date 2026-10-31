// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConnectorProviderFactory, ResolvedConnectorAuth } from '@objectstack/spec/integration';
import { ConnectorCredentialRejectedError, ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
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
 * The HTTP status of a credential rejection carried by `err` (or by an error in
 * its `cause` chain), else `undefined`. Only the MCP SDK's own HTTP-transport
 * errors count — a `StreamableHTTPError` with status 401 / 403, or the SDK's
 * `UnauthorizedError` — so a JSON-RPC error that merely carries a numeric code
 * is never mistaken for one. The SDK is imported lazily, as the default client
 * does, and only on this failure path.
 */
async function credentialRejectionStatus(err: unknown): Promise<number | undefined> {
  const [{ StreamableHTTPError }, { UnauthorizedError }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
    import('@modelcontextprotocol/sdk/client/auth.js'),
  ]);
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur instanceof Error; depth++) {
    if (cur instanceof StreamableHTTPError && (cur.code === 401 || cur.code === 403)) return cur.code;
    if (cur instanceof UnauthorizedError) return 401;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
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
 * A declarative stdio transport runs **in the declaring app's root** (#22423):
 * when the host hands `ConnectorProviderContext.resolvePackagePath`, the
 * child's working directory is `resolvePackagePath('.')`, so the app's relative
 * `command` and `args` resolve against the same anchor as its other relative
 * refs (the `openapi` provider's `providerConfig.spec`, read through
 * `loadPackageFile`), not against the directory the server was started from.
 * The anchor is the host's: `providerConfig.transport` carries no working
 * directory, and an author cannot write one. A host without the member keeps
 * the previous behaviour — no `cwd`, so the child inherits the host's current
 * directory. The policy check runs first and is unchanged: it judges the
 * `command` string exactly as written.
 *
 * The connection is opened at materialization. Faults are classified (#3017):
 * an invalid transport shape is a *configuration* fault and throws plain —
 * fatal at boot per the ADR-0097 fail-loud contract — while a connect /
 * `tools/list` failure (server down, refused, timed out) is an *operational*
 * fault and throws {@link ConnectorUpstreamUnavailableError}, which the
 * materializer turns into a degraded instance that is retried with backoff
 * instead of aborting the whole app boot. The one exception past transport
 * validation is a **rejected credential**: an HTTP 401 / 403 during connect,
 * handshake or `tools/list` throws {@link ConnectorCredentialRejectedError} —
 * a configuration fault the materializer degrades the instance for (see
 * {@link credentialRejectionStatus}, #27237). A handshake that carried the
 * instance's credential answers `credentialVerified`.
 *
 * `providerConfig.include` (optional) narrows the actions to an allowlist of
 * tool names, with the `openapi` provider's meaning. An `include` that is not
 * an array of non-empty strings is refused before connecting, and an entry
 * naming a tool the server's `tools/list` does not carry is refused after
 * listing (the connection is closed first); both are configuration faults.
 * The instance never falls back to exposing every tool. The second refusal is
 * thrown plain when the handshake carried no instance credential, and as
 * {@link ConnectorCredentialRejectedError} when it did: a server may list only
 * the tools a credential is allowed to use (GitHub's hides a tool a classic
 * token's scopes do not cover), and nothing in a `tools/list` answer tells a
 * tool hidden from this credential apart from one the server never had, so the
 * refusal names both and takes the credential's path — the instance degraded,
 * a stored credential marked `rejected`, the boot not failed.
 */
export function createMcpProviderFactory(deps: McpProviderDeps = {}): ConnectorProviderFactory {
  return async (ctx) => {
    const cfg = (ctx.providerConfig ?? {}) as McpProviderConfig;
    let transport = normalizeTransport(cfg.transport, ctx.name, ctx.auth);
    if (transport.kind === 'stdio') {
      assertDeclarativeStdioAllowed(deps.declarativeStdio, transport.command, ctx.name);
      // One anchor for the app's relative paths (#22423). A resolver that
      // throws is a host fault: it propagates plain, a configuration error
      // (fatal at boot), never upstream-unavailable.
      if (ctx.resolvePackagePath) {
        transport = { ...transport, cwd: await ctx.resolvePackagePath('.') };
      }
    }
    // `include` keeps the `openapi` provider's meaning (one allowlist, two
    // providers): absent ⇒ every tool; otherwise an array of non-empty tool
    // names. Any other shape is a configuration fault, thrown plain before
    // connecting — fatal at boot, a skipped entry on reload. An allowlist that
    // dropped a shape it could not read would expose every tool the server
    // has, the very ones the author meant to keep out of flows and agents.
    if (
      cfg.include !== undefined &&
      (!Array.isArray(cfg.include) ||
        cfg.include.some((entry) => typeof entry !== 'string' || entry.length === 0))
    ) {
      throw new Error(
        `connector-mcp provider: connector '${ctx.name}' providerConfig.include must be an array of ` +
          `tool names (strings): each the name of a tool the MCP server lists in tools/list.`,
      );
    }
    const includeList = cfg.include as readonly string[] | undefined;
    // The allowlist rides the connector's own `include` predicate; every tool
    // name the server lists is recorded on the way, so an entry nothing
    // matched can be named in the refusal below.
    const listedTools: string[] = [];
    const include = includeList
      ? (toolName: string) => {
          listedTools.push(toolName);
          return includeList.includes(toolName);
        }
      : undefined;

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
      // A credential the server rejects (HTTP 401 / 403 on connect, handshake
      // or tools/list) is a configuration fault on ADR-0097's configuration /
      // operational split, like an unresolvable credentialRef and like the
      // openapi provider's 401 on its spec fetch: retrying cannot make a wrong,
      // missing or under-scoped credential valid, and a degraded instance
      // retried with backoff reads as "server down", hiding the misconfiguration
      // the author has to fix. Credential-protected remote servers are the
      // common case, so it is told apart by the SDK's HTTP status. [#27237]
      // Thrown as `ConnectorCredentialRejectedError` (ruling on #27237,
      // comment 6470087293): the materializer degrades the instance naming the
      // refusal and marks a stored credential `rejected`, instead of failing
      // boot. Whether it retries is the materializer's call, by where the
      // credential came from: a stored or declared one waits for its next
      // change, an environment or vault one retries with backoff.
      const status = await credentialRejectionStatus(err);
      if (status !== undefined) {
        throw new ConnectorCredentialRejectedError(
          `connector-mcp provider: connector '${ctx.name}' was refused by its MCP server (HTTP ${status}): the ` +
            `credential it sent (the instance auth, or providerConfig.transport.headers) is missing, wrong or not ` +
            `authorized. This is a configuration fault — fix the credential. ` +
            `${(err as Error).message}`,
          status,
          { cause: err },
        );
      }
      // Everything else past transport validation is talking to the server
      // (connect, handshake, tools/list) — operational, hence retryable.
      throw new ConnectorUpstreamUnavailableError(
        `connector-mcp provider: connector '${ctx.name}' could not reach its MCP server: ${(err as Error).message}`,
        { cause: err },
      );
    }
    // [#27237] The handshake carried the instance's credential only over
    // http, and only as a header (an api-key `paramName` is not sent): then
    // the server's answer was given to that credential.
    const credentialSent = transport.kind === 'http' && sendsInstanceAuth(ctx.auth);
    if (includeList) {
      // An entry naming a tool the server does not list is refused after the
      // connection is released. Ignoring it would bring the instance up
      // without the tool the author listed (a typo, a tool the server renamed
      // or dropped, or one hidden from this credential), and the first sign
      // would be a flow failing at run time.
      const offered = new Set(listedTools);
      const unknown = [...new Set(includeList)].filter((entry) => !offered.has(entry));
      if (unknown.length > 0) {
        await bundle.close().catch(() => {});
        const named = unknown.map((entry) => `'${entry}'`).join(', ');
        // At most 20 of the server's tool names, as the openapi refusal lists.
        const sample = [...offered].slice(0, 20);
        const more = offered.size > sample.length ? `, … ${offered.size - sample.length} more` : '';
        const listed =
          `the server lists ${offered.size} tool(s): ` + `${sample.map((name) => `'${name}'`).join(', ')}${more}.`;
        if (credentialSent) {
          // A server may list only the tools the credential it was sent is
          // allowed to use: GitHub's hides each tool a classic token's scopes
          // do not cover, and its answer carries nothing about what it hid —
          // no field in the tools/list result, no response header. So a
          // missing tool is the credential's fault or the declaration's, and
          // which one cannot be read off the answer. It takes the credential's
          // path, like a 401 / 403 above: the instance degraded naming both
          // causes, a stored credential marked `rejected` (cleared by setting
          // it again, or by a handshake that lists every entry), and never a
          // failed boot for a value the administrator supplies and can fix.
          // Status 403: the server answered 200 and refused nothing in so many
          // words, and 403 is the status a credential short of the scopes a
          // resource needs is answered with (RFC 6750 §3.1, insufficient_scope;
          // GitHub's server answers a tools/call outside its token's scopes
          // that way). The message quotes no HTTP status for that reason.
          throw new ConnectorCredentialRejectedError(
            `connector-mcp provider: connector '${ctx.name}' providerConfig.include names ${named}, which the MCP ` +
              `server does not list for the credential this instance sent. A server may list only the tools a ` +
              `credential is allowed to use, and its tools/list answer cannot tell the two causes apart: either the ` +
              `credential lacks the scopes or permissions these tools need — fix the credential, then set it ` +
              `again — or the declaration names a tool this server does not have — fix providerConfig.include. ` +
              `For this credential, ${listed}`,
            403,
          );
        }
        // No instance credential reached the server, so its list is not one
        // filtered for a credential: a configuration fault, thrown plain —
        // fatal at boot, a skipped entry on reload.
        throw new Error(
          `connector-mcp provider: connector '${ctx.name}' providerConfig.include names ` +
            `${named}, which the MCP server does not list. ` +
            `Each entry must be the name of a tool from the server's tools/list; ${listed}`,
        );
      }
    }
    // [#27237] Then the server's answer proved the credential.
    const credentialVerified = credentialSent;
    return {
      def: bundle.def,
      handlers: bundle.handlers,
      close: bundle.close,
      ...(credentialVerified ? { credentialVerified } : {}),
    };
  };
}

/** Whether {@link applyAuthToHeaders} puts the instance's credential on the http transport. */
function sendsInstanceAuth(auth: ResolvedConnectorAuth | undefined): boolean {
  if (!auth || auth.type === 'none') return false;
  return !(auth.type === 'api-key' && auth.paramName);
}
