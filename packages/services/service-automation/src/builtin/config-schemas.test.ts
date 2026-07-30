// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Designer-parity configSchemas (#3304 — descriptor counterpart to objectui
 * #2670 Phase 3). The keyValue-capable nodes now publish a `configSchema` that
 * mirrors objectui's hardcoded field group, so the online (schema-driven) form
 * matches the offline one. The load-bearing shape is the free-form map —
 * `type: 'object'` + `additionalProperties: true` and NO fixed `properties` —
 * which the designer renders with its flat keyValue editor; `true`-permissive
 * because real metadata carries operator objects (`{"$ne": null}`), `{var}`
 * templates, and non-string literals as values.
 *
 * Deliberately schemaless (stay on the hardcoded designer form; a node with no
 * configSchema has NO online/offline divergence): `decision` (virtual Target
 * column derived from edges), `wait` (top-level `waitEventConfig` block),
 * `script` (actionType-conditional form) and `subflow` (top-level `timeoutMs`)
 * — a partial schema would drop those editors.
 */

import { describe, it, expect } from 'vitest';
import { LOOP_MAX_ITERATIONS_CEILING } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerCrudNodes } from './crud-nodes.js';
import { registerLogicNodes } from './logic-nodes.js';
import { registerScreenNodes } from './screen-nodes.js';
import { registerLoopNode } from './loop-node.js';
import { registerParallelNode } from './parallel-node.js';
import { registerTryCatchNode } from './try-catch-node.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

interface SchemaProp {
  type?: string;
  format?: string;
  properties?: Record<string, SchemaProp>;
  additionalProperties?: unknown;
  items?: SchemaProp;
  enum?: unknown[];
  xRef?: { kind?: string };
  xExpression?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minLength?: number;
  default?: unknown;
}

function schemaOf(engine: AutomationEngine, type: string) {
  const schema = engine.getActionDescriptor(type)?.configSchema as
    | { properties?: Record<string, SchemaProp>; required?: string[] }
    | undefined;
  expect(schema, `${type} should publish a configSchema`).toBeDefined();
  return schema!;
}

/** The keyValue contract: an open map with a value schema and no fixed props. */
function expectKeyValueMap(prop: SchemaProp | undefined, label: string) {
  expect(prop, label).toBeDefined();
  expect(prop!.type).toBe('object');
  expect(prop!.additionalProperties).toBe(true);
  expect(prop!.properties).toBeUndefined();
}

describe('builtin node configSchemas — designer parity (#3304)', () => {
  const engine = new AutomationEngine(silentLogger());
  registerCrudNodes(engine, ctx());
  registerLogicNodes(engine, ctx());
  registerScreenNodes(engine, ctx());

  it('CRUD quartet: object reference + keyValue maps, objectName required', () => {
    const get = schemaOf(engine, 'get_record');
    expect(get.properties?.objectName?.xRef?.kind).toBe('object');
    expectKeyValueMap(get.properties?.filter, 'get_record.filter');
    expect(get.properties?.limit?.type).toBe('integer');
    expect(get.required).toEqual(['objectName']);

    const create = schemaOf(engine, 'create_record');
    expect(create.properties?.objectName?.xRef?.kind).toBe('object');
    expectKeyValueMap(create.properties?.fields, 'create_record.fields');

    const update = schemaOf(engine, 'update_record');
    expectKeyValueMap(update.properties?.filter, 'update_record.filter');
    expectKeyValueMap(update.properties?.fields, 'update_record.fields');

    const del = schemaOf(engine, 'delete_record');
    expectKeyValueMap(del.properties?.filter, 'delete_record.filter');
  });

  it('assignment: a single free-form assignments map, nothing required', () => {
    const schema = schemaOf(engine, 'assignment');
    expectKeyValueMap(schema.properties?.assignments, 'assignment.assignments');
    expect(schema.required).toBeUndefined();
  });

  it('screen: field list with a CEL visibleWhen column, object-form refs, defaults map', () => {
    const schema = schemaOf(engine, 'screen');
    // The repeater's visibleWhen column is bare CEL → expression column.
    expect(schema.properties?.fields?.items?.properties?.visibleWhen?.xExpression).toBe('expression');
    expect(schema.properties?.fields?.items?.properties?.required?.type).toBe('boolean');
    expect(schema.properties?.objectName?.xRef?.kind).toBe('object');
    expect(schema.properties?.mode?.enum).toEqual(['create', 'edit']);
    expect(schema.properties?.description?.format).toBe('multiline');
    expectKeyValueMap(schema.properties?.defaults, 'screen.defaults');
  });

  /**
   * The control-flow trio had NO descriptor assertions at all — the designer's
   * input for `loop` / `parallel` / `try_catch` was unguarded, so a change to
   * these literals could not be noticed (#4045 step A).
   *
   * What these pin is deliberately more than "the current bytes": each of these
   * three publishes a form description that is **intentionally shallower and
   * looser than its Zod counterpart** in `control-flow.zod.ts`. That difference
   * is the point, and it is what a naive "one Zod source, generate the
   * configSchema from it" refactor would erase:
   *
   *  - **Region keys are opaque.** `loop.body`, `parallel.branches[].nodes/edges`
   *    and `try_catch.try/catch` publish `{ type: 'array' }` with **no `items`**.
   *    The Zod is `FlowRegionSchema` — `z.array(FlowNodeSchema)` — so generating
   *    would emit the entire FlowNode/FlowEdge definition nested here, and the
   *    designer would try to render a property form for a sub-graph that is
   *    edited on the CANVAS.
   *  - **Zod-only constraints stay out of the form.** `collection` is
   *    `z.string().min(1)` and `iteratorVariable` is `.default('item')`, yet the
   *    form publishes neither `minLength` nor `default`.
   *
   * So these are not redundant copies pending de-duplication; they are a
   * different artifact with a different job (drive a form vs. validate a value),
   * and the assertions below are what make that intent enforced rather than
   * merely true. Any move toward a generated configSchema has to keep them green
   * or state explicitly why the designer contract changed.
   */
  describe('control-flow trio: the form is deliberately shallower than the Zod', () => {
    const engine2 = new AutomationEngine(silentLogger());
    registerLoopNode(engine2, ctx());
    registerParallelNode(engine2, ctx());
    registerTryCatchNode(engine2, ctx());

    /** A region body publishes an opaque array — no `items` to recurse into. */
    function expectOpaqueRegion(region: SchemaProp | undefined, label: string) {
      expect(region, label).toBeDefined();
      expect(region!.type, `${label}.type`).toBe('object');
      for (const key of ['nodes', 'edges'] as const) {
        const arr = region!.properties?.[key];
        expect(arr, `${label}.${key}`).toBeDefined();
        expect(arr!.type, `${label}.${key}.type`).toBe('array');
        // The load-bearing absence: no element schema, so the designer treats the
        // sub-graph as opaque instead of forms-for-every-node.
        expect(arr!.items, `${label}.${key} must stay opaque (no items)`).toBeUndefined();
      }
    }

    it('loop: template collection, bounded iterations, opaque body', () => {
      const schema = schemaOf(engine2, 'loop');
      expect(schema.properties?.collection?.xExpression).toBe('template');
      expect(schema.properties?.maxIterations?.type).toBe('integer');
      expect(schema.properties?.maxIterations?.minimum).toBe(1);
      expect(schema.properties?.maxIterations?.maximum).toBe(LOOP_MAX_ITERATIONS_CEILING);
      expectOpaqueRegion(schema.properties?.body, 'loop.body');
    });

    it('loop: the form does NOT carry the Zod-only string constraints', () => {
      // `LoopConfigSchema.collection` is `z.string().min(1)` and
      // `iteratorVariable` is `.default('item')`. Generating the form from that
      // Zod would publish `minLength: 1` / `default: 'item'`, which this form has
      // never advertised. Pinned so such a change is a decision, not a side effect.
      const schema = schemaOf(engine2, 'loop');
      expect(schema.properties?.collection?.minLength).toBeUndefined();
      expect(schema.properties?.iteratorVariable?.minLength).toBeUndefined();
      expect(schema.properties?.iteratorVariable?.default).toBeUndefined();
    });

    it('parallel: at least two branches, each an opaque region', () => {
      const schema = schemaOf(engine2, 'parallel');
      expect(schema.properties?.branches?.type).toBe('array');
      expect(schema.properties?.branches?.minItems).toBe(2);
      expect(schema.properties?.branches?.items?.properties?.name?.type).toBe('string');
      expectOpaqueRegion(schema.properties?.branches?.items, 'parallel.branches[]');
    });

    it('try_catch: both regions opaque, bounded retry policy', () => {
      const schema = schemaOf(engine2, 'try_catch');
      expectOpaqueRegion(schema.properties?.try, 'try_catch.try');
      expectOpaqueRegion(schema.properties?.catch, 'try_catch.catch');
      expect(schema.properties?.errorVariable?.type).toBe('string');
      const retry = schema.properties?.retry?.properties;
      expect(retry?.maxRetries?.type).toBe('integer');
      expect(retry?.maxRetries?.minimum).toBe(0);
      expect(retry?.maxRetries?.maximum).toBe(10);
      expect(retry?.backoffMultiplier?.minimum).toBe(1);
      expect(retry?.jitter?.type).toBe('boolean');
    });
  });

  it('decision / script stay deliberately schemaless (no partial forms)', () => {
    // A node with no configSchema renders identically online and offline (the
    // hardcoded fallback), so there is no divergence — and publishing a partial
    // schema would DROP editors the adapter cannot express (decision's virtual
    // Target column; script's actionType-conditional fields).
    expect(engine.getActionDescriptor('decision')?.configSchema).toBeUndefined();
    expect(engine.getActionDescriptor('script')?.configSchema).toBeUndefined();
  });
});
