// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D2, ADR-0090 D5] The six built-in positions, and the `everyone`
 * anchor's deployment baseline, are declared in `init()` — the kernel
 * contract's declaration phase.
 *
 * A boot that composes this plugin for its declarations only runs `init()` and
 * no `start()` and no hook; `os migrate organization-ownership --apply`
 * resolves the position bindings an older release wrote against that boot's
 * catalog. Each case here runs `init()` ALONE, over a real engine registry, and
 * reads through core's security catalog reader — the read the ceremony and the
 * authorization resolver both make.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { createSecurityCatalogReader } from '@objectstack/core';
import { AUDIENCE_ANCHOR_POSITIONS, BUILTIN_IDENTITY_NAMES, EVERYONE_POSITION } from '@objectstack/spec';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { SECURITY_PLUGIN_ID } from './manifest.js';

const NOT_DECLARED = 'were NOT declared as position metadata';
const WITHHELD = 'the everyone anchor does not name a baseline set';

/** `init()` alone, with the engine registry the plugin declares to. */
async function initOnly(plugin: SecurityPlugin, engine: unknown) {
  const hook = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (name === 'manifest') return { register: vi.fn() };
      if (name === 'objectql' && engine !== undefined) return engine;
      throw new Error(`service not registered: ${name}`);
    },
    hook,
  };
  await plugin.init(ctx);
  const warned = (text: string) => ctx.logger.warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes(text)).length;
  return { ctx, warned };
}

const catalogOf = (engine: ObjectQL) =>
  createSecurityCatalogReader({
    registry: (engine as any).registry,
    metadata: { get: async () => undefined, list: async () => [] },
  });

describe('the built-in positions and the everyone baseline, after init() alone', () => {
  it('resolves all six built-in positions, owned by this plugin', async () => {
    const engine = new ObjectQL();
    const { warned } = await initOnly(new SecurityPlugin(), engine);
    const catalog = catalogOf(engine);
    for (const name of [...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS]) {
      const entry = await catalog.resolve('position', name);
      expect(entry?.definition.name, name).toBe(name);
      expect(entry?.packageId, name).toBe(SECURITY_PLUGIN_ID);
    }
    expect(warned(NOT_DECLARED)).toBe(0);
  });

  it('names the deployment baseline on everyone: the app’s default set, then member_default', async () => {
    const engine = new ObjectQL();
    await initOnly(new SecurityPlugin({ fallbackPermissionSet: 'field_default' }), engine);
    const everyone = await catalogOf(engine).resolve('position', EVERYONE_POSITION);
    expect(everyone?.definition.permissionSets).toEqual(['field_default', 'member_default']);
  });

  // The declared-capability context is the stack's, and the stack is still
  // declaring while plugins initialize: `init()` takes the fail-closed reading,
  // so a token only a declaration excuses is not named yet — and nothing is
  // reported, because `kernel:ready` derives again with every declaration in
  // (security-plugin.test.ts pins that the excused set is named there).
  it('takes the fail-closed reading: a set whose token only a declaration excuses is not named, and nothing is said', async () => {
    const engine = new ObjectQL();
    (engine as any).registry.registerItem('capability', { name: 'crm.export_pipeline', label: 'Export' }, 'name', 'com.example.app');
    const appDefault = {
      name: 'app_member_default',
      label: 'App Member Default',
      isDefault: true,
      systemPermissions: ['crm.export_pipeline'],
      objects: {},
    } as unknown as PermissionSet;
    const { warned } = await initOnly(new SecurityPlugin({ defaultPermissionSets: [appDefault] }), engine);
    const everyone = await catalogOf(engine).resolve('position', EVERYONE_POSITION);
    expect(everyone?.definition.permissionSets).toEqual(['member_default']);
    expect(warned(WITHHELD)).toBe(0);
  });

  it('says so when the engine exposes no registry that can register them', async () => {
    const { warned } = await initOnly(new SecurityPlugin(), { registerMiddleware: () => {} });
    expect(warned(NOT_DECLARED)).toBe(1);
  });

  it('declares nothing and says nothing when no engine is registered: start() reports that', async () => {
    const { warned } = await initOnly(new SecurityPlugin(), undefined);
    expect(warned(NOT_DECLARED)).toBe(0);
  });
});
