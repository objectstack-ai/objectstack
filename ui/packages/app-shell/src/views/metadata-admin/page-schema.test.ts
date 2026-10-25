// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { getPageSchema, getPageForm, PAGE_FIELDS_OWNED_ELSEWHERE } from './page-schema';
import { registerBuiltinInspectors } from './inspectors';
import { getMetadataDefaultInspector } from './default-inspector-registry';
import { PageDefaultInspector } from './inspectors/PageDefaultInspector';

describe('page-schema (spec-derived Page authoring metadata)', () => {
  it('derives a Page JSONSchema that carries interfaceConfig (interface/list pages)', () => {
    const schema = getPageSchema();
    expect(schema).toBeTruthy();
    expect(schema!.properties && typeof schema!.properties).toBe('object');
    // The whole point: an interface/list page's config must be describable, so
    // its inspector can render source / visualizations / userActions etc.
    expect(JSON.stringify(schema)).toContain('interfaceConfig');
  });

  it('exposes the canonical authoring form with canvas/identity fields pruned', () => {
    const form = getPageForm();
    // Spec ships a pageForm; if present, it must not re-declare the fields the
    // canvas / identity own (they are edited on the canvas, not in this panel).
    if (form) {
      const declared = new Set<string>();
      for (const s of form.sections ?? []) {
        for (const f of s.fields ?? []) declared.add(typeof f === 'string' ? f : (f as any)?.field);
      }
      for (const owned of PAGE_FIELDS_OWNED_ELSEWHERE) {
        expect(declared.has(owned)).toBe(false);
      }
    }
  });
});

describe('page default inspector registration', () => {
  it('registers PageDefaultInspector as the no-selection inspector for `page`', () => {
    registerBuiltinInspectors();
    expect(getMetadataDefaultInspector('page')).toBe(PageDefaultInspector);
  });
});
