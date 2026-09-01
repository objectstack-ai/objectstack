// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, LOOP_MAX_ITERATIONS_CEILING, LoopConfigSchema } from '@objectstack/spec/automation';
import type { LoopConfigParsed } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine, StepLogEntry } from '../engine.js';
import { interpolate } from './template.js';
import { parseNodeConfig } from './parse-config.js';
import { attachPartialSteps } from '../partial-steps.js';

/**
 * `loop` built-in node — a **structured iteration container** (ADR-0031).
 *
 * Replaces the previous no-op `loop` stub. The node owns a bounded **body
 * region** (`config.body`, a single-entry/single-exit sub-graph) and drives
 * iteration over a collection: for each item it binds the current value to
 * `config.iteratorVariable` (and the zero-based index to `config.indexVariable`,
 * when given) in the **enclosing variable scope** and runs the body region. A
 * **hard max-iteration guard** (`config.maxIterations`, clamped to
 * {@link LOOP_MAX_ITERATIONS_CEILING}) keeps termination analyzable.
 *
 * The body region runs as a unit via {@link AutomationEngine.runRegion}; the
 * loop node's *ordinary* out-edges in the main graph remain the "after-loop"
 * continuation, so the DAG invariant for ordinary edges is preserved.
 *
 * **Back-compat:** a `loop` node with no `config.body` keeps the legacy
 * flat-graph behavior (sets `$loopItems`/`$loopIndex` and falls through) — the
 * container construct is additive.
 */
export function registerLoopNode(engine: AutomationEngine, ctx: PluginContext): void {
  engine.registerNodeExecutor({
    type: 'loop',
    descriptor: defineActionDescriptor({
      type: 'loop',
      version: '2.0.0',
      name: 'Loop',
      description: 'Iterate a body region over a collection (bounded, structured container).',
      icon: 'repeat',
      category: 'logic',
      source: 'builtin',
      configSchema: {
        type: 'object',
        properties: {
          // `xExpression: 'template'` tells the designer this string is an
          // `interpolate()` single-brace `{var}` template (e.g. `{tasks}`), not
          // bare CEL — so the flow-designer renders the mono expression editor
          // with a `{var}` data-picker and does NOT run the CEL brace-trap on it
          // (objectui #2670 Phase 3; the contract mirrors `xRef`/`xEnumDeprecated`).
          collection: { type: 'string', description: 'Template/variable resolving to the array to iterate', xExpression: 'template' },
          iteratorVariable: { type: 'string', description: 'Loop variable holding the current item' },
          indexVariable: { type: 'string', description: 'Optional loop variable holding the current index' },
          maxIterations: { type: 'integer', minimum: 1, maximum: LOOP_MAX_ITERATIONS_CEILING },
          body: {
            type: 'object',
            description: 'Loop body region (single-entry/single-exit sub-graph)',
            properties: { nodes: { type: 'array' }, edges: { type: 'array' } },
          },
        },
        required: ['collection'],
      },
    }),
    async execute(node, variables, context) {
      const raw = (node.config ?? {}) as Record<string, unknown>;

      // ── Legacy flat-graph loop (no body) — preserve prior stub behavior. ──
      // Deliberately NOT parsed: this shape predates the ADR-0031 construct the
      // contract describes (`collection` is required there, but a legacy marker
      // loop legally carries none), and the constructs are additive — the
      // contract governs only the structured form it defines (#4277).
      if (raw.body == null) {
        const collectionName = typeof raw.collection === 'string' ? raw.collection : undefined;
        if (collectionName) {
          const legacy = variables.get(collectionName);
          if (Array.isArray(legacy)) {
            variables.set('$loopItems', legacy);
            variables.set('$loopIndex', 0);
          }
        }
        return { success: true };
      }

      // ── Structured loop container. ──
      const parsed = parseNodeConfig<LoopConfigParsed>('loop', node.id, LoopConfigSchema, raw);
      if (!parsed.ok) return parsed.refusal;
      const cfg = parsed.config;
      const body = cfg.body!;
      const iteratorVariable = cfg.iteratorVariable;
      const indexVariable = cfg.indexVariable || undefined;

      // Resolve the collection: a `{token}` template, a bare variable name, or
      // an inline array (the contract is the union, same as `map`).
      const rawCollection = cfg.collection;
      let collection: unknown;
      if (Array.isArray(rawCollection)) {
        collection = rawCollection;
      } else {
        collection = interpolate(rawCollection, variables, context ?? ({} as AutomationContext));
        if ((collection == null) && variables.has(rawCollection)) {
          collection = variables.get(rawCollection);
        }
      }

      if (!Array.isArray(collection)) {
        return {
          success: false,
          error: `loop '${node.id}': collection '${String(rawCollection)}' did not resolve to an array`,
        };
      }

      // Hard iteration guard.
      const requested = cfg.maxIterations ?? LOOP_MAX_ITERATIONS_CEILING;
      const maxIterations = Math.min(requested, LOOP_MAX_ITERATIONS_CEILING);
      if (collection.length > maxIterations) {
        return {
          success: false,
          error:
            `loop '${node.id}': collection length ${collection.length} exceeds maxIterations ${maxIterations}`,
        };
      }

      let iterations = 0;
      const childSteps: StepLogEntry[] = [];
      try {
        for (let i = 0; i < collection.length; i++) {
          variables.set(iteratorVariable, collection[i]);
          if (indexVariable) variables.set(indexVariable, i);
          // Body runs in the shared scope; iterator var + mutations are visible.
          // #1479: collect each iteration's body steps, tagged with the index.
          // #13803: `childSteps` doubles as the #7546 `partialSteps` sink, so a
          // FAILING iteration's steps land here too — `runRegion` tags them and
          // pushes them in before it rethrows. Success returns them instead, so
          // nothing is counted twice.
          const iterSteps = await engine.runRegion(
            body,
            variables,
            context ?? ({} as AutomationContext),
            {
              parentNodeId: node.id,
              iteration: i,
              regionKind: 'loop-body',
            },
            childSteps,
          );
          childSteps.push(...iterSteps);
          iterations++;
        }
      } catch (err) {
        // #13803 — the sweep is dying, but the iterations that already
        // completed really did write. Hand their steps to the engine's catch
        // path so the run log keeps the record and the summary's `acted`
        // counts the writes that happened. The error itself is rethrown
        // UNCHANGED: same identity, same message, same guard-refusal marking,
        // so failure propagation is byte-for-byte what it was.
        if (err !== null && typeof err === 'object') attachPartialSteps(err, childSteps);
        throw err;
      }

      return { success: true, output: { iterations }, childSteps };
    },
  });

  ctx.logger.info('[Loop Node] 1 built-in node executor registered');
}
