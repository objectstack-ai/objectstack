// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, ParallelConfigSchema } from '@objectstack/spec/automation';
import type { ParallelConfigParsed } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine, StepLogEntry } from '../engine.js';
import { parseNodeConfig } from './parse-config.js';

/**
 * `parallel` built-in node — a **structured parallel block** with an
 * **implicit join** (ADR-0031 §Decision 2).
 *
 * The node declares N branch regions in `config.branches[]`; each branch is a
 * self-contained single-entry/single-exit sub-graph (validated at
 * `registerFlow()`). The executor runs every branch concurrently
 * (`Promise.all`) in the **enclosing variable scope** and continues **once when
 * all branches complete** — the join is implicit at block end, engine
 * synchronized. There is no author-visible split/join gateway to mis-wire or
 * deadlock; the node's ordinary out-edges remain the after-block continuation.
 *
 * Concurrency model: JavaScript is single-threaded, so branches interleave only
 * at `await` points and the shared `variables` map is never torn. Branches
 * SHOULD write distinct variables; on a key collision the last writer to settle
 * wins (same semantics as the engine's existing unconditional-edge fan-out).
 *
 * If any branch fails (a node returns `success: false` or throws), the block
 * fails — surfaced as a node failure so the flow's fault edge / error handling
 * applies. Durable pause inside a branch is unsupported (a clear error), mirror-
 * ing the loop container.
 */
export function registerParallelNode(engine: AutomationEngine, ctx: PluginContext): void {
  engine.registerNodeExecutor({
    type: 'parallel',
    descriptor: defineActionDescriptor({
      type: 'parallel',
      version: '1.0.0',
      name: 'Parallel',
      description: 'Run N branch regions concurrently and join implicitly when all complete.',
      icon: 'git-fork',
      category: 'logic',
      source: 'builtin',
      configSchema: {
        type: 'object',
        properties: {
          branches: {
            type: 'array',
            minItems: 2,
            description: 'Branch regions executed concurrently; implicit join at block end',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                nodes: { type: 'array' },
                edges: { type: 'array' },
              },
            },
          },
        },
        required: ['branches'],
      },
    }),
    async execute(node, variables, context) {
      // The contract owns the shape guard: `branches` is required, each branch
      // a region, and `.min(2)` refuses the degenerate single-branch block the
      // hand-written check here used to catch.
      const parsed = parseNodeConfig<ParallelConfigParsed>('parallel', node.id, ParallelConfigSchema, node.config);
      if (!parsed.ok) return parsed.refusal;
      const branches = parsed.config.branches;

      let branchSteps: StepLogEntry[][];
      try {
        // Implicit join: continue once when ALL branches have completed.
        // #1479: each branch returns its body steps, tagged with the branch index.
        branchSteps = await Promise.all(
          branches.map((branch, i) =>
            engine.runRegion(branch, variables, context ?? ({} as AutomationContext), {
              parentNodeId: node.id,
              iteration: i,
              regionKind: 'parallel-branch',
            }),
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: `parallel '${node.id}': branch failed — ${message}` };
      }

      return { success: true, output: { branches: branches.length }, childSteps: branchSteps.flat() };
    },
  });

  ctx.logger.info('[Parallel Node] 1 built-in node executor registered');
}
