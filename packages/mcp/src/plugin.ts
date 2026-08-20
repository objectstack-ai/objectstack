// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import {
  assembleExecutionContext,
  resolveAuthzContext,
  resolveLocalizationContext,
  type EntryLocalization,
} from '@objectstack/core';
import { readEnvWithDeprecation, isMcpServerEnabled, resolveMcpStdioAutoStart } from '@objectstack/types';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IAIService, IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { MCPServerRuntimeConfig, McpMergedMetadataRead } from './mcp-server-runtime.js';
import type { ToolRegistry } from './types.js';
import { createStdioDataBridge, enforceApiExposure, GATED_ACTIONS } from './stdio-data-bridge.js';
import type { McpDataBridge } from './mcp-http-tools.js';
import { CONNECT_AGENT_UI_BUNDLE } from './connect-ui.js';

/**
 * Resolve `OS_MCP_STDIO_API_KEY` into an {@link ExecutionContext} through the
 * SAME `@objectstack/core` verify + authorization chain the HTTP and REST
 * surfaces use (`resolveApiKeyPrincipal` → `resolveAuthzContext`), so a stdio
 * call is scoped exactly like the same identity over REST (RLS / FLS / tenant).
 *
 * [#7279] Assembled by the SHARED `assembleExecutionContext` rather than by
 * hand. This face was the last hand-written assembly left after #6216 converged
 * the dispatcher / REST / share-link sites, and hand assembly is what let it
 * fall behind the envelope twice over: it dropped `tabPermissions`, and it
 * resolved no localization at all. The assembler's field set is CLOSED, so the
 * NEXT `ExecutionContext` field cannot miss this transport the way those did.
 *
 * Fail-closed: returns `undefined` for an unknown / revoked / expired /
 * owner-less key. That contract is not re-implemented here — it IS
 * `assembleExecutionContext`'s default entry (`!authz.userId ⇒ undefined`),
 * which is why the explicit guard this function used to carry is gone rather
 * than merely moved. Re-run per read, so revocation of a key takes effect on
 * the next call of a live stdio session (ADR-0101 D1).
 *
 * @param localization Resolved ONCE by `start()` and threaded in — see the
 * hoist there for why this function must not resolve it itself.
 */
async function resolveStdioExecutionContext(
  ql: { find: (object: string, opts: unknown) => Promise<unknown> },
  apiKey: string,
  localization: EntryLocalization | undefined,
): Promise<ExecutionContext | undefined> {
  const authz = await resolveAuthzContext({ ql, headers: { 'x-api-key': apiKey } });
  return assembleExecutionContext({
    authz,
    // OAuth access tokens are honoured on the `/mcp` HTTP door alone
    // (`acceptOAuthAccessToken`); a stdio process presents an API key, never a
    // bearer, so `principalKind: 'agent'`, `onBehalfOf` and `oauthScopes` are
    // not representable here.
    oauth: undefined,
    localization,
    // No request to carry a locale preference: a long-lived stdio transport has
    // no per-call `Accept-Language` equivalent, so the workspace default in
    // `localization` is the only locale this face can speak.
    requestLocale: undefined,
    // [#7279] WITHHELD, on the record — the same decision the REST face makes
    // for the same reason (`rest-server.ts`, `accessToken: undefined`).
    //
    // Two independent reasons, either sufficient:
    //  1. There is nothing to carry. `ResolvedAuthzContext.accessToken` is
    //     assigned in exactly one place — inside `resolve-authz-context.ts`'s
    //     `if (!userId && typeof input.getSession === 'function')` branch. This
    //     call passes NO `getSession`, and the assembler discards `!userId`
    //     anyway, so the value is unreachable on this path twice over.
    //  2. Even once plumbed it should not be carried. This face's credential is
    //     a LONG-LIVED `osk_` API key from the environment, not a session
    //     bearer. `ExecutionContext.accessToken` is a PUBLISHED hook surface
    //     (`session.accessToken`, `spec/data/hook.zod.ts`), and handing every
    //     `beforeFind`/`afterFind` a credential with far longer life than the
    //     session token that surface was designed around is a product decision
    //     nobody has made — not a refactor.
    accessToken: undefined,
    // [ADR-0069] No authentication-policy gate: that posture is resolved from a
    // better-auth SESSION (expired password / enforced MFA), and this face has
    // none. REST carries it because `enforceAuth` reads it off the envelope ten
    // lines away; nothing on the stdio path reads it.
    authGate: undefined,
  });
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

    // ── Merged (overlay-aware) metadata read for the prompt bridge (#8328) ──
    // The protocol service is the layer that merges `sys_metadata` overlay rows
    // over the registry / MetadataService baselines; the metadata service alone
    // is one layer BELOW that merge. Resolved here, next to the metadata
    // service, because this assembly is the only place that can see both — the
    // runtime is handed its collaborators and keeps no service registry.
    //
    // Absent is a supported state, not a failure: a host assembled without the
    // metadata protocol has no merged read to give, and the bridge then reads
    // exactly as it did before #8328. Same duck-typed `getMetaItems` probe the
    // REST layer applies to this service, for the same reason — the shim is
    // registered by two different mounts (`MetadataProtocolPlugin` and
    // ObjectQLPlugin's built-in `registerProtocol` mode).
    let mergedRead: McpMergedMetadataRead | undefined;
    try {
      const protocol = ctx.getService<McpMergedMetadataRead>('protocol');
      if (protocol && typeof protocol.getMetaItems === 'function') {
        mergedRead = protocol;
      } else {
        ctx.logger.debug(
          '[MCP] Protocol service has no getMetaItems — skill prompts read the un-merged metadata listing (runtime meta overrides will not be reflected)',
        );
      }
    } catch {
      ctx.logger.debug(
        '[MCP] Protocol service not available — skill prompts read the un-merged metadata listing (runtime meta overrides will not be reflected)',
      );
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
      // Deliberately resolved WITHOUT localization: this probe's only job is
      // admission (`initial.userId`, logged below) — it is never handed to a
      // data call, so it must not pay for settings reads whose result it would
      // discard. The localization hoist below needs its `userId`/`tenantId`,
      // which is why the probe comes first.
      const initial = await resolveStdioExecutionContext(ql, apiKey, undefined);
      if (!initial) {
        throw new Error(
          '[MCP] OS_MCP_STDIO_API_KEY did not resolve to a valid identity (unknown / revoked / expired / owner-less). ' +
            'Refusing to start stdio (ADR-0101).',
        );
      }
      const scopedQl = ql;
      // ── Localization, resolved ONCE for the life of the transport (#7279) ──
      // `resolveStdioExecutionContext` re-runs on EVERY call below, deliberately
      // (ADR-0101 D1: a revoked key must stop working on the next one). The
      // IDENTITY has to be re-read for that; the workspace's timezone/locale
      // does not — the key's tenant cannot change mid-session. Resolving it
      // in-line would put up to three settings reads (or one `sys_setting`
      // find, `resolveLocalizationContext`) on every single MCP call of a
      // long-lived process, which is not acceptable steady state.
      //
      // `resolveLocalizationContext` never throws; a deployment with no settings
      // service falls back to the direct `sys_setting` read and then to the
      // built-ins (`UTC` / `en-US`), i.e. exactly the values this face used to
      // get by carrying nothing.
      let settingsService: unknown;
      try {
        settingsService = ctx.getService('settings');
      } catch {
        settingsService = undefined;
      }
      const localization: EntryLocalization = await resolveLocalizationContext({
        ql: scopedQl,
        settings: settingsService,
        tenantId: initial.tenantId,
        userId: initial.userId,
      });
      // Re-resolve per call so a revoked/expired key stops working on the next read.
      const resolvePrincipal = async (): Promise<ExecutionContext> => {
        const ec = await resolveStdioExecutionContext(scopedQl, apiKey, localization);
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
      // [#8328] `mergedRead` points the skill read at the overlay-aware layer
      // so a runtime `PUT /api/v1/meta/skill/<name>` reaches this surface.
      await this.runtime.bridgePrompts(metadataService, mergedRead);
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
