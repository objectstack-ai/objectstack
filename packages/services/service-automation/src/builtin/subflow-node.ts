// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, SubflowConfigSchema } from '@objectstack/spec/automation';
import type { SubflowConfigParsed } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';
import { refuseNode } from '../guard-refusal.js';
import { parseNodeConfig } from './parse-config.js';

/** Hard cap on subflow nesting — turns an accidental cycle into a clean error. */
const MAX_SUBFLOW_DEPTH = 16;

/**
 * `subflow` built-in node — invoke another flow as a step (reuse / DRY).
 *
 * Resolves `config.input` (a `{token}` mapping) against the parent's variables,
 * runs `config.flowName` via the engine, and writes the child's output back to
 * the parent — under `${nodeId}.output`, and under `config.outputVariable` as a
 * bare variable when given.
 *
 * **Nested durable pause (linked-runs model).** If the child *suspends* (a
 * nested `approval` / `screen` / `wait`), the child's continuation is already
 * persisted by the engine as its own run; this node then suspends the PARENT
 * run at this node with `correlation: 'subflow:<childRunId>'`, so both rows
 * survive a restart and stay linked. The engine's resume boundary completes
 * the chain in both directions:
 *
 *  - resuming the CHILD directly (approval service / wait timer hold the child
 *    `$runId`) bubbles UP on completion — the engine auto-resumes the parent
 *    with the child's output, mapped exactly like the synchronous path;
 *  - resuming the PARENT (a UI holds the parent run id from the original
 *    `execute()` response) delegates DOWN to the suspended child.
 *
 * The linkage rides on the child's context (`$parentRunId` / `$parentNodeId` /
 * `$parentOutputVariable`), which the engine persists with the child run — no
 * schema change. A depth guard ({@link MAX_SUBFLOW_DEPTH}) turns an accidental
 * recursive cycle into a clean error instead of a stack overflow.
 */
export function registerSubflowNode(engine: AutomationEngine, ctx: PluginContext): void {
  engine.registerNodeExecutor({
    type: 'subflow',
    descriptor: defineActionDescriptor({
      type: 'subflow',
      version: '1.0.0',
      name: 'Subflow',
      description: 'Invoke another flow as a reusable step and capture its output.',
      icon: 'workflow',
      category: 'logic',
      source: 'builtin',
      // A child that suspends (approval/screen/wait) suspends this node too —
      // the parent run pauses here and resumes when the child completes.
      supportsPause: true,
      // `'any'` on this node is not the authority that ends up applying: the
      // #3801 gate follows the `subflow:` correlation down to the CHILD and
      // judges the node the signal actually lands on (#3853), so a parent parked
      // above a pending approval is still refused. Stated rather than inherited
      // so the omission-warning's silence here is a decision, not a gap (#5561).
      resumeAuthority: 'any',
    }),
    async execute(node, variables, context) {
      // #4343 — the contract is parsed before anything runs, the same seam the
      // flat builtins got in #4277: a missing or empty `flowName` refuses this
      // node as a GUARD (wrong metadata; a rerun cannot supply it), with the
      // path named, instead of the hand-written check this replaces.
      //
      // The historical `flow` alias is canonicalized at load by the ADR-0087 D2
      // conversion 'flow-node-subflow-flow-alias' (#4278), so only the
      // canonical key reaches the parse.
      const parsed = parseNodeConfig<SubflowConfigParsed>('subflow', node.id, SubflowConfigSchema, node.config);
      if (!parsed.ok) return parsed.refusal;
      const cfg = parsed.config;
      const flowName = cfg.flowName;

      // Cycle guard: depth rides on the context so it accumulates across nesting.
      const depth = Number((context as { $subflowDepth?: number } | undefined)?.$subflowDepth ?? 0);
      if (depth >= MAX_SUBFLOW_DEPTH) {
        // A graph that recurses past the ceiling is a metadata defect, not a
        // transient condition — the next run nests exactly as deep (#3863).
        return refuseNode(
          `subflow '${flowName}': max nesting depth (${MAX_SUBFLOW_DEPTH}) exceeded — recursive subflow?`,
        );
      }

      // Map inputs (resolve `{var}` against the parent's variables/context).
      const params = interpolate(cfg.input ?? {}, variables, context ?? ({} as AutomationContext)) as Record<string, unknown>;

      const outVar = cfg.outputVariable || undefined;

      // Parent linkage for nested durable pause: should the child suspend, the
      // engine persists these with the child run and uses them to bubble the
      // child's eventual completion back into THIS run (resume at this node).
      // `$runId` is injected by the engine at run start (ADR-0019).
      const parentRunId = variables.get('$runId');
      const childContext = {
        ...(context ?? {}),
        $subflowDepth: depth + 1,
        params,
        ...(parentRunId != null
          ? {
              $parentRunId: String(parentRunId),
              $parentNodeId: node.id,
              ...(outVar ? { $parentOutputVariable: outVar } : {}),
            }
          : {}),
      } as AutomationContext;

      const child = await engine.execute(flowName, childContext);

      if (child.status === 'paused') {
        // Nested durable pause: the child's continuation is persisted under its
        // own run id; suspend the parent here, linked via the correlation key.
        // A nested screen surfaces on the parent's paused result so a UI runner
        // can render it against the parent run id (the engine delegates the
        // parent's resume down to the child).
        if (!child.runId) {
          return { success: false, error: `subflow '${flowName}' paused without a run id — cannot link the runs` };
        }
        return {
          success: true,
          suspend: true,
          correlation: `subflow:${child.runId}`,
          screen: child.screen,
        };
      }
      // #4354 — roll the child's totals up into this node's step. The child's
      // steps live in the CHILD's run log, so without this a parent that
      // delegates its writes to a subflow reports `acted: 0` and reads as a
      // broken sweep. The child keeps its own run row with its own summary;
      // the parent's answers "what did this run cause", subflows included.
      const rolled = child.summary
        ? {
            metrics: {
              selected: child.summary.selected,
              acted: child.summary.acted,
              // An uncountable effect inside the child is uncountable for the
              // parent too — the parent's `acted` cannot be read as complete.
              ...(child.summary.unmeasured ? { unmeasuredEffect: true } : {}),
            },
          }
        : {};

      if (!child.success) {
        // A failed child may still have written rows before it died — carry its
        // counts so the parent's summary does not understate what happened.
        return { success: false, error: `subflow '${flowName}' failed: ${child.error ?? 'unknown error'}`, ...rolled };
      }

      // Bare output variable (like the assignment node, the executor may write
      // directly to the parent variable map).
      if (outVar) variables.set(outVar, child.output ?? null);

      return { success: true, output: { output: child.output ?? null }, ...rolled };
    },
  });

  ctx.logger.info('[Subflow Node] 1 built-in node executor registered');
}
