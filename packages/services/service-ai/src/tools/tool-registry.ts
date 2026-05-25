// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  AIToolDefinition,
  ToolCallPart,
  ToolResultPart,
  ToolExecutionContext,
} from '@objectstack/spec/contracts';

/**
 * Re-exported {@link ToolExecutionContext} from `@objectstack/spec` so
 * tool implementations in this package can import a single canonical
 * symbol without depending on spec internals.
 *
 * The spec hosts the authoritative shape because `ChatWithToolsOptions`
 * exposes the same type to external callers (HTTP routes, custom
 * agents).
 */
export type { ToolExecutionContext };

/**
 * Handler function for a registered tool.
 *
 * Receives parsed arguments and an optional per-call execution context.
 * Returns the tool output as a string (typically JSON). Tools that
 * require permission enforcement should use `ctx.actor` and propagate
 * it into the underlying engine call.
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx?: ToolExecutionContext,
) => Promise<string> | string;

/**
 * Extended ToolResultPart that carries an `isError` flag for internal
 * error-tracking in the tool-call loop.
 */
export interface ToolExecutionResult extends ToolResultPart {
  isError?: boolean;
}

/**
 * ToolRegistry — Central registry for AI-callable tools.
 *
 * Plugins register tools (metadata helpers, data queries, business actions)
 * during the `ai:ready` hook.  The AI service resolves tool calls against
 * this registry and feeds the results back to the LLM.
 */
export class ToolRegistry {
  private readonly definitions = new Map<string, AIToolDefinition>();
  private readonly handlers = new Map<string, ToolHandler>();

  /**
   * Register a tool with its definition and handler.
   * @param definition - Tool definition (name, description, parameters schema)
   * @param handler    - Async function that executes the tool
   */
  register(definition: AIToolDefinition, handler: ToolHandler): void {
    this.definitions.set(definition.name, definition);
    this.handlers.set(definition.name, handler);
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): void {
    this.definitions.delete(name);
    this.handlers.delete(name);
  }

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.definitions.has(name);
  }

  /**
   * Get the definition for a registered tool.
   */
  getDefinition(name: string): AIToolDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * Return all registered tool definitions.
   */
  getAll(): AIToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Number of registered tools. */
  get size(): number {
    return this.definitions.size;
  }

  /** All registered tool names. */
  names(): string[] {
    return Array.from(this.definitions.keys());
  }

  /**
   * Execute a tool call and return the result.
   *
   * @param toolCall The decoded tool-call part from the model response.
   * @param ctx      Optional per-call execution context (actor, conversation,
   *                 environment). Handlers may use this to enforce RLS,
   *                 attribute audit entries, or correlate traces. When
   *                 omitted, handlers should fall back to system-level
   *                 behaviour for backward compatibility.
   */
  async execute(
    toolCall: ToolCallPart,
    ctx?: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const handler = this.handlers.get(toolCall.toolName);
    if (!handler) {
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: `Tool "${toolCall.toolName}" is not registered` },
        isError: true,
      };
    }

    try {
      const args = typeof toolCall.input === 'string'
        ? JSON.parse(toolCall.input)
        : (toolCall.input as Record<string, unknown>) ?? {};
      const content = await handler(args, ctx);
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: content },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        type: 'tool-result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: 'text', value: message },
        isError: true,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel, threading the same
   * execution context to each handler.
   */
  async executeAll(
    toolCalls: ToolCallPart[],
    ctx?: ToolExecutionContext,
  ): Promise<ToolExecutionResult[]> {
    return Promise.all(toolCalls.map(tc => this.execute(tc, ctx)));
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.definitions.clear();
    this.handlers.clear();
  }
}
