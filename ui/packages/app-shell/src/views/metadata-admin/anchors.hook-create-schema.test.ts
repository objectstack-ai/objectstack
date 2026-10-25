// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { registerBuiltinAnchors } from './anchors';
import { resolveResourceConfig } from './registry';

/**
 * #2324 — Hook's create form defined `createFields` but no `createSchema`, so
 * the flat form had no property types and every field (incl. `object`) rendered
 * as a plain text input instead of an object picker. Guard that the hook create
 * schema exists and gives `object` the `ref:object` widget, mirroring `page`.
 */
registerBuiltinAnchors();

type CreateSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, { widget?: string } | undefined>;
};

describe('hook createSchema (#2324 — object field must be a ref:object picker)', () => {
  const cfg = resolveResourceConfig('hook');
  const schema = cfg.createSchema as CreateSchema | undefined;

  it('declares a createSchema on the hook resource', () => {
    expect(schema).toBeTruthy();
    expect(schema?.type).toBe('object');
  });

  it('renders the object field via the ref:object widget (not plain text)', () => {
    expect(schema?.properties?.object?.widget).toBe('ref:object');
  });

  it('covers every asked-for create field with a typed property', () => {
    const props = schema?.properties ?? {};
    for (const field of cfg.createFields ?? []) {
      expect(props[field], `createField '${field}' has no createSchema property`).toBeTruthy();
    }
  });

  it('requires the spec-required `object` binding up front', () => {
    expect(schema?.required ?? []).toContain('object');
  });
});
