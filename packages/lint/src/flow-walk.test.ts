// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  FLOW_REGION_SLOTS,
  FLOW_REGION_CONFIG_KEYS,
} from '@objectstack/spec/automation';

import {
  walkFlowNodes,
  flowNodeLabel,
  REGION_SLOTS,
  REGION_CONFIG_KEYS,
  MAX_REGION_DEPTH,
} from './flow-walk.js';

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'script', ...extra });

/**
 * The behavioural probe that used to live here — deriving each construct's
 * region keys from its own config schema — moved to `region-slots.test.ts` in
 * the spec, next to the single declaration it now reconciles (#4401). This side
 * only has to prove the projection is faithful; a renamed or added slot fails
 * over there, once, for all three walks.
 */
describe('REGION_SLOTS — projected from the spec, not restated', () => {
  it('carries every declared slot, grouped by container type', () => {
    const projected = [...REGION_SLOTS].flatMap(([type, keys]) => keys.map(key => `${type}.${key}`)).sort();
    expect(projected).toEqual(FLOW_REGION_SLOTS.map(s => `${s.nodeType}.${s.key}`).sort());
  });

  it('shares the flat config-key set by reference', () => {
    expect(REGION_CONFIG_KEYS).toBe(FLOW_REGION_CONFIG_KEYS);
  });
});

describe('walkFlowNodes', () => {
  it('yields top-level nodes with a flat path and an empty trail', () => {
    const walked = walkFlowNodes({ nodes: [node('a'), node('b')] }, 'flows[0]');
    expect(walked.map((w) => w.path)).toEqual(['flows[0].nodes[0]', 'flows[0].nodes[1]']);
    expect(walked.every((w) => w.regionTrail === '' && w.depth === 0)).toBe(true);
  });

  it('reaches try_catch try + catch regions', () => {
    const flow = {
      nodes: [
        {
          id: 'guard',
          type: 'try_catch',
          label: 'Guard',
          config: {
            try: { nodes: [node('push')], edges: [] },
            catch: { nodes: [node('flag')], edges: [] },
          },
        },
      ],
    };
    const walked = walkFlowNodes(flow, 'flows[0]');
    expect(walked.map((w) => w.path)).toEqual([
      'flows[0].nodes[0]',
      'flows[0].nodes[0].config.try.nodes[0]',
      'flows[0].nodes[0].config.catch.nodes[0]',
    ]);
    expect(walked[2].regionTrail).toBe('try_catch "Guard" › catch');
    expect(walked[2].depth).toBe(1);
  });

  it('reaches a loop body', () => {
    const flow = {
      nodes: [{ id: 'each', type: 'loop', config: { collection: '{items}', body: { nodes: [node('inner')], edges: [] } } }],
    };
    const walked = walkFlowNodes(flow, 'flows[0]');
    expect(walked.map((w) => w.path)).toEqual(['flows[0].nodes[0]', 'flows[0].nodes[0].config.body.nodes[0]']);
    expect(walked[1].regionTrail).toBe('loop "each" › body');
  });

  it('reaches every parallel branch, named or indexed', () => {
    const flow = {
      nodes: [
        {
          id: 'fan',
          type: 'parallel',
          config: {
            branches: [
              { name: 'left', nodes: [node('l')], edges: [] },
              { nodes: [node('r')], edges: [] },
            ],
          },
        },
      ],
    };
    const walked = walkFlowNodes(flow, 'flows[0]');
    expect(walked.map((w) => w.path)).toEqual([
      'flows[0].nodes[0]',
      'flows[0].nodes[0].config.branches[0].nodes[0]',
      'flows[0].nodes[0].config.branches[1].nodes[0]',
    ]);
    expect(walked[1].regionTrail).toBe('parallel "fan" › branch left');
    expect(walked[2].regionTrail).toBe('parallel "fan" › branch #1');
  });

  it('recurses through nested regions and accumulates the trail', () => {
    const flow = {
      nodes: [
        {
          id: 'outer',
          type: 'try_catch',
          config: {
            try: {
              nodes: [
                {
                  id: 'inner',
                  type: 'loop',
                  config: { collection: '{x}', body: { nodes: [node('deep')], edges: [] } },
                },
              ],
              edges: [],
            },
          },
        },
      ],
    };
    const walked = walkFlowNodes(flow, 'flows[0]');
    const deep = walked.find((w) => w.node.id === 'deep');
    expect(deep?.path).toBe('flows[0].nodes[0].config.try.nodes[0].config.body.nodes[0]');
    expect(deep?.regionTrail).toBe('try_catch "outer" › try › loop "inner" › body');
    expect(deep?.depth).toBe(2);
  });

  // The trap that makes a recursive config scan double-report.
  it('localConfig strips region slots but keeps the container’s own config', () => {
    const flow = {
      nodes: [
        {
          id: 'each',
          type: 'loop',
          config: { collection: '{items}', maxIterations: 10, body: { nodes: [node('inner')], edges: [] } },
        },
      ],
    };
    const [container, inner] = walkFlowNodes(flow, 'flows[0]');
    expect(Object.keys(container.localConfig ?? {}).sort()).toEqual(['collection', 'maxIterations']);
    // The raw node is untouched — stripping is a view, not a mutation.
    expect((container.node.config as Record<string, unknown>).body).toBeDefined();
    // A non-container node's localConfig is its config, not a copy-with-holes.
    expect(inner.localConfig).toEqual(inner.node.config ?? undefined);
  });

  it('leaves localConfig undefined for a node with no config', () => {
    const [only] = walkFlowNodes({ nodes: [{ id: 'x', type: 'end' }] }, 'flows[0]');
    expect(only.localConfig).toBeUndefined();
  });

  it('labels a node by label, then id, then index', () => {
    expect(flowNodeLabel({ label: 'L', id: 'i' }, 0)).toBe('L');
    expect(flowNodeLabel({ id: 'i' }, 0)).toBe('i');
    expect(flowNodeLabel({}, 3)).toBe('#3');
  });

  it('tolerates missing/!array nodes and non-record entries', () => {
    expect(walkFlowNodes({}, 'flows[0]')).toEqual([]);
    expect(walkFlowNodes({ nodes: 'nope' }, 'flows[0]')).toEqual([]);
    expect(walkFlowNodes({ nodes: [null, 'x', node('ok')] }, 'flows[0]').map((w) => w.node.id)).toEqual(['ok']);
    expect(walkFlowNodes({ nodes: [{ id: 'c', type: 'try_catch', config: { try: 'nope' } }] }, 'flows[0]')).toHaveLength(1);
  });

  it('stops at the depth cap rather than recursing without bound', () => {
    // Build MAX_REGION_DEPTH + 3 levels of try nesting.
    let deepest: Record<string, unknown> = { id: 'leaf', type: 'script' };
    for (let i = 0; i < MAX_REGION_DEPTH + 3; i++) {
      deepest = { id: `t${i}`, type: 'try_catch', config: { try: { nodes: [deepest], edges: [] } } };
    }
    const walked = walkFlowNodes({ nodes: [deepest] }, 'flows[0]');
    expect(walked.length).toBeGreaterThan(0);
    expect(Math.max(...walked.map((w) => w.depth))).toBeLessThanOrEqual(MAX_REGION_DEPTH);
  });
});
