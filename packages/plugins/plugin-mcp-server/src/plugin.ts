// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { readEnvWithDeprecation } from '@objectstack/types';
import type { IAIService, IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { MCPServerRuntime } from './mcp-server-runtime.js';
import type { MCPServerRuntimeConfig } from './mcp-server-runtime.js';
import type { ToolRegistry } from './types.js';

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
 *    to the MCP server. Starts the transport if `autoStart` is enabled or
 *    the `OS_MCP_SERVER_ENABLED` environment variable is set.
 * 3. **destroy** — Stops the MCP transport.
 *
 * Environment Variables:
 * - `OS_MCP_SERVER_ENABLED=true` — Enable MCP server at startup
 * - `OS_MCP_SERVER_NAME` — Override server name
 * - `OS_MCP_SERVER_TRANSPORT` — Override transport ('stdio' | 'http')
 *   (legacy `MCP_SERVER_*` names still honoured with a deprecation warning)
 *
 * @example
 * ```ts
 * import { LiteKernel } from '@objectstack/core';
 * import { MCPServerPlugin } from '@objectstack/plugin-mcp-server';
 *
 * const kernel = new LiteKernel();
 * kernel.use(new MCPServerPlugin({ autoStart: true }));
 * await kernel.bootstrap();
 * ```
 */
export class MCPServerPlugin implements Plugin {
  name = 'com.objectstack.plugin-mcp-server';
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
      name: readEnvWithDeprecation('OS_MCP_SERVER_NAME', 'MCP_SERVER_NAME') ?? this.options.name ?? 'objectstack',
      version: this.options.version ?? '1.0.0',
      transport: (readEnvWithDeprecation('OS_MCP_SERVER_TRANSPORT', 'MCP_SERVER_TRANSPORT') as 'stdio' | 'http') ?? this.options.transport ?? 'stdio',
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

    // ── Bridge resources from MetadataService & DataEngine ──
    let metadataService: IMetadataService | undefined;
    let dataEngine: IDataEngine | undefined;

    try {
      metadataService = ctx.getService<IMetadataService>('metadata');
    } catch {
      ctx.logger.debug('[MCP] Metadata service not available, skipping resource bridging');
    }

    try {
      dataEngine = ctx.getService<IDataEngine>('data');
    } catch {
      ctx.logger.debug('[MCP] Data engine not available, skipping record resources');
    }

    if (metadataService) {
      this.runtime.bridgeResources(metadataService, dataEngine);
      this.runtime.bridgePrompts(metadataService);
    }

    // ── Auto-start if configured ──
    const shouldStart = this.options.autoStart || readEnvWithDeprecation('OS_MCP_SERVER_ENABLED', 'MCP_SERVER_ENABLED') === 'true';
    if (shouldStart) {
      await this.runtime.start();
      ctx.logger.info('[MCP] Server started automatically');
    } else {
      ctx.logger.info(
        '[MCP] Server ready but not started. Set OS_MCP_SERVER_ENABLED=true or use autoStart option.',
      );
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
