// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { getReportSchema, getReportForm } from './report-schema';

describe('report-schema — getReportSchema', () => {
  it('derives a JSONSchema object for the Report document', () => {
    const schema = getReportSchema();
    expect(schema).toBeDefined();
    expect(schema?.type).toBe('object');
    const props = schema?.properties ?? {};
    // Core report properties flow through from the spec. Since the 9.0
    // single-form cutover a report is dataset-bound: `dataset` + `rows` /
    // `values` replace the inline `objectName` + `columns` query.
    expect(props.name).toBeDefined();
    expect(props.label).toBeDefined();
    expect(props.type).toBeDefined();
    expect(props.dataset).toBeDefined();
    expect(props.rows).toBeDefined();
    expect(props.values).toBeDefined();
  });

  it('exposes the report `type` enum from the spec', () => {
    const schema = getReportSchema();
    const en = schema?.properties?.type?.enum;
    expect(Array.isArray(en)).toBe(true);
    expect(en).toEqual(expect.arrayContaining(['tabular', 'summary', 'matrix', 'joined']));
  });

  it('memoises the result (same reference across calls)', () => {
    expect(getReportSchema()).toBe(getReportSchema());
  });
});

describe('report-schema — getReportForm', () => {
  it('returns a FormView with sections', () => {
    const form = getReportForm();
    expect(form).toBeDefined();
    expect(Array.isArray(form?.sections)).toBe(true);
    expect((form?.sections?.length ?? 0)).toBeGreaterThan(0);
  });

  it('prunes inspector-owned fields (dataset / values / rows / name) from every section', () => {
    const form = getReportForm();
    const declared = new Set<string>();
    for (const s of form?.sections ?? []) {
      for (const f of s.fields ?? []) {
        declared.add(typeof f === 'string' ? f : (f as { field: string }).field);
      }
    }
    expect(declared.has('dataset')).toBe(false);
    expect(declared.has('values')).toBe(false);
    expect(declared.has('rows')).toBe(false);
    expect(declared.has('name')).toBe(false);
  });

  it('prunes form fields the 9.0 schema no longer carries (query-form leftovers)', () => {
    const form = getReportForm();
    const declared = new Set<string>();
    for (const s of form?.sections ?? []) {
      for (const f of s.fields ?? []) {
        declared.add(typeof f === 'string' ? f : (f as { field: string }).field);
      }
    }
    // Removed in the ADR-0021 single-form cutover — the editor must not offer
    // fields the schema strips at parse time.
    expect(declared.has('objectName')).toBe(false);
    expect(declared.has('columns')).toBe(false);
    expect(declared.has('groupingsDown')).toBe(false);
    expect(declared.has('groupingsAcross')).toBe(false);
    expect(declared.has('filter')).toBe(false);
  });

  it('keeps non-owned spec fields and surfaces runtimeFilter', () => {
    const form = getReportForm();
    const declared = new Set<string>();
    for (const s of form?.sections ?? []) {
      for (const f of s.fields ?? []) {
        declared.add(typeof f === 'string' ? f : (f as { field: string }).field);
      }
    }
    expect(declared.has('description')).toBe(true);
    expect(declared.has('chart')).toBe(true);
    // `filter` was renamed `runtimeFilter` in 9.0 — the alignment pass appends
    // it when the bundled form predates the rename.
    expect(declared.has('runtimeFilter')).toBe(true);
  });

  it('drops sections that become empty after pruning', () => {
    const form = getReportForm();
    for (const s of form?.sections ?? []) {
      expect((s.fields ?? []).length).toBeGreaterThan(0);
    }
  });

  it('memoises the result (same reference across calls)', () => {
    expect(getReportForm()).toBe(getReportForm());
  });
});
