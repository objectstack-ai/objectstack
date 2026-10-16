// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The LIVE half of the ADR-0087 D2 window: an entry that has not left the load
 * path is applied by the default pass and by the authoring funnel
 * (`normalizeStackInput`), reported through the caller's sink, and applied
 * silently when the caller gave none.
 *
 * These cases lived in `conversions.test.ts`, driven by
 * `flow-node-http-callout-rename`, until #23543 F5-http retired it — the last
 * real entry below 18 left live. No real entry is live on the default path
 * now, so the subject is a conversion this file owns: a test-only flow-node
 * type rename appended to the table the pass reads. A probe nobody retires
 * keeps these pins about the live window, not about whichever entry happens to
 * be live. The retired half is pinned in `conversions.test.ts` ("load-path
 * retirement").
 *
 * `vi.mock` replaces the registry module for the whole file, so `apply.ts`
 * (which `normalizeStackInput` calls) reads the extended table; nothing outside
 * this file sees the probe.
 */
import { describe, expect, it, vi } from 'vitest';

import { normalizeStackInput } from '../shared/metadata-collection.zod.js';
import { collectConversionNotices } from './apply.js';
import type { ConversionNotice, MetadataConversion } from './types.js';

const PROBE = 'apply-live-window-probe';

vi.mock('./registry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./registry.js')>();
  const { mapFlowNodes } = await import('./walk.js');
  const probe: MetadataConversion = {
    id: 'apply-live-window-probe',
    toMajor: 18,
    surface: 'flow.node.type (test probe)',
    summary: "test-only probe: a live load-path rename, node type 'probe_old_callout' → 'http'",
    apply(stack, emit) {
      return mapFlowNodes(stack, (node, path) => {
        if (node.type !== 'probe_old_callout') return node;
        emit({ from: 'probe_old_callout', to: 'http', path: `${path}.type` });
        return { ...node, type: 'http' };
      });
    },
    fixture: { before: {}, after: {}, expectedNotices: 0 },
  };
  return { ...original, ALL_CONVERSIONS: [...original.ALL_CONVERSIONS, probe] };
});

describe('a live-window conversion applies at load', () => {
  it('the default pass applies it, one notice naming the entry', () => {
    const { stack, notices } = collectConversionNotices({
      flows: [{ name: 'f', nodes: [{ id: 'n1', type: 'probe_old_callout', config: { url: 'https://example.com' } }] }],
    });
    expect((stack.flows as any[])[0].nodes[0].type).toBe('http');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.conversionId).toBe(PROBE);
    expect(notices[0]!.retiresIn).toBe(19);
  });

  describe('normalizeStackInput (the authoring funnel)', () => {
    it('converts at load and surfaces notices through the sink', () => {
      const notices: ConversionNotice[] = [];
      const out = normalizeStackInput(
        { flows: [{ name: 'f', nodes: [{ id: 'n', type: 'probe_old_callout' }] }] },
        { onConversionNotice: (n) => notices.push(n) },
      );
      expect((out.flows as any[])[0].nodes[0].type).toBe('http');
      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("'probe_old_callout' → 'http'");
    });

    it('still converts silently when no sink is provided (zero consumer action)', () => {
      const out = normalizeStackInput({ flows: [{ name: 'f', nodes: [{ id: 'n', type: 'probe_old_callout' }] }] });
      expect((out.flows as any[])[0].nodes[0].type).toBe('http');
    });

    it('normalizes map collections and converts in one pass', () => {
      const out = normalizeStackInput({
        flows: { my_flow: { nodes: [{ id: 'n', type: 'probe_old_callout' }] } } as any,
      });
      const flows = out.flows as any[];
      expect(Array.isArray(flows)).toBe(true);
      expect(flows[0].name).toBe('my_flow'); // map key injected
      expect(flows[0].nodes[0].type).toBe('http'); // converted
    });
  });
});
