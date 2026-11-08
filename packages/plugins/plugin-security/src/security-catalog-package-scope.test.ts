// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D3/D4/D7, epic #31527 child E3] The security catalog reads
 * permission sets by `(package, name)` through the ONE package-scoped resolver,
 * and a position's `permissionSets` resolve from the package that declared it.
 *
 * Over the real `SchemaRegistry` (`@objectstack/objectql`, aliased to source):
 * packages installed through `installPackage`, so the declared dependency
 * closure is the one the resolver reads; items registered under each
 * package's composite slot; environment rows and overlays in the package-less
 * bare slot, as `sys_metadata` hydration registers them. The catalog is the
 * one the security plugin binds (`createPackageScopedSecurityCatalogReader`),
 * and the grant path is core's own (`readPositionGrantsInForce`).
 *
 * Red lines 1 and 2 (never loosens; every refusal names every candidate) are
 * the `refused` cases. Each was ablated once — the registry's first-registered
 * read put back in place of a refusal, the pin read red, restored — and the
 * readings are in the PR body, not kept as test files. Red line 3 is the
 * `unchanged` block: every reference with a package-less caller, an in-closure
 * holder or a position the environment binds answers as before, and positions
 * keep the one-holder refusal (ADR-0150 D7, ruled Q2 = A).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import {
  bindSecurityCatalogReader,
  createSecurityCatalogReader,
  readPositionGrantsInForce,
  type SecurityCatalogReader,
} from '@objectstack/core';
import { createPackageScopedSecurityCatalogReader } from './security-catalog-package-scope.js';

const P = 'com.acme.caller';
const Q = 'com.acme.other';
const DEP = 'com.acme.dependency';
const SYS = 'com.objectstack.kernel.probe';

const manifest = (id: string, deps: string[] = [], namespace = id.split('.').pop()!) => ({
  id,
  name: id,
  version: '1.0.0',
  type: 'app',
  namespace,
  ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
}) as never;

let registry: SchemaRegistry;
const install = (id: string, deps: string[] = [], namespace?: string) => registry.installPackage(manifest(id, deps, namespace), 'code');
/** A package's item, in its composite slot. */
const ship = (type: string, item: Record<string, unknown>, packageId: string) =>
  registry.registerItem(type, { ...item }, 'name' as never, packageId);
/** A stored row hydrated into the bare slot — the environment's own item, or an overlay bound to `binding`. */
const stored = (type: string, item: Record<string, unknown>, binding?: string) =>
  registry.registerItem(type, { ...item, ...(binding ? { _packageId: binding } : {}), _provenance: 'org' }, 'name' as never);

const NO_METADATA = { get: () => undefined, list: () => [] };
const catalog = (): SecurityCatalogReader => createPackageScopedSecurityCatalogReader(registry, NO_METADATA);
/** The by-name catalog every reader was before this card: the registry's first-registered read. */
const byNameCatalog = (): SecurityCatalogReader => createSecurityCatalogReader({ registry: registry as never, metadata: NO_METADATA });

const position = async (name: string) => {
  const entry = await catalog().resolve('position', name);
  if (!entry) throw new Error(`the catalog holds no position '${name}'`);
  return entry;
};

/** What core's grant path gives a holder of `positions`, over an engine whose catalog is this registry's. */
const grantedThrough = async (positions: string[]): Promise<Map<string, string[]>> => {
  const ql = { registry, find: async () => [] };
  bindSecurityCatalogReader(ql, catalog());
  return (await readPositionGrantsInForce(ql, positions)).inForce;
};

beforeEach(() => {
  registry = new SchemaRegistry();
  registry.logLevel = 'silent';
  install(SYS, [], 'sys');
  ship('permission', { name: 'sys_baseline', label: 'sys baseline' }, SYS);
});

describe('ADR-0150 D7 — a package position resolves its permission sets from its package (D3)', () => {
  it("answers the package's own set and a `sys` set, and the grant path grants both", async () => {
    install(P);
    ship('permission', { name: 'p_set', label: 'caller set' }, P);
    ship('position', { name: 'p_pos', label: 'caller position', permissionSets: ['p_set', 'sys_baseline'] }, P);

    const pos = await position('p_pos');
    expect(pos.packageId).toBe(P);
    expect((await catalog().resolve('permission', 'p_set', { position: pos }))?.packageId).toBe(P);
    expect((await catalog().resolve('permission', 'sys_baseline', { position: pos }))?.packageId).toBe(SYS);
    expect((await grantedThrough(['p_pos'])).get('p_pos')).toEqual(['p_set', 'sys_baseline']);
  });

  it('answers a set its declared dependency holds', async () => {
    install(DEP);
    install(P, [DEP]);
    ship('permission', { name: 'dep_set', label: 'dependency set' }, DEP);
    ship('position', { name: 'p_pos', permissionSets: ['dep_set'] }, P);

    const answer = await catalog().resolveReference!('permission', 'dep_set', { position: await position('p_pos') });
    expect(answer).toMatchObject({ status: 'resolved', entry: { packageId: DEP } });
    expect((await grantedThrough(['p_pos'])).get('p_pos')).toEqual(['dep_set']);
  });

  it('refuses a set only the environment holds (D3 (a), the declared narrowing), naming the environment, and grants nothing through it', async () => {
    install(P);
    stored('permission', { name: 'env_set', label: 'environment set' });
    ship('position', { name: 'p_pos', permissionSets: ['env_set'] }, P);
    const pos = await position('p_pos');

    // What the by-name read served before this card: the environment's set.
    expect((await byNameCatalog().resolve('permission', 'env_set'))?.definition.label).toBe('environment set');

    const answer = await catalog().resolveReference!('permission', 'env_set', { position: pos });
    expect(answer.status).toBe('refused');
    if (answer.status !== 'refused') return;
    expect(answer.reason).toBe('outside-closure');
    expect(answer.candidates).toEqual([expect.stringContaining('the environment')]);
    expect(answer.message).toContain(P);
    expect(await catalog().resolve('permission', 'env_set', { position: pos })).toBeUndefined();
    expect((await grantedThrough(['p_pos'])).get('p_pos')).toEqual([]);
  });

  it('refuses a set only a package outside its declared closure holds, naming that package, and grants nothing through it', async () => {
    install(P);
    install(Q);
    ship('permission', { name: 'q_set', label: 'other set' }, Q);
    ship('position', { name: 'p_pos', permissionSets: ['q_set'] }, P);
    const pos = await position('p_pos');

    expect((await byNameCatalog().resolve('permission', 'q_set'))?.packageId).toBe(Q);

    const answer = await catalog().resolveReference!('permission', 'q_set', { position: pos });
    expect(answer).toMatchObject({ status: 'refused', reason: 'outside-closure' });
    if (answer.status !== 'refused') return;
    expect(answer.candidates).toEqual([expect.stringContaining(Q)]);
    expect(await catalog().resolve('permission', 'q_set', { position: pos })).toBeUndefined();
    expect((await grantedThrough(['p_pos'])).get('p_pos')).toEqual([]);
  });

  it('a set one position cannot resolve is still granted through another position that can', async () => {
    install(P);
    stored('permission', { name: 'env_set', label: 'environment set' });
    ship('position', { name: 'p_pos', permissionSets: ['env_set'] }, P);
    stored('position', { name: 'env_pos', permissionSets: ['env_set'] });

    const granted = await grantedThrough(['p_pos', 'env_pos']);
    expect(granted.get('p_pos')).toEqual([]);
    expect(granted.get('env_pos')).toEqual(['env_set']);
  });
});

describe('ADR-0150 D3/D7 — the environment\'s references resolve as a caller with no package (unchanged)', () => {
  it('a stored grant (no position) resolves environment-wide: the environment set and any one package holder', async () => {
    install(Q);
    stored('permission', { name: 'env_set', label: 'environment set' });
    ship('permission', { name: 'q_set', label: 'other set' }, Q);
    expect((await catalog().resolve('permission', 'env_set'))?.definition.label).toBe('environment set');
    expect((await catalog().resolve('permission', 'q_set'))?.packageId).toBe(Q);
  });

  it("an environment-authored position resolves another package's set", async () => {
    install(Q);
    ship('permission', { name: 'q_set' }, Q);
    stored('position', { name: 'env_pos', permissionSets: ['q_set'] });
    expect((await grantedThrough(['env_pos'])).get('env_pos')).toEqual(['q_set']);
  });

  it("an administrator's overlay of a package position binds another package's set and an environment set (D7)", async () => {
    install(P);
    install(Q);
    ship('permission', { name: 'q_set' }, Q);
    stored('permission', { name: 'env_set' });
    ship('position', { name: 'p_pos', permissionSets: [] }, P);
    stored('position', { name: 'p_pos', permissionSets: ['q_set', 'env_set'] }, P);

    const pos = await position('p_pos');
    expect(pos.definition.permissionSets).toEqual(['q_set', 'env_set']);
    expect((await grantedThrough(['p_pos'])).get('p_pos')).toEqual(['q_set', 'env_set']);
  });

  it("the `everyone` anchor's composed bindings resolve as the environment's (ADR-0090 D5/D9)", async () => {
    install(P);
    ship('permission', { name: 'p_default', label: 'an accepted package default' }, P);
    ship('position', { name: 'everyone', permissionSets: ['sys_baseline', 'p_default'] }, SYS);
    expect((await grantedThrough(['everyone'])).get('everyone')).toEqual(['sys_baseline', 'p_default']);
  });
});

describe('ADR-0150 D4 — the list is keyed by (package, name), and answers as before under phase 1', () => {
  it('lists one entry per holder, each carrying its package', async () => {
    install(P);
    install(Q);
    ship('permission', { name: 'p_set' }, P);
    ship('permission', { name: 'q_set' }, Q);
    stored('permission', { name: 'env_set' });
    const listed = (await catalog().list('permission')).map((e) => [e.name, e.packageId ?? null]);
    expect(listed).toEqual(expect.arrayContaining([['p_set', P], ['q_set', Q], ['env_set', null], ['sys_baseline', SYS]]));
    expect(listed).toHaveLength(4);
  });

  it('every package-less read answers what the by-name read answered, the overlay included', async () => {
    install(P);
    ship('permission', { name: 'p_set', label: 'shipped' }, P);
    stored('permission', { name: 'p_set', label: 'overlaid' }, P);
    stored('permission', { name: 'env_set', label: 'environment' });
    for (const name of ['p_set', 'env_set', 'sys_baseline', 'nothing_here']) {
      const scoped = await catalog().resolve('permission', name);
      const byName = await byNameCatalog().resolve('permission', name);
      expect(scoped?.definition, name).toBe(byName?.definition);
    }
    const definitions = (list: Awaited<ReturnType<SecurityCatalogReader['list']>>) =>
      list.map((e) => e.definition).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    expect(definitions(await catalog().list('permission'))).toEqual(definitions(await byNameCatalog().list('permission')));
  });
});

describe('ADR-0150 D7 — positions are unchanged: one environment-wide slot, a second package holder refused (ruled Q2 = A)', () => {
  it("refuses a second package's position of the same name, and the catalog keeps answering the first", async () => {
    install(P);
    install(Q);
    ship('position', { name: 'shared_pos', label: 'first' }, P);
    expect(() => ship('position', { name: 'shared_pos', label: 'second' }, Q)).toThrow(/shared_pos/);
    expect((await catalog().resolve('position', 'shared_pos'))?.definition.label).toBe('first');
  });
});
