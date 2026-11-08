// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  createSecurityCatalogReader,
  resolveCatalogReference,
  type SecurityCatalogEntry,
  type SecurityCatalogMetadataService,
  type SecurityCatalogPackageScope,
  type SecurityCatalogRegistry,
  type SecurityCatalogScopedOutcome,
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

/**
 * [ADR-0150 D3/D4/D7] Permission sets by `(package, name)`: the plumbing
 * around the injected resolver, over a stand-in scope that records who asked.
 * The resolver's own answers over the real registry are pinned in
 * plugin-security's `security-catalog-package-scope.test.ts`.
 */
describe('security catalog read — permission sets by (package, name) through the package scope', () => {
  interface Asked { name: string; caller: string | null }

  /** A scope answering `answers[name]` (default not-found), recording every question. */
  function scope(
    answers: Record<string, SecurityCatalogScopedOutcome> = {},
    opts: { holders?: Record<string, Array<{ packageId: string | null; item: unknown }>>; shipped?: (name: string, pkg: string) => boolean } = {},
  ): SecurityCatalogPackageScope & { asked: Asked[] } {
    const asked: Asked[] = [];
    return {
      asked,
      resolvePermissionSet(name, caller) {
        asked.push({ name, caller });
        return answers[name] ?? { status: 'not-found' };
      },
      permissionSetHolders: (name) => opts.holders?.[name] ?? [],
      isPackageItem: (_type, name, pkg) => opts.shipped?.(name, pkg) ?? true,
    };
  }

  const positionEntry = (over: Partial<SecurityCatalogEntry> & { name: string }): SecurityCatalogEntry => ({
    type: 'position',
    definition: { name: over.name },
    source: 'registry',
    ...over,
  });

  it('a refusal confers nothing, names every candidate, and never falls back to the registry or the metadata service', async () => {
    const refused: SecurityCatalogScopedOutcome = {
      status: 'refused', reason: 'outside-closure', candidates: ['package "com.acme.q"', 'the environment'], message: 'refused: both named',
    };
    const reader = createSecurityCatalogReader({
      registry: registry({ permission: [{ name: 'q_set', _packageId: 'com.acme.q' }] }),
      metadata: metadata({ permission: [{ name: 'q_set' }] }),
      packageScope: scope({ q_set: refused }),
    });
    const at = { position: positionEntry({ name: 'p_pos', packageId: 'com.acme.p' }) };
    expect(await reader.resolve('permission', 'q_set', at)).toBeUndefined();
    expect(await resolveCatalogReference(reader, 'permission', 'q_set', at)).toEqual({
      status: 'refused', reason: 'outside-closure', candidates: ['package "com.acme.q"', 'the environment'], message: 'refused: both named',
    });
  });

  it("a package position's set is asked as that package; a stored grant as no package", async () => {
    const s = scope({ p_set: { status: 'resolved', item: { name: 'p_set', _packageId: 'com.acme.p' }, holderPackageId: 'com.acme.p' } });
    const reader = createSecurityCatalogReader({ registry: registry({}), metadata: metadata({}), packageScope: s });
    const entry = await reader.resolve('permission', 'p_set', { position: positionEntry({ name: 'p_pos', packageId: 'com.acme.p' }) });
    expect(entry?.packageId).toBe('com.acme.p');
    await reader.resolve('permission', 'p_set');
    expect(s.asked).toEqual([{ name: 'p_set', caller: 'com.acme.p' }, { name: 'p_set', caller: null }]);
  });

  it("the environment's positions ask as no package: an overlay, an environment row, a stack position with no owner, the audience anchors", async () => {
    const s = scope({}, { shipped: (name) => name !== 'overlaid_pos' });
    const reader = createSecurityCatalogReader({ registry: registry({}), metadata: metadata({}), packageScope: s });
    for (const position of [
      positionEntry({ name: 'overlaid_pos', packageId: 'com.acme.p' }),
      positionEntry({ name: 'env_pos', packageId: 'sys_metadata' }),
      positionEntry({ name: 'stack_pos', source: 'metadata' }),
      positionEntry({ name: 'everyone', packageId: 'com.objectstack.security' }),
      positionEntry({ name: 'guest', packageId: 'com.objectstack.security' }),
    ]) {
      await reader.resolve('permission', 'x', { position });
    }
    expect(s.asked.map((a) => a.caller)).toEqual([null, null, null, null, null]);
  });

  it("a stack-declared position that names its package asks as that package", async () => {
    const s = scope();
    const reader = createSecurityCatalogReader({ registry: registry({}), metadata: metadata({}), packageScope: s });
    await reader.resolve('permission', 'x', { position: positionEntry({ name: 'app_pos', source: 'metadata', packageId: 'com.acme.app' }) });
    expect(s.asked).toEqual([{ name: 'x', caller: 'com.acme.app' }]);
  });

  it("the metadata service answers a name nothing in the registry holds for no package, never for a package's reference", async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({ permission: [{ name: 'declared_set', label: 'from the metadata service' }] }),
      packageScope: scope(),
    });
    expect((await reader.resolve('permission', 'declared_set'))?.source).toBe('metadata');
    expect(
      await reader.resolve('permission', 'declared_set', { position: positionEntry({ name: 'p_pos', packageId: 'com.acme.p' }) }),
    ).toBeUndefined();
  });

  it('a resolved item of a disabled package is not served', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}, { disabled: ['com.acme.off'] }),
      metadata: metadata({}),
      packageScope: scope({ off_set: { status: 'resolved', item: { name: 'off_set', _packageId: 'com.acme.off' }, holderPackageId: 'com.acme.off' } }),
    });
    expect(await reader.resolve('permission', 'off_set')).toBeUndefined();
  });

  it('the permission-set list carries one entry per (package, name) holder, never one picked per name', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({ permission: [{ name: 'shared', _packageId: 'com.acme.a' }] }),
      metadata: metadata({}),
      packageScope: scope({}, {
        holders: {
          shared: [
            { packageId: 'com.acme.a', item: { name: 'shared', _packageId: 'com.acme.a' } },
            { packageId: 'com.acme.b', item: { name: 'shared', _packageId: 'com.acme.b' } },
          ],
        },
      }),
    });
    expect((await reader.list('permission')).map((e) => e.packageId)).toEqual(['com.acme.a', 'com.acme.b']);
  });

  it('positions and capabilities never ask the package scope (ADR-0150 D7; bucket 1)', async () => {
    const s = scope();
    const reader = createSecurityCatalogReader({
      registry: registry({ position: [{ name: 'p_pos' }], capability: [{ name: 'acme.cap' }] }),
      metadata: metadata({}),
      packageScope: s,
    });
    expect((await reader.resolve('position', 'p_pos'))?.name).toBe('p_pos');
    expect((await reader.resolve('capability', 'acme.cap'))?.name).toBe('acme.cap');
    expect(s.asked).toEqual([]);
  });

  it('construction refuses a partial package scope', () => {
    const partial = { resolvePermissionSet: () => ({ status: 'not-found' }) } as never;
    expect(() => createSecurityCatalogReader({ registry: registry({}), metadata: metadata({}), packageScope: partial })).toThrow(TypeError);
  });

  it('a scope that throws is an unreadable catalog, never "no such set"', async () => {
    const reader = createSecurityCatalogReader({
      registry: registry({}),
      metadata: metadata({}),
      packageScope: { ...scope(), resolvePermissionSet: () => { throw new Error('registry gone'); } },
    });
    expect(isAuthzStoreUnavailableError(await rejection(reader.resolve('permission', 'x')))).toBe(true);
  });
});
