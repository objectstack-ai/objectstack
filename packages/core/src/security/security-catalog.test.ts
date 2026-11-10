// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  createSecurityCatalogReader,
  holdsPlatformPermissionSet,
  resolveCatalogReference,
  storedPermissionSetScope,
  type SecurityCatalogEntry,
  type SecurityCatalogMetadataService,
  type SecurityCatalogPackageScopedRegistry,
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

/**
 * [ADR-0150 D3/D4/D7] Permission sets by `(package, name)`: the catalog's own
 * plumbing around the one rule (`resolvePackageScopedHolders`) and the one
 * closure walk (`packageResolutionClosure`), over a stand-in registry that
 * carries the package-scoped reads and records who asked. The answers over
 * ObjectQL's real `SchemaRegistry` are pinned in plugin-security's
 * `security-catalog-permission-sets-by-package.test.ts`.
 */
describe('security catalog read — permission sets by (package, name) through the package-scoped registry', () => {
  interface Held { packageId: string | null; item: Def }
  interface ScopedOptions {
    /** Every holder's item per permission-set name; `packageId: null` is the environment's own item. */
    holders?: Record<string, Held[]>;
    /** Installed packages: id → declared dependencies (and the namespace, `sys` for a kernel package). */
    packages?: Record<string, { deps?: string[]; namespace?: string }>;
    /** Which `(position, package)` pairs are the package's own shipped position. Default: every one. */
    shipped?: (name: string, pkg: string) => boolean;
    disabled?: readonly string[];
    throwOnHolders?: boolean;
  }

  /**
   * The by-name reads of {@link registry}, plus the package-scoped reads a
   * `SchemaRegistry` carries — its served holders too (#32183): a disabled
   * package holds no name, the caller's own holding aside, unless
   * `includeDisabledPackages` asks for every holder.
   */
  function scopedRegistry(
    byName: Record<string, Def[]>,
    opts: ScopedOptions = {},
  ): SecurityCatalogRegistry & SecurityCatalogPackageScopedRegistry & { asked: Array<{ name: string; caller: string | null | undefined }> } {
    const asked: Array<{ name: string; caller: string | null | undefined }> = [];
    const held = (type: string, name: string) => (type === 'permission' ? opts.holders?.[name] ?? [] : []);
    const rows = Object.entries(opts.packages ?? {}).map(([id, p]) => ({
      manifest: { id, namespace: p.namespace ?? id.split('.').pop(), dependencies: Object.fromEntries((p.deps ?? []).map((d) => [d, '^1.0.0'])) },
    }));
    return {
      ...registry(byName, { disabled: opts.disabled }),
      asked,
      packageScopedHoldersOf(type, name, caller, options) {
        if (opts.throwOnHolders) throw new Error('registry gone');
        // `asked` records the rule's reads; the every-holder read is not the rule asked.
        if (type === 'permission' && options?.includeDisabledPackages !== true) asked.push({ name, caller });
        const disabled = new Set(opts.disabled ?? []);
        return held(type, name).filter((h) => h.packageId !== null).map((h) => h.packageId as string)
          .filter((id) => options?.includeDisabledPackages === true || id === caller || !disabled.has(id));
      },
      getPackageScopedItem: (type, name, packageId) => held(type, name).find((h) => h.packageId === packageId)?.item,
      getEnvironmentScopedItem: (type, name) => held(type, name).find((h) => h.packageId === null)?.item,
      getArtifactItem: (_type, name, pkg) => (opts.shipped?.(name, pkg as string) ?? true ? SHIPPED : undefined),
      getPackage: (id) => rows.find((r) => r.manifest.id === id),
      getAllPackages: () => rows,
    };
  }

  /** The one definition every stand-in position below uses, so `getArtifactItem` can answer "shipped" by identity. */
  const SHIPPED: Def = { name: 'shipped_position' };
  const positionEntry = (over: Partial<SecurityCatalogEntry> & { name: string }): SecurityCatalogEntry => ({
    type: 'position',
    definition: SHIPPED,
    source: 'registry',
    ...over,
  });
  const P = 'com.acme.p';
  const Q = 'com.acme.q';
  const at = (packageId = P) => ({ position: positionEntry({ name: 'p_pos', packageId }) });

  it('a refusal confers nothing, names every candidate, and never falls back to the by-name read or the metadata service', async () => {
    const reader = createSecurityCatalogReader({
      registry: scopedRegistry(
        { permission: [{ name: 'q_set', _packageId: Q }] },
        { packages: { [P]: {}, [Q]: {} }, holders: { q_set: [{ packageId: Q, item: { name: 'q_set', _packageId: Q } }, { packageId: null, item: { name: 'q_set' } }] } },
      ),
      metadata: metadata({ permission: [{ name: 'q_set' }] }),
    });
    expect(await reader.resolve('permission', 'q_set', at())).toBeUndefined();
    const answer = await resolveCatalogReference(reader, 'permission', 'q_set', at());
    expect(answer).toMatchObject({ status: 'refused', reason: 'outside-closure' });
    if (answer.status !== 'refused') return;
    expect(answer.candidates).toEqual([expect.stringContaining(Q), expect.stringContaining('the environment')]);
    expect(answer.message).toContain(P);
  });

  it('a name two packages in the closure hold is refused, naming both; with no package, environment-wide, naming both', async () => {
    const two = {
      packages: { [P]: { deps: [Q, 'com.acme.r'] }, [Q]: {}, 'com.acme.r': {} },
      holders: { shared: [{ packageId: Q, item: { name: 'shared', _packageId: Q } }, { packageId: 'com.acme.r', item: { name: 'shared', _packageId: 'com.acme.r' } }] },
    };
    const reader = createSecurityCatalogReader({ registry: scopedRegistry({}, two), metadata: metadata({}) });
    for (const [scope, reason] of [[at(), 'ambiguous-in-closure'], [undefined, 'ambiguous-in-environment']] as const) {
      const answer = await resolveCatalogReference(reader, 'permission', 'shared', scope);
      expect(answer).toMatchObject({ status: 'refused', reason });
      if (answer.status === 'refused') expect(answer.candidates).toEqual([expect.stringContaining(Q), expect.stringContaining('com.acme.r')]);
    }
  });

  it("a package position's set is asked as that package and reaches its own and its declared dependency's; a stored grant asks as no package", async () => {
    const r = scopedRegistry({}, {
      packages: { [P]: { deps: [Q] }, [Q]: {} },
      holders: {
        p_set: [{ packageId: P, item: { name: 'p_set', _packageId: P } }],
        q_set: [{ packageId: Q, item: { name: 'q_set', _packageId: Q } }],
      },
    });
    const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
    expect((await reader.resolve('permission', 'p_set', at()))?.packageId).toBe(P);
    expect((await reader.resolve('permission', 'q_set', at()))?.packageId).toBe(Q);
    expect((await reader.resolve('permission', 'p_set'))?.packageId).toBe(P);
    expect(r.asked).toEqual([{ name: 'p_set', caller: P }, { name: 'q_set', caller: P }, { name: 'p_set', caller: null }]);
  });

  it("the environment's positions ask as no package: an overlay, an environment row, a stack position with no owner, the audience anchors", async () => {
    const r = scopedRegistry({}, { shipped: (name) => name !== 'overlaid_pos' });
    const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
    for (const position of [
      positionEntry({ name: 'overlaid_pos', packageId: P }),
      positionEntry({ name: 'env_pos', packageId: 'sys_metadata' }),
      positionEntry({ name: 'stack_pos', source: 'metadata' }),
      positionEntry({ name: 'everyone', packageId: 'com.objectstack.security' }),
      positionEntry({ name: 'guest', packageId: 'com.objectstack.security' }),
    ]) {
      await reader.resolve('permission', 'x', { position });
    }
    expect(r.asked.map((a) => a.caller)).toEqual([null, null, null, null, null]);
  });

  it('a stack-declared position that names its package asks as that package', async () => {
    const r = scopedRegistry({});
    const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
    await reader.resolve('permission', 'x', { position: positionEntry({ name: 'app_pos', source: 'metadata', packageId: 'com.acme.app' }) });
    expect(r.asked).toEqual([{ name: 'x', caller: 'com.acme.app' }]);
  });

  it("a name the registry holds nowhere: the metadata service's body serves a caller with no package, and a package's reference is the D3 (a) refusal naming the environment", async () => {
    const reader = createSecurityCatalogReader({
      registry: scopedRegistry({}, { packages: { [P]: {} } }),
      metadata: metadata({ permission: [{ name: 'declared_set', label: 'from the metadata service' }] }),
    });
    expect((await reader.resolve('permission', 'declared_set'))?.source).toBe('metadata');
    expect(await reader.resolve('permission', 'declared_set', at())).toBeUndefined();
    const answer = await resolveCatalogReference(reader, 'permission', 'declared_set', at());
    expect(answer).toMatchObject({ status: 'refused', reason: 'outside-closure', candidates: [expect.stringContaining('the environment')] });
    if (answer.status === 'refused') {
      expect(answer.message).toContain(P);
      expect(answer.message).toContain('declared_set');
    }
    expect(await resolveCatalogReference(reader, 'permission', 'nowhere_set', at())).toEqual({ status: 'not-found' });
  });

  it("a resolved holder that may not be served (a disabled package's set) is final: not-found, never a by-name metadata-service read", async () => {
    const reader = createSecurityCatalogReader({
      registry: scopedRegistry({}, { disabled: ['com.acme.off'], holders: { off_set: [{ packageId: 'com.acme.off', item: { name: 'off_set', _packageId: 'com.acme.off' } }] } }),
      metadata: metadata({ permission: [{ name: 'off_set', label: 'a metadata-service body of that name' }] }),
    });
    expect(await reader.resolve('permission', 'off_set')).toBeUndefined();
    expect(await resolveCatalogReference(reader, 'permission', 'off_set')).toEqual({ status: 'not-found' });
    expect(await reader.resolve('permission', 'off_set', at())).toBeUndefined();
  });

  it('the permission-set list carries one entry per (package, name) holder, never one picked per name', async () => {
    const reader = createSecurityCatalogReader({
      registry: scopedRegistry({ permission: [{ name: 'shared', _packageId: 'com.acme.a' }] }, {
        holders: {
          shared: [
            { packageId: 'com.acme.a', item: { name: 'shared', _packageId: 'com.acme.a' } },
            { packageId: 'com.acme.b', item: { name: 'shared', _packageId: 'com.acme.b' } },
          ],
        },
      }),
      metadata: metadata({}),
    });
    expect((await reader.list('permission')).map((e) => e.packageId)).toEqual(['com.acme.a', 'com.acme.b']);
  });

  it('positions and capabilities are read by name, never through the package-scoped reads (ADR-0150 D7; bucket 1)', async () => {
    const r = scopedRegistry({ position: [{ name: 'p_pos' }], capability: [{ name: 'acme.cap' }] });
    const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
    expect((await reader.resolve('position', 'p_pos'))?.name).toBe('p_pos');
    expect((await reader.resolve('capability', 'acme.cap'))?.name).toBe('acme.cap');
    expect(r.asked).toEqual([]);
  });

  it('construction refuses a registry carrying only some of the package-scoped reads', () => {
    const partial = { ...registry({}), packageScopedHoldersOf: () => [] } as never;
    expect(() => createSecurityCatalogReader({ registry: partial, metadata: metadata({}) })).toThrow(TypeError);
    const noArtifactRead = { ...scopedRegistry({}), getArtifactItem: undefined } as never;
    expect(() => createSecurityCatalogReader({ registry: noArtifactRead, metadata: metadata({}) })).toThrow(TypeError);
  });

  it('a by-name registry carrying only the artifact or package reads is still read by name', async () => {
    const byName = { ...registry({ permission: [{ name: 'x', _packageId: P }] }), getArtifactItem: () => undefined, getPackage: () => undefined, getAllPackages: () => [] };
    const reader = createSecurityCatalogReader({ registry: byName, metadata: metadata({}) });
    expect((await reader.resolve('permission', 'x', at()))?.packageId).toBe(P);
  });

  it('a package-scoped read that throws is an unreadable catalog, never "no such set"', async () => {
    const reader = createSecurityCatalogReader({ registry: scopedRegistry({}, { throwOnHolders: true }), metadata: metadata({}) });
    expect(isAuthzStoreUnavailableError(await rejection(reader.resolve('permission', 'x')))).toBe(true);
    expect(isAuthzStoreUnavailableError(await rejection(reader.resolve('permission', 'x', at())))).toBe(true);
  });

  // [ADR-0150 D8 R1/R3] A stored reference read by its package column.
  describe('a stored reference read by its package column', () => {
    const R = 'com.acme.r';
    /** `shared` held by Q and R (a pre-phase-1 clash); `q_only` by Q alone; `env_set` by the environment. */
    const stored = () => scopedRegistry(
      { permission: [{ name: 'shared', _packageId: Q }, { name: 'q_only', _packageId: Q }] },
      {
        packages: { [P]: { deps: [Q] }, [Q]: {}, [R]: {} },
        holders: {
          shared: [{ packageId: Q, item: { name: 'shared', _packageId: Q, label: 'Q' } }, { packageId: R, item: { name: 'shared', _packageId: R, label: 'R' } }],
          q_only: [{ packageId: Q, item: { name: 'q_only', _packageId: Q } }],
          env_set: [{ packageId: null, item: { name: 'env_set' } }],
        },
      },
    );

    it('a column naming a holder reads that package\'s set and no other, even where the bare name is refused', async () => {
      const reader = createSecurityCatalogReader({ registry: stored(), metadata: metadata({}) });
      expect((await reader.resolve('permission', 'shared', storedPermissionSetScope(Q)))?.definition.label).toBe('Q');
      expect((await reader.resolve('permission', 'shared', storedPermissionSetScope(R)))?.definition.label).toBe('R');
      expect(await resolveCatalogReference(reader, 'permission', 'shared')).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
    });

    it('a stale column (its package no longer serves the set) reads as a null one: one holder grants, two are refused naming both — said once', async () => {
      const warn = vi.fn();
      const reader = createSecurityCatalogReader({
        registry: stored(),
        metadata: metadata({ permission: [{ name: 'meta_only' }] }),
        logger: { warn },
      });
      const gone = storedPermissionSetScope('com.acme.gone');
      // The set moved to Q on an upgrade: the grant follows it, as an unbound one does.
      expect((await reader.resolve('permission', 'q_only', gone))?.packageId).toBe(Q);
      expect((await reader.resolve('permission', 'env_set', gone))?.definition).toEqual({ name: 'env_set' });
      expect((await reader.resolve('permission', 'meta_only', gone))?.definition).toEqual({ name: 'meta_only' });
      // ⛔ Two holders: refused, naming both — never the first registered.
      const answer = await resolveCatalogReference(reader, 'permission', 'shared', gone);
      expect(answer).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
      if (answer.status === 'refused') expect(answer.candidates).toEqual([expect.stringContaining(Q), expect.stringContaining(R)]);
      // R3: a stale column is read from the writer, as its null column is.
      expect((await reader.resolve('permission', 'shared', storedPermissionSetScope('com.acme.gone', P)))?.definition.label).toBe('Q');
      // Said once per (package, name), however often it is read.
      await reader.resolve('permission', 'q_only', gone);
      expect(warn.mock.calls.map(([, meta]) => `${meta.packageId}:${meta.name}`)).toEqual([
        'com.acme.gone:q_only', 'com.acme.gone:env_set', 'com.acme.gone:meta_only', 'com.acme.gone:shared',
      ]);
      expect(warn.mock.calls[0][0]).toContain('os migrate stored-references');
      expect(warn.mock.calls[0][0]).toContain(`package "${Q}"'s set`);
      expect(warn.mock.calls[3][0]).toContain('it is refused');
    });

    it('a null column with two or more holders is refused, naming every candidate — never the first registered', async () => {
      const r = stored();
      const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
      expect(storedPermissionSetScope(null)).toBeUndefined();
      expect(await reader.resolve('permission', 'shared', storedPermissionSetScope(null))).toBeUndefined();
      const answer = await resolveCatalogReference(reader, 'permission', 'shared', storedPermissionSetScope(''));
      expect(answer).toMatchObject({ status: 'refused', reason: 'ambiguous-in-environment' });
      if (answer.status === 'refused') expect(answer.candidates).toEqual([expect.stringContaining(Q), expect.stringContaining(R)]);
    });

    it('a null column with one holder resolves by D3, as today; a writer\'s package is the D3 caller (R3)', async () => {
      const r = stored();
      const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
      expect((await reader.resolve('permission', 'q_only', storedPermissionSetScope(null)))?.packageId).toBe(Q);
      expect((await reader.resolve('permission', 'env_set', storedPermissionSetScope(undefined)))?.definition).toEqual({ name: 'env_set' });
      // R3: the suggesting package P reaches its declared dependency Q; R's copy of `shared` is outside P's closure.
      expect((await reader.resolve('permission', 'shared', storedPermissionSetScope(null, P)))?.definition.label).toBe('Q');
      expect(await resolveCatalogReference(reader, 'permission', 'q_only', storedPermissionSetScope(null, R))).toMatchObject({ status: 'refused', reason: 'outside-closure' });
      expect(r.asked).toEqual([
        { name: 'q_only', caller: null },
        { name: 'env_set', caller: null },
        { name: 'shared', caller: P },
        { name: 'q_only', caller: R },
      ]);
    });

    it('the column names the exact holder ahead of a writer and a position', async () => {
      const r = stored();
      const reader = createSecurityCatalogReader({ registry: r, metadata: metadata({}) });
      expect((await reader.resolve('permission', 'shared', { ...at(), ...storedPermissionSetScope(R, P) }))?.definition.label).toBe('R');
      expect(r.asked).toEqual([]);
    });
  });

  /**
   * [#32183] A disabled package holds no name. BASE (main de141e32): two
   * holders with one disabled were refused naming both, for no reference and
   * for a column naming the disabled one; a name only a disabled package holds
   * resolved that holder and answered not-found, and `holdsPlatformPermissionSet`
   * false.
   */
  // [contract review S2] Both registration orders: the holders as listed, and reversed.
  describe.each([
    { order: 'enabled first', reversed: false },
    { order: 'disabled first', reversed: true },
  ])('#32183 — a disabled holder, $order', ({ reversed }) => {
    const SYS = 'com.objectstack.kernel';
    const OFF = 'com.acme.off';
    const ordered = <T>(holders: T[]): T[] => (reversed ? [...holders].reverse() : holders);
    const two = () => scopedRegistry({}, {
      packages: { [P]: {}, [Q]: {}, [OFF]: {}, [SYS]: { namespace: 'sys' } },
      disabled: [OFF],
      holders: {
        shared: ordered([{ packageId: Q, item: { name: 'shared', _packageId: Q, label: 'Q' } }, { packageId: OFF, item: { name: 'shared', _packageId: OFF, label: 'OFF' } }]),
        off_set: [{ packageId: OFF, item: { name: 'off_set', _packageId: OFF } }],
        admin_set: ordered([{ packageId: SYS, item: { name: 'admin_set', _packageId: SYS } }, { packageId: OFF, item: { name: 'admin_set', _packageId: OFF } }]),
      },
    });

    it('two holders, one disabled: a reference with no column resolves the enabled holder; a caller outside both is refused naming it only', async () => {
      const reader = createSecurityCatalogReader({ registry: two(), metadata: metadata({}) });
      expect((await reader.resolve('permission', 'shared'))?.definition.label).toBe('Q');
      expect((await reader.resolve('permission', 'shared', storedPermissionSetScope(null)))?.definition.label).toBe('Q');
      const answer = await resolveCatalogReference(reader, 'permission', 'shared', at());
      expect(answer).toMatchObject({ status: 'refused', reason: 'outside-closure' });
      if (answer.status === 'refused') {
        expect(answer.candidates).toEqual([expect.stringContaining(Q)]);
        expect(answer.message).not.toContain(OFF);
      }
    });

    it('⛔ a column naming the disabled holder confers nothing: not-found, never re-targeted to the enabled holder, and not said stale', async () => {
      const warn = vi.fn();
      const reader = createSecurityCatalogReader({ registry: two(), metadata: metadata({}), logger: { warn } });
      expect(await resolveCatalogReference(reader, 'permission', 'shared', storedPermissionSetScope(OFF))).toEqual({ status: 'not-found' });
      expect(await reader.resolve('permission', 'shared', storedPermissionSetScope(OFF, P))).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      // CONTROL: the enabled holder's column reads its set.
      expect((await reader.resolve('permission', 'shared', storedPermissionSetScope(Q)))?.definition.label).toBe('Q');
    });

    it('⛔ a name only a disabled package holds is not-found, never the metadata service\'s by-name body', async () => {
      const reader = createSecurityCatalogReader({
        registry: two(),
        metadata: metadata({ permission: [{ name: 'off_set', label: 'a metadata-service body of that name' }] }),
      });
      for (const scope of [undefined, storedPermissionSetScope(null), at(), storedPermissionSetScope(OFF)]) {
        expect(await resolveCatalogReference(reader, 'permission', 'off_set', scope)).toEqual({ status: 'not-found' });
      }
    });

    it('holdsPlatformPermissionSet: the enabled holder\'s verdict for two holders; a name only a disabled package holds is no identity', () => {
      const ql = { registry: two() };
      expect(holdsPlatformPermissionSet(ql, { permissions: ['admin_set'] }, 'admin_set')).toBe(true);
      expect(holdsPlatformPermissionSet(ql, { permissions: ['shared'] }, 'shared')).toBe(false);
      expect(holdsPlatformPermissionSet(ql, { permissions: ['off_set'] }, 'off_set')).toBe(false);
      // CONTROL: a name the registry holds nowhere answers as a by-name read did.
      expect(holdsPlatformPermissionSet(ql, { permissions: ['nowhere'] }, 'nowhere')).toBe(true);
    });
  });
});
