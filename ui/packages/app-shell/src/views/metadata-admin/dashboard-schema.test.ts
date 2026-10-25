// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { getDashboardSchema, getDashboardForm } from './dashboard-schema';

describe('dashboard-schema — getDashboardSchema', () => {
  it('derives a JSONSchema object for the Dashboard document', () => {
    const schema = getDashboardSchema();
    expect(schema).toBeDefined();
    expect(schema?.type).toBe('object');
    const props = schema?.properties ?? {};
    // Core dashboard properties flow through from the spec.
    expect(props.name).toBeDefined();
    expect(props.label).toBeDefined();
    expect(props.description).toBeDefined();
    expect(props.widgets).toBeDefined();
    expect(props.columns).toBeDefined();
  });

  it('memoises the result (same reference across calls)', () => {
    expect(getDashboardSchema()).toBe(getDashboardSchema());
  });
});

describe('dashboard-schema — getDashboardForm', () => {
  it('returns a FormView with sections', () => {
    const form = getDashboardForm();
    expect(form).toBeDefined();
    expect(Array.isArray(form?.sections)).toBe(true);
    expect((form?.sections?.length ?? 0)).toBeGreaterThan(0);
  });

  it('prunes inspector-owned fields (widgets / label / description / name) from every section', () => {
    const form = getDashboardForm();
    const declared = new Set<string>();
    for (const s of form?.sections ?? []) {
      for (const f of s.fields ?? []) {
        declared.add(typeof f === 'string' ? f : (f as { field: string }).field);
      }
    }
    expect(declared.has('widgets')).toBe(false);
    expect(declared.has('label')).toBe(false);
    expect(declared.has('description')).toBe(false);
    expect(declared.has('name')).toBe(false);
  });

  it('keeps non-owned spec fields (e.g. layout / filters), and carries a retirement through', () => {
    const form = getDashboardForm();
    const declared = new Set<string>();
    for (const s of form?.sections ?? []) {
      for (const f of s.fields ?? []) {
        declared.add(typeof f === 'string' ? f : (f as { field: string }).field);
      }
    }
    // Layout and filter fields survive the prune.
    expect(declared.has('columns')).toBe(true);
    expect(declared.has('globalFilters')).toBe(true);
    // `performance` was RETIRED in spec 17.0.0 (framework#3896 audit close-out):
    // no renderer or runtime ever read it. This form is derived from the spec's
    // own `dashboardForm`, so the removal arrives here for free — which is the
    // point of deriving instead of hand-listing, and worth pinning: were this
    // file ever to hardcode a field list again, a retirement would silently
    // keep offering an input the loader rejects.
    expect(declared.has('performance')).toBe(false);
  });

  it('drops sections that become empty after pruning', () => {
    const form = getDashboardForm();
    for (const s of form?.sections ?? []) {
      expect((s.fields ?? []).length).toBeGreaterThan(0);
    }
  });

  it('memoises the result (same reference across calls)', () => {
    expect(getDashboardForm()).toBe(getDashboardForm());
  });
});
