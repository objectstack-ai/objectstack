// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, ParallelConfigSchema } from '@objectstack/spec/automation';
import type { ParallelConfigParsed } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine, StepLogEntry } from '../engine.js';
import { parseNodeConfig } from './parse-config.js';
import { isRegionSuspensionRefusal } from '../region-suspension-refusal.js';
import { attachPartialSteps } from '../partial-steps.js';

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
 * applies. The failure is reported once every branch has settled, and it
 * carries every branch's steps: the siblings that completed, and the failing
 * branch's own steps up to and including the one that failed. Durable pause
 * inside a branch is unsupported (a clear error), mirroring the loop container.
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

      // A failing block keeps the record of what its branches did. A branch
      // that completed may already have delivered a notification or called
      // out, and a run log without its step makes the #4354 summary report
      // `acted: 0` for that run — which reads as "nothing happened, safe to
      // re-run", the double-execution misread a dying `loop` was fixed for
      // (`partial-steps.ts`).
      //
      // One #7546 `partialSteps` sink PER BRANCH: `runRegion` pushes a failing
      // branch's tagged steps (its failing step included) into that branch's
      // sink before it rethrows, and a completed branch returns them instead,
      // so each step is collected exactly once and the log keeps declaration
      // order, as on the success path.
      //
      // The block waits for EVERY branch to settle before it reports a
      // failure: a sibling still running when another branch fails would
      // otherwise finish its effect after the block had already failed, with
      // no step on the record. `rejections` keeps the settle order, so the
      // failure the block reports is the one `Promise.all` rejected with.
      const sinks: StepLogEntry[][] = branches.map(() => []);
      const rejections: { err: unknown }[] = [];
      // Implicit join: continue once when ALL branches have completed.
      // #1479: each branch returns its body steps, tagged with the branch index.
      //
      // #15230: the branch index goes on `branch`, NOT on `iteration`. It
      // used to share `iteration` with the loop's row index — one field, two
      // meanings, told apart only by reading `regionKind` first — and because
      // the tagger let the innermost region win outright, a branch step
      // inside a loop body recorded the branch and lost the row entirely.
      // `iteration` is now single-valued (the enclosing loop's, carried
      // through nesting by `runRegion`'s tagger), so nothing here writes it:
      // a branch step inside a loop body gets the row from the loop's own
      // tagging pass, and a bare `parallel` leaves it absent because there is
      // no enclosing loop to report. Maintainer ruling 2026-09-03.
      const branchSteps = await Promise.all(
        branches.map(async (branchRegion, i) => {
          try {
            return await engine.runRegion(
              branchRegion,
              variables,
              context ?? ({} as AutomationContext),
              { parentNodeId: node.id, branch: i, regionKind: 'parallel-branch' },
              sinks[i],
            );
          } catch (err) {
            rejections.push({ err });
            return sinks[i];
          }
        }),
      );
      const childSteps = branchSteps.flat();

      const first = rejections[0];
      if (first) {
        const { err } = first;
        // [#18881] A durable pause raised inside a BRANCH is refused at the
        // region boundary and must reach the run, ⛔ not be folded into this
        // node's returned failure. A returned failure is routable by a `fault`
        // edge on the `parallel` node, and routing this one would re-open the
        // silence the card closes: the run would continue past a region that
        // parked nothing and report success. Re-thrown, so the engine's own
        // catch path records it once and fails the run — carrying the branch
        // steps on the error the way a dying `loop` does, which leaves the
        // error itself (identity, message, refusal marking) untouched.
        if (isRegionSuspensionRefusal(err)) throw attachPartialSteps(err, childSteps);
        const message = err instanceof Error ? err.message : String(err);
        // Returned, not thrown, exactly as before: the block's failure stays
        // routable by a `fault` edge on the `parallel`, with the same step
        // code, error text and `$error`. The engine folds a returned failure's
        // `childSteps` into the run log right behind the block's own step.
        return { success: false, error: `parallel '${node.id}': branch failed — ${message}`, childSteps };
      }

      return { success: true, output: { branches: branches.length }, childSteps };
    },
  });

  ctx.logger.info('[Parallel Node] 1 built-in node executor registered');
}
