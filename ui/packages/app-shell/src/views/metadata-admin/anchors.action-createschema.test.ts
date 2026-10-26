// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { registerBuiltinAnchors } from './anchors';
import { resolveResourceConfig } from './registry';

/**
 * objectui#2325 — the `action` resource listed `objectName` in `createFields`
 * but shipped no `createSchema`, so the create form fell back to a plain text
 * input for the object-binding field (instead of a `ref:object` dropdown, the
 * way `view` / `page` render theirs). Pin the create-form contract here so the
 * widget hint can't silently regress.
 */
registerBuiltinAnchors();

describe('action createSchema (object-binding field renders as a picker)', () => {
  const cfg = resolveResourceConfig('action');
  const props = (cfg.createSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;

  it('declares a createSchema for the create form', () => {
    expect(cfg.createSchema).toBeTruthy();
    expect(cfg.createSchema?.type).toBe('object');
  });

  it('every createFields entry has a matching createSchema property', () => {
    // A createFields key with no schema property is never rendered by
    // SchemaForm (it iterates schema.properties), so the two must agree.
    for (const field of cfg.createFields ?? []) {
      expect(props[field], `createFields '${field}' missing from createSchema.properties`).toBeTruthy();
    }
  });

  it('renders objectName as the ref:object object selector', () => {
    expect(props.objectName?.widget).toBe('ref:object');
  });

  it('keeps objectName optional (record-scoped / global actions bind no object)', () => {
    const required = (cfg.createSchema?.required as string[] | undefined) ?? [];
    expect(required).not.toContain('objectName');
    // identity fields are still required
    expect(required).toContain('label');
    expect(required).toContain('name');
  });

  it('renders icon as the searchable icon picker', () => {
    expect(props.icon?.widget).toBe('icon');
  });
});
