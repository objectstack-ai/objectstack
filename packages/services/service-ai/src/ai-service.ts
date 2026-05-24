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
  ChatWithToolsOptions,
  LLMAdapter,
} from '@objectstack/spec/contracts';
import type { Logger } from '@objectstack/spec/contracts';
import type { z } from 'zod';
import { createLogger } from '@objectstack/core';
import { MemoryLLMAdapter } from './adapters/memory-adapter.js';
import { ToolRegistry } from './tools/tool-registry.js';
import type { ToolExecutionResult } from './tools/tool-registry.js';
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
  private readonly adapter: LLMAdapter;
  private readonly logger: Logger;
  readonly toolRegistry: ToolRegistry;
  readonly conversationService: IAIConversationService;
  readonly modelRegistry?: ModelRegistry;
  readonly traceRecorder: TraceRecorder;

  constructor(config: AIServiceConfig = {}) {
    this.adapter = config.adapter ?? new MemoryLLMAdapter();
    this.logger = config.logger ?? createLogger({ level: 'info', format: 'pretty' });
    this.toolRegistry = config.toolRegistry ?? new ToolRegistry();
    this.conversationService = config.conversationService ?? new InMemoryConversationService();
    this.modelRegistry = config.modelRegistry;
    this.traceRecorder = config.traceRecorder ?? new NullTraceRecorder();

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
    // Destructure loop-specific options so they are never forwarded to the adapter
    const { maxIterations: maxIter, onToolError, ...restOptions } = options ?? {};
    const maxIterations = maxIter ?? AIService.DEFAULT_MAX_ITERATIONS;
    const registeredTools = this.toolRegistry.getAll();

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

    // Track errors across iterations for diagnostics
    const toolErrors: Array<{ iteration: number; toolName: string; error: string }> = [];

    this.logger.debug('[AI] chatWithTools start', {
      messageCount: conversation.length,
      toolCount: mergedTools.length,
      maxIterations,
    });

    let abortedByCallback = false;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const result = await this.adapter.chat(conversation, chatOptions);

      // If the model did not request any tool calls we're done
      if (!result.toolCalls || result.toolCalls.length === 0) {
        this.logger.debug('[AI] chatWithTools finished', { iteration, content: result.content.slice(0, 80) });
        return result;
      }

      this.logger.debug('[AI] chatWithTools tool calls', {
        iteration,
        calls: result.toolCalls.map(tc => tc.toolName),
      });

      // Append the assistant's response (with tool call metadata) to the conversation
      const assistantContent: Array<{ type: 'text'; text: string } | ToolCallPart> = [];
      if (result.content) assistantContent.push({ type: 'text', text: result.content });
      assistantContent.push(...result.toolCalls);
      conversation.push({
        role: 'assistant',
        content: assistantContent,
      } as ModelMessage);

      // Execute all tool calls in parallel
      const toolResults: ToolExecutionResult[] = await this.toolRegistry.executeAll(result.toolCalls);

      // Process results: track errors and honour onToolError callback
      for (const tr of toolResults) {
        if (tr.isError) {
          // Match tool call by toolCallId for robust attribution
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
        conversation.push({
          role: 'tool',
          content: [tr],
        } as ModelMessage);
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
    const finalResult = await this.adapter.chat(conversation, {
      ...chatOptions,
      tools: undefined,
      toolChoice: undefined,
    });
    return finalResult;
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
    const { maxIterations: maxIter, onToolError, ...restOptions } = options ?? {};
    const maxIterations = maxIter ?? AIService.DEFAULT_MAX_ITERATIONS;
    const registeredTools = this.toolRegistry.getAll();

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

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Use non-streaming chat for intermediate tool-call rounds
      const result = await this.adapter.chat(conversation, chatOptions);

      if (!result.toolCalls || result.toolCalls.length === 0) {
        // Final round — return the probed result without an extra model call
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
      conversation.push({
        role: 'assistant',
        content: assistantContent,
      } as ModelMessage);

      const toolResults: ToolExecutionResult[] = await this.toolRegistry.executeAll(result.toolCalls);

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
        conversation.push({
          role: 'tool',
          content: [tr],
        } as ModelMessage);
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
    const result = await this.adapter.chat(conversation, finalOptions);
    yield textDeltaPart('stream', result.content);
    yield finishPart(result);
  }
}
