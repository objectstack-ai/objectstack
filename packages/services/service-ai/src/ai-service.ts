// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  ModelMessage,
  ToolCallPart,
  TextStreamPart,
  ToolSet,
  AIRequestOptions,
  AIResult,
  AIObjectResult,
  GenerateObjectOptions,
  IAIService,
  IAIConversationService,
  IDataEngine,
  ChatWithToolsOptions,
  LLMAdapter,
  MessageObservability,
  PendingActionRow,
  PendingActionStatus,
  ProposePendingActionInput,
} from '@objectstack/spec/contracts';
import type { Logger } from '@objectstack/spec/contracts';
import type { z } from 'zod';
import { createLogger } from '@objectstack/core';
import { MemoryLLMAdapter } from './adapters/memory-adapter.js';
import { ToolRegistry } from './tools/tool-registry.js';
import type { ToolExecutionResult, ToolExecutionContext } from './tools/tool-registry.js';
import { InMemoryConversationService } from './conversation/in-memory-conversation-service.js';
import { ModelRegistry } from './model-registry.js';
import {
  NullTraceRecorder,
  buildTraceEvent,
  type TraceRecorder,
  type TraceOperation,
} from './trace-recorder.js';

// ── Stream event helpers ──────────────────────────────────────────
// These helpers construct properly-typed Vercel AI SDK stream parts
// to avoid repeated `as unknown as TextStreamPart<ToolSet>` casts.

/** Create a text-delta stream part. */
function textDeltaPart(id: string, text: string): TextStreamPart<ToolSet> {
  return { type: 'text-delta', id, text } as TextStreamPart<ToolSet>;
}

/** Create a finish stream part from an AIResult. */
function finishPart(result?: AIResult): TextStreamPart<ToolSet> {
  return {
    type: 'finish',
    finishReason: 'stop',
    totalUsage: result?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    rawFinishReason: 'stop',
  } as unknown as TextStreamPart<ToolSet>;
}

/**
 * Extract plain text from a ModelMessage's `content`. Handles the three
 * common shapes: bare string, array of `{type: 'text', text}` parts, and
 * array of tool-call / tool-result parts (which we ignore for titling
 * because they encode metadata, not user-facing language).
 */
function extractMessageText(message: { content?: unknown }): string {
  const c = message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts: string[] = [];
  for (const part of c) {
    if (typeof part === 'string') {
      parts.push(part);
    } else if (part && typeof part === 'object') {
      const p = part as { type?: string; text?: unknown };
      if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text);
    }
  }
  return parts.join(' ').trim();
}

/**
 * Defensive title cleanup. Models love to add quotes, trailing periods,
 * "Title:" prefixes, and Markdown decoration even when told not to.
 * Strip those, collapse whitespace, then hard-cap to `maxLen` characters.
 */
function cleanTitle(raw: string, maxLen: number): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Strip leading/trailing quotes (straight + curly) and parens/brackets.
  s = s.replace(/^[\s"'“”‘’`「『（(\[【]+/, '').replace(/[\s"'“”‘’`」』）)\]】]+$/, '');
  // Drop common preambles like "Title:" / "标题:" (after quote strip so
  // models that wrap the whole thing in quotes still get unwrapped).
  s = s.replace(/^(title|标题|主题)\s*[:：]\s*/i, '');
  // Strip wrapping quotes a second time in case the preamble itself was
  // quoted (e.g. `Title: "Foo Bar"` → after preamble strip → `"Foo Bar"`).
  s = s.replace(/^[\s"'“”‘’`「『（(\[【]+/, '').replace(/[\s"'“”‘’`」』）)\]】]+$/, '');
  // Drop trailing terminal punctuation.
  s = s.replace(/[.。!！?？,，;；:：]+$/, '').trim();
  if (!s) return '';
  if (s.length <= maxLen) return s;
  // Soft cut at the last word boundary within the budget when ASCII;
  // otherwise hard slice (CJK has no spaces).
  if (/^[\x00-\x7F]+$/.test(s)) {
    const cut = s.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return lastSpace > maxLen / 2 ? cut.slice(0, lastSpace) : cut;
  }
  return s.slice(0, maxLen);
}

/**
 * Configuration for AIService.
 */
export interface AIServiceConfig {
  /** LLM adapter to delegate calls to (defaults to MemoryLLMAdapter). */
  adapter?: LLMAdapter;
  /** Logger instance. */
  logger?: Logger;
  /** Pre-registered tools. */
  toolRegistry?: ToolRegistry;
  /** Conversation service (defaults to InMemoryConversationService). */
  conversationService?: IAIConversationService;
  /** Model registry for pricing + default model resolution. Optional. */
  modelRegistry?: ModelRegistry;
  /** Trace recorder for per-call observability. Defaults to no-op. */
  traceRecorder?: TraceRecorder;
  /**
   * Data engine used to persist `ai_pending_actions` rows for the
   * actions-as-tools HITL queue. Optional — when omitted, the
   * `proposePendingAction` / `approvePendingAction` methods throw if
   * called. Wired by `AIServicePlugin` after the data driver is up.
   */
  dataEngine?: IDataEngine;
}

/**
 * AIService — Unified AI capability service.
 *
 * Implements {@link IAIService} by delegating to a pluggable {@link LLMAdapter}
 * and managing tools and conversations through dedicated sub-components:
 *
 * | Component | Responsibility |
 * |:---|:---|
 * | {@link LLMAdapter} | LLM provider abstraction (chat, complete, stream, embed) |
 * | {@link ToolRegistry} | Tool definition storage & execution |
 * | {@link IAIConversationService} | Conversation CRUD & message persistence |
 *
 * The service is registered as `'ai'` in the kernel service registry by
 * the {@link AIServicePlugin}.
 */
export class AIService implements IAIService {
  private adapter: LLMAdapter;
  private readonly logger: Logger;
  readonly toolRegistry: ToolRegistry;
  readonly conversationService: IAIConversationService;
  readonly modelRegistry?: ModelRegistry;
  readonly traceRecorder: TraceRecorder;
  /**
   * Map of tool-name → dispatcher used to re-run an approved pending
   * action. Populated by `registerActionsAsTools()` when action
   * approval is enabled. Kept private because callers should go
   * through `approvePendingAction()`.
   */
  private readonly pendingDispatchers = new Map<
    string,
    (input: Record<string, unknown>) => Promise<unknown>
  >();
  /** Data engine for `ai_pending_actions` persistence. */
  private readonly dataEngine?: IDataEngine;

  /**
   * Auto-title configuration. When `enabled`, the first `chatWithTools` /
   * `streamChatWithTools` call against a still-untitled conversation
   * triggers a one-shot LLM call (fire-and-forget) that summarises the
   * exchange into a short title and PATCHes it onto the conversation row.
   *
   * Defaults to disabled — `AIServicePlugin` flips this on (with values
   * read from the `ai` settings namespace) once the kernel is ready.
   * Keeping the default off means unit tests don't accidentally make
   * extra adapter calls.
   */
  private titleGeneration: { enabled: boolean; maxLength: number } = {
    enabled: false,
    maxLength: 16,
  };

  /** Tracks conversations we've already attempted to title to avoid duplicate LLM calls. */
  private readonly titledConversations = new Set<string>();

  constructor(config: AIServiceConfig = {}) {
    this.adapter = config.adapter ?? new MemoryLLMAdapter();
    this.logger = config.logger ?? createLogger({ level: 'info', format: 'pretty' });
    this.toolRegistry = config.toolRegistry ?? new ToolRegistry();
    this.conversationService = config.conversationService ?? new InMemoryConversationService();
    this.modelRegistry = config.modelRegistry;
    this.traceRecorder = config.traceRecorder ?? new NullTraceRecorder();
    this.dataEngine = config.dataEngine;

    this.logger.info(
      `[AI] Service initialized with adapter="${this.adapter.name}", ` +
      `tools=${this.toolRegistry.size}, models=${this.modelRegistry?.size ?? 0}`,
    );
  }

  /** The name of the active LLM adapter. */
  get adapterName(): string {
    return this.adapter.name;
  }

  /**
   * Hot-swap the LLM adapter. Used by AIServicePlugin when the `ai`
   * settings namespace changes (provider/key/model edited via Setup UI).
   * In-flight requests bound to the previous adapter complete normally;
   * subsequent calls go through the new adapter.
   */
  setAdapter(next: LLMAdapter): void {
    const prev = this.adapter.name;
    this.adapter = next;
    if (prev !== next.name) {
      this.logger.info(`[AI] LLM adapter swapped: ${prev} → ${next.name}`);
    }
  }

  /**
   * Configure conversation auto-titling. Called by `AIServicePlugin`
   * when the `ai` settings namespace is bound (so admins can toggle
   * the feature live from the Setup app without a restart).
   *
   * - `enabled=false` is the safe default for unit tests and the
   *   memory adapter (which would just echo the prompt back as a title).
   * - `maxLength` is enforced both in the prompt and as a hard server-side
   *   `slice()` so a misbehaving model can't write a 4 KB "title".
   */
  setTitleGenerationConfig(config: { enabled: boolean; maxLength?: number }): void {
    this.titleGeneration = {
      enabled: config.enabled,
      maxLength: Math.max(8, Math.min(80, config.maxLength ?? 16)),
    };
    this.logger.debug('[AI] title generation config', this.titleGeneration);
  }

  /**
   * Best-effort title generation for a conversation. Idempotent per
   * `AIService` instance — once attempted, the id is recorded in
   * `titledConversations` so subsequent chats don't burn extra tokens
   * re-summarising the same thread.
   *
   * Skips when:
   * - feature disabled
   * - conversation already has a non-empty title
   * - conversation has fewer than 2 messages (no exchange to summarise)
   * - conversation has no user message
   *
   * Failures are logged at debug level and swallowed — title generation
   * is purely cosmetic and must never break chat.
   */
  async summarizeConversation(conversationId: string): Promise<void> {
    if (!this.titleGeneration.enabled) return;
    if (this.titledConversations.has(conversationId)) return;
    this.titledConversations.add(conversationId);

    try {
      const conv = await this.conversationService.get(conversationId);
      if (!conv) return;
      if (conv.title && conv.title.trim().length > 0) return;
      if (!conv.messages || conv.messages.length < 2) return;

      const userMsg = conv.messages.find((m) => (m as { role?: string }).role === 'user');
      const assistantMsg = conv.messages.find((m) => (m as { role?: string }).role === 'assistant');
      if (!userMsg) return;

      const userText = extractMessageText(userMsg);
      const assistantText = assistantMsg ? extractMessageText(assistantMsg) : '';
      if (!userText) return;

      const maxLen = this.titleGeneration.maxLength;
      const prompt: ModelMessage[] = [
        {
          role: 'system',
          content:
            `You are a title generator. Produce a SHORT (<=${maxLen} characters), ` +
            `noun-phrase title that captures the topic of the conversation below. ` +
            `Reply with the title ONLY — no quotes, no punctuation, no preamble, ` +
            `no trailing period. Match the language of the user's message.`,
        } as ModelMessage,
        {
          role: 'user',
          content:
            `User said:\n${userText.slice(0, 800)}` +
            (assistantText ? `\n\nAssistant replied:\n${assistantText.slice(0, 800)}` : ''),
        } as ModelMessage,
      ];

      // Call adapter directly — bypass tools, bypass our own persist/title
      // hooks, and request a minimal token budget. Errors here surface as
      // warnings and the user just gets the fallback preview in the sidebar.
      const result = await this.adapter.chat(prompt, {
        temperature: 0.3,
        maxTokens: 32,
      });
      const raw = (result.content ?? '').trim();
      if (!raw) return;
      const cleaned = cleanTitle(raw, maxLen);
      if (!cleaned) return;

      await this.conversationService.update(conversationId, { title: cleaned });
      this.logger.debug('[AI] auto-titled conversation', {
        conversationId,
        title: cleaned,
      });
    } catch (err) {
      // Failure is non-fatal — drop the id from the tried set so a
      // later turn can retry once the underlying issue clears.
      this.titledConversations.delete(conversationId);
      this.logger.debug('[AI] summarizeConversation failed', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Best-effort auto-creation of a conversation when the caller did not
   * supply one but did supply an actor we can attribute the chat to.
   * Returns the new id on success, or `undefined` if creation failed (in
   * which case we silently fall back to non-persisted chat).
   */
  private async autoCreateConversation(
    ctx: { actor?: { id?: string }; environmentId?: string } | undefined,
  ): Promise<string | undefined> {
    const actorId = ctx?.actor?.id;
    if (!actorId) return undefined;
    try {
      const conv = await this.conversationService.create({
        userId: actorId,
        metadata: ctx?.environmentId ? { environmentId: ctx.environmentId } : undefined,
      });
      this.logger.debug('[AI] auto-created conversation', { conversationId: conv.id, actorId });
      return conv.id;
    } catch (err) {
      this.logger.warn('[AI] auto-create conversation failed', {
        actorId,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  /**
   * Best-effort persistence of a single chat message to the conversation
   * store. Failures are logged at warn level and swallowed — chat requests
   * must never fail because the history write failed. Mirrors the
   * precedent set by `ObjectQLTraceRecorder.record`.
   */
  private async persistMessage(
    conversationId: string,
    message: ModelMessage,
    extras?: MessageObservability,
  ): Promise<void> {
    try {
      await this.conversationService.addMessage(conversationId, message, extras);
    } catch (err) {
      this.logger.warn('[AI] persist message failed', {
        conversationId,
        role: (message as { role?: string }).role,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Build a {@link MessageObservability} payload from an LLM-call result
   * and the wall-clock time it took. Returns `undefined` when there's
   * nothing useful to persist (no usage and no latency) so callers don't
   * need to special-case empty results.
   */
  private static buildObservability(
    result: { model?: string; usage?: AIResult['usage'] } | undefined,
    startedAt: number | undefined,
  ): MessageObservability | undefined {
    if (!result) return undefined;
    const usage = result.usage;
    const latencyMs = startedAt != null ? Date.now() - startedAt : undefined;
    if (!result.model && !usage && latencyMs == null) return undefined;
    return {
      model: result.model,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      totalTokens: usage?.totalTokens,
      latencyMs,
    };
  }

  /**
   * Run an adapter call and emit a trace event.
   *
   * Records both success and failure. Tracing failures never escape — the
   * recorder is expected to be defensive.
   */
  private async instrument<T extends { model?: string; usage?: AIResult['usage'] }>(
    operation: TraceOperation,
    options: AIRequestOptions | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      void this.traceRecorder.record(buildTraceEvent({
        operation,
        adapter: this.adapter.name,
        model: result.model ?? options?.model,
        usage: result.usage,
        latencyMs: Date.now() - started,
        status: 'success',
        registry: this.modelRegistry,
      }));
      return result;
    } catch (err) {
      void this.traceRecorder.record(buildTraceEvent({
        operation,
        adapter: this.adapter.name,
        model: options?.model,
        latencyMs: Date.now() - started,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        registry: this.modelRegistry,
      }));
      throw err;
    }
  }

  // ── IAIService implementation ──────────────────────────────────

  async chat(messages: ModelMessage[], options?: AIRequestOptions): Promise<AIResult> {
    this.logger.debug('[AI] chat', { messageCount: messages.length, model: options?.model });
    return this.instrument('chat', options, () => this.adapter.chat(messages, options));
  }

  async complete(prompt: string, options?: AIRequestOptions): Promise<AIResult> {
    this.logger.debug('[AI] complete', { promptLength: prompt.length, model: options?.model });
    return this.instrument('complete', options, () => this.adapter.complete(prompt, options));
  }

  /**
   * Generate a strongly-typed object validated against a Zod schema.
   *
   * Delegates to the adapter's `generateObject` when supported; throws a
   * descriptive error when the adapter does not implement structured output.
   *
   * @example
   * ```ts
   * import { z } from 'zod';
   * const Schema = z.object({ name: z.string(), priority: z.number().int() });
   * const { object } = await ai.generateObject(messages, Schema);
   * ```
   */
  async generateObject<T>(
    messages: ModelMessage[],
    schema: z.ZodType<T>,
    options?: GenerateObjectOptions,
  ): Promise<AIObjectResult<T>> {
    this.logger.debug('[AI] generateObject', { messageCount: messages.length, model: options?.model });
    if (!this.adapter.generateObject) {
      throw new Error(
        `[AI] Adapter "${this.adapter.name}" does not support generateObject. ` +
        `Use VercelLLMAdapter with a structured-output-capable model.`,
      );
    }
    return this.instrument('generate_object', options, () =>
      this.adapter.generateObject!(messages, schema, options),
    );
  }

  async *streamChat(
    messages: ModelMessage[],
    options?: AIRequestOptions,
  ): AsyncIterable<TextStreamPart<ToolSet>> {
    this.logger.debug('[AI] streamChat', { messageCount: messages.length, model: options?.model });

    if (!this.adapter.streamChat) {
      // Fallback: emit the entire response as a single text-delta + finish
      const result = await this.adapter.chat(messages, options);
      yield textDeltaPart('fallback', result.content);
      yield finishPart(result);
      return;
    }

    yield* this.adapter.streamChat(messages, options);
  }

  async embed(input: string | string[], model?: string): Promise<number[][]> {
    if (!this.adapter.embed) {
      throw new Error(`[AI] Adapter "${this.adapter.name}" does not support embeddings`);
    }
    return this.adapter.embed(input, model);
  }

  async listModels(): Promise<string[]> {
    if (!this.adapter.listModels) {
      return [];
    }
    return this.adapter.listModels();
  }

  // ── Tool Call Loop ────────────────────────────────────────────

  /** Default maximum iterations for the tool call loop. */
  static readonly DEFAULT_MAX_ITERATIONS = 10;

  /** Extract the text value from a ToolExecutionResult's output. */
  private static extractOutputText(tr: ToolExecutionResult): string {
    return tr.output && typeof tr.output === 'object' && 'value' in tr.output
      ? String(tr.output.value) : 'unknown error';
  }

  /**
   * Chat with automatic tool call resolution.
   *
   * 1. Merges registered tool definitions into `options.tools`.
   * 2. Calls the LLM adapter.
   * 3. If the response contains `toolCalls`, executes them via the
   *    {@link ToolRegistry}, appends tool results as `role: 'tool'`
   *    messages, and loops back to step 2.
   * 4. Repeats until the model produces a final text response or the
   *    maximum number of iterations (`maxIterations`) is reached.
   */
  async chatWithTools(
    messages: ModelMessage[],
    options?: ChatWithToolsOptions,
  ): Promise<AIResult> {
    return this.instrument('chat_with_tools', options, () =>
      this.chatWithToolsImpl(messages, options),
    );
  }

  private async chatWithToolsImpl(
    messages: ModelMessage[],
    options?: ChatWithToolsOptions,
  ): Promise<AIResult> {
    // Destructure loop-specific options so they are never forwarded to the adapter
    const {
      maxIterations: maxIter,
      onToolError,
      toolExecutionContext,
      ...restOptions
    } = options ?? {};
    const maxIterations = maxIter ?? AIService.DEFAULT_MAX_ITERATIONS;
    const registeredTools = this.toolRegistry.getAll();
    let conversationId = toolExecutionContext?.conversationId;
    let autoCreatedConversationId: string | undefined;
    if (!conversationId) {
      autoCreatedConversationId = await this.autoCreateConversation(toolExecutionContext);
      conversationId = autoCreatedConversationId;
    }

    // Merge registered tools with any explicitly provided tools
    const mergedTools = [
      ...registeredTools,
      ...(restOptions.tools ?? []),
    ];

    // Build the options that will be sent to every LLM call in the loop
    const chatOptions: AIRequestOptions = {
      ...restOptions,
      tools: mergedTools.length > 0 ? mergedTools : undefined,
      toolChoice: mergedTools.length > 0 ? (restOptions.toolChoice ?? 'auto') : undefined,
    };

    // Working copy of the conversation
    const conversation = [...messages];

    // Persist the inbound user turn when a conversationId is supplied.
    // Only the last message is written — callers are assumed to pass
    // prior history alongside the new turn; we don't diff.
    if (conversationId && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last && (last as { role?: string }).role === 'user') {
        await this.persistMessage(conversationId, last);
      }
    }

    // Track errors across iterations for diagnostics
    const toolErrors: Array<{ iteration: number; toolName: string; error: string }> = [];

    this.logger.debug('[AI] chatWithTools start', {
      messageCount: conversation.length,
      toolCount: mergedTools.length,
      maxIterations,
    });

    let abortedByCallback = false;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const turnStartedAt = Date.now();
      const result = await this.adapter.chat(conversation, chatOptions);
      const turnObservability = AIService.buildObservability(result, turnStartedAt);

      // If the model did not request any tool calls we're done
      if (!result.toolCalls || result.toolCalls.length === 0) {
        this.logger.debug('[AI] chatWithTools finished', { iteration, content: result.content.slice(0, 80) });
        if (conversationId) {
          await this.persistMessage(
            conversationId,
            {
              role: 'assistant',
              content: result.content,
            } as ModelMessage,
            turnObservability,
          );
          void this.summarizeConversation(conversationId);
        }
        return autoCreatedConversationId
          ? { ...result, conversationId: autoCreatedConversationId }
          : result;
      }

      this.logger.debug('[AI] chatWithTools tool calls', {
        iteration,
        calls: result.toolCalls.map(tc => tc.toolName),
      });

      // Append the assistant's response (with tool call metadata) to the conversation
      const assistantContent: Array<{ type: 'text'; text: string } | ToolCallPart> = [];
      if (result.content) assistantContent.push({ type: 'text', text: result.content });
      assistantContent.push(...result.toolCalls);
      const assistantTurn = {
        role: 'assistant',
        content: assistantContent,
      } as ModelMessage;
      conversation.push(assistantTurn);
      if (conversationId) {
        // Attribute usage / latency to the assistant turn that triggered
        // the tool calls — the subsequent role:'tool' messages have no
        // LLM cost of their own.
        await this.persistMessage(conversationId, assistantTurn, turnObservability);
      }

      // Execute all tool calls in parallel, threading the per-request
      // execution context so handlers can attribute work to the actor
      // and enforce row-level security.
      const toolResults: ToolExecutionResult[] = await this.toolRegistry.executeAll(
        result.toolCalls,
        toolExecutionContext,
      );

      // Process results: track errors, honour onToolError callback, and
      // append each tool result as a `role: 'tool'` message so the
      // model can react in the next loop iteration.
      for (const tr of toolResults) {
        if (tr.isError) {
          const matchedCall = result.toolCalls!.find(tc => tc.toolCallId === tr.toolCallId);
          const toolName = matchedCall?.toolName ?? 'unknown';
          const errorText = AIService.extractOutputText(tr);
          const errorEntry = { iteration, toolName, error: errorText };
          toolErrors.push(errorEntry);
          this.logger.warn('[AI] chatWithTools tool error', errorEntry);

          if (onToolError && matchedCall) {
            const action = onToolError(matchedCall, errorText);
            if (action === 'abort') {
              abortedByCallback = true;
            }
          }
        }

        // Append each tool result as a `role: 'tool'` message
        const toolTurn = {
          role: 'tool',
          content: [tr],
        } as ModelMessage;
        conversation.push(toolTurn);
        if (conversationId) {
          await this.persistMessage(conversationId, toolTurn);
        }
      }

      if (abortedByCallback) {
        break;
      }
    }

    // Distinguish user-driven abort from max-iterations exhaustion in logs
    if (abortedByCallback) {
      this.logger.warn('[AI] chatWithTools aborted by onToolError callback', { toolErrors });
    } else {
      this.logger.warn('[AI] chatWithTools max iterations reached, forcing final response', {
        toolErrors: toolErrors.length > 0 ? toolErrors : undefined,
      });
    }

    // Make one last call *without* tools so the model is forced to produce text.
    const finalStartedAt = Date.now();
    const finalResult = await this.adapter.chat(conversation, {
      ...chatOptions,
      tools: undefined,
      toolChoice: undefined,
    });
    const finalObservability = AIService.buildObservability(finalResult, finalStartedAt);
    if (conversationId) {
      await this.persistMessage(
        conversationId,
        {
          role: 'assistant',
          content: finalResult.content,
        } as ModelMessage,
        finalObservability,
      );
      void this.summarizeConversation(conversationId);
    }
    return autoCreatedConversationId
      ? { ...finalResult, conversationId: autoCreatedConversationId }
      : finalResult;
  }

  /**
   * Stream chat with automatic tool call resolution.
   *
   * Works like {@link chatWithTools} but yields SSE events.  When the model
   * requests tool calls during streaming, they are executed and the results
   * fed back until a final text stream is produced.
   */
  async *streamChatWithTools(
    messages: ModelMessage[],
    options?: ChatWithToolsOptions,
  ): AsyncIterable<TextStreamPart<ToolSet>> {
    const {
      maxIterations: maxIter,
      onToolError,
      toolExecutionContext,
      ...restOptions
    } = options ?? {};
    const maxIterations = maxIter ?? AIService.DEFAULT_MAX_ITERATIONS;
    const registeredTools = this.toolRegistry.getAll();
    let conversationId = toolExecutionContext?.conversationId;
    let autoCreatedConversationId: string | undefined;
    if (!conversationId) {
      autoCreatedConversationId = await this.autoCreateConversation(toolExecutionContext);
      conversationId = autoCreatedConversationId;
    }

    const mergedTools = [
      ...registeredTools,
      ...(restOptions.tools ?? []),
    ];

    const chatOptions: AIRequestOptions = {
      ...restOptions,
      tools: mergedTools.length > 0 ? mergedTools : undefined,
      toolChoice: mergedTools.length > 0 ? (restOptions.toolChoice ?? 'auto') : undefined,
    };

    const conversation = [...messages];
    let abortedByCallback = false;

    // Surface an auto-created conversation id to streaming clients via a
    // synthetic tool-call frame. Clients that care can listen for the
    // `__conversation_meta__` tool name and persist the id locally.
    if (autoCreatedConversationId) {
      yield {
        type: 'tool-call',
        toolCallId: '__conversation_meta__',
        toolName: '__conversation_meta__',
        input: { conversationId: autoCreatedConversationId },
      } as TextStreamPart<ToolSet>;
    }

    if (conversationId && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last && (last as { role?: string }).role === 'user') {
        await this.persistMessage(conversationId, last);
      }
    }

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Use non-streaming chat for intermediate tool-call rounds
      const turnStartedAt = Date.now();
      const result = await this.adapter.chat(conversation, chatOptions);
      const turnObservability = AIService.buildObservability(result, turnStartedAt);

      if (!result.toolCalls || result.toolCalls.length === 0) {
        // Final round — return the probed result without an extra model call
        if (conversationId) {
          await this.persistMessage(
            conversationId,
            {
              role: 'assistant',
              content: result.content,
            } as ModelMessage,
            turnObservability,
          );
          void this.summarizeConversation(conversationId);
        }
        yield textDeltaPart('stream', result.content);
        yield finishPart(result);
        return;
      }

      // Emit tool-call events so the client can see tool execution progress
      for (const tc of result.toolCalls) {
        yield { type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input } as TextStreamPart<ToolSet>;
      }

      const assistantContent: Array<{ type: 'text'; text: string } | ToolCallPart> = [];
      if (result.content) assistantContent.push({ type: 'text', text: result.content });
      assistantContent.push(...result.toolCalls);
      const assistantTurn = {
        role: 'assistant',
        content: assistantContent,
      } as ModelMessage;
      conversation.push(assistantTurn);
      if (conversationId) {
        await this.persistMessage(conversationId, assistantTurn, turnObservability);
      }

      // Drain tool PROGRESS events (emitted via `ctx.onProgress` during a
      // long-running tool, e.g. apply_blueprint's build tree) into the stream
      // WHILE the tools run, then yield their final results. Backward-compatible:
      // a tool that never emits leaves `progress` empty, so this awaits execution
      // exactly once — identical to the previous single `await executeAll`.
      const progress: TextStreamPart<ToolSet>[] = [];
      let resolveTick: (() => void) | null = null;
      const tick = (): void => {
        const r = resolveTick;
        resolveTick = null;
        r?.();
      };
      const execCtx: ToolExecutionContext = {
        ...(toolExecutionContext ?? {}),
        onProgress: (part) => {
          progress.push(part as unknown as TextStreamPart<ToolSet>);
          tick();
        },
      };
      const execPromise = this.toolRegistry.executeAll(result.toolCalls, execCtx);
      let execSettled = false;
      // Swallow rejection on the tracking chain (the real throw is re-surfaced by
      // `await execPromise` below) so it never becomes an unhandled rejection.
      void execPromise.then(
        () => {},
        () => {},
      ).finally(() => {
        execSettled = true;
        tick();
      });
      // Yield any buffered progress, then park until the next emit or completion.
      while (true) {
        while (progress.length > 0) yield progress.shift()!;
        if (execSettled) break;
        await new Promise<void>((resolve) => {
          resolveTick = resolve;
        });
      }
      const toolResults: ToolExecutionResult[] = await execPromise;

      for (const tr of toolResults) {
        if (tr.isError && onToolError) {
          const matchedCall = result.toolCalls!.find(tc => tc.toolCallId === tr.toolCallId);
          if (matchedCall) {
            const errorText = AIService.extractOutputText(tr);
            const action = onToolError(matchedCall, errorText);
            if (action === 'abort') {
              abortedByCallback = true;
            }
          }
        }
        // Emit tool-result so the client can see tool output via SSE
        yield {
          type: 'tool-result',
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: tr.output,
        } as TextStreamPart<ToolSet>;
        const toolTurn = {
          role: 'tool',
          content: [tr],
        } as ModelMessage;
        conversation.push(toolTurn);
        if (conversationId) {
          await this.persistMessage(conversationId, toolTurn);
        }
      }

      if (abortedByCallback) {
        break;
      }
    }

    // Forced final response (no tools) — either aborted or max iterations
    if (abortedByCallback) {
      this.logger.warn('[AI] streamChatWithTools aborted by onToolError callback');
    } else {
      this.logger.warn('[AI] streamChatWithTools max iterations reached');
    }
    const finalOptions = { ...chatOptions, tools: undefined, toolChoice: undefined };
    const finalStartedAt = Date.now();
    const result = await this.adapter.chat(conversation, finalOptions);
    const finalObservability = AIService.buildObservability(result, finalStartedAt);
    if (conversationId) {
      await this.persistMessage(
        conversationId,
        {
          role: 'assistant',
          content: result.content,
        } as ModelMessage,
        finalObservability,
      );
      void this.summarizeConversation(conversationId);
    }
    yield textDeltaPart('stream', result.content);
    yield finishPart(result);
  }

  // ── HITL: pending-action queue ─────────────────────────────────

  /**
   * Register a dispatcher callback for a tool. Called by
   * `registerActionsAsTools()` when action approval is enabled so the
   * approval handler can re-run the exact same code path the LLM
   * would have triggered.
   */
  registerPendingActionDispatcher(
    toolName: string,
    dispatch: (input: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.pendingDispatchers.set(toolName, dispatch);
  }

  async proposePendingAction(input: ProposePendingActionInput): Promise<{ id: string }> {
    if (!this.dataEngine) {
      throw new Error('proposePendingAction requires a dataEngine — wire it via AIServiceConfig.');
    }
    const id = `pa_${cryptoRandomId()}`;
    const row = {
      id,
      conversation_id: input.conversationId ?? null,
      message_id: input.messageId ?? null,
      object_name: input.objectName,
      action_name: input.actionName,
      tool_name: input.toolName,
      tool_input: JSON.stringify(input.toolInput ?? {}),
      status: 'pending',
      proposed_by: input.proposedBy ?? 'ai_agent',
      proposed_at: new Date().toISOString(),
    };
    await this.dataEngine.insert('ai_pending_actions', row);
    this.logger.info(
      `[AI] pending action proposed: ${id} (${input.toolName} on ${input.objectName})`,
    );
    return { id };
  }

  async approvePendingAction(
    id: string,
    actorId: string,
  ): Promise<{ status: 'executed' | 'failed'; result?: unknown; error?: string }> {
    if (!this.dataEngine) {
      throw new Error('approvePendingAction requires a dataEngine.');
    }
    const row = await this.loadPendingRow(id);
    if (row.status !== 'pending') {
      throw new Error(`pending action ${id} is already ${row.status}`);
    }
    const dispatch = this.pendingDispatchers.get(row.tool_name);
    if (!dispatch) {
      throw new Error(
        `no dispatcher registered for tool '${row.tool_name}' — was the AI plugin restarted without re-registering actions?`,
      );
    }
    await this.dataEngine.update(
      'ai_pending_actions',
      {
        id,
        status: 'approved',
        decided_by: actorId,
        decided_at: new Date().toISOString(),
      },
      { where: { id } },
    );
    let parsed: Record<string, unknown> = {};
    try {
      parsed = row.tool_input ? (JSON.parse(row.tool_input) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    try {
      const out = await dispatch(parsed);
      await this.dataEngine.update(
        'ai_pending_actions',
        { id, status: 'executed', result: JSON.stringify(out ?? null) },
        { where: { id } },
      );
      this.logger.info(`[AI] pending action ${id} executed by ${actorId}`);
      return { status: 'executed', result: out };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.dataEngine.update(
        'ai_pending_actions',
        { id, status: 'failed', error: msg },
        { where: { id } },
      );
      this.logger.warn(`[AI] pending action ${id} failed after approval: ${msg}`);
      return { status: 'failed', error: msg };
    }
  }

  async rejectPendingAction(id: string, actorId: string, reason?: string): Promise<void> {
    if (!this.dataEngine) {
      throw new Error('rejectPendingAction requires a dataEngine.');
    }
    const row = await this.loadPendingRow(id);
    if (row.status !== 'pending') {
      throw new Error(`pending action ${id} is already ${row.status}`);
    }
    await this.dataEngine.update(
      'ai_pending_actions',
      {
        id,
        status: 'rejected',
        decided_by: actorId,
        decided_at: new Date().toISOString(),
        rejection_reason: reason ?? null,
      },
      { where: { id } },
    );
    this.logger.info(`[AI] pending action ${id} rejected by ${actorId}`);
  }

  async listPendingActions(filter?: {
    status?: PendingActionStatus | PendingActionStatus[];
    conversationId?: string;
    objectName?: string;
    limit?: number;
  }): Promise<PendingActionRow[]> {
    if (!this.dataEngine) return [];
    const where: Record<string, unknown> = {};
    if (filter?.status) {
      where.status = Array.isArray(filter.status) ? { in: filter.status } : filter.status;
    }
    if (filter?.conversationId) where.conversation_id = filter.conversationId;
    if (filter?.objectName) where.object_name = filter.objectName;
    const rows = (await this.dataEngine.find('ai_pending_actions', {
      where,
      limit: filter?.limit ?? 100,
      orderBy: [{ field: 'proposed_at', order: 'desc' }],
    })) as PendingActionRow[];
    return rows;
  }

  private async loadPendingRow(id: string): Promise<PendingActionRow> {
    const rows = (await this.dataEngine!.find('ai_pending_actions', {
      where: { id },
      limit: 1,
    })) as PendingActionRow[];
    const row = rows[0];
    if (!row) throw new Error(`pending action ${id} not found`);
    return row;
  }
}

function cryptoRandomId(): string {
  // crypto.randomUUID is available in Node 16+ and modern browsers; fall
  // back to a timestamp+random pair for environments that lack it.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
