// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  deriveRecordSurface,
  deriveRecordFlowSurface,
  countAuthorableFields,
  RECORD_SURFACE_PAGE_THRESHOLD,
  type RecordFlow,
} from './record-surface';

/** Build an object def with `n` plain text fields named f0..f(n-1). */
function objWithFields(n: number, extra: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) fields[`f${i}`] = { type: 'text', label: `F${i}` };
  return { name: 'thing', fields: { ...fields, ...extra } };
}

describe('deriveRecordSurface (ADR-0085 §5)', () => {
  it('opens a light object as a drawer (below threshold)', () => {
    expect(deriveRecordSurface(objWithFields(3))).toBe('drawer');
    expect(deriveRecordSurface(objWithFields(RECORD_SURFACE_PAGE_THRESHOLD - 1))).toBe('drawer');
  });

  it('opens a field-heavy object as a full page (at/above threshold)', () => {
    expect(deriveRecordSurface(objWithFields(RECORD_SURFACE_PAGE_THRESHOLD))).toBe('page');
    expect(deriveRecordSurface(objWithFields(60))).toBe('page');
  });

  it('forces a full page on mobile regardless of field count', () => {
    expect(deriveRecordSurface(objWithFields(1), { viewport: 'mobile' })).toBe('page');
    expect(deriveRecordSurface(objWithFields(60), { viewport: 'mobile' })).toBe('page');
  });

  it('honours an explicit pageThreshold override', () => {
    expect(deriveRecordSurface(objWithFields(5), { pageThreshold: 4 })).toBe('page');
    expect(deriveRecordSurface(objWithFields(5), { pageThreshold: 20 })).toBe('drawer');
  });

  it('does not count hidden or audit/system fields toward "heavy"', () => {
    const def = objWithFields(RECORD_SURFACE_PAGE_THRESHOLD - 1, {
      created_at: { type: 'datetime' },
      updated_at: { type: 'datetime' },
      organization_id: { type: 'text' },
      secret: { type: 'text', hidden: true },
    });
    // Still below threshold: the 4 extra fields are all system/hidden.
    expect(deriveRecordSurface(def)).toBe('drawer');
  });

  it('tolerates bare / malformed input', () => {
    expect(deriveRecordSurface(null)).toBe('drawer');
    expect(deriveRecordSurface(undefined)).toBe('drawer');
    expect(deriveRecordSurface({})).toBe('drawer');
    expect(deriveRecordSurface({ fields: 'nope' } as unknown)).toBe('drawer');
  });
});

describe('deriveRecordFlowSurface (#2604)', () => {
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

  it('task flows never route: heavy → full-screen modal overlay', () => {
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(heavy, flow)).toEqual({
        container: 'overlay', surface: 'modal', size: 'full',
      });
    }
  });

  it('task flows on a light object stay a drawer overlay', () => {
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(light, flow)).toEqual({
        container: 'overlay', surface: 'drawer', size: 'auto',
      });
    }
  });

  it('mobile: view routes to a page; task flows become a full-screen modal', () => {
    expect(deriveRecordFlowSurface(light, 'view', { viewport: 'mobile' })).toEqual({
      container: 'route', surface: 'page', size: 'auto',
    });
    for (const flow of TASK_FLOWS) {
      expect(deriveRecordFlowSurface(light, flow, { viewport: 'mobile' })).toEqual({
        container: 'overlay', surface: 'modal', size: 'full',
      });
    }
  });

  it('child-* flows size to the def they are given (the child), independent of any parent', () => {
    // A thin child stays a drawer even though its parent (not passed) is heavy.
    expect(deriveRecordFlowSurface(objWithFields(3), 'child-create').surface).toBe('drawer');
    // A fat child gets the full-screen modal.
    expect(deriveRecordFlowSurface(objWithFields(40), 'child-edit')).toEqual({
      container: 'overlay', surface: 'modal', size: 'full',
    });
  });

  it('honours pageThreshold and tolerates bare/malformed input', () => {
    expect(deriveRecordFlowSurface(objWithFields(5), 'create', { pageThreshold: 4 }).size).toBe('full');
    expect(deriveRecordFlowSurface(null, 'create')).toEqual({
      container: 'overlay', surface: 'drawer', size: 'auto',
    });
    expect(deriveRecordFlowSurface({ fields: 'nope' } as unknown, 'view').surface).toBe('drawer');
  });
});

describe('countAuthorableFields', () => {
  it('counts visible non-system fields only', () => {
    expect(countAuthorableFields(objWithFields(5))).toBe(5);
    const def = objWithFields(2, {
      created_by: { type: 'text' },
      hidden_one: { type: 'text', hidden: true },
    });
    expect(countAuthorableFields(def)).toBe(2);
  });

  it('returns 0 for bare/malformed input', () => {
    expect(countAuthorableFields(null)).toBe(0);
    expect(countAuthorableFields({})).toBe(0);
  });
});
