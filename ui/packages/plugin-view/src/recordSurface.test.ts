/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Unit coverage for the local `@objectstack/spec` record-surface mirror
 * (`deriveRecordSurface` #2578, `deriveRecordFlowSurface` #2604). Thresholds
 * and flow mapping must stay in lockstep with the spec helpers — these tests
 * pin the local copy so a drift is caught here rather than in the browser.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveRecordSurface,
  deriveRecordFlowSurface,
  deriveOverlaySize,
  overlayWidthFor,
  RECORD_SURFACE_PAGE_THRESHOLD,
  type RecordFlow,
} from './recordSurface';

/** Build an object schema with `n` plain text fields named f0..f(n-1). */
function objWithFields(n: number, extra: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) fields[`f${i}`] = { type: 'text', label: `F${i}` };
  return { name: 'thing', fields: { ...fields, ...extra } };
}

describe('deriveRecordSurface (#2578 mirror)', () => {
  it('drawer below the threshold, page at/above it', () => {
    expect(deriveRecordSurface(objWithFields(RECORD_SURFACE_PAGE_THRESHOLD - 1))).toBe('drawer');
    expect(deriveRecordSurface(objWithFields(RECORD_SURFACE_PAGE_THRESHOLD))).toBe('page');
  });

  it('mobile always pages', () => {
    expect(deriveRecordSurface(objWithFields(1), { viewport: 'mobile' })).toBe('page');
  });

  it('ignores hidden and audit/system fields', () => {
    const def = objWithFields(RECORD_SURFACE_PAGE_THRESHOLD - 1, {
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
      organization_id: { type: 'text' },
      secret: { type: 'text', hidden: true },
    });
    expect(deriveRecordSurface(def)).toBe('drawer');
  });

  it('tolerates bare / malformed input', () => {
    expect(deriveRecordSurface(null)).toBe('drawer');
    expect(deriveRecordSurface({ fields: 'nope' })).toBe('drawer');
  });
});

describe('deriveRecordFlowSurface (#2604 mirror)', () => {
  const TASK_FLOWS: RecordFlow[] = ['create', 'edit', 'child-create', 'child-edit'];
  const heavy = objWithFields(RECORD_SURFACE_PAGE_THRESHOLD);
  const light = objWithFields(RECORD_SURFACE_PAGE_THRESHOLD - 1);

  it("view keeps the #2578 behavior verbatim: heavy → route('page'), light → overlay('drawer')", () => {
    expect(deriveRecordFlowSurface(heavy, 'view')).toEqual({
      container: 'route', surface: 'page', size: 'auto',
    });
    expect(deriveRecordFlowSurface(light, 'view')).toEqual({
      container: 'overlay', surface: 'drawer', size: 'auto',
    });
  });

  // objectstack-ai/objectstack#23734 (letter B of objectui#12521, objectui#12592): on desktop a
  // field-heavy task flow derives a BOUNDED modal; only a phone keeps the full-screen one (below).
  // The spec keeps no full-screen split for a form with an embedded child or line-items table.
  it('task flows never route: heavy → bounded modal overlay on desktop', () => {
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(heavy, flow)).toEqual({
        container: 'overlay', surface: 'modal', size: 'auto',
      });
    }
  });

  it('heavy task flows on mobile: the full-screen modal', () => {
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(heavy, flow, { viewport: 'mobile' })).toEqual({
        container: 'overlay', surface: 'modal', size: 'full',
      });
    }
  });

  it('task flows on a light object stay a drawer-class overlay', () => {
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(light, flow)).toEqual({
        container: 'overlay', surface: 'drawer', size: 'auto',
      });
    }
  });

  it('mobile: view routes; task flows become a full-screen modal', () => {
    expect(deriveRecordFlowSurface(light, 'view', { viewport: 'mobile' }).container).toBe('route');
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(light, flow, { viewport: 'mobile' })).toEqual({
        container: 'overlay', surface: 'modal', size: 'full',
      });
    }
  });

  it('child-* flows size to the def they are given (the child), independent of any parent', () => {
    expect(deriveRecordFlowSurface(objWithFields(3), 'child-create').surface).toBe('drawer');
    expect(deriveRecordFlowSurface(objWithFields(40), 'child-edit')).toEqual({
      container: 'overlay', surface: 'modal', size: 'auto',
    });
  });
});

describe('deriveOverlaySize / overlayWidthFor (#2578 mirror)', () => {
  it('buckets by field count and clamps to the viewport', () => {
    expect(deriveOverlaySize(objWithFields(2))).toBe('sm');
    expect(deriveOverlaySize(objWithFields(20))).toBe('xl');
    expect(overlayWidthFor('auto', objWithFields(2))).toBe('min(92vw, 480px)');
    expect(overlayWidthFor('full', objWithFields(2))).toBe('min(92vw, 1600px)');
  });
});
