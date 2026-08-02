// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, TryCatchConfigSchema } from '@objectstack/spec/automation';
import type { TryCatchConfigParsed } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';
import { parseNodeConfig } from './parse-config.js';

/**
 * `try_catch` built-in node — **structured try/catch/retry** (ADR-0031 §Decision 3).
 *
 * Runs the protected `try` region; if it throws (a node fails), an optional
 * `retry` policy re-runs the `try` region with exponential backoff. If the
 * region still fails after retries, the optional `catch` region runs with the
 * caught error bound to `errorVariable` (default `$error`). Both regions are
 * self-contained single-entry/single-exit sub-graphs validated at
 * `registerFlow()`, executed in the **enclosing variable scope** via
 * {@link AutomationEngine.runRegion}.
 *
 * Outcome:
 *  - `try` (or a retry) succeeds → the node succeeds, downstream continues.
 *  - `try` exhausts retries, a `catch` is present and succeeds → the node
 *    succeeds (the error was handled).
 *  - `try` exhausts retries and there is **no** `catch` (or `catch` itself
 *    fails) → the node fails, surfacing to the flow's fault edge / error handling.
 *
 * This is the low-code-native error model — the same `fault` + exponential-
 * backoff retry the engine already implements, surfaced as a construct rather
 * than BPMN boundary events.
 */
export function registerTryCatchNode(engine: AutomationEngine, ctx: PluginContext): void {
  engine.registerNodeExecutor({
    type: 'try_catch',
    descriptor: defineActionDescriptor({
      type: 'try_catch',
      version: '1.0.0',
      name: 'Try / Catch',
      description: 'Run a protected region with optional retry and a catch handler (structured error handling).',
      icon: 'shield-alert',
      category: 'logic',
      source: 'builtin',
      supportsRetry: true,
      configSchema: {
        type: 'object',
        properties: {
          try: {
            type: 'object',
            description: 'Protected region (single-entry/single-exit sub-graph)',
            properties: { nodes: { type: 'array' }, edges: { type: 'array' } },
          },
          catch: {
            type: 'object',
            description: 'Handler region run when the try region fails',
            properties: { nodes: { type: 'array' }, edges: { type: 'array' } },
          },
          errorVariable: { type: 'string', description: 'Variable holding the caught error in the catch region' },
          retry: {
            type: 'object',
            properties: {
              maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
              // `backoffMs` (was `retryDelayMs`) since spec 17.0.0 — one retry
              // policy spelling across job.retryPolicy and try_catch (#4661).
              backoffMs: { type: 'integer', minimum: 0 },
              backoffMultiplier: { type: 'number', minimum: 1 },
              maxRetryDelayMs: { type: 'integer', minimum: 0 },
              jitter: { type: 'boolean' },
            },
          },
        },
        required: ['try'],
      },
    }),
    async execute(node, variables, context) {
      // Parse against the ADR-0031 contract. Note the retry defaults now come
      // from the CONTRACT (RetryPolicySchema): a declared `retry` block that
      // omits `backoffMs` gets the documented 1000ms base delay, where this
      // executor historically filled in 0 — the declared default is the
      // enforced one (#4277). Since spec 17.0.0 that contract is one shared
      // declaration with `job.retryPolicy`, and the base delay is spelled
      // `backoffMs` (was `retryDelayMs`, tombstoned + converted — #4661).
      const parsed = parseNodeConfig<TryCatchConfigParsed>('try_catch', node.id, TryCatchConfigSchema, node.config);
      if (!parsed.ok) return parsed.refusal;
      const cfg = parsed.config;
      const tryRegion = cfg.try;
      const catchRegion = cfg.catch;
      const errorVariable = cfg.errorVariable || '$error';
      const retry = cfg.retry;

      const ctxOrEmpty = context ?? ({} as AutomationContext);
      const maxRetries = retry?.maxRetries ?? 0;
      const baseDelay = retry?.backoffMs ?? 0;
      const multiplier = retry?.backoffMultiplier ?? 1;
      const maxDelay = retry?.maxRetryDelayMs ?? 30000;
      const useJitter = retry?.jitter === true;

      // Run the try region, retrying with exponential backoff up to maxRetries.
      let lastError = 'unknown error';
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          let delay = Math.min(baseDelay * Math.pow(multiplier, attempt - 1), maxDelay);
          if (useJitter) delay = delay * (0.5 + Math.random() * 0.5);
          if (delay > 0) await new Promise(r => setTimeout(r, delay));
        }
        try {
          // #1479: surface the successful try region's steps.
          const trySteps = await engine.runRegion(tryRegion, variables, ctxOrEmpty, {
            parentNodeId: node.id,
            regionKind: 'try',
          });
          return { success: true, output: { attempts: attempt + 1, caught: false }, childSteps: trySteps };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      // The try region (and any retries) failed. Run the catch handler if present.
      if (catchRegion != null) {
        variables.set(errorVariable, { nodeId: node.id, message: lastError });
        try {
          // #1479: surface the catch handler region's steps.
          const catchSteps = await engine.runRegion(catchRegion, variables, ctxOrEmpty, {
            parentNodeId: node.id,
            regionKind: 'catch',
          });
          return {
            success: true,
            output: { attempts: maxRetries + 1, caught: true, error: lastError },
            childSteps: catchSteps,
          };
        } catch (catchErr) {
          const catchMsg = catchErr instanceof Error ? catchErr.message : String(catchErr);
          return { success: false, error: `try_catch '${node.id}': catch region failed — ${catchMsg}` };
        }
      }

      // No catch handler — surface the failure to the flow's fault edge / error handling.
      return { success: false, error: `try_catch '${node.id}': try region failed — ${lastError}` };
    },
  });

  ctx.logger.info('[TryCatch Node] 1 built-in node executor registered');
}
