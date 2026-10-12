// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor, LOOP_MAX_ITERATIONS_CEILING, LoopConfigSchema } from '@objectstack/spec/automation';
import type { LoopConfigParsed } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine, StepLogEntry } from '../engine.js';
import { parseNodeConfig } from './parse-config.js';
import { collectionNotAList, resolveCollectionSlot } from './value-slot-map.js';
import { attachPartialSteps } from '../partial-steps.js';
import { runInLoopIteration } from './loop-frame.js';

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
          // [#19939] A `value` slot whose literal is a list: the
          // `xExpression: 'value'` marker declares it to the expression ledger
          // (it was `'template'`, the single-brace `{var}` slot), and its
          // contract (`LoopConfigSchema.collection`, `FlowCollectionSlotSchema`)
          // carries none, so one channel declares it. Untyped, like a screen
          // field's `defaultValue`: the value is an envelope object or a list,
          // and a string is refused.
          collection: { description: 'The list to iterate: a CEL value envelope evaluated to a list in the run\'s scope (e.g. { dialect: \'cel\', source: \'tasks\' }), or an inline array of the items.', xExpression: 'value' },
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

      // [#19939] The collection is a `value` slot whose literal is a list (the
      // contract `map` shares): a CEL value envelope evaluated in the run's
      // scope, or an inline array, iterated as written. The parse above has
      // refused a string — a `{token}` of the retired dialect, and a bare
      // variable name, which this branch never read: the interpolator handed
      // the name back unchanged and every run failed here.
      const collection = resolveCollectionSlot(engine, cfg.collection, variables, context ?? ({} as AutomationContext));
      if (!Array.isArray(collection)) {
        return { success: false, error: `loop '${node.id}': ${collectionNotAList(cfg.collection, collection)}` };
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
          // #14456: publish the row identity for the duration of this
          // iteration's body, so a `try_catch` nested in it can attribute a
          // CONTAINED failure to the row that produced it — `$error.iteration`
          // / `$error.item`, and the loop's `iteration` on the try/catch
          // region's own steps. Nothing about the iteration itself changes:
          // `runInLoopIteration` returns and throws exactly what the body does.
          const iterSteps = await runInLoopIteration(
            { iteration: i, item: collection[i], scope: variables },
            () => engine.runRegion(
              body,
              variables,
              context ?? ({} as AutomationContext),
              {
                parentNodeId: node.id,
                iteration: i,
                regionKind: 'loop-body',
              },
              childSteps,
            ),
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
