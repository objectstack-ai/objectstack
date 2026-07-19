// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';

/** Hard cap on map fan-out — turns a runaway collection into a clean error. */
const MAX_MAP_ITEMS = 10_000;

/**
 * `map` built-in node — **sequential multi-instance** (ADR-0037 Track A2).
 *
 * Runs a per-item **subflow** for each element of a collection, **one item at a
 * time**, and continues once every item's subflow has completed — collecting
 * each result into `config.outputVariable`. Unlike `loop` (whose body region
 * runs synchronously and cannot pause), each item here is a full child run, so
 * the per-item subflow **may durably pause** (an `approval` / `screen` /
 * `wait`). This is the worked "batch approval" shape: *approve each item in
 * turn, then continue.*
 *
 * Mechanism (no token tree — one program counter, ADR-0037):
 *  - The node tracks its progress in flow variables (`${nodeId}.$mapState`).
 *  - For item *k* it invokes `config.flowName` via `engine.execute`, tagging the
 *    child run with `$parentRunId` + `$parentMapNode` so the engine knows to
 *    bubble the child's completion **back into this node** (not past it).
 *  - If the child completes synchronously, the result is recorded and the loop
 *    advances inline. If the child **pauses**, the parent suspends at this node
 *    (`correlation: 'map:<childRunId>'`); when the child later completes, the
 *    engine **re-enters** this node (it reads `$mapItemOutput` / `$mapItemDone`,
 *    records the item, and starts the next).
 *
 * v1 is **sequential and fail-fast**: items run in order; the first item whose
 * subflow fails fails the map. Concurrent fan-out + partial aggregation is a
 * deliberate follow-up (ADR-0037 — needs N:1 aggregation + serialization).
 */
export function registerMapNode(engine: AutomationEngine, ctx: PluginContext): void {
  engine.registerNodeExecutor({
    type: 'map',
    descriptor: defineActionDescriptor({
      type: 'map',
      version: '1.0.0',
      name: 'Map',
      description: 'Run a per-item subflow for each element of a collection, one at a time (each item may pause).',
      icon: 'list-check',
      category: 'logic',
      source: 'builtin',
      // Each item's subflow may pause, so the map suspends and resumes per item.
      supportsPause: true,
      isAsync: true,
      // Structured config form for the flow designer (ADR-0018). Mirrors the
      // objectui hardcoded `map` field group field-for-field, so the online
      // (schema-driven) form matches the offline one (objectui #2670 Phase 3 /
      // #3304). `map` is the one previously-schemaless node whose fields are all
      // scalars / typed references — no `keyValue` map, no virtual columns — so
      // it maps cleanly through `jsonSchemaToFlowFields` with zero regression.
      configSchema: {
        type: 'object',
        properties: {
          // interpolate() single-brace `{items}` template, not bare CEL — same
          // marker + rationale as loop.collection.
          collection: { type: 'string', title: 'Collection', description: 'Expression resolving to the array to process, one item at a time.', xExpression: 'template' },
          flowName: { type: 'string', title: 'Per-item flow', description: 'Subflow run for each item — it may pause (e.g. an approval).', xRef: { kind: 'flow' } },
          iteratorVariable: { type: 'string', title: 'Item variable' },
          itemObject: { type: 'string', title: 'Item object', description: 'When items are records, the object they belong to (exposes each item as the child’s record).', xRef: { kind: 'object' } },
          outputVariable: { type: 'string', title: 'Output variable', description: 'Each item’s subflow output, collected in order.' },
        },
        required: ['collection', 'flowName'],
      },
    }),
    async execute(node, variables, context) {
      const cfg = (node.config ?? {}) as Record<string, unknown>;
      const flowName =
        typeof cfg.flowName === 'string' ? cfg.flowName : typeof cfg.flow === 'string' ? cfg.flow : undefined;
      if (!flowName) {
        return { success: false, error: `map '${node.id}': config.flowName (the per-item subflow) is required` };
      }

      const iteratorVariable =
        typeof cfg.iteratorVariable === 'string' && cfg.iteratorVariable ? cfg.iteratorVariable : 'item';
      const indexVariable =
        typeof cfg.indexVariable === 'string' && cfg.indexVariable ? cfg.indexVariable : undefined;
      const outVar =
        typeof cfg.outputVariable === 'string' && cfg.outputVariable ? cfg.outputVariable : undefined;

      // Resolve the collection (template / bare var / already-an-array).
      const rawCollection = cfg.collection;
      let collection: unknown;
      if (Array.isArray(rawCollection)) {
        collection = rawCollection;
      } else if (typeof rawCollection === 'string') {
        collection = interpolate(rawCollection, variables, context ?? ({} as AutomationContext));
        if (collection == null && variables.has(rawCollection)) collection = variables.get(rawCollection);
      }
      if (!Array.isArray(collection)) {
        return { success: false, error: `map '${node.id}': collection '${String(rawCollection)}' did not resolve to an array` };
      }
      if (collection.length > MAX_MAP_ITEMS) {
        return { success: false, error: `map '${node.id}': collection length ${collection.length} exceeds the ${MAX_MAP_ITEMS} cap` };
      }

      // ── Progress state, carried across re-entries in the variable map. ──
      const stateKey = `${node.id}.$mapState`;
      const state = (variables.get(stateKey) as { started: number; results: unknown[] } | undefined) ?? {
        started: 0,
        results: [],
      };

      // Re-entry: the previously-started item's subflow just completed (the
      // engine bubbled its output here). Record it and clear the handoff vars.
      if (variables.get(`${node.id}.$mapItemDone`) === true) {
        state.results.push(variables.get(`${node.id}.$mapItemOutput`) ?? null);
        variables.delete(`${node.id}.$mapItemDone`);
        variables.delete(`${node.id}.$mapItemOutput`);
      }

      const parentRunId = variables.get('$runId');

      // Drive items in order. Synchronous items advance inline; a pausing item
      // suspends the run and is resumed via re-entry.
      while (state.started < collection.length) {
        const idx = state.started;
        const item = collection[idx];
        variables.set(iteratorVariable, item);
        if (indexVariable) variables.set(indexVariable, idx);

        const rawInput = (cfg.input && typeof cfg.input === 'object' ? cfg.input : {}) as Record<string, unknown>;
        const params = interpolate(rawInput, variables, context ?? ({} as AutomationContext)) as Record<string, unknown>;

        // When the mapped item IS a record (has an id), expose it as the
        // child's `record` + `object` so a per-item `approval` / `update_record`
        // targets that item — the natural "approve each row" shape. Otherwise
        // the item is just data, passed via `params`.
        const itemIsRecord = item != null && typeof item === 'object' && typeof (item as any).id === 'string';
        const itemObject = typeof cfg.itemObject === 'string' ? cfg.itemObject : (context as any)?.object;

        const childContext = {
          ...(context ?? {}),
          params,
          ...(itemIsRecord ? { record: item, object: itemObject } : {}),
          ...(parentRunId != null
            ? { $parentRunId: String(parentRunId), $parentMapNode: node.id }
            : {}),
        } as AutomationContext;

        const child = await engine.execute(flowName, childContext);

        if (child.status === 'paused') {
          if (!child.runId) {
            return { success: false, error: `map '${node.id}': item ${idx} paused without a run id — cannot link the runs` };
          }
          // Mark this item started and suspend; the engine re-enters on bubble.
          state.started = idx + 1;
          variables.set(stateKey, state);
          return { success: true, suspend: true, correlation: `map:${child.runId}` };
        }
        if (!child.success) {
          return { success: false, error: `map '${node.id}': item ${idx} (subflow '${flowName}') failed: ${child.error ?? 'unknown error'}` };
        }
        // Synchronous completion — record and advance.
        state.started = idx + 1;
        state.results.push(child.output ?? null);
      }

      // All items done.
      variables.set(stateKey, state);
      if (outVar) variables.set(outVar, state.results);
      return { success: true, output: { results: state.results, count: state.results.length } };
    },
  });

  ctx.logger.info('[Map Node] 1 built-in node executor registered');
}
