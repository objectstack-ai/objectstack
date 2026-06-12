// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0048 — cross-package metadata collision detection.
 *
 * Bare-named generic metadata (`page`, `dashboard`, `flow`, `action`, `doc`,
 * …) carries no package coordinate in the registry key, so two installed
 * packages defining the same `(type, name)` would silently shadow each other
 * at read time (last-write-wins). These tests pin the guard: real
 * cross-package base-layer collisions fail loudly, while same-package reloads
 * and legitimate runtime/DB overlays pass through untouched.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SchemaRegistry, MetadataCollisionError } from './registry';

describe('SchemaRegistry — cross-package collision (ADR-0048)', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.logLevel = 'silent';
  });

  it('throws when two different packages register the same (type, name)', () => {
    registry.registerItem('page', { name: 'home', title: 'CRM Home' }, 'name', 'crm');
    expect(() =>
      registry.registerItem('page', { name: 'home', title: 'HR Home' }, 'name', 'hr'),
    ).toThrowError(MetadataCollisionError);
  });

  it('error names both packages and the type/name', () => {
    registry.registerItem('flow', { name: 'on_create' }, 'name', 'crm');
    try {
      registry.registerItem('flow', { name: 'on_create' }, 'name', 'hr');
      throw new Error('expected a collision error');
    } catch (e) {
      expect(e).toBeInstanceOf(MetadataCollisionError);
      const err = e as MetadataCollisionError;
      expect(err.type).toBe('flow');
      expect(err.name_).toBe('on_create');
      expect(err.existingPackageId).toBe('crm');
      expect(err.incomingPackageId).toBe('hr');
      expect(err.message).toContain('crm');
      expect(err.message).toContain('hr');
      expect(err.message).toContain('flow/on_create');
    }
  });

  it('does NOT throw when the same package re-registers the same name (idempotent reload)', () => {
    registry.registerItem('page', { name: 'home', title: 'v1' }, 'name', 'crm');
    expect(() =>
      registry.registerItem('page', { name: 'home', title: 'v2' }, 'name', 'crm'),
    ).not.toThrow();
    // The latest value from the same package wins (overwrite under the same key).
    expect(registry.getItem<any>('page', 'home')?.title).toBe('v2');
  });

  it('does NOT throw for a runtime/DB overlay over a packaged item (ADR-0005 overlay)', () => {
    // Package ships the artifact under a composite key…
    registry.registerItem('page', { name: 'home', title: 'packaged' }, 'name', 'crm');
    // …and a runtime-authored row (no packageId) overlays it under the bare key.
    expect(() =>
      registry.registerItem('page', { name: 'home', title: 'runtime' }, 'name'),
    ).not.toThrow();
  });

  it('does NOT throw when a package ships over a pre-existing bare/runtime row', () => {
    // Runtime/DB row registered first (no packageId)…
    registry.registerItem('page', { name: 'home', title: 'runtime' }, 'name');
    // …then a package ships the same name. This is the artifact-vs-DB case,
    // handled by the existing shadowing warning, not a cross-package error.
    expect(() =>
      registry.registerItem('page', { name: 'home', title: 'packaged' }, 'name', 'crm'),
    ).not.toThrow();
  });

  it('treats the sys_metadata rehydration sentinel as a non-owner (no collision)', () => {
    // An item rehydrated from sys_metadata carries _packageId='sys_metadata'.
    registry.registerItem('page', { name: 'home', _packageId: 'sys_metadata' }, 'name');
    expect(() =>
      registry.registerItem('page', { name: 'home', title: 'packaged' }, 'name', 'crm'),
    ).not.toThrow();
  });

  it('does NOT throw for the same name owned by the same package across types', () => {
    registry.registerItem('page', { name: 'home' }, 'name', 'crm');
    expect(() =>
      registry.registerItem('dashboard', { name: 'home' }, 'name', 'hr'),
    ).not.toThrow();
  });

  it('does NOT throw for different names across packages', () => {
    registry.registerItem('page', { name: 'crm_home' }, 'name', 'crm');
    expect(() =>
      registry.registerItem('page', { name: 'hr_home' }, 'name', 'hr'),
    ).not.toThrow();
  });

  describe("collisionPolicy: 'warn'", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'warn' });
      registry.logLevel = 'silent';
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns instead of throwing, and registers both items', () => {
      registry.registerItem('page', { name: 'home', title: 'CRM' }, 'name', 'crm');
      expect(() =>
        registry.registerItem('page', { name: 'home', title: 'HR' }, 'name', 'hr'),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      const msg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(msg).toContain('Cross-package metadata collision');
      // Both survive under distinct composite keys; the artifact lookup still
      // resolves an item (read-time shadowing is what the error guards against).
      expect(registry.getItem<any>('page', 'home')).toBeDefined();
    });
  });
});
