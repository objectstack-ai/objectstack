// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  getListVariantSchema,
  getFormVariantSchema,
  getListColumnSchema,
  getViewForm,
} from './view-schema';

/**
 * Regression for objectui#2561: the View inspector's spec-derived JSONSchema
 * had no test, so when spec 15 (ADR-0089 D3a) turned FormFieldSchema into a
 * `.strict().transform(…)` pipe and crashed `z.toJSONSchema` over the
 * lazySchema proxy (fixed upstream in framework#3021), the inspector degraded
 * silently. Pin the derivation like page-schema.test.ts does for pages.
 */
describe('view-schema (spec-derived View authoring metadata)', () => {
  it('derives the list-variant JSONSchema from the spec ViewSchema', () => {
    const schema = getListVariantSchema();
    expect(schema).toBeTruthy();
    expect(JSON.stringify(schema)).toContain('kanban');
  });

  it('derives the form-variant JSONSchema (recursive strict FormFieldSchema)', () => {
    const schema = getFormVariantSchema();
    expect(schema).toBeTruthy();
    expect(JSON.stringify(schema)).toContain('sections');
  });

  it('derives the ListColumn JSONSchema', () => {
    expect(getListColumnSchema()).toBeTruthy();
  });

  it('prunes inspector-owned fields from the authoring form', () => {
    const form = getViewForm();
    if (form) {
      const declared = new Set<string>();
      for (const s of form.sections ?? []) {
        for (const f of s.fields ?? []) {
          declared.add(typeof f === 'string' ? f : (f as any)?.field);
        }
      }
      for (const owned of ['columns', 'data', 'name']) {
        expect(declared.has(owned)).toBe(false);
      }
    }
  });
});
