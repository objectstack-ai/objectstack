// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { normalizeStackInput } from '../shared/metadata-collection.zod.js';
import { applyConversions, collectConversionNotices } from './apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
import { CONVERSION_NOTICE_CODE, type ConversionNotice } from './types.js';

describe('conversion layer (ADR-0087 D2)', () => {
  describe('fixture pairs — every entry converts old shape → canonical', () => {
    for (const conversion of ALL_CONVERSIONS) {
      it(`${conversion.id}: before → after, emits ${conversion.fixture.expectedNotices} notice(s)`, () => {
        const { stack, notices } = collectConversionNotices(
          structuredClone(conversion.fixture.before),
        );
        // The whole table runs, but fixtures are disjoint, so the result must
        // equal exactly this entry's `after`.
        expect(stack).toEqual(conversion.fixture.after);
        expect(notices).toHaveLength(conversion.fixture.expectedNotices);
        // Every notice this fixture produced must come from this conversion.
        for (const n of notices) {
          expect(n.conversionId).toBe(conversion.id);
          expect(n.code).toBe(CONVERSION_NOTICE_CODE);
          expect(n.toMajor).toBe(conversion.toMajor);
          expect(n.retiresIn).toBe(conversion.toMajor + 1);
          expect(n.surface).toBe(conversion.surface);
        }
      });
    }
  });

  describe('immutability & non-interference', () => {
    it('returns the same reference when nothing converts', () => {
      const clean = { objects: [{ name: 'account' }], flows: [{ name: 'f', nodes: [] }] };
      expect(applyConversions(clean)).toBe(clean);
    });

    it('never mutates the caller input', () => {
      const before = {
        flows: [{ name: 'f', nodes: [{ id: 'n', type: 'http_request', config: { url: 'x' } }] }],
      };
      const snapshot = structuredClone(before);
      applyConversions(before);
      expect(before).toEqual(snapshot);
    });

    it('shares untouched branches (copy-on-write, so plugins survive)', () => {
      const plugin = { onEnable() {} }; // non-clonable value that must be preserved by reference
      const stack: Record<string, unknown> = {
        plugins: [plugin],
        pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }],
      };
      const out = applyConversions(stack);
      expect(out).not.toBe(stack);
      expect((out.plugins as unknown[])[0]).toBe(plugin); // same reference, untouched
    });
  });

  describe('flow-node-http-callout-rename', () => {
    it('rewrites http_request / http_call / webhook → http, leaving http untouched', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              { id: 'a', type: 'http_call' },
              { id: 'b', type: 'http' },
              { id: 'c', type: 'webhook' },
            ],
          },
        ],
      });
      const nodes = (stack.flows as any[])[0].nodes;
      expect(nodes.map((n: any) => n.type)).toEqual(['http', 'http', 'http']);
      expect(notices).toHaveLength(2); // 'http' was already canonical
      expect(notices.map((n) => n.path)).toEqual(['flows[0].nodes[0].type', 'flows[0].nodes[2].type']);
    });
  });

  describe('flow-node-http-callout-rename — reserved-name conflict guard', () => {
    it('refuses to rewrite an alias a live executor owns, reporting a conflict', () => {
      const notices: ConversionNotice[] = [];
      const conflicts: { token: string; path: string; conversionId: string }[] = [];
      const out = applyConversions(
        { flows: [{ name: 'f', nodes: [{ id: 'a', type: 'webhook' }] }] },
        {
          onNotice: (n) => notices.push(n),
          onConflict: (c) => conflicts.push({ token: c.token, path: c.path, conversionId: c.conversionId }),
          reservedNodeTypes: new Set(['webhook']), // a third-party custom node owns this name
        },
      );
      // Not rewritten — the custom node is preserved.
      expect((out.flows as any[])[0].nodes[0].type).toBe('webhook');
      expect(notices).toHaveLength(0);
      expect(conflicts).toEqual([
        { token: 'webhook', path: 'flows[0].nodes[0].type', conversionId: 'flow-node-http-callout-rename' },
      ]);
    });

    it('converts normally when the alias is not a live type (build/validate seam)', () => {
      // No reservedNodeTypes → the historical alias converts as usual.
      const { stack, notices } = collectConversionNotices({
        flows: [{ name: 'f', nodes: [{ id: 'a', type: 'webhook' }] }],
      });
      expect((stack.flows as any[])[0].nodes[0].type).toBe('http');
      expect(notices).toHaveLength(1);
    });
  });

  describe('flow-node-crud-filter-alias (PD #12 retirement)', () => {
    it('renames config.filters → config.filter only for CRUD node types', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              { id: 'a', type: 'get_record', config: { objectName: 'lead', filters: { x: 1 } } },
              // non-CRUD type: `filters` is left alone (not this conversion's surface)
              { id: 'b', type: 'custom', config: { filters: { y: 2 } } },
            ],
          },
        ],
      });
      const nodes = (stack.flows as any[])[0].nodes;
      expect(nodes[0].config).toEqual({ objectName: 'lead', filter: { x: 1 } });
      expect(nodes[1].config).toEqual({ filters: { y: 2 } });
      expect(notices).toHaveLength(1);
    });

    it('does not clobber an existing canonical filter', () => {
      const { stack, notices } = collectConversionNotices({
        flows: [
          {
            name: 'f',
            nodes: [
              {
                id: 'a',
                type: 'delete_record',
                config: { filter: { keep: true }, filters: { drop: true } },
              },
            ],
          },
        ],
      });
      const node = (stack.flows as any[])[0].nodes[0];
      expect(node.config.filter).toEqual({ keep: true });
      expect(notices).toHaveLength(0); // canonical present → no conversion
    });
  });

  describe('registry invariants', () => {
    it('every conversion carries a fixture pair and a positive retirement window', () => {
      for (const c of ALL_CONVERSIONS) {
        expect(c.fixture.before).toBeTypeOf('object');
        expect(c.fixture.after).toBeTypeOf('object');
        expect(c.toMajor).toBeGreaterThan(0);
      }
    });

    it('conversion ids are unique', () => {
      const ids = ALL_CONVERSIONS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('ALL_CONVERSIONS is the flattened CONVERSIONS_BY_MAJOR', () => {
      const flat = Object.values(CONVERSIONS_BY_MAJOR).flat();
      expect(ALL_CONVERSIONS).toHaveLength(flat.length);
    });
  });

  describe('normalizeStackInput integration (the load seam)', () => {
    it('converts at load and surfaces notices through the sink', () => {
      const notices: ConversionNotice[] = [];
      const out = normalizeStackInput(
        { pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] },
        { onConversionNotice: (n) => notices.push(n) },
      );
      expect((out.pages as any[])[0].kind).toBe('html');
      expect(notices).toHaveLength(1);
      expect(notices[0]!.message).toContain("'jsx' → 'html'");
    });

    it('still converts silently when no sink is provided (zero consumer action)', () => {
      const out = normalizeStackInput({ pages: [{ name: 'p', kind: 'jsx', source: '<div/>' }] });
      expect((out.pages as any[])[0].kind).toBe('html');
    });

    it('normalizes map collections and converts in one pass', () => {
      const out = normalizeStackInput({
        flows: { my_flow: { nodes: [{ id: 'n', type: 'webhook' }] } } as any,
      });
      const flows = out.flows as any[];
      expect(Array.isArray(flows)).toBe(true);
      expect(flows[0].name).toBe('my_flow'); // map key injected
      expect(flows[0].nodes[0].type).toBe('http'); // converted
    });
  });
});
