// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { randomUUID } from 'node:crypto';
import type { IDataEngine, Logger } from '@objectstack/spec/contracts';
import type { ModelRegistry, CostEstimate } from './model-registry.js';

/** Object name used for persistence. */
const TRACE_OBJECT = 'ai_traces';

/**
 * The operation that produced a trace.
 */
export type TraceOperation =
  | 'chat'
  | 'complete'
  | 'stream_chat'
  | 'chat_with_tools'
  | 'generate_object'
  | 'embed';

/**
 * Data captured for every LLM invocation.
 *
 * Token counts default to 0 when the adapter does not report usage.
 * Cost fields are populated only when a {@link ModelRegistry} can resolve
 * pricing for the reported model.
 */
export interface TraceEvent {
  operation: TraceOperation;
  adapter: string;
  model?: string;
  agentId?: string;
  conversationId?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: 'success' | 'error';
  error?: string;
  cost?: CostEstimate;
  metadata?: Record<string, unknown>;
}

/**
 * TraceRecorder — Records {@link TraceEvent}s.
 *
 * Implementations are expected to be non-throwing — a tracing failure must
 * never crash an AI call. The default {@link ObjectQLTraceRecorder} swallows
 * errors and logs at `warn`.
 */
export interface TraceRecorder {
  record(event: TraceEvent): Promise<void> | void;
}

/** Discard all traces. Default when no data engine is wired. */
export class NullTraceRecorder implements TraceRecorder {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  record(_event: TraceEvent): void {
    // intentional no-op
  }
}

/**
 * ObjectQLTraceRecorder — Persists traces via {@link IDataEngine}.
 *
 * Writes one row per call to the `ai_traces` object. Failures are logged
 * but never propagated.
 *
 * @example
 * ```ts
 * const recorder = new ObjectQLTraceRecorder(dataEngine, { logger });
 * ```
 */
export class ObjectQLTraceRecorder implements TraceRecorder {
  private readonly engine: IDataEngine;
  private readonly logger?: Logger;

  constructor(engine: IDataEngine, options: { logger?: Logger } = {}) {
    this.engine = engine;
    this.logger = options.logger;
  }

  async record(event: TraceEvent): Promise<void> {
    const row = {
      id: `trace_${randomUUID()}`,
      conversation_id: event.conversationId ?? null,
      agent_id: event.agentId ?? null,
      operation: event.operation,
      model: event.model ?? null,
      adapter: event.adapter,
      prompt_tokens: event.promptTokens,
      completion_tokens: event.completionTokens,
      total_tokens: event.totalTokens,
      input_cost: event.cost?.inputCost ?? null,
      output_cost: event.cost?.outputCost ?? null,
      total_cost: event.cost?.totalCost ?? null,
      currency: event.cost?.currency ?? null,
      latency_ms: event.latencyMs,
      status: event.status,
      error: event.error ?? null,
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      created_at: new Date().toISOString(),
    };

    try {
      await this.engine.insert(TRACE_OBJECT, row);
    } catch (err) {
      this.logger?.warn('[AI] Failed to record trace (non-fatal)',
        err instanceof Error ? { error: err.message } : { error: String(err) });
    }
  }
}

/**
 * Helper: build a {@link TraceEvent} from a measured call.
 *
 * Resolves cost via the optional {@link ModelRegistry} when the model is
 * reported and pricing is available.
 */
export function buildTraceEvent(input: {
  operation: TraceOperation;
  adapter: string;
  model?: string;
  agentId?: string;
  conversationId?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
  status: 'success' | 'error';
  error?: string;
  registry?: ModelRegistry;
  metadata?: Record<string, unknown>;
}): TraceEvent {
  const usage = input.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const cost = input.model && input.registry
    ? input.registry.estimateCost(input.model, usage)
    : undefined;
  return {
    operation: input.operation,
    adapter: input.adapter,
    model: input.model,
    agentId: input.agentId,
    conversationId: input.conversationId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    latencyMs: input.latencyMs,
    status: input.status,
    error: input.error,
    cost,
    metadata: input.metadata,
  };
}
