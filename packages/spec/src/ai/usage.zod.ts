// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';

/**
 * AI Usage Primitives
 *
 * Platform contract for measuring AI consumption.
 *
 * Scope (intentionally minimal):
 * - Token usage per call.
 * - Per-call cost (computed from a model's unit price).
 * - Model unit pricing.
 *
 * NOT in scope (deferred to FinOps / product layer):
 * - Budget definitions, enforcement, alerts.
 * - Cost allocation / chargeback / reports.
 * - Optimization recommendations.
 *
 * Rationale: the platform must record *what was used*; deciding what
 * to do about it (block calls, send alerts, allocate to cost centers)
 * is product policy that varies wildly between tenants.
 */

/**
 * Token usage breakdown for a single AI invocation.
 */
export const TokenUsageSchema = lazySchema(() => z.object({
  promptTokens: z.number().int().nonnegative().describe('Tokens consumed by the prompt'),
  completionTokens: z.number().int().nonnegative().describe('Tokens generated in the completion'),
  totalTokens: z.number().int().nonnegative().describe('Total tokens (prompt + completion)'),
}));

/**
 * Cost record for a single AI invocation.
 *
 * Persisted alongside conversation/trace records so usage can be
 * aggregated by tenant, agent, user, or model. The pricing used to
 * compute `costUsd` lives on the model registry entry
 * ({@link ModelPricingSchema} in `./model-registry.zod`); this record
 * captures the *result* of that computation, not the rates.
 */
export const AIUsageRecordSchema = lazySchema(() => z.object({
  /** Model used. */
  model: z.string(),
  /** Token usage. */
  usage: TokenUsageSchema,
  /** Computed USD cost (promptTokens × promptCostPer1K/1000 + …). */
  costUsd: z.number().nonnegative().describe('Computed cost in USD'),
  /** Wall-clock latency in milliseconds. */
  latencyMs: z.number().nonnegative().optional(),
  /** ISO-8601 timestamp of the call. */
  timestamp: z.string().datetime().optional(),
}));

export type TokenUsage = z.input<typeof TokenUsageSchema>;
export type AIUsageRecord = z.input<typeof AIUsageRecordSchema>;
