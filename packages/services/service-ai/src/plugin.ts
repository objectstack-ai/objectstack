// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IAIService, IAIConversationService, IAutomationService, IDataEngine, IEmbedder, IMetadataService, LLMAdapter } from '@objectstack/spec/contracts';
import { EMBEDDER_SERVICE } from '@objectstack/spec/contracts';
import type * as AI from '@objectstack/spec/ai';
import { AIService } from './ai-service.js';
import type { AIServiceConfig } from './ai-service.js';
import { buildAIRoutes } from './routes/ai-routes.js';
import { buildAgentRoutes } from './routes/agent-routes.js';
import { buildAssistantRoutes } from './routes/assistant-routes.js';
import { buildToolRoutes } from './routes/tool-routes.js';
import { buildPendingActionRoutes } from './routes/pending-action-routes.js';
import { ObjectQLConversationService } from './conversation/objectql-conversation-service.js';
import { AiConversationObject, AiMessageObject, AiPendingActionObject, AiTraceObject } from './objects/index.js';
import { AiTraceView, AiPendingActionView } from './views/index.js';
import { registerDataTools } from './tools/data-tools.js';
import { registerMetadataTools } from './tools/metadata-tools.js';
import { registerQueryDataTool } from './tools/query-data.tool.js';
import { registerActionsAsTools } from './tools/action-tools.js';
import { AgentRuntime } from './agent-runtime.js';
import { SkillRegistry } from './skill-registry.js';
import { DATA_CHAT_AGENT, METADATA_ASSISTANT_AGENT } from './agents/index.js';
import { DATA_EXPLORER_SKILL, METADATA_AUTHORING_SKILL, ACTIONS_EXECUTOR_SKILL } from './skills/index.js';
import { VercelLLMAdapter } from './adapters/vercel-adapter.js';
import { MemoryLLMAdapter } from './adapters/memory-adapter.js';
import { ModelRegistry } from './model-registry.js';
import { ObjectQLTraceRecorder, type TraceRecorder } from './trace-recorder.js';

/**
 * Configuration options for the AIServicePlugin.
 */
export interface AIServicePluginOptions {
  /** LLM adapter to use (defaults to MemoryLLMAdapter). */
  adapter?: LLMAdapter;
  /** Enable debug logging. */
  debug?: boolean;
  /** Explicit conversation service override. When set, auto-detection is skipped. */
  conversationService?: IAIConversationService;
  /**
   * Models to register in the runtime {@link ModelRegistry}.
   *
   * Used for default-model resolution and cost attribution in traces.
   * If omitted, the registry starts empty and trace `cost_*` fields are null.
   */
  models?: AI.ModelConfig[];
  /** Default model id (must appear in `models`). */
  defaultModelId?: string;
  /**
   * Explicit trace recorder override. When set, auto-detection
   * of {@link ObjectQLTraceRecorder} is skipped.
   *
   * Set to `null` to disable tracing entirely.
   */
  /**
   * Explicit trace recorder override. When set, auto-detection
   * of {@link ObjectQLTraceRecorder} is skipped.
   *
   * Set to `null` to disable tracing entirely.
   */
  traceRecorder?: TraceRecorder | null;
  /**
   * Base URL prepended to relative `target` paths for `type:'api'`
   * actions invoked by the AI tool runtime. When unset, falls back to
   * `process.env.OS_AI_ACTION_API_BASE_URL`. If neither is set, api
   * actions are skipped at registration with a clear reason.
   */
  apiActionBaseUrl?: string;
  /**
   * Extra HTTP headers (e.g. `{ Authorization: 'Bearer ...' }`) applied
   * to every `type:'api'` action dispatch. Useful for forwarding the
   * caller's session token so server-side authorization still applies.
   */
  apiActionHeaders?: Record<string, string>;
  /**
   * Opt into Human-In-The-Loop approval for dangerous actions exposed
   * as AI tools. When `true`, actions with `confirmText`, `mode:'delete'`,
   * or `variant:'danger'` are still registered as tools — but invoking
   * them enqueues an `ai_pending_actions` row and returns
   * `{ status: 'pending_approval' }` instead of running. A human
   * operator approves via Studio's pending-actions inbox to execute.
   *
   * Defaults to `false` (safer: dangerous actions stay invisible to LLM
   * until an operator explicitly enables this routing).
   */
  enableActionApproval?: boolean;
  /**
   * Bind to the `ai` settings namespace and rebuild the LLM adapter on
   * every `settings:changed` event. When enabled (default), operators
   * can edit provider/credentials/model via the Setup app and the
   * change applies live without restart. Disable to lock the adapter
   * to whatever was resolved at boot (constructor option or env var).
   */
  bindToSettings?: boolean;
}

/**
 * AIServicePlugin — Kernel plugin for the unified AI capability service.
 *
 * Lifecycle:
 * 1. **init** — Creates {@link AIService}, registers as `'ai'` service.
 *    If an existing AI service is already registered, it is replaced.
 * 2. **start** — Triggers `'ai:ready'` hook so other plugins can register
 *    tools or extend the service.  Registers REST/SSE routes.
 * 3. **destroy** — Cleans up references.
 *
 * @example
 * ```ts
 * import { LiteKernel } from '@objectstack/core';
 * import { AIServicePlugin } from '@objectstack/service-ai';
 *
 * const kernel = new LiteKernel();
 * kernel.use(new AIServicePlugin());
 * await kernel.bootstrap();
 *
 * const ai = kernel.getService<IAIService>('ai');
 * const result = await ai.chat([{ role: 'user', content: 'Hello' }]);
 * ```
 */
export class AIServicePlugin implements Plugin {
  name = 'com.objectstack.service-ai';
  version = '1.0.0';
  type = 'standard' as const;
  dependencies: string[] = ['com.objectstack.engine.objectql']; // manifest service required

  private service?: AIService;
  private readonly options: AIServicePluginOptions;

  constructor(options: AIServicePluginOptions = {}) {
    this.options = options;
  }

  /**
   * Build an LLM adapter from a provider/key/model triple. Used both
   * by the boot-time auto-detect path and by the live `settings:changed`
   * rebuild path. Returns `null` if the requested provider cannot be
   * loaded or required credentials are missing.
   */
  private async buildAdapterFromValues(
    ctx: PluginContext,
    values: Record<string, unknown>,
  ): Promise<{ adapter: LLMAdapter; description: string } | null> {
    const provider = String(values.provider ?? 'memory');

    if (provider === 'memory') {
      return { adapter: new MemoryLLMAdapter(), description: 'MemoryLLMAdapter (echo mode)' };
    }

    if (provider === 'gateway') {
      const gatewayModel = String(values.gateway_model ?? '').trim();
      if (!gatewayModel) return null;
      try {
        const gatewayPkg = '@ai-sdk/gateway';
        const { gateway } = await import(/* webpackIgnore: true */ gatewayPkg);
        return {
          adapter: new VercelLLMAdapter({ model: gateway(gatewayModel) }),
          description: `Vercel AI Gateway (model: ${gatewayModel})`,
        };
      } catch (err) {
        ctx.logger.warn(
          `[AI] Failed to load @ai-sdk/gateway for provider=gateway`,
          err instanceof Error ? { error: err.message } : undefined,
        );
        return null;
      }
    }

    const providerSpecs: Record<string, { pkg: string; factory: string; defaultModel: string; displayName: string }> = {
      openai: { pkg: '@ai-sdk/openai', factory: 'openai', defaultModel: 'gpt-4o', displayName: 'OpenAI' },
      anthropic: { pkg: '@ai-sdk/anthropic', factory: 'anthropic', defaultModel: 'claude-sonnet-4-20250514', displayName: 'Anthropic' },
      google: { pkg: '@ai-sdk/google', factory: 'google', defaultModel: 'gemini-2.0-flash', displayName: 'Google' },
    };
    const spec = providerSpecs[provider];
    if (!spec) return null;

    const apiKey = String(values[`${provider}_api_key`] ?? '').trim();
    if (!apiKey) return null;

    // The Vercel-style provider SDKs read credentials from environment
    // variables. To honor the settings-supplied key without forcing the
    // operator to also set the env var, mirror it onto process.env for
    // the duration of the adapter construction.
    const envKey =
      provider === 'openai' ? 'OPENAI_API_KEY'
      : provider === 'anthropic' ? 'ANTHROPIC_API_KEY'
      : 'GOOGLE_GENERATIVE_AI_API_KEY';
    process.env[envKey] = apiKey;

    try {
      const mod = await import(/* webpackIgnore: true */ spec.pkg);
      const factory = mod[spec.factory] ?? mod.default;
      if (typeof factory !== 'function') return null;
      const modelId = String(values[`${provider}_model`] ?? '').trim() || spec.defaultModel;
      // For OpenAI, prefer the Chat Completions API. See note in detectAdapter().
      const useChatApi = provider === 'openai' && typeof (factory as any).chat === 'function';
      const model = useChatApi ? (factory as any).chat(modelId) : factory(modelId);
      const apiSuffix = useChatApi ? ' [chat-completions]' : '';
      return {
        adapter: new VercelLLMAdapter({ model }),
        description: `${spec.displayName} (model: ${modelId})${apiSuffix}`,
      };
    } catch (err) {
      ctx.logger.warn(
        `[AI] Failed to load ${spec.pkg} for provider=${provider}`,
        err instanceof Error ? { error: err.message } : undefined,
      );
      return null;
    }
  }

  /**
   * Build an `IEmbedder` instance from embedder settings values
   * (`embedder_provider`, `embedder_api_key`, …) by dynamically
   * importing `@objectstack/embedder-openai`. Returns `null` for
   * `none` (embedder disabled) or when required credentials are
   * missing / the package isn't installed.
   *
   * The OpenAI-compatible plugin covers OpenAI, Azure, 阿里通义,
   * 智谱, 硅基流动, 火山 Doubao, MiniMax, Ollama, and any custom
   * OpenAI-shape endpoint via `embedder_base_url`.
   */
  private async buildEmbedderFromValues(
    ctx: PluginContext,
    values: Record<string, unknown>,
  ): Promise<{ embedder: IEmbedder; description: string } | null> {
    const provider = String(values.embedder_provider ?? 'none').trim();
    if (!provider || provider === 'none') return null;

    const apiKey = String(values.embedder_api_key ?? '').trim();
    const model = String(values.embedder_model ?? '').trim() || undefined;
    const baseUrlOverride = String(values.embedder_base_url ?? '').trim() || undefined;
    const dimensions =
      values.embedder_dimensions != null && values.embedder_dimensions !== ''
        ? Number(values.embedder_dimensions)
        : undefined;

    // ollama and custom typically run unauthenticated. Other providers
    // require an api key.
    if (!apiKey && provider !== 'ollama') {
      ctx.logger.warn(
        `[AI] Embedder provider=${provider} requires embedder_api_key — embedder unchanged.`,
      );
      return null;
    }
    if ((provider === 'custom' || provider === 'azure') && !baseUrlOverride) {
      ctx.logger.warn(
        `[AI] Embedder provider=${provider} requires embedder_base_url — embedder unchanged.`,
      );
      return null;
    }

    try {
      const pkg = '@objectstack/embedder-openai';
      const mod = await import(/* webpackIgnore: true */ pkg);
      const create = mod.createOpenAIEmbedder ?? mod.default?.createOpenAIEmbedder;
      if (typeof create !== 'function') {
        ctx.logger.warn(
          `[AI] ${pkg} did not export createOpenAIEmbedder — embedder unchanged.`,
        );
        return null;
      }
      const embedder = create({
        preset: provider === 'custom' ? undefined : provider,
        baseUrl: baseUrlOverride,
        apiKey: apiKey || 'ollama',
        model,
        dimensions: Number.isFinite(dimensions) ? dimensions : undefined,
        id: provider,
      }) as IEmbedder;
      const dimsLabel = embedder.dimensions ? `dims=${embedder.dimensions}` : 'dims=?';
      return {
        embedder,
        description: `OpenAI-compatible embedder (provider=${provider}${model ? `, model=${model}` : ''}, ${dimsLabel})`,
      };
    } catch (err) {
      ctx.logger.warn(
        `[AI] Failed to load @objectstack/embedder-openai for embedder provider=${provider}`,
        err instanceof Error ? { error: err.message } : undefined,
      );
      return null;
    }
  }

  /**
   * Auto-detect LLM provider from environment variables.
   *
   * Priority order:
   * 1. AI_GATEWAY_MODEL → Vercel AI Gateway
   * 2. OPENAI_API_KEY → OpenAI
   * 3. ANTHROPIC_API_KEY → Anthropic
   * 4. GOOGLE_GENERATIVE_AI_API_KEY → Google
   * 5. Fallback → MemoryLLMAdapter
   *
   * Returns the adapter and a description for logging.
   */
  private async detectAdapter(ctx: PluginContext): Promise<{ adapter: LLMAdapter; description: string }> {
    // 1. Vercel AI Gateway — works with any provider via gateway('provider/model')
    const gatewayModel = process.env.AI_GATEWAY_MODEL;
    if (gatewayModel) {
      try {
        const gatewayPkg = '@ai-sdk/gateway';
        const { gateway } = await import(/* webpackIgnore: true */ gatewayPkg);
        const adapter = new VercelLLMAdapter({ model: gateway(gatewayModel) });
        return { adapter, description: `Vercel AI Gateway (model: ${gatewayModel})` };
      } catch (err) {
        ctx.logger.warn(
          `[AI] Failed to load @ai-sdk/gateway for AI_GATEWAY_MODEL=${gatewayModel}, trying next provider`,
          err instanceof Error ? { error: err.message } : undefined
        );
      }
    }

    // 2. Direct provider SDKs
    const providerConfigs: Array<{
      envKey: string;
      pkg: string;
      factory: string;
      defaultModel: string;
      displayName: string;
    }> = [
      {
        envKey: 'OPENAI_API_KEY',
        pkg: '@ai-sdk/openai',
        factory: 'openai',
        defaultModel: 'gpt-4o',
        displayName: 'OpenAI'
      },
      {
        envKey: 'ANTHROPIC_API_KEY',
        pkg: '@ai-sdk/anthropic',
        factory: 'anthropic',
        defaultModel: 'claude-sonnet-4-20250514',
        displayName: 'Anthropic'
      },
      {
        envKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
        pkg: '@ai-sdk/google',
        factory: 'google',
        defaultModel: 'gemini-2.0-flash',
        displayName: 'Google'
      },
    ];

    for (const { envKey, pkg, factory, defaultModel, displayName } of providerConfigs) {
      if (process.env[envKey]) {
        try {
          const mod = await import(/* webpackIgnore: true */ pkg);
          const provider = mod[factory] ?? mod.default;
          if (typeof provider === 'function') {
            const modelId = process.env.AI_MODEL ?? defaultModel;
            // For OpenAI, prefer the Chat Completions API (`openai.chat(...)`)
            // over the new Responses API. The Responses endpoint
            // (`/v1/responses`) is not supported by common reverse proxies
            // such as the Vercel AI Gateway, Cloudflare AI Gateway, or
            // Azure-style OpenAI deployments — calling it returns 403
            // Forbidden and the chat completion silently fails. The Chat
            // Completions endpoint (`/v1/chat/completions`) is the
            // industry-standard contract every gateway supports.
            const useChatApi = factory === 'openai' && typeof (provider as any).chat === 'function';
            const model = useChatApi
              ? (provider as any).chat(modelId)
              : provider(modelId);
            const adapter = new VercelLLMAdapter({ model });
            const apiSuffix = useChatApi ? ' [chat-completions]' : '';
            return { adapter, description: `${displayName} (model: ${modelId})${apiSuffix}` };
          }
        } catch (err) {
          ctx.logger.warn(
            `[AI] Failed to load ${pkg} for ${envKey}, trying next provider`,
            err instanceof Error ? { error: err.message } : undefined
          );
        }
      }
    }

    // 3. Fallback to MemoryLLMAdapter
    ctx.logger.warn('[AI] No LLM provider configured via environment variables. Falling back to MemoryLLMAdapter (echo mode). Set AI_GATEWAY_MODEL, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY to use a real LLM.');
    return { adapter: new MemoryLLMAdapter(), description: 'MemoryLLMAdapter (echo mode - for testing only)' };
  }

  async init(ctx: PluginContext): Promise<void> {
    // Check if there is an existing AI service (e.g. from dev-plugin)
    let hasExisting = false;
    try {
      const existing = ctx.getService<IAIService>('ai');
      if (existing && typeof existing.chat === 'function') {
        hasExisting = true;
        ctx.logger.debug('[AI] Found existing AI service, replacing');
      }
    } catch {
      // No existing service — that's fine
    }

    // Determine conversation service: explicit > auto-detect IDataEngine > InMemory fallback
    let conversationService: IAIConversationService | undefined = this.options.conversationService;
    if (!conversationService) {
      try {
        const engine = ctx.getService<IDataEngine>('data');
        if (engine && typeof engine.find === 'function') {
          conversationService = new ObjectQLConversationService(engine);
          ctx.logger.info('[AI] Using ObjectQLConversationService (IDataEngine detected)');
        }
      } catch {
        // No data engine — fall back to InMemory
      }
    }

    // Determine LLM adapter: explicit > auto-detect from env > MemoryLLMAdapter fallback
    let adapter: LLMAdapter;
    let adapterDescription: string;

    if (this.options.adapter) {
      // User provided an explicit adapter
      adapter = this.options.adapter;
      adapterDescription = `${adapter.name} (explicitly configured)`;
    } else {
      // Auto-detect from environment variables
      const detected = await this.detectAdapter(ctx);
      adapter = detected.adapter;
      adapterDescription = detected.description;
    }

    // Log the selected adapter
    ctx.logger.info(`[AI] Using LLM adapter: ${adapterDescription}`);

    // Model registry — empty by default; populated from plugin options.
    const modelRegistry = new ModelRegistry({
      models: this.options.models,
      defaultModelId: this.options.defaultModelId,
    });
    if (modelRegistry.size > 0) {
      ctx.logger.info(`[AI] ModelRegistry initialised with ${modelRegistry.size} model(s)`);
    }

    // Trace recorder — explicit > auto-detect IDataEngine > NullTraceRecorder
    let traceRecorder: TraceRecorder | undefined;
    let dataEngine: IDataEngine | undefined;
    try {
      const engine = ctx.getService<IDataEngine>('data');
      if (engine && typeof engine.insert === 'function') {
        dataEngine = engine;
      }
    } catch {
      // No data engine — pending-action queue will be a no-op.
    }
    if (this.options.traceRecorder === null) {
      // Explicit opt-out
      ctx.logger.debug('[AI] Tracing disabled (traceRecorder=null)');
    } else if (this.options.traceRecorder) {
      traceRecorder = this.options.traceRecorder;
    } else if (dataEngine) {
      traceRecorder = new ObjectQLTraceRecorder(dataEngine, { logger: ctx.logger });
      ctx.logger.info('[AI] Using ObjectQLTraceRecorder (IDataEngine detected)');
    }

    const config: AIServiceConfig = {
      adapter,
      logger: ctx.logger,
      conversationService,
      modelRegistry,
      traceRecorder,
      dataEngine,
    };

    this.service = new AIService(config);

    // Register or replace the AI service
    if (hasExisting) {
      ctx.replaceService('ai', this.service);
    } else {
      ctx.registerService('ai', this.service);
    }

    // Register AI system objects via the manifest service.
    ctx.getService<{ register(m: any): void }>('manifest').register({
      id: 'com.objectstack.service-ai',
      name: 'AI Service',
      version: '1.0.0',
      type: 'plugin',
      scope: 'project',
      namespace: 'ai',
      objects: [AiConversationObject, AiMessageObject, AiTraceObject, AiPendingActionObject],
      views: [AiTraceView, AiPendingActionView],
    });

    if (this.options.debug) {
      ctx.hook('ai:beforeChat', async (messages: unknown) => {
        ctx.logger.debug('[AI] Before chat', { messages });
      });
    }

    ctx.logger.info('[AI] Service initialized');
  }

  async start(ctx: PluginContext): Promise<void> {
    if (!this.service) return;

    // ── Auto-register built-in tools & agents when services are available ──
    let metadataService: IMetadataService | undefined;
    // Helper: race a promise against a timeout, resolving null on timeout
    const withTimeout = <T>(promise: Promise<T>, ms = 2000): Promise<T | null> =>
      Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
    try {
      metadataService = ctx.getService<IMetadataService>('metadata');
      console.log('[AI Plugin] Retrieved metadata service:', !!metadataService, 'has getRegisteredTypes:', typeof (metadataService as any)?.getRegisteredTypes);
    } catch (e: any) {
      console.log('[AI] Metadata service not available:', e.message);
      ctx.logger.debug('[AI] Metadata service not available');
    }

    // Probe metadata service reachability with a short timeout.
    // If the backing store (e.g. Turso) is unreachable, exists() will hang.
    // A single probe determines whether persistence is available for all subsequent calls.
    if (metadataService && typeof metadataService.exists === 'function') {
      const probeResult = await withTimeout(metadataService.exists('tool', '__probe__'), 3000);
      if (probeResult === null) {
        ctx.logger.warn('[AI] Metadata service unreachable (timed out) — AI tools/agents will work but Studio visibility unavailable');
        metadataService = undefined; // disable persistence for this boot
      }
    }

    // Data tools require only the data engine
    try {
      const dataEngine = ctx.getService<IDataEngine>('data');
      if (dataEngine) {
        registerDataTools(this.service.toolRegistry, { dataEngine });
        ctx.logger.info('[AI] Built-in data tools registered');

        // Register query_data tool when metadata service is also available —
        // it composes AI + Metadata + Data into a single NL-to-records call.
        if (metadataService) {
          registerQueryDataTool(this.service.toolRegistry, {
            ai: this.service,
            metadata: metadataService,
            dataEngine,
          });
          ctx.logger.info('[AI] query_data tool registered');

          // Register actions-as-tools: enumerate every object's actions[]
          // and surface the script-type ones as `action_<name>` tools.
          // This is what gives agents the ability to *do things* (mark
          // task complete, clone record, ...) — the write-side counterpart
          // to query_data.
          try {
            // Resolve automation service (optional — flow actions get
            // skipped gracefully if unavailable).
            let automation: IAutomationService | undefined;
            try {
              automation = ctx.getService<IAutomationService>('automation');
            } catch {
              automation = undefined;
            }
            const apiBaseUrl =
              this.options.apiActionBaseUrl ?? process.env.OS_AI_ACTION_API_BASE_URL;
            const apiHeaders = this.options.apiActionHeaders;
            const { registered, skipped } = await registerActionsAsTools(
              this.service.toolRegistry,
              {
                metadata: metadataService,
                dataEngine,
                automation,
                apiBaseUrl,
                apiHeaders,
                enableActionApproval: this.options.enableActionApproval ?? false,
                aiService: this.service,
              },
            );
            if (registered.length > 0) {
              ctx.logger.info(
                `[AI] ${registered.length} action tool(s) registered: ${registered.join(', ')}`,
              );
            }
            if (skipped.length > 0) {
              ctx.logger.debug(
                `[AI] Skipped ${skipped.length} action(s) for AI exposure`,
                { skipped },
              );
            }
          } catch (err) {
            ctx.logger.warn(
              '[AI] Failed to register action tools',
              err instanceof Error ? { error: err.message } : { error: String(err) },
            );
          }
        }

        // Register data tools as metadata (for Studio visibility)
        if (metadataService) {
          const { DATA_TOOL_DEFINITIONS } = await import('./tools/data-tools.js');
          for (const toolDef of DATA_TOOL_DEFINITIONS) {
            const toolExists =
              typeof metadataService.exists === 'function'
                ? await withTimeout(metadataService.exists('tool', toolDef.name))
                : false;

            if (toolExists === null) {
              ctx.logger.warn('[AI] Metadata service timed out checking tool existence (non-fatal), skipping persistence');
              break;
            }

            if (!toolExists) {
              try {
                await withTimeout(metadataService.register('tool', toolDef.name, toolDef));
              } catch (err) {
                ctx.logger.warn('[AI] Failed to persist tool metadata (non-fatal)',
                  err instanceof Error ? { tool: toolDef.name, error: err.message } : { tool: toolDef.name });
              }
            }
          }
          ctx.logger.info(`[AI] ${DATA_TOOL_DEFINITIONS.length} data tools registered as metadata`);
        }

        // Register the built-in data_chat agent (requires metadata service)
        if (metadataService) {
          try {
            const agentExists =
              typeof metadataService.exists === 'function'
                ? await withTimeout(metadataService.exists('agent', DATA_CHAT_AGENT.name))
                : false;

            if (agentExists === null) {
              ctx.logger.warn('[AI] Metadata service timed out checking data_chat agent, skipping');
            } else if (!agentExists) {
              await withTimeout(metadataService.register('agent', DATA_CHAT_AGENT.name, DATA_CHAT_AGENT));
              console.log('[AI] Registered data_chat agent to metadataService');
              ctx.logger.info('[AI] data_chat agent registered');
            } else {
              console.log('[AI] data_chat agent already exists, skipping');
              ctx.logger.debug('[AI] data_chat agent already exists, skipping auto-registration');
            }
          } catch (err) {
            ctx.logger.warn('[AI] Failed to register data_chat agent', err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) });
          }

          // Register the built-in data_explorer skill (capability bundle for data_chat)
          try {
            const skillExists =
              typeof metadataService.exists === 'function'
                ? await withTimeout(metadataService.exists('skill', DATA_EXPLORER_SKILL.name))
                : false;

            if (skillExists === null) {
              ctx.logger.warn('[AI] Metadata service timed out checking data_explorer skill, skipping');
            } else if (!skillExists) {
              await withTimeout(metadataService.register('skill', DATA_EXPLORER_SKILL.name, DATA_EXPLORER_SKILL));
              ctx.logger.info('[AI] data_explorer skill registered');
            } else {
              ctx.logger.debug('[AI] data_explorer skill already exists, skipping auto-registration');
            }
          } catch (err) {
            ctx.logger.warn('[AI] Failed to register data_explorer skill', err instanceof Error ? { error: err.message } : { error: String(err) });
          }

          // Register the built-in actions_executor skill (write-side bundle for data_chat)
          try {
            const skillExists =
              typeof metadataService.exists === 'function'
                ? await withTimeout(metadataService.exists('skill', ACTIONS_EXECUTOR_SKILL.name))
                : false;

            if (skillExists === null) {
              ctx.logger.warn('[AI] Metadata service timed out checking actions_executor skill, skipping');
            } else if (!skillExists) {
              await withTimeout(metadataService.register('skill', ACTIONS_EXECUTOR_SKILL.name, ACTIONS_EXECUTOR_SKILL));
              ctx.logger.info('[AI] actions_executor skill registered');
            } else {
              ctx.logger.debug('[AI] actions_executor skill already exists, skipping auto-registration');
            }
          } catch (err) {
            ctx.logger.warn('[AI] Failed to register actions_executor skill', err instanceof Error ? { error: err.message } : { error: String(err) });
          }
        }
      }
    } catch {
      ctx.logger.debug('[AI] Data engine not available, skipping data tools');
    }

    // Metadata tools require only the metadata service
    if (metadataService) {
      try {
        registerMetadataTools(this.service.toolRegistry, { metadataService });
        ctx.logger.info('[AI] Built-in metadata tools registered');

        // Register metadata tools as metadata (for Studio visibility)
        const { METADATA_TOOL_DEFINITIONS } = await import('./tools/metadata-tools.js');
        for (const toolDef of METADATA_TOOL_DEFINITIONS) {
          const toolExists =
            typeof metadataService.exists === 'function'
              ? await withTimeout(metadataService.exists('tool', toolDef.name))
              : false;

          if (toolExists === null) {
            ctx.logger.warn('[AI] Metadata service timed out checking tool existence (non-fatal), skipping persistence');
            break;
          }

          if (!toolExists) {
            try {
              await withTimeout(metadataService.register('tool', toolDef.name, toolDef));
            } catch (err) {
              ctx.logger.warn('[AI] Failed to persist tool metadata (non-fatal)',
                err instanceof Error ? { tool: toolDef.name, error: err.message } : { tool: toolDef.name });
            }
          }
        }
        ctx.logger.info(`[AI] ${METADATA_TOOL_DEFINITIONS.length} metadata tools registered as metadata`);

        // Register the built-in metadata_assistant agent
        try {
          const agentExists =
            typeof metadataService.exists === 'function'
              ? await withTimeout(metadataService.exists('agent', METADATA_ASSISTANT_AGENT.name))
              : false;

          if (agentExists === null) {
            ctx.logger.warn('[AI] Metadata service timed out checking metadata_assistant agent, skipping');
          } else if (!agentExists) {
            await withTimeout(metadataService.register('agent', METADATA_ASSISTANT_AGENT.name, METADATA_ASSISTANT_AGENT));
            console.log('[AI] Registered metadata_assistant agent to metadataService');
            ctx.logger.info('[AI] metadata_assistant agent registered');
          } else {
            console.log('[AI] metadata_assistant agent already exists, skipping');
            ctx.logger.debug('[AI] metadata_assistant agent already exists, skipping auto-registration');
          }
        } catch (err) {
          ctx.logger.warn('[AI] Failed to register metadata_assistant agent', err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) });
        }

        // Register the built-in metadata_authoring skill (capability bundle for metadata_assistant)
        try {
          const skillExists =
            typeof metadataService.exists === 'function'
              ? await withTimeout(metadataService.exists('skill', METADATA_AUTHORING_SKILL.name))
              : false;

          if (skillExists === null) {
            ctx.logger.warn('[AI] Metadata service timed out checking metadata_authoring skill, skipping');
          } else if (!skillExists) {
            await withTimeout(metadataService.register('skill', METADATA_AUTHORING_SKILL.name, METADATA_AUTHORING_SKILL));
            ctx.logger.info('[AI] metadata_authoring skill registered');
          } else {
            ctx.logger.debug('[AI] metadata_authoring skill already exists, skipping auto-registration');
          }
        } catch (err) {
          ctx.logger.warn('[AI] Failed to register metadata_authoring skill', err instanceof Error ? { error: err.message } : { error: String(err) });
        }
      } catch (err) {
        ctx.logger.debug('[AI] Failed to register metadata tools', err instanceof Error ? err : undefined);
      }
    }

    // Trigger hook to notify AI service is ready — other plugins can register tools
    await ctx.trigger('ai:ready', this.service);

    // ── Bridge stack-defined agents from the ObjectQL registry into the
    //    MetadataService so AgentRuntime.listAgents() / loadAgent() can see
    //    them. Agents declared via defineStack({ agents: [...] }) are stored
    //    in the ObjectQL registry by the AppPlugin, but the MetadataManager
    //    keeps an independent in-memory store. Without this bridge,
    //    /api/v1/ai/agents would only return agents the AI plugin registered
    //    itself (data_chat, metadata_assistant).
    if (metadataService) {
      try {
        const objectql = ctx.getService<any>('objectql');
        const registry = objectql?.registry;
        if (registry && typeof registry.listItems === 'function') {
          const stackAgents = registry.listItems('agent') as Array<any>;
          let bridged = 0;
          for (const entry of stackAgents) {
            const agent = entry?.content ?? entry;
            const agentName = agent?.name;
            if (!agentName || typeof agentName !== 'string') continue;
            const exists =
              typeof metadataService.exists === 'function'
                ? await withTimeout(metadataService.exists('agent', agentName))
                : false;
            if (exists === true) continue;
            try {
              await withTimeout(metadataService.register('agent', agentName, agent));
              bridged++;
            } catch (err) {
              ctx.logger.warn(
                '[AI] Failed to bridge stack agent into metadata service (non-fatal)',
                err instanceof Error ? { agent: agentName, error: err.message } : { agent: agentName },
              );
            }
          }
          if (bridged > 0) {
            ctx.logger.info(`[AI] Bridged ${bridged} stack-defined agent(s) from ObjectQL registry`);
            console.log(`[AI] Bridged ${bridged} stack-defined agent(s) from ObjectQL registry`);
          }
        }
      } catch (err) {
        ctx.logger.debug('[AI] ObjectQL registry not available, skipping agent bridge', err instanceof Error ? err : undefined);
      }
    }

    // Build and expose route definitions
    const routes = buildAIRoutes(this.service, this.service.conversationService, ctx.logger);

    // Build tool routes
    const toolRoutes = buildToolRoutes(this.service, ctx.logger);
    routes.push(...toolRoutes);
    ctx.logger.info(`[AI] Tool routes registered (${toolRoutes.length} routes)`);

    // Build HITL pending-action routes
    const pendingRoutes = buildPendingActionRoutes(this.service, ctx.logger);
    routes.push(...pendingRoutes);
    ctx.logger.info(`[AI] Pending-action routes registered (${pendingRoutes.length} routes)`);

    // Build agent routes if metadata service is available
    if (metadataService) {
      const skillRegistry = new SkillRegistry(metadataService);
      const agentRuntime = new AgentRuntime(metadataService, skillRegistry);
      const agentRoutes = buildAgentRoutes(this.service, agentRuntime, ctx.logger);
      routes.push(...agentRoutes);
      ctx.logger.info(`[AI] Agent routes registered (${agentRoutes.length} routes)`);

      const assistantRoutes = buildAssistantRoutes(this.service, agentRuntime, skillRegistry, ctx.logger);
      routes.push(...assistantRoutes);
      ctx.logger.info(`[AI] Assistant (ambient) routes registered (${assistantRoutes.length} routes)`);
    } else {
      ctx.logger.debug('[AI] Metadata service not available, skipping agent and assistant routes');
    }

    // Trigger hook so HTTP server plugins can mount these routes
    await ctx.trigger('ai:routes', routes);

    // Cache routes on the kernel so HttpDispatcher can find them
    const kernel = ctx.getKernel();
    if (kernel) {
      (kernel as any).__aiRoutes = routes;
    }

    ctx.logger.info(
      `[AI] Service started — adapter="${this.service.adapterName}", ` +
      `tools=${this.service.toolRegistry.size}, ` +
      `routes=${routes.length}`,
    );

    // ── Bind to the `ai` settings namespace ───────────────────────
    // Apply persisted settings (provider/keys/model) once, then
    // subscribe to live changes so admin edits in the Setup app
    // swap the adapter without restart. Mirrors the storage pattern.
    if (this.options.bindToSettings !== false) {
      ctx.hook('kernel:ready', async () => {
        await this.bindSettings(ctx);
      });
    }
  }

  /**
   * Resolve the `settings` service, apply any persisted `ai` values,
   * subscribe to changes, and register the live `ai/test` action
   * (overrides the manifest's fallback stub).
   */
  private async bindSettings(ctx: PluginContext): Promise<void> {
    if (!this.service) return;
    let settings: any;
    try {
      settings = ctx.getService<any>('settings');
    } catch {
      return; // settings service not mounted — env-only mode stays in effect
    }
    if (!settings || typeof settings.getNamespace !== 'function') return;

    const applySettings = async (): Promise<void> => {
      if (!this.service) return;
      try {
        const payload = await settings.getNamespace('ai');
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
          values[k] = v?.value;
        }
        const provider = String(values.provider ?? 'memory');
        // memory provider is the manifest default; treat it as "no override"
        // so the env-detected adapter chosen at init stays in place.
        if (provider === 'memory') return;
        const built = await this.buildAdapterFromValues(ctx, values);
        if (!built) {
          ctx.logger.warn(
            `[AI] Settings provider=${provider} could not be applied (missing credentials or package). ` +
              `Adapter unchanged (current="${this.service.adapterName}").`,
          );
          return;
        }
        this.service.setAdapter(built.adapter);
        ctx.logger.info(`[AI] Adapter rebuilt from settings: ${built.description}`);
      } catch (err: any) {
        ctx.logger.warn('[AI] Failed to apply ai settings: ' + (err?.message ?? err));
      }
    };

    await applySettings();
    if (typeof settings.subscribe === 'function') {
      settings.subscribe('ai', () => { void applySettings(); });
      ctx.logger.info('[AI] Bound to settings:changed for namespace=ai');
    }

    // ── Embedder binding ────────────────────────────────────────
    // Build an IEmbedder from `embedder_*` settings and register it
    // as the kernel-level `EMBEDDER_SERVICE`. Knowledge adapters
    // (`@objectstack/knowledge-turso`, …) resolve this service when
    // their `embedding` constructor option is omitted, so operators
    // only need to configure the embedder once in Setup.
    let currentEmbedderId: string | null = null;
    const applyEmbedder = async (): Promise<void> => {
      try {
        const payload = await settings.getNamespace('ai');
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload.values as Record<string, any>)) {
          values[k] = v?.value;
        }
        const built = await this.buildEmbedderFromValues(ctx, values);
        if (!built) {
          if (currentEmbedderId !== null) {
            ctx.logger.info('[AI] Embedder disabled by settings; kernel embedder service unset.');
            currentEmbedderId = null;
          }
          return;
        }
        // Register or replace under the well-known DI token.
        const replace = (ctx as any).replaceService ?? ctx.registerService;
        replace.call(ctx, EMBEDDER_SERVICE, built.embedder);
        currentEmbedderId = built.embedder.id;
        ctx.logger.info(`[AI] Embedder registered from settings: ${built.description}`);
      } catch (err: any) {
        ctx.logger.warn('[AI] Failed to apply embedder settings: ' + (err?.message ?? err));
      }
    };

    await applyEmbedder();
    if (typeof settings.subscribe === 'function') {
      settings.subscribe('ai', () => { void applyEmbedder(); });
    }

    // Live `ai/test_embedder` action — overrides the manifest's
    // fallback stub with a real one-shot embed of "ping" against
    // the form's (possibly unsaved) values.
    if (typeof settings.registerAction === 'function') {
      settings.registerAction('ai', 'test_embedder', async ({ values, payload }: any) => {
        const overrides =
          payload && typeof payload === 'object' && payload !== null && 'values' in payload
            ? (payload as { values?: Record<string, unknown> }).values ?? {}
            : {};
        const merged: Record<string, unknown> = { ...(values ?? {}), ...overrides };
        const provider = String(merged.embedder_provider ?? 'none');
        if (provider === 'none') {
          return {
            ok: false,
            severity: 'warning',
            message: 'Embedder disabled (provider=none). Select a provider to enable knowledge search.',
          };
        }
        let built;
        try {
          built = await this.buildEmbedderFromValues(ctx, merged);
        } catch (err: any) {
          return { ok: false, severity: 'error', message: err?.message ?? String(err) };
        }
        if (!built) {
          return {
            ok: false,
            severity: 'error',
            message: `Could not build embedder for provider=${provider}. Check api key, base URL, and that @objectstack/embedder-openai is installed.`,
          };
        }
        const started = Date.now();
        try {
          const vectors = await built.embedder.embed(['ping']);
          const latency = Date.now() - started;
          const dim = vectors[0]?.length ?? 0;
          return {
            ok: true,
            severity: 'info',
            message: `${built.description} responded in ${latency}ms (vector dims=${dim}).`,
          };
        } catch (err: any) {
          return {
            ok: false,
            severity: 'error',
            message: `${built.description} request failed: ${err?.message ?? String(err)}`,
          };
        }
      });
      ctx.logger.info('[AI] Registered live settings action ai/test_embedder');
    }

    // Override the manifest's fallback test handler with a live
    // round-trip against a temporary adapter built from the posted
    // (possibly unsaved) form values.
    if (typeof settings.registerAction === 'function') {
      settings.registerAction('ai', 'test', async ({ values, payload }: any) => {
        const overrides =
          payload && typeof payload === 'object' && payload !== null && 'values' in payload
            ? (payload as { values?: Record<string, unknown> }).values ?? {}
            : {};
        const merged: Record<string, unknown> = { ...(values ?? {}), ...overrides };
        const provider = String(merged.provider ?? 'memory');
        if (provider === 'memory') {
          return {
            ok: true,
            severity: 'warning',
            message: 'Memory provider is an echo stub — no external call to validate. Switch to a real provider for production.',
          };
        }
        let built;
        try {
          built = await this.buildAdapterFromValues(ctx, merged);
        } catch (err: any) {
          return { ok: false, severity: 'error', message: err?.message ?? String(err) };
        }
        if (!built) {
          return {
            ok: false,
            severity: 'error',
            message: `Could not build adapter for provider=${provider}. Check API key and that the provider SDK package is installed.`,
          };
        }
        const started = Date.now();
        try {
          const result = await built.adapter.chat(
            [{ role: 'user', content: 'ping' }],
            { maxTokens: 8 },
          );
          const latency = Date.now() - started;
          const preview = String((result as any)?.text ?? '').slice(0, 60);
          return {
            ok: true,
            severity: 'info',
            message: `${built.description} responded in ${latency}ms${preview ? ` — "${preview}"` : ''}.`,
          };
        } catch (err: any) {
          return {
            ok: false,
            severity: 'error',
            message: `${built.description} request failed: ${err?.message ?? String(err)}`,
          };
        }
      });
      ctx.logger.info('[AI] Registered live settings action ai/test');
    }
  }

  async destroy(): Promise<void> {
    this.service = undefined;
  }
}
