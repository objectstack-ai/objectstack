// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30215 — an uninstalled package stops reading as a booted code package on
 * the running instance.
 *
 * `registerApp` puts a package's manifest in the engine's `manifests` map, and
 * ADR-0070's `isWritablePackage` reads that map FIRST: an id in it is a code
 * package, read-only. Every uninstall door (the protocol's `deletePackage`,
 * `DELETE /packages/:id`, the install-local DELETE) withdraws the package
 * through `SchemaRegistry.uninstallPackage`, and nothing took the id out of
 * the engine's map. So an administrator who uninstalled a package got a 200,
 * then `ensure-customization` on the same instance answered `writable: false`
 * for it until the server restarted.
 *
 * Pinned here, against a real engine and its own registry:
 *   - the registry's uninstall drops the engine's manifest entry, so the
 *     predicate answers writable again;
 *   - an uninstall the registry REFUSES (ADR-0029: another package extends an
 *     object this one owns) removes nothing, the manifest entry included;
 *   - a reinstall of the same id puts the entry back (read-only again);
 *   - the registry's announcement: once per withdrawn package, never for an id
 *     it does not hold, never after unsubscribe, and a throwing listener does
 *     not turn a completed uninstall into a refused one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWritablePackage } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { SchemaRegistry } from './registry.js';

const PKG = 'com.example.tasksapp';

function manifestsOf(engine: ObjectQL): Map<string, unknown> {
  return (engine as unknown as { manifests: Map<string, unknown> }).manifests;
}

function bootWithPackage(): ObjectQL {
  const engine = new ObjectQL();
  engine.registerApp({
    id: PKG,
    namespace: 'tasks_app',
    objects: [{ name: 'tasks_app_task', fields: { name: { type: 'text' } } }],
  } as any);
  return engine;
}

describe('ObjectQL — an uninstall forgets the package\'s manifest (#30215)', () => {
  it('reads a registered code package as read-only, and writable once the registry uninstalls it', () => {
    const engine = bootWithPackage();
    expect(manifestsOf(engine).has(PKG)).toBe(true);
    expect(isWritablePackage(engine, PKG)).toBe(false);

    expect(engine.registry.uninstallPackage(PKG)).toBe(true);

    expect(engine.registry.getPackage(PKG)).toBeUndefined();
    expect(manifestsOf(engine).has(PKG)).toBe(false);
    expect(isWritablePackage(engine, PKG)).toBe(true);
  });

  it('keeps the manifest entry when the registry refuses the uninstall (an extended object)', () => {
    const engine = bootWithPackage();
    engine.registry.registerObject(
      { name: 'tasks_app_task', fields: {} } as any, 'com.example.addon', undefined, 'extend',
    );

    expect(() => engine.registry.uninstallPackage(PKG)).toThrow();

    expect(engine.registry.getPackage(PKG)).toBeDefined();
    expect(manifestsOf(engine).has(PKG)).toBe(true);
    expect(isWritablePackage(engine, PKG)).toBe(false);
  });

  it('puts the entry back on a reinstall of the same id', () => {
    const engine = bootWithPackage();
    engine.registry.uninstallPackage(PKG);
    expect(isWritablePackage(engine, PKG)).toBe(true);

    engine.registerApp({
      id: PKG,
      namespace: 'tasks_app',
      objects: [{ name: 'tasks_app_task', fields: { name: { type: 'text' } } }],
    } as any);

    expect(manifestsOf(engine).has(PKG)).toBe(true);
    expect(isWritablePackage(engine, PKG)).toBe(false);
  });

  it('leaves every other package\'s manifest entry in place', () => {
    const engine = bootWithPackage();
    engine.registerApp({ id: 'com.example.notesapp', namespace: 'notes_app' } as any);

    engine.registry.uninstallPackage(PKG);

    expect(manifestsOf(engine).has('com.example.notesapp')).toBe(true);
    expect(isWritablePackage(engine, 'com.example.notesapp')).toBe(false);
  });
});

describe('SchemaRegistry.onPackageUninstalled (#30215)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function registryWith(id: string): SchemaRegistry {
    const registry = new SchemaRegistry();
    registry.installPackage({ id, name: id, version: '1.0.0', type: 'app' } as any, 'code');
    return registry;
  }

  it('announces a withdrawn package once, after its record is gone', () => {
    const registry = registryWith(PKG);
    const seen: Array<{ id: string; recordGone: boolean }> = [];
    registry.onPackageUninstalled((id) => {
      seen.push({ id, recordGone: registry.getPackage(id) === undefined });
    });

    registry.uninstallPackage(PKG);
    registry.uninstallPackage(PKG); // nothing left to withdraw

    expect(seen).toEqual([{ id: PKG, recordGone: true }]);
  });

  it('announces nothing for an id the registry does not hold, or after unsubscribe', () => {
    const registry = registryWith(PKG);
    const listener = vi.fn();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsubscribe = registry.onPackageUninstalled(listener);

    registry.uninstallPackage('com.example.never-installed');
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
    registry.uninstallPackage(PKG);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener neither refuses the uninstall nor starves the next listener, and is logged at error', () => {
    const registry = registryWith(PKG);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const next = vi.fn();
    registry.onPackageUninstalled(() => { throw new Error('boom'); });
    registry.onPackageUninstalled(next);

    expect(registry.uninstallPackage(PKG)).toBe(true);

    expect(registry.getPackage(PKG)).toBeUndefined();
    expect(next).toHaveBeenCalledWith(PKG);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain(`package "${PKG}" was uninstalled`);
    expect(String(error.mock.calls[0][0])).toContain('boom');
  });
});
