// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  createSecurityCatalogReader,
  type SecurityCatalogMetadataService,
  type SecurityCatalogRegistry,
} from './security-catalog.js';
import { isAuthzStoreUnavailableError } from './authz-store-unavailable.js';

/**
 * ADR-0131 D2–D4 — the catalog read's own rules, over stand-in readers.
 *
 * What the real readers answer (a name a second package is refused, so every
 * reader answers its one holder; the sets a booted showcase holds) is pinned
 * against the real readers elsewhere: the `security catalog read — a name two
 * packages ship` describe in `packages/objectql/src/protocol-boot-hydration-scoped.test.ts`
 * (the refusal itself, door by door: `registry-security-catalog-namespace.test.ts`
 * beside it) and `packages/qa/dogfood/test/security-catalog-showcase.dogfood.test.ts`.
 * Here: the read order, the union, the disabled-package rule, and that a read
 * which did not happen is never reported as "no such item".
 */

type Def = Record<string, unknown>;

interface RegistryOptions {
  disabled?: readonly string[];
  getItem?: (type: string, name: string) => unknown;
  listItems?: (type: string) => readonly unknown[];
}

/** First-registered-wins by name, and a list that hides disabled packages — the registry's own two rules. */
function registry(items: Record<string, Def[]>, opts: RegistryOptions = {}): SecurityCatalogRegistry {
  const disabled = new Set(opts.disabled ?? []);
  const isPackageDisabled = (pkg?: string) => (pkg ? disabled.has(pkg) : false);
  return {
    getItem: opts.getItem ?? ((type, name) => (items[type] ?? []).find((d) => d.name === name)),
    listItems:
      opts.listItems
      ?? ((type) => (items[type] ?? []).filter((d) => !isPackageDisabled(d._packageId as string | undefined))),
    isPackageDisabled,
  };
}

function metadata(items: Record<string, Def[]>, over: Partial<SecurityCatalogMetadataService> = {}): SecurityCatalogMetadataService {
  return {
    async get(type, name) {
      return (items[type] ?? []).find((d) => d.name === name);
    },
    async list(type) {
      return items[type] ?? [];
    },
    ...over,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the read to reject, and it resolved');
}

describe('security catalog read — the read order and the union', () => {
  it('a name both readers hold is answered by the engine registry', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({ permission: [{ name: 'sales', label: 'from the registry', _packageId: 'com.acme' }] }),
      metadata: metadata({ permission: [{ name: 'sales', label: 'from the metadata service' }] }),
    });
    const entry = await reader.resolve('permission', 'sales');
    expect(entry?.source).toBe('registry');
    expect(entry?.definition.label).toBe('from the registry');
    expect(entry?.packageId).toBe('com.acme');
  });

  it('a name only the metadata service holds is answered by it (stack-declared positions)', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({ position: [{ name: 'manager', label: 'Manager' }] }),
    });
    const entry = await reader.resolve('position', 'manager');
    expect(entry).toMatchObject({ type: 'position', name: 'manager', source: 'metadata' });
    expect(entry?.packageId).toBeUndefined();
  });

  it('a name neither reader holds resolves to nothing and is not listed', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({ capability: [{ name: 'export_data' }] }),
      metadata: metadata({ capability: [{ name: 'export_data' }] }),
    });
    expect(await reader.resolve('capability', 'nobody_declared_this')).toBeUndefined();
    expect((await reader.list('capability')).map((e) => e.name)).toEqual(['export_data']);
  });

  it('list gives one entry per name across both readers, each the entry resolve answers', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({
        permission: [
          { name: 'admin_full_access', _packageId: 'com.objectstack.plugin-security' },
          { name: 'shared', label: 'registry body', _packageId: 'com.acme' },
        ],
      }),
      metadata: metadata({
        permission: [
          { name: 'shared', label: 'metadata body', _packageId: 'com.acme' },
          { name: 'declared_only', label: 'metadata only' },
        ],
      }),
    });
    const listed = await reader.list('permission');
    expect(listed.map((e) => [e.name, e.source])).toEqual([
      ['admin_full_access', 'registry'],
      ['shared', 'registry'],
      ['declared_only', 'metadata'],
    ]);
    for (const entry of listed) {
      expect(await reader.resolve('permission', entry.name)).toEqual(entry);
    }
  });

  it('an entry states existence only: no activation member, whatever the definition carries', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({ permission: [{ name: 'sales', _packageId: 'com.acme' }] }),
      metadata: metadata({}),
    });
    const entry = await reader.resolve('permission', 'sales');
    expect(Object.keys(entry ?? {}).sort()).toEqual(['definition', 'name', 'packageId', 'source', 'type']);
  });
});

describe('security catalog read — a disabled package\'s definition answers neither read', () => {
  it('the registry\'s list rule holds for the by-name read too', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry(
        { permission: [{ name: 'vendor_set', _packageId: 'com.vendor' }, { name: 'kept', _packageId: 'com.acme' }] },
        { disabled: ['com.vendor'] },
      ),
      metadata: metadata({}),
    });
    expect(await reader.resolve('permission', 'vendor_set')).toBeUndefined();
    expect((await reader.list('permission')).map((e) => e.name)).toEqual(['kept']);
  });

  it('a metadata-service copy owned by the disabled package is not served either', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({ permission: [{ name: 'vendor_set', _packageId: 'com.vendor' }] }, { disabled: ['com.vendor'] }),
      metadata: metadata({ permission: [{ name: 'vendor_set', _packageId: 'com.vendor' }] }),
    });
    expect(await reader.resolve('permission', 'vendor_set')).toBeUndefined();
    expect(await reader.list('permission')).toEqual([]);
  });
});

describe('security catalog read — a read that did not happen is loud, never "no such item"', () => {
  const expectUnavailable = (error: unknown) => {
    expect(isAuthzStoreUnavailableError(error)).toBe(true);
    expect((error as { code?: unknown }).code).toBe('SERVICE_UNAVAILABLE');
    expect((error as { status?: unknown }).status).toBe(503);
  };

  it('a registry read that throws', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}, {
        getItem: () => { throw new Error('registry torn'); },
        listItems: () => { throw new Error('registry torn'); },
      }),
      metadata: metadata({}),
    });
    expectUnavailable(await rejection(reader.resolve('permission', 'admin_full_access')));
    expectUnavailable(await rejection(reader.list('permission')));
  });

  it('a metadata read that throws', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({}, {
        get: async () => { throw new Error('loader down'); },
        list: async () => { throw new Error('loader down'); },
      }),
    });
    expectUnavailable(await rejection(reader.resolve('position', 'manager')));
    expectUnavailable(await rejection(reader.list('position')));
  });

  it('a metadata read that lost a loader and found nothing', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({}, {
        getDiagnosed: async () => ({ data: undefined, degraded: true, errors: ['db loader: connection refused'] }),
        listDiagnosed: async () => ({ items: [{ name: 'manager' }], degraded: true, errors: ['db loader: connection refused'] }),
      }),
    });
    expectUnavailable(await rejection(reader.resolve('position', 'manager')));
    // A list that lost a loader is partial even when another loader answered.
    expectUnavailable(await rejection(reader.list('position')));
  });

  it('control: a clean miss is a miss, and a degraded read that found the item serves it', async () => {
    const clean = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({}, { getDiagnosed: async () => ({ data: undefined, degraded: false, errors: [] }) }),
    });
    expect(await clean.resolve('position', 'manager')).toBeUndefined();

    const found = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({}, { getDiagnosed: async () => ({ data: { name: 'manager' }, degraded: true, errors: ['x'] }) }),
    });
    expect((await found.resolve('position', 'manager'))?.name).toBe('manager');
  });
});

describe('security catalog read — refusals at the edge', () => {
  it('construction refuses a missing reader, naming what that reader holds', () => {
    const md = metadata({});
    expect(() => createSecurityCatalogReader({ registry: undefined as never, metadata: md })).toThrow(TypeError);
    expect(() => createSecurityCatalogReader({ registry: registry({}), metadata: undefined as never })).toThrow(
      TypeError,
    );
    expect(() => createSecurityCatalogReader({ registry: registry({}), metadata: { get: md.get } as never })).toThrow(
      TypeError,
    );
  });

  it('a type outside the catalog is refused, not answered empty', async () => {
    const reader = createSecurityCatalogReader({ registry: registry({}), metadata: metadata({}) });
    await expect(reader.resolve('view' as never, 'x')).rejects.toBeInstanceOf(TypeError);
    await expect(reader.list('object' as never)).rejects.toBeInstanceOf(TypeError);
  });

  it('an empty or non-string name names nothing', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({ permission: [{ name: 'sales' }] }),
      metadata: metadata({}),
    });
    expect(await reader.resolve('permission', '')).toBeUndefined();
    expect(await reader.resolve('permission', undefined as never)).toBeUndefined();
  });
});
