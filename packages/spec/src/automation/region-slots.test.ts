// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one reconciliation test for the one region-slot declaration (#4401).
 *
 * There used to be three of these — one beside each walk that needed the table
 * (`spec/conversions/walk.ts`, `spec/automation/control-flow.zod.ts` and
 * `lint/flow-walk.ts`). Each pinned its own copy, so every copy was protected
 * from drifting away from the schemas and *none* of them would have failed if
 * the copies drifted from each other. One table, one test.
 *
 * The probe is behavioural rather than structural — it asks each container
 * config schema what it actually ACCEPTS in a region shape, instead of reading
 * key names off `.shape`. A slot renamed in the schema fails here; so does a
 * slot that stops accepting a region. (Approach carried over from the
 * `flow-walk.test.ts` version it replaces.)
 */

import { describe, it, expect } from 'vitest';

import * as controlFlow from './control-flow.zod.js';
import { LoopConfigSchema, ParallelConfigSchema, TryCatchConfigSchema } from './control-flow.zod.js';
import {
  FLOW_REGION_SLOTS,
  FLOW_REGION_SLOTS_BY_TYPE,
  FLOW_REGION_CONFIG_KEYS,
} from './region-slots.js';

/** Every container construct that carries a region, and its config schema. */
const REGION_BEARING_CONFIGS = {
  loop: LoopConfigSchema,
  parallel: ParallelConfigSchema,
  try_catch: TryCatchConfigSchema,
} as const;

/** A minimal well-formed region. `label` is required by `FlowNodeSchema`. */
const region = () => ({ nodes: [{ id: 'probe', type: 'script', label: 'Probe' }], edges: [] });

/**
 * Ask a config schema which of its keys accept a region — by handing it every
 * candidate at once and seeing which survive the parse in a region shape.
 * Returns each surviving key with the arity it parsed at.
 */
function regionSlotsAccepted(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } },
): Array<{ key: string; arity: 'one' | 'many' }> {
  const probes: Record<string, unknown> = {
    // Required siblings, so the parse reaches the region keys at all.
    collection: '{items}',
    body: region(),
    try: region(),
    catch: region(),
    branches: [region(), region()],
  };
  const parsed = schema.safeParse(probes);
  if (!parsed.success) return [];
  const data = parsed.data as Record<string, unknown>;
  const isRegion = (v: unknown) => !!v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>).nodes);

  const out: Array<{ key: string; arity: 'one' | 'many' }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.length > 0 && value.every(isRegion)) out.push({ key, arity: 'many' });
    else if (isRegion(value)) out.push({ key, arity: 'one' });
  }
  return out;
}

const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key);

describe('#4401 — FLOW_REGION_SLOTS reconciles with the ADR-0031 construct schemas', () => {
  it('declares exactly the slots each construct accepts, at the right arity', () => {
    for (const [nodeType, schema] of Object.entries(REGION_BEARING_CONFIGS)) {
      const declared = FLOW_REGION_SLOTS
        .filter(s => s.nodeType === nodeType)
        .map(s => ({ key: s.key, arity: s.arity }))
        .sort(byKey);
      expect(declared, `region slots for '${nodeType}'`).toEqual(regionSlotsAccepted(schema).sort(byKey));
    }
  });

  it('covers every region-bearing construct — no fourth one goes unlisted', () => {
    expect([...FLOW_REGION_SLOTS_BY_TYPE.keys()].sort())
      .toEqual(Object.keys(REGION_BEARING_CONFIGS).sort());
  });

  /**
   * Closes the loop the list above would otherwise leave open: a new construct
   * whose author forgets BOTH the table and this test's map would pass silently.
   * Every `*ConfigSchema` this module exports is probed, so the only way to add
   * a region-bearing construct without failing here is to declare it.
   */
  it('and no other exported config schema quietly accepts one', () => {
    const accounted = new Set<unknown>(Object.values(REGION_BEARING_CONFIGS));
    const probed: string[] = [];
    for (const [name, exported] of Object.entries(controlFlow)) {
      if (!name.endsWith('ConfigSchema') || accounted.has(exported)) continue;
      probed.push(name);
      expect(
        regionSlotsAccepted(exported as never),
        `${name} accepts a region shape but is not in FLOW_REGION_SLOTS`,
      ).toEqual([]);
    }
    // Guard against the probe going vacuous if the naming convention changes.
    expect(probed.length + accounted.size).toBeGreaterThanOrEqual(3);
  });

  it('marks exactly the array-valued slot as `many`', () => {
    expect(FLOW_REGION_SLOTS.filter(s => s.arity === 'many').map(s => `${s.nodeType}.${s.key}`))
      .toEqual(['parallel.branches']);
  });
});

describe('#4401 — the derived views stay in step with the source list', () => {
  it('indexes every slot by its container type', () => {
    expect([...FLOW_REGION_SLOTS_BY_TYPE.values()].flat().sort(byKey))
      .toEqual([...FLOW_REGION_SLOTS].sort(byKey));
  });

  it('flattens every config key into FLOW_REGION_CONFIG_KEYS', () => {
    expect([...FLOW_REGION_CONFIG_KEYS].sort())
      .toEqual([...new Set(FLOW_REGION_SLOTS.map(s => s.key))].sort());
  });

  it('resolves a hostile node type to nothing instead of Object.prototype', () => {
    // `node.type` is an open, author-controlled namespace (ADR-0018). An object
    // literal would hand a walk `Object`'s constructor here.
    for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(FLOW_REGION_SLOTS_BY_TYPE.get(hostile)).toBeUndefined();
    }
  });
});
