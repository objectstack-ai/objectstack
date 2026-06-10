// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IAIService - AI Engine Service Contract
 *
 * Defines the interface for AI capabilities (NLQ, chat, suggestions, embeddings)
 * in ObjectStack. Concrete implementations (OpenAI, Anthropic, Ollama, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete AI/LLM provider implementations.
 *
 * Aligned with CoreServiceName 'ai' in core-services.zod.ts.
 *
 * ## Vercel AI SDK Alignment
 *
 * Message, tool-call, and streaming types are re-exported directly from the
 * Vercel AI SDK (`ai`) so that ObjectStack's wire protocol is fully aligned
 * with the ecosystem used by `@ai-sdk/react/useChat` on the frontend.
 *
 * - `ModelMessage` replaces the former custom `AIMessage`
 * - `ToolCallPart` replaces `AIToolCall`
 * - `ToolResultPart` replaces `AIToolResult`
 * - `TextStreamPart` replaces `AIStreamEvent`
 */

// ---------------------------------------------------------------------------
// Re-exports from Vercel AI SDK (canonical types)
// ---------------------------------------------------------------------------

export type {
    ModelMessage,
    SystemModelMessage,
    UserModelMessage,
    AssistantModelMessage,
    ToolModelMessage,
    ToolCallPart,
    ToolResultPart,
    TextStreamPart,
    ToolSet,
    FinishReason,
} from 'ai';

// ---------------------------------------------------------------------------
// Deprecated aliases — kept for backward compatibility
// ---------------------------------------------------------------------------

import type {
    ModelMessage,
    ToolCallPart,
    ToolResultPart,
    TextStreamPart,
    ToolSet,
} from 'ai';
import type { z } from 'zod';

/**
 * @deprecated Use `ModelMessage` from `ai` instead.
 *
 * Previously a flat interface with `role`, `content: string`, `toolCalls?`,
 * and `toolCallId?`. The Vercel AI SDK uses a discriminated union where each
 * role has its own content type.
 */
export type AIMessage = ModelMessage;

/**
 * @deprecated Use `ToolCallPart` from `ai` instead.
 *
 * The Vercel type uses `toolCallId` / `toolName` / `input` rather than
 * `id` / `name` / `arguments`.
 */
export type AIToolCall = ToolCallPart;

/**
 * @deprecated Use `ToolResultPart` from `ai` instead.
 */
export type AIToolResult = ToolResultPart;

/**
 * @deprecated Use `AIMessage` directly — tool fields are now on the base type.
 */
export type AIMessageWithTools = ModelMessage;

/**
 * @deprecated Use `AIRequestOptions` directly — tool fields are now on the base type.
 */
export type AIRequestOptionsWithTools = AIRequestOptions;

/**
 * @deprecated Use `TextStreamPart<ToolSet>` from `ai` instead.
 *
 * The Vercel AI SDK uses a rich discriminated union for stream parts.
 */
export type AIStreamEvent = TextStreamPart<ToolSet>;

// ---------------------------------------------------------------------------
// ObjectStack-specific types (no Vercel equivalent)
// ---------------------------------------------------------------------------

/**
 * Options for AI completion/chat requests.
 *
 * Includes tool-related configuration so that tool calling works in both
 * streaming (`streamChat`) and non-streaming (`chat`) modes.
 */
export interface AIRequestOptions {
    /** Model identifier to use */
    model?: string;
    /** Sampling temperature (0-2) */
    temperature?: number;
    /** Maximum tokens to generate */
    maxTokens?: number;
    /** Stop sequences */
    stop?: string[];
    /** Tool definitions available to the model */
    tools?: AIToolDefinition[];
    /** How the model should use tools: 'auto', 'none', or a specific tool name */
    toolChoice?: 'auto' | 'none' | string;
}

/**
 * Result of an AI completion/chat request
 */
export interface AIResult {
    /** Generated text content */
    content: string;
    /** Model used for generation */
    model?: string;
    /** Tool calls requested by the model (present when the model invokes tools) */
    toolCalls?: ToolCallPart[];
    /** Token usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /**
     * Conversation id used for persistence. Echoed back when
     * `chatWithTools` auto-creates a conversation (caller omitted
     * `toolExecutionContext.conversationId` but supplied an actor).
     * Callers can use this to continue the same thread on subsequent
     * turns.
     */
    conversationId?: string;
}

// ---------------------------------------------------------------------------
// Tool Calling Protocol
// ---------------------------------------------------------------------------

/**
 * Definition of a tool that can be invoked by the AI model.
 *
 * This is an ObjectStack-specific simplified definition used by the
 * `IAIService` contract. For the full Vercel AI SDK tool definition,
 * use `Tool` from `ai`.
 */
export interface AIToolDefinition {
    /** Tool name (snake_case identifier) */
    name: string;
    /**
     * Human-readable display name. Optional for the LLM function-calling
     * path (which only needs name/description/parameters), but required
     * when the tool is registered as `tool` metadata for Studio — see
     * `ToolSchema`. Registration paths must supply a label (falling back
     * to a name-derived one) so persisted tool metadata passes validation.
     */
    label?: string;
    /** Human-readable description */
    description: string;
    /** JSON Schema describing the tool parameters */
    parameters: Record<string, unknown>;
    /**
     * Optional tool category (mirrors `ToolSchema.category`). Carried by
     * action-backed tools from `action.ai.category`; surfaced by tool-listing
     * routes. Not sent to the model.
     */
    category?: string;
    /**
     * Optional JSON Schema for the tool's return value. Action-backed tools
     * derive this from `action.ai.outputSchema` to enable downstream chaining.
     */
    outputSchema?: Record<string, unknown>;
    /** Object this tool operates on, when the tool is action-backed. */
    objectName?: string;
    /**
     * Whether invoking this tool requires human-in-the-loop confirmation.
     * Action-backed tools set this from the action's confirmation policy
     * (`action.ai.requiresConfirmation`, or the destructive-action default).
     */
    requiresConfirmation?: boolean;
}

// ---------------------------------------------------------------------------
// IAIService
// ---------------------------------------------------------------------------

export interface IAIService {
    /**
     * Generate a chat completion from a conversation.
     *
     * Accepts Vercel AI SDK `ModelMessage[]` for full ecosystem alignment.
     *
     * @param messages - Array of conversation messages (Vercel `ModelMessage`)
     * @param options - Optional request configuration
     * @returns AI-generated response
     */
    chat(messages: ModelMessage[], options?: AIRequestOptions): Promise<AIResult>;

    /**
     * Generate a text completion from a prompt
     * @param prompt - Input prompt string
     * @param options - Optional request configuration
     * @returns AI-generated response
     */
    complete(prompt: string, options?: AIRequestOptions): Promise<AIResult>;

    /**
     * Generate embeddings for a text input
     * @param input - Text or array of texts to embed
     * @param model - Optional embedding model identifier
     * @returns Array of embedding vectors
     */
    embed?(input: string | string[], model?: string): Promise<number[][]>;

    /**
     * List available models
     * @returns Array of model identifiers
     */
    listModels?(): Promise<string[]>;

    /**
     * Stream a chat completion as an async iterable of Vercel AI SDK stream parts.
     *
     * @param messages - Array of conversation messages (Vercel `ModelMessage`)
     * @param options - Optional request configuration (supports tool definitions)
     * @returns Async iterable of `TextStreamPart` events
     */
    streamChat?(messages: ModelMessage[], options?: AIRequestOptions): AsyncIterable<TextStreamPart<ToolSet>>;

    /**
     * Generate a strongly-typed object that conforms to a Zod schema.
     *
     * Implementations should leverage native structured-output features
     * (OpenAI JSON mode / Responses API, Anthropic tool use, Gemini schema)
     * when available. The result `object` is guaranteed to validate against
     * the schema.
     *
     * Optional — adapters that do not support structured output should
     * either throw or omit this method.
     *
     * @example
     * ```ts
     * const Schema = z.object({ name: z.string(), priority: z.number().int() });
     * const { object } = await ai.generateObject(messages, Schema);
     * // object is typed as { name: string; priority: number }
     * ```
     */
    generateObject?<T>(
        messages: ModelMessage[],
        schema: z.ZodType<T>,
        options?: GenerateObjectOptions,
    ): Promise<AIObjectResult<T>>;

    /**
     * Chat with automatic tool call resolution.
     *
     * Sends messages to the LLM with tool definitions, automatically
     * executes any returned tool calls, feeds the results back, and
     * repeats until the model returns a final text response or the
     * maximum number of iterations is reached.
     *
     * @param messages - Conversation messages (Vercel `ModelMessage`)
     * @param options  - Request options (tools are auto-injected from the registry)
     * @returns Final AI result after all tool calls have been resolved
     */
    chatWithTools?(messages: ModelMessage[], options?: ChatWithToolsOptions): Promise<AIResult>;

    /**
     * Persist a proposed AI-initiated action that requires human approval
     * before execution. Used by the actions-as-tools runtime when the
     * picked action is dangerous (delete / danger variant / has
     * `confirmText`) and `enableActionApproval` is on.
     *
     * Implementations write a row to `ai_pending_actions` and return
     * its id. The caller (the tool handler) immediately returns a
     * `{ status: 'pending_approval' }` envelope to the LLM.
     */
    proposePendingAction?(input: ProposePendingActionInput): Promise<{ id: string }>;

    /**
     * Approve a previously-proposed pending action and re-dispatch it
     * via the same handler that would have run had approval not been
     * required. Updates the row to `executed` (or `failed`) and returns
     * the outcome.
     */
    approvePendingAction?(
        id: string,
        actorId: string,
    ): Promise<{ status: 'executed' | 'failed'; result?: unknown; error?: string }>;

    /**
     * Reject a pending action. The row transitions to `rejected` and the
     * optional `reason` is stored so the next LLM turn can surface it.
     */
    rejectPendingAction?(id: string, actorId: string, reason?: string): Promise<void>;

    /**
     * Inbox query: list pending (or filtered) action proposals. Used by
     * Studio's pending-actions view.
     */
    listPendingActions?(filter?: {
        status?: PendingActionStatus | PendingActionStatus[];
        conversationId?: string;
        objectName?: string;
        limit?: number;
    }): Promise<PendingActionRow[]>;
}

/** Lifecycle of a pending action proposal. */
export type PendingActionStatus = 'pending' | 'approved' | 'executed' | 'failed' | 'rejected';

/** Input for {@link IAIService.proposePendingAction}. */
export interface ProposePendingActionInput {
    objectName: string;
    actionName: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    conversationId?: string;
    messageId?: string;
    proposedBy?: string;
}

/** Stored row shape returned by {@link IAIService.listPendingActions}. */
export interface PendingActionRow {
    id: string;
    object_name: string;
    action_name: string;
    tool_name: string;
    tool_input: string;
    status: PendingActionStatus;
    result?: string;
    error?: string;
    rejection_reason?: string;
    conversation_id?: string;
    message_id?: string;
    proposed_by?: string;
    decided_by?: string;
    proposed_at: string;
    decided_at?: string;
}

/**
 * Options for the `chatWithTools()` tool call loop.
 */
export interface ChatWithToolsOptions extends AIRequestOptions {
    /** Maximum number of tool call loop iterations (default: 10) */
    maxIterations?: number;
    /**
     * Optional callback invoked when a tool execution fails.
     *
     * Receives the tool call that failed and the error message.
     * Return `'continue'` (default) to feed the error back to the model,
     * or `'abort'` to immediately stop the tool call loop.
     */
    onToolError?: (toolCall: ToolCallPart, error: string) => 'continue' | 'abort';
    /**
     * Per-call execution context threaded into every tool handler the
     * loop dispatches. The HTTP route should populate this from
     * `req.user` (and any conversation/environment headers) so that
     * built-in data tools forward the actor into ObjectQL's
     * `ExecutionContext` and row-level security automatically scopes
     * what the LLM can see or change.
     *
     * Optional for backward compatibility — when omitted, tools fall
     * back to system-level behaviour.
     */
    toolExecutionContext?: ToolExecutionContext;
}

/**
 * Per-call execution context threaded into every tool handler invoked
 * by {@link ChatWithToolsOptions}. Mirrors {@link ExecutionContext}
 * but is tailored to the AI tool boundary (no transaction handle, no
 * raw access token — those live on the engine call site).
 */
export interface ToolExecutionContext {
    /**
     * Authenticated end user on whose behalf the LLM is acting.
     * Built-in tools promote this into the ObjectQL `ExecutionContext`
     * so RLS engages. Omit for internal/system invocations.
     */
    actor?: {
        id: string;
        name?: string;
        roles?: string[];
        permissions?: string[];
    };
    /** Conversation id for trace/HITL correlation. */
    conversationId?: string;
    /** Assistant message id that produced the tool call. */
    messageId?: string;
    /** Active environment (multi-tenant project) id, if known. */
    environmentId?: string;
    /** Distributed-trace id for cross-service correlation. */
    traceId?: string;
    /**
     * Emit a progress event WHILE a long-running tool executes, surfaced to the
     * client mid-stream (before the tool returns). Set only on the streaming
     * path (`streamChatWithTools`); `undefined` for non-streaming/system calls,
     * so handlers must call it optionally (`ctx.onProgress?.(…)`).
     *
     * `type` is a Vercel UI-message-stream custom data-part name (must start
     * with `data-`, e.g. `data-build-progress`). Pass a stable `id` to RECONCILE
     * (replace) the part across emits — ideal for a single progress object that
     * updates in place; omit `id` for append-only events. `data` is the payload.
     *
     * Example (apply_blueprint streaming its build tree):
     *   ctx.onProgress?.({ type: 'data-build-progress', id: 'build', data: { phase, items } });
     */
    onProgress?: (part: { type: string; id?: string; data?: unknown }) => void;
}

/**
 * Options for {@link IAIService.generateObject}.
 */
export interface GenerateObjectOptions extends AIRequestOptions {
    /** Optional schema name to send to the provider (improves prompt clarity). */
    schemaName?: string;
    /** Optional schema description (sent to the provider). */
    schemaDescription?: string;
}

/**
 * Result of a {@link IAIService.generateObject} call.
 */
export interface AIObjectResult<T> {
    /** The validated, strongly-typed object. */
    object: T;
    /** Model used for generation. */
    model?: string;
    /** Token usage statistics. */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

// ---------------------------------------------------------------------------
// Conversation Management
// ---------------------------------------------------------------------------

/**
 * A persistent AI conversation with message history
 */
export interface AIConversation {
    /** Conversation ID */
    id: string;
    /** Title / summary */
    title?: string;
    /** Associated agent ID */
    agentId?: string;
    /** User who owns the conversation */
    userId?: string;
    /** Messages in the conversation */
    messages: ModelMessage[];
    /** Creation timestamp (ISO 8601) */
    createdAt: string;
    /** Last update timestamp (ISO 8601) */
    updatedAt: string;
    /** Conversation metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Optional per-message observability metadata passed by the AI service
 * when persisting a message that was produced (or consumed) by an LLM
 * call. Lets the conversation store record token usage, latency, and
 * model id alongside each message so analytics surfaces (cost per turn,
 * latency histograms, A/B comparisons) can read a single table.
 *
 * All fields are optional — user-authored messages typically pass none.
 * Conversation services SHOULD persist supplied fields verbatim and
 * SHOULD tolerate missing fields gracefully (older callers, in-flight
 * upgrades).
 */
export interface MessageObservability {
    /** Model id reported by the adapter (e.g. `gpt-4o-mini-2024-07-18`). */
    model?: string;
    /** Tokens consumed by the prompt portion of the call. */
    promptTokens?: number;
    /** Tokens generated in the completion. */
    completionTokens?: number;
    /** prompt + completion. */
    totalTokens?: number;
    /** Wall-clock duration of the LLM call that produced this message. */
    latencyMs?: number;
}

/**
 * IAIConversationService - Manages persistent AI conversations
 *
 * Provides CRUD operations for conversations and their messages.
 */
export interface IAIConversationService {
    /**
     * Create a new conversation
     * @param options - Initial conversation properties
     * @returns The created conversation
     */
    create(options?: {
        title?: string;
        agentId?: string;
        userId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<AIConversation>;

    /**
     * Get a conversation by ID, including its full message history.
     *
     * For paginated or filtered reads of `ai_messages`, use the generic
     * ObjectQL data endpoint directly — that's the canonical query layer.
     *
     * @param conversationId - Conversation identifier
     * @returns The conversation, or null if not found
     */
    get(conversationId: string): Promise<AIConversation | null>;

    /**
     * List conversations with optional filters
     * @param options - Filter and pagination options
     * @returns Array of matching conversations
     */
    list(options?: {
        userId?: string;
        agentId?: string;
        limit?: number;
        cursor?: string;
    }): Promise<AIConversation[]>;

    /**
     * Add a message to a conversation
     * @param conversationId - Target conversation ID
     * @param message - Message to append (Vercel `ModelMessage`)
     * @param extras - Optional per-message observability metadata. When
     *                supplied, the conversation service persists token
     *                usage, latency, and model id alongside the message
     *                so each `ai_messages` row can be analysed without
     *                joining `ai_traces` by timestamp.
     * @returns The updated conversation
     */
    addMessage(
        conversationId: string,
        message: ModelMessage,
        extras?: MessageObservability,
    ): Promise<AIConversation>;

    /**
     * Update mutable conversation fields (title, metadata).
     * @param conversationId - Conversation to update
     * @param patch - Fields to change. Only provided keys are written.
     * @returns The updated conversation
     */
    update(
        conversationId: string,
        patch: { title?: string; metadata?: Record<string, unknown> },
    ): Promise<AIConversation>;

    /**
     * Delete a conversation
     * @param conversationId - Conversation to delete
     */
    delete(conversationId: string): Promise<void>;
}
