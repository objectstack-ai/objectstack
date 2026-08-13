// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveAuthzContext } from '@objectstack/core';
import { readEnvWithDeprecation, isMcpServerEnabled, resolveMcpStdioAutoStart } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IAIService, IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { MCPServerRuntimeConfig } from './mcp-server-runtime.js';
import type { ToolRegistry } from './types.js';
import { createStdioDataBridge, enforceApiExposure, GATED_ACTIONS } from './stdio-data-bridge.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { CONNECT_AGENT_UI_BUNDLE } from './connect-ui.js';

/**
 * Resolve `OS_MCP_STDIO_API_KEY` into an {@link ExecutionContext} through the
 * SAME `@objectstack/core` verify + authorization chain the HTTP and REST
 * surfaces use (`resolveApiKeyPrincipal` → `resolveAuthzContext`), so a stdio
 * read is scoped exactly like the same identity over REST (RLS / FLS / tenant).
 *
 * Fail-closed: returns `undefined` for an unknown / revoked / expired /
 * owner-less key (no `userId` resolved). Re-run per read, so revocation of a
 * key takes effect on the next call of a live stdio session (ADR-0101 D1).
 */
async function resolveStdioExecutionContext(
  ql: { find: (object: string, opts: unknown) => Promise<unknown> },
  apiKey: string,
): Promise<ExecutionContext | undefined> {
  const authz = await resolveAuthzContext({ ql, headers: { 'x-api-key': apiKey } });
  if (!authz.userId) return undefined;
  const ec: ExecutionContext = {
    positions: authz.positions,
    permissions: authz.permissions,
    systemPermissions: authz.systemPermissions,
    isSystem: false,
    principalKind: 'human',
    userId: authz.userId,
  };
  if (authz.tenantId) ec.tenantId = authz.tenantId;
  if (authz.email) ec.email = authz.email;
  if (authz.posture) ec.posture = authz.posture;
  (ec as unknown as { org_user_ids?: string[] }).org_user_ids = authz.org_user_ids;
  // [ADR-0105 D2] The caller's org access set — the `group` posture's Layer 0
  // wall reads it directly, so every transport must carry it.
  (ec as unknown as { accessible_org_ids?: string[] }).accessible_org_ids =
    authz.accessible_org_ids;
  return ec;
}

/**
 * Configuration options for the MCPServerPlugin.
 */
export interface MCPServerPluginOptions {
  /** Override MCP server name. Defaults to 'objectstack'. */
  name?: string;
  /** Override MCP server version. Defaults to package version. */
  version?: string;
  /** Transport mode: 'stdio' (default). */
  transport?: 'stdio' | 'http';
  /** Whether to auto-start the MCP server. Defaults to false (manual start via env var). */
  autoStart?: boolean;
  /** Custom instructions for the MCP server. */
  instructions?: string;
}

/**
 * MCPServerPlugin — Kernel plugin that exposes ObjectStack as an MCP server.
 *
 * Lifecycle:
 * 1. **init** — Creates {@link MCPServerRuntime} and registers as `'mcp'` service.
 * 2. **start** — Bridges ToolRegistry, MetadataService, DataEngine, and Agents
 *    to the MCP server. Starts the long-lived transport (stdio) only when
 *    `autoStart` is enabled or `OS_MCP_SERVER_ENABLED` is explicitly `true` —
 *    the HTTP surface needs no start: the runtime dispatcher serves it
 *    per-request at `/api/v1/mcp` (default-on; `OS_MCP_SERVER_ENABLED=false`
 *    opts out — see `isMcpServerEnabled` in `@objectstack/types`).
 * 3. **destroy** — Stops the MCP transport.
 *
 * Environment Variables:
 * - `OS_MCP_SERVER_ENABLED` — HTTP surface default-on; `false` disables it,
 *   explicit `true` additionally auto-starts the stdio transport
 * - `OS_MCP_SERVER_NAME` — Override server name
 * - `OS_MCP_SERVER_TRANSPORT` — Override transport ('stdio' | 'http')
 *   (legacy `MCP_SERVER_*` names still honoured with a deprecation warning)
 *
 * @example
 * ```ts
 * import { LiteKernel } from '@objectstack/core';
 * import { MCPServerPlugin } from '@objectstack/mcp';
 *
 * const kernel = new LiteKernel();
 * kernel.use(new MCPServerPlugin({ autoStart: true }));
 * await kernel.bootstrap();
 * ```
 */
export class MCPServerPlugin implements Plugin {
  name = 'com.objectstack.mcp';
  /**
   * Services init() registers on every path (ADR-0116, #4131) — lets the
   * kernel name this plugin when a consumer requires one before it inits.
   */
  providesServices = ['mcp'];
  version = '1.0.0';
  type = 'standard' as const;
  dependencies: string[] = [];

  private runtime?: MCPServerRuntime;
  private readonly options: MCPServerPluginOptions;

  constructor(options: MCPServerPluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    const config: MCPServerRuntimeConfig = {
      name: readEnvWithDeprecation('OS_MCP_SERVER_NAME', 'MCP_SERVER_NAME', { silent: true }) ?? this.options.name ?? 'objectstack',
      version: this.options.version ?? '1.0.0',
      transport: (readEnvWithDeprecation('OS_MCP_SERVER_TRANSPORT', 'MCP_SERVER_TRANSPORT', { silent: true }) as 'stdio' | 'http') ?? this.options.transport ?? 'stdio',
      instructions: this.options.instructions,
      logger: ctx.logger,
    };

    this.runtime = new MCPServerRuntime(config);
    ctx.registerService('mcp', this.runtime);

    ctx.logger.info('[MCP] Plugin initialized');
  }

  async start(ctx: PluginContext): Promise<void> {
    if (!this.runtime) return;

    // ── Bridge tools from AIService ──
    // The IAIService contract does not formally include `toolRegistry` because
    // it is an implementation detail of AIService.  We use duck-typing here to
    // avoid a hard dependency on @objectstack/service-ai while still bridging
    // tools when the full AIService implementation is present.
    try {
      const aiService = ctx.getService<IAIService & { toolRegistry?: ToolRegistry }>('ai');
      if (aiService?.toolRegistry) {
        this.runtime.bridgeTools(aiService.toolRegistry);
      } else {
        ctx.logger.debug('[MCP] AI service does not expose a toolRegistry, skipping tool bridging');
      }
    } catch {
      ctx.logger.debug('[MCP] AI service not available, skipping tool bridging');
    }

    // ── Metadata service for the resource bridge ──
    let metadataService: IMetadataService | undefined;
    try {
      metadataService = ctx.getService<IMetadataService>('metadata');
    } catch {
      ctx.logger.debug('[MCP] Metadata service not available, skipping resource bridging');
    }

    // ── stdio auto-start decision (opt-in, its OWN switch) ──
    // Deliberately stricter than the HTTP-surface default (`isMcpServerEnabled`,
    // default-on): start() attaches a long-lived transport claiming the
    // process's stdin/stdout, so it stays opt-in via a SEPARATE switch
    // (`OS_MCP_STDIO_ENABLED` / the `autoStart` option), never the HTTP var.
    // The HTTP surface does not depend on this: the runtime dispatcher serves
    // `/api/v1/mcp` per-request regardless.
    const stdio = resolveMcpStdioAutoStart();
    const shouldStart = this.options.autoStart || stdio.enabled;
    if (stdio.viaDeprecatedAlias && !this.options.autoStart) {
      ctx.logger.warn(
        '[MCP] Starting the stdio transport via OS_MCP_SERVER_ENABLED=true is DEPRECATED — that var now only gates the default-on HTTP surface. Use OS_MCP_STDIO_ENABLED=true (or the plugin `autoStart` option) for the long-lived stdio transport.',
      );
    }

    // ── Principal-bound record reader for the stdio transport (ADR-0101) ──
    // The long-lived stdio server reads ROW data only under an env-supplied
    // API-key identity, resolved through the same @objectstack/core chain as the
    // HTTP/REST surfaces (RLS/FLS/tenant apply). FAIL-CLOSED: stdio auto-start
    // without a resolvable key REFUSES to start — no unscoped fallback, and no
    // `system`/identity-skipping bypass. Full authority = an admin/service key.
    let getRecord:
      | ((objectName: string, recordId: string) => Promise<Record<string, unknown> | null>)
      | undefined;
    // [#8034] The object-tool surface for the long-lived server, bound to the
    // same identity as `getRecord` above. Built only on the stdio path, because
    // that is the only path with a principal to bind: no principal ⇒ no bridge
    // ⇒ no tools registered ⇒ no `tools` capability advertised, which is the
    // honest report rather than the empty promise this issue is about.
    let dataBridge: McpDataBridge | undefined;
    if (shouldStart) {
      const apiKey = readEnvWithDeprecation('OS_MCP_STDIO_API_KEY', [], { silent: true });
      let ql: (IDataEngine & { find: (object: string, opts: unknown) => Promise<unknown> }) | undefined;
      try {
        ql = ctx.getService('objectql');
      } catch {
        ql = undefined;
      }
      if (!apiKey) {
        throw new Error(
          '[MCP] The stdio transport is enabled (OS_MCP_STDIO_ENABLED / autoStart) but OS_MCP_STDIO_API_KEY is not set. ' +
            'stdio must run under a real identity — mint an API key (Setup → Connect an Agent, or POST /api/v1/keys) and set ' +
            'OS_MCP_STDIO_API_KEY=osk_.... Refusing to start an unscoped stdio server (ADR-0101).',
        );
      }
      if (!ql || typeof ql.find !== 'function') {
        throw new Error(
          '[MCP] The stdio transport requires the objectql data service to resolve its principal, but it is not available. ' +
            'Refusing to start (ADR-0101).',
        );
      }
      // Validate the key up-front (fail-closed) before attaching the transport.
      const initial = await resolveStdioExecutionContext(ql, apiKey);
      if (!initial) {
        throw new Error(
          '[MCP] OS_MCP_STDIO_API_KEY did not resolve to a valid identity (unknown / revoked / expired / owner-less). ' +
            'Refusing to start stdio (ADR-0101).',
        );
      }
      const scopedQl = ql;
      // Re-resolve per call so a revoked/expired key stops working on the next read.
      const resolvePrincipal = async (): Promise<ExecutionContext> => {
        const ec = await resolveStdioExecutionContext(scopedQl, apiKey);
        if (!ec) throw new Error('MCP stdio identity is no longer valid (key revoked or expired)');
        return ec;
      };
      if (metadataService) {
        dataBridge = createStdioDataBridge({
          engine: scopedQl,
          metadataService,
          resolvePrincipal,
        });
      } else {
        // Functional degradation, said once and naming the remedy: two of the
        // object tools read the schema, so without a metadata service the
        // surface cannot be served at all. Nothing is advertised in its place.
        ctx.logger.warn(
          '[MCP] stdio transport starting WITHOUT object tools — the metadata service is not registered, '
            + 'so list_objects/describe_object have nothing to read and no tool surface is bridged. '
            + 'An MCP client will see resources and prompts but no tools. '
            + 'Fix: register the metadata service (the metadata plugin) in this assembly.',
        );
      }
      // [#8266] The metadata service the exposure gate reads the declaration
      // from, captured once rather than re-read off the outer `let` inside the
      // closure — the reader must not be able to see a different service from
      // the one `bridgeResources` was registered with.
      const gateMetadata = metadataService;
      getRecord = async (objectName, recordId) => {
        const ec = await resolvePrincipal();
        // [#8266] The ADR-0049 exposure gate, applied BEFORE the read: the same
        // decision, from the same helper, that `bridge.get` applies for the
        // `get_record` tool (#8083). Without it, one `enable.apiEnabled: false`
        // declaration was refused by the TOOL and still served by this
        // RESOURCE — same transport, same key, two answers.
        //
        // This is a SURFACE-AREA control, not the authorization boundary (see
        // `api-exposure.ts`'s own ADR note): the `find` below runs under the
        // key's `ExecutionContext` and passes CRUD/FLS/RLS either way. What was
        // leaking is the author's exposure DECLARATION.
        //
        // No metadata service ⇒ no declaration to read ⇒ open, exactly as
        // `enforceApiExposure` itself falls open when `getObject` throws or
        // resolves nothing. Unreachable in practice: `bridgeResources` — the
        // only consumer of this reader — is called under `if (metadataService)`
        // below, so the resource is never registered without one.
        if (gateMetadata) {
          await enforceApiExposure(gateMetadata, objectName, GATED_ACTIONS.get, ec);
        }
        const res = (await scopedQl.find(objectName, {
          where: { id: recordId },
          limit: 1,
          context: ec,
        })) as unknown;
        const rows = res && (res as { value?: unknown }).value ? (res as { value: unknown }).value : res;
        const row = Array.isArray(rows) ? rows[0] : rows;
        return (row ?? null) as Record<string, unknown> | null;
      };
      ctx.logger.info(
        `[MCP] stdio transport principal-bound to OS_MCP_STDIO_API_KEY identity ${initial.userId} (RLS/FLS/tenant applied)`,
      );
    }

    if (metadataService) {
      this.runtime.bridgeResources(metadataService, getRecord);
      // Awaited: the prompt bridge reads `skill` metadata to project each
      // skill's instructions onto an MCP prompt (#3905), so the surface must be
      // complete before the transport attaches below.
      await this.runtime.bridgePrompts(metadataService);
    }

    // [#8034] BEFORE `start()`, with the resources and prompts: registering a
    // tool is also what declares the `tools` capability, and the SDK refuses to
    // register capabilities once a transport is attached. Every bridge on this
    // server is complete before the transport claims stdin/stdout.
    if (dataBridge) {
      this.runtime.bridgeDataTools(dataBridge);
    }

    if (shouldStart) {
      await this.runtime.start();
      ctx.logger.info('[MCP] Server started automatically');
    } else {
      ctx.logger.info(
        '[MCP] Transport not auto-started (HTTP is served per-request at /api/v1/mcp regardless). Set OS_MCP_STDIO_ENABLED=true or autoStart for a long-lived (stdio) transport.',
      );
    }

    // ── Plugin-carried Setup UI (cloud ADR-0009 principle) ──
    // "Connect an agent" page + nav entry ship WITH the MCP capability and
    // follow the HTTP surface's default-on switch: an opted-out deployment
    // advertises nothing, so it gets no page either.
    if (isMcpServerEnabled()) {
      ctx.hook('kernel:ready', async () => {
        try {
          const manifest = ctx.getService<{ register(m: unknown): void }>('manifest');
          manifest?.register?.(CONNECT_AGENT_UI_BUNDLE);
        } catch { /* no manifest service (bare kernels, tests) */ }
      });
    }

    // Trigger hook for other plugins to extend MCP
    await ctx.trigger('mcp:ready', this.runtime);
  }

  async destroy(): Promise<void> {
    if (this.runtime?.isStarted) {
      await this.runtime.stop();
    }
    this.runtime = undefined;
  }
}
