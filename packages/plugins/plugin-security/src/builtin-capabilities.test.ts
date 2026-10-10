// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, ADR-0066 D1] The curated platform capabilities, declared from
 * the spec list. The expected values come from `PLATFORM_CAPABILITIES`, never
 * from the module under test.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityDeclarationSchema, PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import {
  isPlatformCapabilityDeclaration,
  registerBuiltinCapabilities,
  securityBuiltinCapabilities,
  withoutPlatformCapabilityDeclarations,
  withoutPlatformCapabilityItems,
} from './builtin-capabilities.js';
import { SECURITY_PLUGIN_ID } from './manifest.js';
import { readDeclaredCapabilityContext } from './declared-capability-context.js';

describe('securityBuiltinCapabilities', () => {
  it('is the spec’s curated list itself, not a copy', () => {
    expect(securityBuiltinCapabilities).toBe(PLATFORM_CAPABILITIES);
  });

  it('is a valid capability declaration, every curated entry', () => {
    for (const declaration of securityBuiltinCapabilities) {
      expect(CapabilityDeclarationSchema.safeParse(declaration).success, declaration.name).toBe(true);
    }
  });
});

describe('registerBuiltinCapabilities', () => {
  it('registers each curated entry as a `capability`, keyed by name, under the owning package, with its four fields', () => {
    const calls: Array<[string, Record<string, unknown>, string, string | undefined]> = [];
    const registry = {
      registerItem(type: string, item: Record<string, unknown>, keyField: string, packageId?: string) {
        // The real registry stamps provenance onto the object it is handed.
        item._packageId = packageId;
        calls.push([type, item, keyField, packageId]);
      },
    };
    expect(registerBuiltinCapabilities(registry, 'com.example.owner')).toBe(PLATFORM_CAPABILITIES.length);
    expect(calls.map(([type, , keyField, packageId]) => [type, keyField, packageId])).toEqual(
      PLATFORM_CAPABILITIES.map(() => ['capability', 'name', 'com.example.owner']),
    );
    expect(calls.map(([, item]) => item)).toEqual(
      PLATFORM_CAPABILITIES.map((c) => ({ ...c, _packageId: 'com.example.owner' })),
    );
    // Each registration got its own copy: the spec list carries no stamp.
    for (const declaration of PLATFORM_CAPABILITIES) expect(declaration).not.toHaveProperty('_packageId');
  });

  it('registers nothing, and says so with 0, when there is no registration seam', () => {
    expect(registerBuiltinCapabilities(undefined, 'com.example.owner')).toBe(0);
    expect(registerBuiltinCapabilities({}, 'com.example.owner')).toBe(0);
  });
});

const curated = PLATFORM_CAPABILITIES[0]!.name;
const OWN = { name: curated, _packageId: SECURITY_PLUGIN_ID };
const FOREIGN_CURATED = { name: curated, _packageId: 'com.example.other' };
const PACKAGE_DECLARED = { name: 'field.export', _packageId: 'com.example.other' };
const OWN_NON_CURATED = { name: 'field.export', _packageId: SECURITY_PLUGIN_ID };

describe('isPlatformCapabilityDeclaration', () => {
  it('is this plugin’s declaration of a curated name, and nothing else', () => {
    expect(isPlatformCapabilityDeclaration(OWN)).toBe(true);
    for (const item of [FOREIGN_CURATED, PACKAGE_DECLARED, OWN_NON_CURATED, { name: curated }, null, undefined, curated]) {
      expect(isPlatformCapabilityDeclaration(item)).toBe(false);
    }
  });

  it('drops only those from a list', () => {
    expect(withoutPlatformCapabilityItems([OWN, FOREIGN_CURATED, PACKAGE_DECLARED, OWN_NON_CURATED])).toEqual(
      [FOREIGN_CURATED, PACKAGE_DECLARED, OWN_NON_CURATED],
    );
  });
});

describe('withoutPlatformCapabilityDeclarations', () => {
  class FakeRegistry {
    readonly items: Record<string, unknown[]> = {
      capability: [OWN, FOREIGN_CURATED, PACKAGE_DECLARED],
      permission: [OWN],
    };
    listItems(type: string): unknown[] {
      return this.items[type] ?? [];
    }
    getItem(type: string, name: string): unknown {
      return (this.items[type] ?? []).find((i) => (i as { name?: unknown }).name === name);
    }
  }
  class FakeEngine {
    registry = new FakeRegistry();
    #inserted: unknown[] = [];
    async insert(object: string, row: unknown): Promise<unknown> {
      this.#inserted.push([object, row]);
      return row;
    }
    inserted(): unknown[] {
      return this.#inserted;
    }
  }

  it('lists every capability but this plugin’s curated declarations, and every other type as it is', () => {
    const engine = new FakeEngine();
    const view = withoutPlatformCapabilityDeclarations(engine);
    expect(view.registry.listItems('capability')).toEqual([FOREIGN_CURATED, PACKAGE_DECLARED]);
    expect(view.registry.listItems('permission')).toEqual([OWN]);
    expect(view.registry.getItem('capability', curated)).toBe(OWN);
    // The engine itself is untouched.
    expect(engine.registry.listItems('capability')).toEqual([OWN, FOREIGN_CURATED, PACKAGE_DECLARED]);
  });

  it('forwards every other member to the engine itself, private state included', async () => {
    const engine = new FakeEngine();
    const view = withoutPlatformCapabilityDeclarations(engine);
    await view.insert('sys_capability', { name: 'x' });
    expect(engine.inserted()).toEqual([['sys_capability', { name: 'x' }]]);
  });

  it('returns an engine with no listing registry as it is', () => {
    const bare = { insert: async () => undefined };
    expect(withoutPlatformCapabilityDeclarations(bare)).toBe(bare);
    expect(withoutPlatformCapabilityDeclarations(undefined)).toBeUndefined();
  });
});

describe('readDeclaredCapabilityContext, beside the curated declarations', () => {
  const APP = { name: 'field.export', _packageId: 'com.example.field' };
  const engineWith = (capabilities: unknown[]) => ({ registry: { listItems: (type: string) => (type === 'capability' ? capabilities : []) } });

  it('still falls back to the metadata service when the registry holds only the platform’s curated declarations', async () => {
    const metadata = { list: async (type: string) => (type === 'capability' ? [APP] : []) };
    expect(await readDeclaredCapabilityContext(engineWith([OWN]), metadata)).toEqual({ declaredCapabilities: [APP] });
    expect(await readDeclaredCapabilityContext(engineWith([OWN]), { list: async () => [] })).toBeUndefined();
  });

  it('reads the registry’s package declarations without the curated ones', async () => {
    expect(await readDeclaredCapabilityContext(engineWith([OWN, APP]), undefined)).toEqual({ declaredCapabilities: [APP] });
  });
});
