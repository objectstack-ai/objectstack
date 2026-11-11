// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';

/**
 * ADR-0150 D5, epic #31527 child G1 (#31691): `?package=X` on the by-name
 * metadata read is the EXACT qualifier — X's item with its bound overlay, or a
 * refusal naming every holder, never another package's item.
 *
 * BASE (measured on main 80c4c9a28 before this change, same fixture): the read
 * naming a package was the registry's prefer-local read, so `?package=gamma`
 * of a page only alpha and beta ship served alpha's (the first registered),
 * and `?package=gamma` of a page only alpha ships served alpha's.
 *
 * Scope: the types whose by-name readers consult `(package, name)` (E8's nine,
 * `registry.readsByPackage`). The CONTROLs pin what stays: a holder's own read,
 * a customization pair's read of its base's item (Studio's `?package=PAIR`,
 * ui carry-in 1), a row bound to the package, zero holders, and the types
 * outside the nine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { declaredRefusalMessage, resolveThrownHttpError } from '@objectstack/types';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';
import { PACKAGE_SCOPED_READ_TYPES, PackageScopedNameRefusedError } from './package-scoped-read.js';
import { NAMESPACE_SCOPED_BARE_NAME_TYPES, PACKAGE_SCOPED_TYPES } from '@objectstack/core';

/** ADR-0150's covered types whose by-name readers no child of the epic has wired yet. */
const UNWIRED_COVERED_TYPES = PACKAGE_SCOPED_TYPES.filter(
  (type) => !(PACKAGE_SCOPED_READ_TYPES as readonly string[]).includes(type),
);

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const C = 'com.acme.gamma';
const PAIR_A = `${A}.custom`;

const manifest = (id: string) => ({
  id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()!,
}) as never;

let registry: SchemaRegistry;
let protocol: ObjectStackProtocolImplementation;
/** The engine double `protocol` reads; its registry is the real `SchemaRegistry`. */
let engine: Record<string, unknown>;
/** Stored `sys_metadata` rows the engine double answers. */
let rows: Array<Record<string, unknown>>;

const ship = (type: string, name: string, packageId: string) =>
  registry.registerItem(type, { name, label: `${packageId.split('.').pop()} ${type}` }, 'name' as never, packageId);
const envItem = (type: string, name: string) =>
  registry.registerItem(type, { name, label: `env ${type}`, _provenance: 'org' }, 'name' as never);
const labelOf = (answer: unknown) => (answer as { item?: { label?: string } } | undefined)?.item?.label;

/**
 * [#32162] A permission set keeps one holder per deployment until its install
 * rule narrows to the namespace (#31698 PR-2), so the registry refuses a second
 * package's set of a name. The two-holder reads below are the state that rule
 * opens: the security catalog's holder check is answered empty for this
 * registry (the #31698 step-0 probe's switch), and nothing else changes.
 */
const admitSecondPermissionHolder = () =>
  vi.spyOn(registry as unknown as { securityCatalogHoldersOtherThan: () => unknown[] }, 'securityCatalogHoldersOtherThan')
    .mockReturnValue([]);

// The engine double: equality and `$in`, and nothing else — any other
// operator or combinator is refused loudly rather than read as a field.
const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined) =>
  Object.entries(where ?? {}).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`engine double: logical operator ${k} is not implemented`);
    if (v !== null && typeof v === 'object') {
      const ops = Object.keys(v);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((v as { $in?: unknown }).$in)) {
        throw new Error(`engine double: operator ${ops.join(', ')} is not implemented`);
      }
      return (v as { $in: unknown[] }).$in.includes(row[k]);
    }
    return (row[k] ?? null) === v;
  });

async function refusalOf(read: () => unknown): Promise<PackageScopedNameRefusedError> {
  try {
    await read();
  } catch (err) {
    expect(err, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
    return err as PackageScopedNameRefusedError;
  }
  throw new Error('the read answered; a refusal was expected');
}

beforeEach(() => {
  rows = [];
  registry = new SchemaRegistry({ multiTenant: false });
  const pick = (opts?: { where?: Record<string, unknown>; limit?: number }) => {
    const hits = rows.filter((r) => matches(r, opts?.where));
    return typeof opts?.limit === 'number' ? hits.slice(0, opts.limit) : hits;
  };
  engine = {
    registry,
    find: vi.fn(async (_object: string, opts?: { where?: Record<string, unknown>; limit?: number }) => pick(opts)),
    findOne: vi.fn(async (object: string, opts?: { where?: Record<string, unknown> }) => {
      assertEngineFindOnePredicate(object, opts as never);
      return pick(opts)[0] ?? null;
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
    aggregate: vi.fn().mockResolvedValue([]),
  };
  protocol = new ObjectStackProtocolImplementation(engine as never);
  for (const id of [A, B, C]) registry.installPackage(manifest(id), 'code');
});

describe('narrowing — `?package=X` for a name X does not hold is refused, naming every holder', () => {
  it('two holders, a third package named: 409 RESOURCE_CONFLICT naming both (BASE: served alpha\'s)', async () => {
    ship('page', 'home', A);
    ship('page', 'home', B);
    const err = await refusalOf(() => protocol.getMetaItem({ type: 'page', name: 'home', packageId: C }));
    expect([err.code, err.status, err.refusal.reason, err.refusal.callerPackageId])
      .toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier', C]);
    expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    expect(err.message).toContain(`is not held by package "${C}"`);
    expect(err.message).toContain(`package "${A}"`);
    expect(err.message).toContain(`package "${B}"`);
  });

  it('one holder, another package named: refused naming it (BASE: served alpha\'s)', async () => {
    ship('dashboard', 'sales', A);
    const err = await refusalOf(() => protocol.getMetaItem({ type: 'dashboard', name: 'sales', packageId: C }));
    expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }]);
  });

  it('the environment\'s own item, a package named: refused naming the environment', async () => {
    envItem('report', 'pipeline');
    const err = await refusalOf(() => protocol.getMetaItem({ type: 'report', name: 'pipeline', packageId: A }));
    expect(err.refusal.candidates).toEqual([{ kind: 'environment' }]);
  });

  it('both faces refuse alike', async () => {
    ship('page', 'home', A);
    await refusalOf(() => protocol.getMetaItemForExecution({ type: 'page', name: 'home', packageId: C }));
  });

  it('the refusal crosses a wire door as 409 with the candidates\' sentence, never 404 or 500', async () => {
    ship('page', 'home', A);
    ship('page', 'home', B);
    const err = await refusalOf(() => protocol.getMetaItem({ type: 'page', name: 'home', packageId: C }));
    const answer = resolveThrownHttpError(err, 500);
    expect([answer.status, answer.code]).toEqual([409, 'RESOURCE_CONFLICT']);
  });
});

describe('CONTROL — what the exact qualifier keeps serving', () => {
  it('each holder of a two-holder name reads its own item', async () => {
    ship('page', 'home', A);
    ship('page', 'home', B);
    expect(labelOf(await protocol.getMetaItem({ type: 'page', name: 'home', packageId: A }))).toBe('alpha page');
    expect(labelOf(await protocol.getMetaItem({ type: 'page', name: 'home', packageId: B }))).toBe('beta page');
  });

  it('the second-registered holder reads its own item when the first holds the bare slot\'s first composite', async () => {
    ship('app', 'console', A);
    ship('app', 'console', B);
    expect(labelOf(await protocol.getMetaItem({ type: 'app', name: 'console', packageId: B }))).toBe('beta app');
  });

  it('Studio\'s pair read (ui carry-in 1): `?package=PAIR` of a base-held item answers the base\'s item', async () => {
    ship('dashboard', 'sales', A);
    ship('dashboard', 'sales', B);
    expect(labelOf(await protocol.getMetaItem({ type: 'dashboard', name: 'sales', packageId: PAIR_A }))).toBe('alpha dashboard');
  });

  it('Studio\'s pair read: the base\'s item, even when another package registered the name first', async () => {
    // The layer below is the prefer-local read: no bare slot, no composite of
    // the pair, so it answers the FIRST composite — beta's. The admitted
    // address names alpha (the base the pair customizes), so alpha's is served.
    ship('dashboard', 'sales', B);
    ship('dashboard', 'sales', A);
    expect(labelOf(await protocol.getMetaItem({ type: 'dashboard', name: 'sales', packageId: PAIR_A }))).toBe('alpha dashboard');
  });

  it('Studio\'s pair read (ui carry-in 1): the pair\'s declared override row is served at the pair', async () => {
    ship('page', 'home', A);
    rows.push({
      type: 'page', name: 'home', state: 'active', package_id: PAIR_A,
      metadata: JSON.stringify({ name: 'home', label: 'pair override', overrides: { package: A } }),
    });
    expect(labelOf(await protocol.getMetaItem({ type: 'page', name: 'home', packageId: PAIR_A }))).toBe('pair override');
  });

  it('a pair\'s added member (a row bound to the pair, no code holder) is served at the pair', async () => {
    rows.push({
      type: 'page', name: 'extra', state: 'active', package_id: PAIR_A,
      metadata: JSON.stringify({ name: 'extra', label: 'pair page' }),
    });
    expect(labelOf(await protocol.getMetaItem({ type: 'page', name: 'extra', packageId: PAIR_A }))).toBe('pair page');
  });

  it('zero holders stays not-found, never a refusal', async () => {
    expect((await protocol.getMetaItem({ type: 'page', name: 'nothing', packageId: A }))?.item).toBeUndefined();
  });

  it('a type outside the nine (view) keeps the prefer-local read', async () => {
    registry.registerItem('view', { name: 'all', label: 'alpha view' }, 'name' as never, A);
    expect(labelOf(await protocol.getMetaItem({ type: 'view', name: 'all', packageId: C }))).toBe('alpha view');
  });

  it('a read naming no package is E8\'s, unchanged', async () => {
    ship('page', 'solo', A);
    expect(labelOf(await protocol.getMetaItem({ type: 'page', name: 'solo' }))).toBe('alpha page');
  });
});

describe('[#31699] a bundled type (email_template): the exact qualifier reads a member addition and a pair\'s member as the package\'s own', () => {
  const D = 'com.acme.alphaaddon';
  /** One member of `packageId`'s bundle `welcome` (its composite slot). */
  const tpl = (locale: string, packageId: string) => registry.registerItem('email_template', {
    name: 'welcome', label: `${packageId.split('.').pop()} ${locale}`, locale,
    subject: `${packageId.split('.').pop()} ${locale}`, bodyHtml: '<p>x</p>',
  }, 'name' as never, packageId);
  const read = (packageId: string, member?: string) => protocol.getMetaItem({
    type: 'email_template', name: 'welcome', packageId, ...(member !== undefined ? { member } : {}),
  } as never);

  beforeEach(() => {
    registry.installPackage({ ...(manifest(D) as object), dependencies: { [A]: '^1.0.0' } } as never, 'code');
  });

  it('a dependent\'s added member (a locale its base does not ship): naming the dependent is admitted, with or without a member', async () => {
    tpl('en-US', A);
    tpl('fr-FR', D);
    // R2: the addition holds no name for a bare read, so a caller with no package reads alpha's.
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([A]);
    expect(labelOf(await read(D, 'fr-FR'))).toBe('alphaaddon fr-FR');
    // The read that names no member (the layered door's disabled-package probe
    // asks it) is the dependent's own holding, never `not-held-by-qualifier`.
    expect(labelOf(await read(D))).toBe('alphaaddon fr-FR');
  });

  it.each(['app', 'page', 'dashboard', 'report', 'book', 'analytics_cube', 'tool', 'skill', 'agent'])(
    'CONTROL — %s (no bundle member): the holders the qualifier asks with itself as caller are the holders it asked before',
    (type) => {
      ship(type, 'home', A);
      ship(type, 'home', B);
      expect(registry.packageScopedHoldersOf(type, 'home', C)).toEqual(registry.packageScopedHoldersOf(type, 'home'));
      expect(registry.packageScopedHoldersOf(type, 'home', C)).toEqual([A, B]);
    },
  );

  it('CONTROL — the addition is still the dependent\'s only: naming the base does not serve it, naming a third package is refused naming the base', async () => {
    tpl('en-US', A);
    tpl('fr-FR', D);
    expect((await read(A, 'fr-FR'))?.item).toBeUndefined();
    const err = await refusalOf(() => read(C, 'fr-FR'));
    expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }]);
  });

  it('the pair\'s added member is served on its base\'s address, stamped with the pair (#28802 ruling A), when the pair is installed', async () => {
    registry.installPackage(manifest(PAIR_A), 'code');
    tpl('en-US', A);
    rows.push({
      type: 'email_template', name: 'welcome', state: 'active', package_id: PAIR_A, bundle_member: 'fr-FR',
      metadata: JSON.stringify({ name: 'welcome', label: 'pair fr-FR', locale: 'fr-FR', subject: 'pair fr-FR', bodyHtml: '<p>p</p>' }),
    });
    const answer = await read(A, 'fr-FR');
    expect(labelOf(answer)).toBe('pair fr-FR');
    expect((answer as { item?: { _packageId?: string } }).item?._packageId).toBe(PAIR_A);
    // CONTROL: the base's own member.
    expect(labelOf(await read(A, 'en-US'))).toBe('alpha en-US');
  });

  it('CONTROL — another package\'s stored member is never served on the base\'s address', async () => {
    tpl('en-US', A);
    rows.push({
      type: 'email_template', name: 'welcome', state: 'active', package_id: B, bundle_member: 'fr-FR',
      metadata: JSON.stringify({ name: 'welcome', label: 'beta fr-FR', locale: 'fr-FR', subject: 'beta fr-FR', bodyHtml: '<p>b</p>' }),
    });
    expect((await read(A, 'fr-FR'))?.item).toBeUndefined();
  });
});

/**
 * ADR-0150 D3/D5, epic #31527 (#32076): on an engine whose registry has no
 * package-scoped resolver slice, a by-name read of a type ADR-0150 addresses by
 * `(package, name)` fails closed — `501 NOT_IMPLEMENTED` naming the cause —
 * instead of falling back to `getItem`'s first match.
 *
 * The fixture is this file's: the same `SchemaRegistry` and stored rows, read
 * through a view of the registry that hides the five slice reads, so the only
 * difference between the two protocols is the slice. BASE (main ff04ad81, the
 * same fixture): every refused read below answered alpha's item, the first
 * registered; the `?package=` read for a name alpha and beta hold, naming gamma,
 * served alpha's.
 */
describe('fail closed — a registry with no package-scoped resolver refuses what it cannot judge', () => {
  const SLICE = new Set([
    'readsByPackage', 'packageScopedHoldersOf', 'getEnvironmentScopedItem', 'getPackageScopedItem', 'resolveItem',
  ]);
  let sliceless: ObjectStackProtocolImplementation;

  beforeEach(() => {
    const view = new Proxy(registry, {
      get(target, prop) {
        if (typeof prop === 'string' && SLICE.has(prop)) return undefined;
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    sliceless = new ObjectStackProtocolImplementation({ ...engine, registry: view } as never);
  });

  async function unjudgeable(read: () => unknown): Promise<Error & { status?: number; code?: string; refusal?: unknown }> {
    try {
      await read();
    } catch (err) {
      return err as Error & { status?: number; code?: string; refusal?: unknown };
    }
    throw new Error('the read answered; a refusal was expected');
  }

  const expectUnjudgeable = (err: Error & { status?: number; code?: string; refusal?: unknown }) => {
    expect([err.status, err.code, err.refusal]).toEqual([501, 'NOT_IMPLEMENTED', true]);
    expect(err.message).toContain('has no package-scoped resolver');
  };

  it('a read naming a package (`?package=`) is refused 501, never another package\'s item (BASE: served alpha\'s)', async () => {
    ship('page', 'home', A);
    ship('page', 'home', B);
    const err = await unjudgeable(() => sliceless.getMetaItem({ type: 'page', name: 'home', packageId: C }));
    expectUnjudgeable(err);
    expect(err.message).toContain(`naming package '${C}'`);
    await unjudgeable(() => sliceless.getMetaItemForExecution({ type: 'page', name: 'home', packageId: C }));
  });

  it('the qualified path `/meta/:type/:ns/:name` — the namespace\'s package as the exact qualifier — is refused 501', async () => {
    ship('page', 'home', B);
    const address = sliceless.resolveMetaItemAddress({ type: 'page', segment: 'alpha', name: 'home' });
    expect(address).toEqual({ kind: 'namespace', namespace: 'alpha', packageId: A });
    const packageId = (address as { packageId: string }).packageId;
    expectUnjudgeable(await unjudgeable(() => sliceless.getMetaItem({ type: 'page', name: 'home', packageId })));
  });

  it('the environment address (`/meta/:type/_env/:name`) is refused 501', async () => {
    ship('report', 'pipeline', A);
    const err = await unjudgeable(() => sliceless.admitEnvironmentQualifier({ type: 'report', name: 'pipeline' }));
    expectUnjudgeable(err);
    expect(err.message).toContain('naming the environment');
  });

  it('a read naming no package is refused 501: nothing can count its holders (BASE: served alpha\'s)', async () => {
    ship('dashboard', 'sales', A);
    const err = await unjudgeable(() => sliceless.getMetaItem({ type: 'dashboard', name: 'sales' }));
    expectUnjudgeable(err);
    expect(err.message).toContain('naming no package');
  });

  it('[#32076] the layered read (`/layers`) is refused 501 as the plain read is, naming a package or naming none (BASE: served alpha\'s layers)', async () => {
    ship('page', 'home', A);
    ship('page', 'home', B);
    const named = await unjudgeable(() => sliceless.getMetaItemLayered({ type: 'page', name: 'home', packageId: C }));
    expectUnjudgeable(named);
    expect(named.message).toContain(`naming package '${C}'`);
    const bare = await unjudgeable(() => sliceless.getMetaItemLayered({ type: 'page', name: 'home' }));
    expectUnjudgeable(bare);
    expect(bare.message).toContain('naming no package');
  });

  it('[#32076] `_env` of the environment\'s own item, on a registry with the exact reads but no `readsByPackage`, is refused naming the environment', async () => {
    const readsNoTypeByName = new Proxy(registry, {
      get(target, prop) {
        if (prop === 'readsByPackage' || prop === 'resolveItem') return undefined;
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const half = new ObjectStackProtocolImplementation({ ...engine, registry: readsNoTypeByName } as never);
    envItem('report', 'pipeline');
    const err = await unjudgeable(() => half.admitEnvironmentQualifier({ type: 'report', name: 'pipeline' }));
    expectUnjudgeable(err);
    expect(err.message).toContain('naming the environment');
  });

  it('the refusal crosses a wire door as 501 with its own sentence, never withheld as a fault', async () => {
    ship('page', 'home', A);
    const err = await unjudgeable(() => sliceless.getMetaItem({ type: 'page', name: 'home', packageId: C }));
    const answer = resolveThrownHttpError(err, 500);
    expect([answer.status, answer.code]).toEqual([501, 'NOT_IMPLEMENTED']);
    // A declared refusal: the 5xx boundary keeps the sentence, never withholds it as a fault.
    expect(declaredRefusalMessage(err)).toBe(err.message);
  });

  it('CONTROL: a type ADR-0150 does not address by package (view) keeps `getItem`\'s read, both ways', async () => {
    registry.registerItem('view', { name: 'all', label: 'alpha view' }, 'name' as never, A);
    expect(labelOf(await sliceless.getMetaItem({ type: 'view', name: 'all', packageId: C }))).toBe('alpha view');
    expect(labelOf(await sliceless.getMetaItem({ type: 'view', name: 'all' }))).toBe('alpha view');
  });

  it('CONTROL: the same reads on the registry WITH the slice answer as before', async () => {
    ship('dashboard', 'sales', A);
    ship('page', 'home', A);
    expect(labelOf(await protocol.getMetaItem({ type: 'dashboard', name: 'sales' }))).toBe('alpha dashboard');
    expect(labelOf(await protocol.getMetaItem({ type: 'page', name: 'home', packageId: A }))).toBe('alpha page');
    expect(() => protocol.admitEnvironmentQualifier({ type: 'page', name: 'nothing' })).not.toThrow();
  });
});

/**
 * Seat rulings (a), (b) and (c) of #32076 (claim amendments 6764797602 and
 * 6764879174): a registry whose `readsByPackage` answers `false` for a covered
 * type. `SchemaRegistry` answers `false` for every covered type no child of
 * epic #31527 has wired yet ({@link UNWIRED_COVERED_TYPES}): that is every
 * in-repo composition's answer for them.
 */
describe('a covered type the registry reads through `getItem` (seat rulings (a), (b), (c))', () => {
  /** Ship an item that parses: a shipped action is stored as its schema parse, which wants a target. */
  const shipValid = (type: string, name: string, packageId: string) => registry.registerItem(
    type,
    { name, label: `${packageId.split('.').pop()} ${type}`, ...(type === 'action' ? { type: 'url', target: 'https://example.com' } : {}) },
    'name' as never,
    packageId,
  );

  it('the registry reads each unwired covered type through `getItem`', () => {
    expect(UNWIRED_COVERED_TYPES.length).toBeGreaterThan(0);
    for (const type of UNWIRED_COVERED_TYPES) expect(registry.readsByPackage(type), type).toBe(false);
  });

  describe('(a) a bare read of a type the registry reads through `getItem` keeps that read, as on main', () => {
    it.each(UNWIRED_COVERED_TYPES)('%s: the read naming no package serves the one holder, as on main', async (type) => {
      shipValid(type, 'solo', A);
      expect(labelOf(await protocol.getMetaItem({ type, name: 'solo' }))).toBe(`alpha ${type}`);
    });
  });

  describe('(b) a bare read of a type narrowed to the namespace, read through `getItem`, is refused 501', () => {
    /**
     * This file's registry, read through a view that answers `false` for every
     * type and has no bare-action judge of its own (`refuseAmbiguousObjectLessAction`).
     */
    let readsNothingByPackage: ObjectStackProtocolImplementation;
    beforeEach(() => {
      const view = new Proxy(registry, {
        get(target, prop) {
          if (prop === 'readsByPackage') return () => false;
          if (prop === 'refuseAmbiguousObjectLessAction') return undefined;
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      readsNothingByPackage = new ObjectStackProtocolImplementation({ ...engine, registry: view } as never);
    });

    it.each([...NAMESPACE_SCOPED_BARE_NAME_TYPES])('%s: 501 naming the missing resolver, even for one holder (BASE: served it)', async (type) => {
      shipValid(type, 'solo', A);
      let thrown: (Error & { status?: number; code?: string; refusal?: unknown }) | undefined;
      try {
        await readsNothingByPackage.getMetaItem({ type, name: 'solo' });
      } catch (err) {
        thrown = err as typeof thrown;
      }
      expect([thrown?.status, thrown?.code, thrown?.refusal], String(thrown)).toEqual([501, 'NOT_IMPLEMENTED', true]);
      expect(thrown?.message).toContain(`has no package-scoped resolver for '${type}' items`);
    });

    it('CONTROL: a covered type not narrowed (tool) keeps `getItem` on the same view', async () => {
      shipValid('tool', 'solo', A);
      expect(labelOf(await readsNothingByPackage.getMetaItem({ type: 'tool', name: 'solo' }))).toBe('alpha tool');
    });

    it('CONTROL: the registry WITH the resolver reads the narrowed AI types by package and serves them', async () => {
      for (const type of ['agent', 'skill']) {
        expect(registry.readsByPackage(type), type).toBe(true);
        shipValid(type, 'solo', A);
        expect(labelOf(await protocol.getMetaItem({ type, name: 'solo' }))).toBe(`alpha ${type}`);
      }
    });

    it('CONTROL (#31697): the registry reads `action` through `getItem` but judges its bare read itself, so it is not refused 501: one holder is served, two are refused 409 naming both', async () => {
      expect(registry.readsByPackage('action')).toBe(false);
      shipValid('action', 'solo', A);
      expect(labelOf(await protocol.getMetaItem({ type: 'action', name: 'solo' }))).toBe('alpha action');
      shipValid('action', 'twin', A);
      shipValid('action', 'twin', B);
      let thrown: (Error & { status?: number; code?: string }) | undefined;
      try {
        await protocol.getMetaItem({ type: 'action', name: 'twin' });
      } catch (err) {
        thrown = err as typeof thrown;
      }
      expect([thrown?.status, thrown?.code], String(thrown)).toEqual([409, 'RESOURCE_CONFLICT']);
      expect(thrown?.message).toContain(A);
      expect(thrown?.message).toContain(B);
    });
  });

  describe('(c) a qualified read is the exact qualifier\'s, never `getItem`\'s first match', () => {
    it.each(UNWIRED_COVERED_TYPES)('%s: `?package=` naming a package that holds nothing is 409 naming the one holder (BASE: 200, alpha\'s)', async (type) => {
      shipValid(type, 'solo', A);
      const err = await refusalOf(() => protocol.getMetaItem({ type, name: 'solo', packageId: C }));
      expect([err.code, err.status, err.refusal.reason, err.refusal.callerPackageId])
        .toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier', C]);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }]);
    });

    it('two holders, a third package named: 409 naming both, on both faces (BASE: 200, alpha\'s flow)', async () => {
      shipValid('flow', 'route', A);
      shipValid('flow', 'route', B);
      const err = await refusalOf(() => protocol.getMetaItem({ type: 'flow', name: 'route', packageId: C }));
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
      await refusalOf(() => protocol.getMetaItemForExecution({ type: 'flow', name: 'route', packageId: C }));
    });

    it('the qualified path of a namespace that holds nothing is the same 409', async () => {
      shipValid('queue', 'triage', A);
      const address = protocol.resolveMetaItemAddress({ type: 'queue', segment: 'gamma', name: 'triage' });
      expect(address).toEqual({ kind: 'namespace', namespace: 'gamma', packageId: C });
      await refusalOf(() => protocol.getMetaItem({ type: 'queue', name: 'triage', packageId: C }));
    });

    it('`_env` of a name only a package holds is 409 naming it (BASE: admitted, alpha\'s served)', async () => {
      shipValid('webhook', 'notify', A);
      const err = await refusalOf(() => protocol.admitEnvironmentQualifier({ type: 'webhook', name: 'notify' }));
      expect([err.refusal.reason, err.refusal.callerPackageId]).toEqual(['not-held-by-qualifier', null]);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }]);
    });

    it('[#32076] the layered read (`/layers?package=`) of a name the package does not hold is the same 409 (BASE: alpha\'s layers)', async () => {
      shipValid('flow', 'route', A);
      const err = await refusalOf(() => protocol.getMetaItemLayered({ type: 'flow', name: 'route', packageId: C }));
      expect([err.code, err.status, err.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier']);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }]);
      // CONTROL: the holder's own layers, and the layers read naming no package.
      const own = await protocol.getMetaItemLayered({ type: 'flow', name: 'route', packageId: A });
      expect((own.code as { label?: string } | null)?.label).toBe('alpha flow');
      const bare = await protocol.getMetaItemLayered({ type: 'flow', name: 'route' });
      expect((bare.code as { label?: string } | null)?.label).toBe('alpha flow');
    });

    it('the refusal crosses a wire door as 409, never 404 or 500', async () => {
      shipValid('flow', 'route', A);
      const err = await refusalOf(() => protocol.getMetaItem({ type: 'flow', name: 'route', packageId: C }));
      const answer = resolveThrownHttpError(err, 500);
      expect([answer.status, answer.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('CONTROL: each holder reads its own item, the second-registered too', async () => {
      shipValid('flow', 'route', A);
      shipValid('flow', 'route', B);
      expect(labelOf(await protocol.getMetaItem({ type: 'flow', name: 'route', packageId: A }))).toBe('alpha flow');
      expect(labelOf(await protocol.getMetaItem({ type: 'flow', name: 'route', packageId: B }))).toBe('beta flow');
    });

    it('CONTROL: Studio\'s pair read of a base-held item answers the base\'s item (ui carry-in 1)', async () => {
      shipValid('queue', 'triage', B);
      shipValid('queue', 'triage', A);
      expect(labelOf(await protocol.getMetaItem({ type: 'queue', name: 'triage', packageId: PAIR_A }))).toBe('alpha queue');
    });

    it('CONTROL: a row bound to the package named is served at it', async () => {
      rows.push({
        type: 'flow', name: 'extra', state: 'active', package_id: PAIR_A,
        metadata: JSON.stringify({ name: 'extra', label: 'pair flow' }),
      });
      expect(labelOf(await protocol.getMetaItem({ type: 'flow', name: 'extra', packageId: PAIR_A }))).toBe('pair flow');
    });

    it('CONTROL: zero holders stays not-found; the environment\'s own item is admitted at `_env`', async () => {
      expect((await protocol.getMetaItem({ type: 'flow', name: 'nothing', packageId: A }))?.item).toBeUndefined();
      envItem('flow', 'local');
      expect(() => protocol.admitEnvironmentQualifier({ type: 'flow', name: 'local' })).not.toThrow();
    });

    it('CONTROL: a type outside the covered set (view) keeps the prefer-local read', async () => {
      registry.registerItem('view', { name: 'all', label: 'alpha view' }, 'name' as never, A);
      expect(labelOf(await protocol.getMetaItem({ type: 'view', name: 'all', packageId: C }))).toBe('alpha view');
    });
  });
});

/**
 * The pair line in `exactQualifierItem` (#32076) under the epic's ruling on
 * #31699 F2 (red-line review 6772561368 on #32277): two packages of one App
 * share the App's customization pair, so a pair row with no `overrides`
 * naming one of them cannot say whose item it is. Serving it on both holders'
 * exact addresses would give one package's item to the other; it is refused
 * on both, naming both. One holder, the App's own address (#28390 ruling A)
 * and a row that declares its base keep their answers.
 */
describe('[#32076] a pair row two holders could own is refused on both exact reads, naming both', () => {
  const APP = 'com.acme.suite';
  const X = 'com.acme.suitex';
  const Y = 'com.acme.suitey';
  const PAIR = `${APP}.custom`;
  /** A package of the App: its own namespace, depending on the App. */
  const memberOf = (id: string) => ({
    id, name: id, version: '1.0.0', type: 'module', namespace: id.split('.').pop()!,
    dependencies: { [APP]: '^1.0.0' },
  }) as never;
  const tpl = (locale: string, packageId: string) => registry.registerItem('email_template', {
    name: 'welcome', label: `${packageId.split('.').pop()} ${locale}`, locale,
    subject: `${packageId.split('.').pop()} ${locale}`, bodyHtml: '<p>x</p>',
  }, 'name' as never, packageId);
  const read = (packageId: string, member: string) => protocol.getMetaItem({
    type: 'email_template', name: 'welcome', packageId, member,
  } as never);
  const pairRow = (over: Record<string, unknown> = {}) => rows.push({
    id: 'row_fr', type: 'email_template', name: 'welcome', state: 'active', package_id: PAIR, bundle_member: 'fr-FR',
    metadata: JSON.stringify({ name: 'welcome', label: 'pair fr-FR', locale: 'fr-FR', subject: 'pair fr-FR', bodyHtml: '<p>p</p>', ...over }),
  });

  beforeEach(() => {
    registry.installPackage(manifest(APP), 'code');
    registry.installPackage(memberOf(X), 'code');
    registry.installPackage(memberOf(Y), 'code');
    registry.installPackage(manifest(PAIR), 'code');
  });

  it('the premise: since #31699 the registry reads an email template by package; the 409 below is still the pair line\'s (one owner check, `pairRowOnAddress`)', () => {
    expect(registry.readsByPackage('email_template')).toBe(true);
  });

  it('two holders share the pair: both exact reads of the pair\'s member refuse 409, naming both (BASE: each served the pair\'s)', async () => {
    tpl('en-US', X);
    tpl('en-US', Y);
    pairRow();
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([X, Y]);
    for (const at of [X, Y]) {
      const err = await refusalOf(() => read(at, 'fr-FR'));
      expect([err.code, err.status, err.refusal.reason], at).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-closure']);
      expect(err.refusal.candidates, at).toEqual([{ kind: 'package', packageId: X }, { kind: 'package', packageId: Y }]);
    }
    // CONTROL: each holder's own member is still its own.
    expect(labelOf(await read(X, 'en-US'))).toBe('suitex en-US');
    expect(labelOf(await read(Y, 'en-US'))).toBe('suitey en-US');
  });

  it('one holder of the pair: the pair\'s member is served on its address (#28802, #28390 ruling A)', async () => {
    tpl('en-US', X);
    pairRow();
    const answer = await read(X, 'fr-FR');
    expect(labelOf(answer)).toBe('pair fr-FR');
    expect((answer as { item?: { _packageId?: string } }).item?._packageId).toBe(PAIR);
  });

  it('the App\'s own address keeps ruling A: its pair\'s added member is served there, even beside a package of the App holding the name', async () => {
    tpl('en-US', APP);
    tpl('en-US', X);
    pairRow();
    expect(labelOf(await read(APP, 'fr-FR'))).toBe('pair fr-FR');
  });

  /** A pair row the boot hydrated into the registry's plain slot, stamped with the pair (`page` reads by package). */
  const hydratedPairPage = (over: Record<string, unknown> = {}) => registry.registerItem('page', {
    name: 'home', label: 'pair page', _packageId: PAIR, ...over,
  }, 'name' as never);
  const pageAt = (packageId: string) => protocol.getMetaItem({ type: 'page', name: 'home', packageId });

  it('a row that declares a member is not the App\'s: the App\'s address serves the App\'s own item, the member\'s address the row (review M1r)', async () => {
    ship('page', 'home', APP);
    ship('page', 'home', X);
    // The App's own item, as the registry's package-scoped read answers it before the pair's row is hydrated.
    const appOwn = registry.getPackageScopedItem('page', 'home', APP);
    hydratedPairPage({ overrides: { package: X } });
    // `SchemaRegistry`'s package-scoped read then answers the pair's plain-slot row for the App too, whatever
    // it declares (`registry.ts`, outside this change; main answers the same). This view answers the App's own
    // item there, so the pin reads the exact qualifier's judgment alone.
    const view = new Proxy(registry, {
      get(target, prop) {
        if (prop === 'getPackageScopedItem') {
          return (type: string, name: string, packageId: string, member?: string) =>
            (type === 'page' && name === 'home' && packageId === APP ? appOwn : target.getPackageScopedItem(type, name, packageId, member));
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const viewed = new ObjectStackProtocolImplementation({ ...engine, registry: view } as never);
    expect(labelOf(await viewed.getMetaItem({ type: 'page', name: 'home', packageId: APP }))).toBe('suite page');
    // CONTROL: the member the row declares serves it.
    expect(labelOf(await viewed.getMetaItem({ type: 'page', name: 'home', packageId: X }))).toBe('pair page');
  });

  it('one owner that the address does not name: the row is not served there (review S2)', async () => {
    ship('page', 'home', Y);
    // X is admitted only by its own pending draft of the name; Y is the one holder.
    rows.push({
      type: 'page', name: 'home', state: 'draft', package_id: X,
      metadata: JSON.stringify({ name: 'home', label: 'suitex draft' }),
    });
    hydratedPairPage();
    expect((await pageAt(X))?.item).toBeUndefined();
    // CONTROL: the one owner's address serves the row.
    expect(labelOf(await pageAt(Y))).toBe('pair page');
  });

  it('a row that declares the base it customizes is served on that base only', async () => {
    tpl('en-US', X);
    tpl('en-US', Y);
    pairRow({ overrides: { package: X } });
    expect(labelOf(await read(X, 'fr-FR'))).toBe('pair fr-FR');
    expect(labelOf(await read(Y, 'fr-FR'))).not.toBe('pair fr-FR');
  });
});

/**
 * [#32069] The exact read never serves a body under a package it was not read
 * from. On main ff04ad81, `GET /meta/api/alpha/NAME` of an api two packages
 * hold answered beta's body stamped `_packageId: alpha`: the metadata service
 * (step 2 of the read) answered by bare name, and the envelope grafted on the
 * requested package's stamp. A pin that only asserts the stamp echoes the
 * request passes on that defect, so each case asserts the BODY too.
 *
 * Driven for every type whose readers consult `(package, name)`, with a
 * metadata service that answers the other package's body whatever it is asked
 * — the shape the bare-name store had.
 */
describe('the exact read serves the holder\'s own body under the holder\'s own stamp, for every package-scoped type (#32069)', () => {
  it.each([...PACKAGE_SCOPED_READ_TYPES])('%s: `?package=` of each holder serves that holder\'s body and stamp, whatever the service answers', async (type) => {
    if (type === 'permission') admitSecondPermissionHolder();
    ship(type, 'shared', A);
    ship(type, 'shared', B);
    const wrongBody = { name: 'shared', label: `beta ${type}`, _packageId: B };
    const metadata = {
      get: vi.fn(async () => wrongBody),
      getDiagnosed: vi.fn(async () => ({ data: wrongBody, degraded: false, errors: [] })),
    };
    const served = new ObjectStackProtocolImplementation(
      (protocol as unknown as { engine: never }).engine,
      () => new Map<string, unknown>([['metadata', metadata]]),
    );
    for (const [packageId, label] of [[A, `alpha ${type}`], [B, `beta ${type}`]] as const) {
      const answer = await served.getMetaItem({ type, name: 'shared', packageId });
      const item = (answer as { item?: { label?: string; _packageId?: string } }).item;
      expect([item?.label, item?._packageId], `${type} at ${packageId}`).toEqual([label, packageId]);
    }
    expect(metadata.get.mock.calls.length + metadata.getDiagnosed.mock.calls.length, 'the service layer was read').toBeGreaterThan(0);
  });
});

/**
 * [#31699 F2, the epic's ruling on the contract review] Two packages of one
 * App share the App's customization pair, so a locale Studio added there with
 * no `overrides` cannot say whose template it extends. Serving it on both
 * holders' exact addresses would give one package's member to the other.
 */
describe('[#31699 F2] a pair member row two holders could own is refused on both exact reads, naming both', () => {
  const APP = 'com.acme.suite';
  const X = 'com.acme.suitex';
  const Y = 'com.acme.suitey';
  const PAIR = `${APP}.custom`;
  /** A package of the App: its own namespace, depending on the App. */
  const memberOf = (id: string) => ({
    id, name: id, version: '1.0.0', type: 'module', namespace: id.split('.').pop()!,
    dependencies: { [APP]: '^1.0.0' },
  }) as never;
  const tpl = (locale: string, packageId: string) => registry.registerItem('email_template', {
    name: 'welcome', label: `${packageId.split('.').pop()} ${locale}`, locale,
    subject: `${packageId.split('.').pop()} ${locale}`, bodyHtml: '<p>x</p>',
  }, 'name' as never, packageId);
  const read = (packageId: string, member: string) => protocol.getMetaItem({
    type: 'email_template', name: 'welcome', packageId, member,
  } as never);
  const pairRow = (over: Record<string, unknown> = {}) => rows.push({
    id: 'row_fr', type: 'email_template', name: 'welcome', state: 'active', package_id: PAIR, bundle_member: 'fr-FR',
    metadata: JSON.stringify({ name: 'welcome', label: 'pair fr-FR', locale: 'fr-FR', subject: 'pair fr-FR', bodyHtml: '<p>p</p>', ...over }),
  });
  const listed = async (packageId: string) => ((await protocol.getMetaItems({ type: 'email_template', packageId } as never)) as { items?: Array<{ label?: string }> })
    .items?.map((i) => i.label).sort();

  beforeEach(() => {
    registry.installPackage(manifest(APP), 'code');
    registry.installPackage(memberOf(X), 'code');
    registry.installPackage(memberOf(Y), 'code');
    registry.installPackage(manifest(PAIR), 'code');
  });

  it('two holders share the pair: both exact reads of the member refuse 409, naming both, and both lists leave it out', async () => {
    tpl('en-US', X);
    tpl('en-US', Y);
    pairRow();
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([X, Y]);
    for (const at of [X, Y]) {
      const err = await refusalOf(() => read(at, 'fr-FR'));
      expect([err.code, err.status], at).toEqual(['RESOURCE_CONFLICT', 409]);
      expect(err.refusal.candidates, at).toEqual([{ kind: 'package', packageId: X }, { kind: 'package', packageId: Y }]);
      expect(await listed(at), at).not.toContain('pair fr-FR');
    }
    // CONTROL: each holder's own member is still its own.
    expect(labelOf(await read(X, 'en-US'))).toBe('suitex en-US');
    expect(labelOf(await read(Y, 'en-US'))).toBe('suitey en-US');
  });

  it('one holder of the pair: the member is served on its address and listed there (#28390 ruling A)', async () => {
    tpl('en-US', X);
    pairRow();
    expect(labelOf(await read(X, 'fr-FR'))).toBe('pair fr-FR');
    expect(await listed(X)).toContain('pair fr-FR');
  });

  it('the App\'s own address keeps ruling A: its pair\'s added member is served there', async () => {
    tpl('en-US', APP);
    pairRow();
    expect(labelOf(await read(APP, 'fr-FR'))).toBe('pair fr-FR');
    expect(await listed(APP)).toContain('pair fr-FR');
  });

  it('a row that declares the base it customizes (the bind) is served on that base only', async () => {
    tpl('en-US', X);
    tpl('en-US', Y);
    pairRow({ overrides: { package: X } });
    expect(labelOf(await read(X, 'fr-FR'))).toBe('pair fr-FR');
    expect((await read(Y, 'fr-FR'))?.item).toBeUndefined();
    expect(await listed(X)).toContain('pair fr-FR');
    expect(await listed(Y)).not.toContain('pair fr-FR');
  });

  it('a bound row is served on its base only, even when the App itself holds the name beside it (contract review F-B)', async () => {
    tpl('en-US', APP);
    tpl('en-US', X);
    pairRow({ overrides: { package: X } });
    expect(labelOf(await read(X, 'fr-FR'))).toBe('pair fr-FR');
    expect(await listed(X)).toContain('pair fr-FR');
    expect((await read(APP, 'fr-FR'))?.item, 'the App\'s own address').toBeUndefined();
    expect(await listed(APP)).not.toContain('pair fr-FR');
  });

  it('a sole owner keeps its member: another package of the pair does not serve it (delta review S2; through the doors the qualifier refuses the non-holder first)', async () => {
    tpl('en-US', X);
    pairRow();
    expect(registry.packageScopedHoldersOf('email_template', 'welcome')).toEqual([X]);
    expect(labelOf(await read(X, 'fr-FR')), 'the owner').toBe('pair fr-FR');
    let served: unknown;
    try { served = labelOf(await read(Y, 'fr-FR')); } catch (e) { served = (e as { code?: string }).code; }
    expect(served, 'Y shares the pair but holds no template of the name').toBe('RESOURCE_CONFLICT');
    expect(await listed(Y)).not.toContain('pair fr-FR');
  });
});

/**
 * [#31699, epic ruling 6761802819] A package-less row of a name two or more
 * packages hold is the customization of one holder and cannot say which
 * (ADR-0150 D4). Once a second namespace may install a name one package held,
 * serving it on both holders' exact addresses would give one package's
 * customization to the other: each exact read refuses it naming every holder,
 * and the list scoped to a holder (which the send reads) leaves it out.
 */
describe('[#31699] a package-less row of a name two packages hold is no holder\'s own', () => {
  const tpl = (locale: string, packageId: string) => registry.registerItem('email_template', {
    name: 'welcome', label: `${packageId.split('.').pop()} ${locale}`, locale,
    subject: `${packageId.split('.').pop()} ${locale}`, bodyHtml: '<p>x</p>',
  }, 'name' as never, packageId);
  const envRow = (locale: string) => rows.push({
    id: `env_${locale}`, type: 'email_template', name: 'welcome', state: 'active', package_id: null, bundle_member: locale,
    metadata: JSON.stringify({ name: 'welcome', label: `env ${locale}`, locale, subject: `env ${locale}`, bodyHtml: '<p>e</p>' }),
  });
  const read = (packageId: string, member: string) => protocol.getMetaItem({
    type: 'email_template', name: 'welcome', packageId, member,
  } as never);
  const listed = async (packageId: string) => ((await protocol.getMetaItems({ type: 'email_template', packageId } as never)) as { items?: Array<{ label?: string }> })
    .items?.map((i) => i.label).sort();
  const forSend = async (packageId: string) => ((await protocol.getMetaItemsForExecution({ type: 'email_template', packageId } as never)) as { items?: Array<{ label?: string }> })
    .items?.map((i) => i.label).sort();

  beforeEach(() => {
    registry.installPackage(manifest(A), 'code');
    registry.installPackage(manifest(B), 'code');
  });

  it('two holders: both exact reads of the package-less member refuse 409 naming both; each list, and the send\'s read, serves the holder\'s own', async () => {
    tpl('en-US', A);
    tpl('en-US', B);
    envRow('en-US');
    envRow('fr-FR');
    for (const at of [A, B]) {
      const err = await refusalOf(() => read(at, 'fr-FR'));
      expect([err.code, err.status, err.refusal.reason], at).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-closure']);
      expect(err.refusal.candidates, at).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    }
    expect(await listed(A)).toEqual(['alpha en-US']);
    expect(await listed(B)).toEqual(['beta en-US']);
    expect(await forSend(A)).toEqual(['alpha en-US']);
    expect(await forSend(B)).toEqual(['beta en-US']);
  });

  it('CONTROL — one holder: the package-less row is that holder\'s customization, on its exact address and in its list', async () => {
    tpl('en-US', A);
    envRow('en-US');
    envRow('fr-FR');
    expect(labelOf(await read(A, 'fr-FR'))).toBe('env fr-FR');
    expect(await listed(A)).toEqual(['env en-US']);
    expect(await forSend(A)).toEqual(['env en-US']);
  });

  for (const type of ['agent', 'skill', 'app', 'dashboard']) {
    it(`${type}: the environment's item of a name two packages hold is refused on both exact addresses naming both; with one holder it is served`, async () => {
      envItem(type, 'dup');
      ship(type, 'dup', A);
      expect(labelOf(await protocol.getMetaItem({ type, name: 'dup', packageId: A } as never)), 'one holder').toBe(`env ${type}`);
      ship(type, 'dup', B);
      for (const at of [A, B]) {
        const err = await refusalOf(() => protocol.getMetaItem({ type, name: 'dup', packageId: at } as never));
        expect([err.status, err.refusal.reason], at).toEqual([409, 'ambiguous-in-closure']);
        expect(err.refusal.candidates, at).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
      }
    });
  }

  for (const stamp of ['sys_metadata', '']) {
    it(`a package-less row hydrated into the registry (stamped ${JSON.stringify(stamp)}) is refused at both holders' exact addresses; with one holder it is served (contract review R2-A)`, async () => {
      registry.registerItem('agent', { name: 'dup', label: 'hydrated agent', _packageId: stamp, _provenance: 'org' }, 'name' as never);
      ship('agent', 'dup', A);
      expect(labelOf(await protocol.getMetaItem({ type: 'agent', name: 'dup', packageId: A } as never)), 'one holder').toBe('hydrated agent');
      ship('agent', 'dup', B);
      for (const at of [A, B]) {
        const err = await refusalOf(() => protocol.getMetaItem({ type: 'agent', name: 'dup', packageId: at } as never));
        expect([err.status, err.refusal.reason], at).toEqual([409, 'ambiguous-in-closure']);
        expect(err.refusal.candidates, at).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
      }
    });
  }

  it('a member the holder itself ships, beside a package-less row of a name two packages hold: the exact read and the holder\'s list both serve the holder\'s own shipped member, never the row (R2-B)', async () => {
    tpl('en-US', A);
    tpl('en-US', B);
    envRow('en-US');
    for (const [at, own] of [[A, 'alpha en-US'], [B, 'beta en-US']] as const) {
      const answer = await read(at, 'en-US');
      expect(labelOf(answer), at).toBe(own);
      expect((answer as { item?: { _packageId?: string } }).item?._packageId, at).toBe(at);
      expect(await listed(at), at).toEqual([own]);
    }
  });

  it('CONTROL — the `_env` address is untouched: it serves the environment\'s own item, and a package-less row of a held name is not that (D4), as on main', async () => {
    envItem('agent', 'local');
    expect(() => protocol.admitEnvironmentQualifier({ type: 'agent', name: 'local' })).not.toThrow();
    expect(labelOf(await protocol.getMetaItem({ type: 'agent', name: 'local' } as never))).toBe('env agent');
    envItem('agent', 'dup');
    ship('agent', 'dup', A);
    ship('agent', 'dup', B);
    expect(() => protocol.admitEnvironmentQualifier({ type: 'agent', name: 'dup' })).toThrow(PackageScopedNameRefusedError);
  });
});

/**
 * [#32162, ADR-0150 D3/D5] `permission` joins the types whose by-name readers
 * consult `(package, name)`. The four `/meta` read forms, at the protocol the
 * two transports share: bare (a caller with no package), `?package=`, the
 * qualified path `/meta/permission/:ns/:name` (`resolveMetaItemAddress`, read
 * as `?package=`) and `_env` (`admitEnvironmentQualifier`).
 *
 * BASE (main c147fc23, `permission` not in `PACKAGE_SCOPED_READ_TYPES`): the
 * bare read of a two-holder name served the first registered; `?package=` of a
 * package that holds no set of the name served the holder's; `_env` of a name
 * only a package holds served that package's set.
 */
describe('permission: the four `/meta` read forms by `(package, name)` (#32162)', () => {
  const nsOf = (id: string) => id.split('.').pop()!;

  it('permission is wired, so it leaves the derived unwired set #32076 parameterizes over', () => {
    expect(registry.readsByPackage('permission')).toBe(true);
    expect(UNWIRED_COVERED_TYPES).not.toContain('permission');
  });

  describe('two holders (the state #31698 PR-2 opens)', () => {
    beforeEach(() => {
      admitSecondPermissionHolder();
      ship('permission', 'shared_set', A);
      ship('permission', 'shared_set', B);
    });

    it('bare: 409 RESOURCE_CONFLICT naming both holders (BASE: served alpha\'s)', async () => {
      const err = await refusalOf(() => protocol.getMetaItem({ type: 'permission', name: 'shared_set' }));
      expect([err.code, err.status, err.refusal.reason, err.refusal.callerPackageId])
        .toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment', null]);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
      const answer = resolveThrownHttpError(err, 500);
      expect([answer.status, answer.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    });

    it('`?package=` of each holder serves that holder\'s own set', async () => {
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'shared_set', packageId: A }))).toBe('alpha permission');
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'shared_set', packageId: B }))).toBe('beta permission');
    });

    it('`?package=` of a package holding no set of the name: 409 naming both (BASE: served alpha\'s)', async () => {
      const err = await refusalOf(() => protocol.getMetaItem({ type: 'permission', name: 'shared_set', packageId: C }));
      expect([err.code, err.status, err.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier']);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });

    it('`/meta/permission/:ns/:name`: each namespace addresses its own holder\'s set', async () => {
      for (const [id, label] of [[A, 'alpha permission'], [B, 'beta permission']] as const) {
        const address = protocol.resolveMetaItemAddress({ type: 'permission', segment: nsOf(id), name: 'shared_set' });
        expect(address).toEqual({ kind: 'namespace', namespace: nsOf(id), packageId: id });
        expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'shared_set', packageId: id }))).toBe(label);
      }
    });

    it('`_env`: refused naming both holders, the environment holding none', async () => {
      let thrown: unknown;
      try { protocol.admitEnvironmentQualifier({ type: 'permission', name: 'shared_set' }); } catch (e) { thrown = e; }
      expect(thrown).toBeInstanceOf(PackageScopedNameRefusedError);
      const err = thrown as PackageScopedNameRefusedError;
      expect([err.code, err.status, err.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier']);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    });
  });

  describe('CONTROL — one holder answers as today', () => {
    beforeEach(() => ship('permission', 'solo_set', A));

    it('bare: the one holder\'s set', async () => {
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'solo_set' }))).toBe('alpha permission');
    });

    it('`?package=` of the holder: its set', async () => {
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'solo_set', packageId: A }))).toBe('alpha permission');
    });

    it('`/meta/permission/:ns/:name` of the holder\'s namespace: its set', async () => {
      expect(protocol.resolveMetaItemAddress({ type: 'permission', segment: nsOf(A), name: 'solo_set' }))
        .toEqual({ kind: 'namespace', namespace: nsOf(A), packageId: A });
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'solo_set', packageId: A }))).toBe('alpha permission');
    });

    it('`_env` of the environment\'s own set: admitted, and served', async () => {
      envItem('permission', 'env_set');
      expect(() => protocol.admitEnvironmentQualifier({ type: 'permission', name: 'env_set' })).not.toThrow();
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'env_set' }))).toBe('env permission');
    });

    it('zero holders stays not-found at every form, never a refusal', async () => {
      expect(() => protocol.admitEnvironmentQualifier({ type: 'permission', name: 'nobody_set' })).not.toThrow();
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'nobody_set' }))).toBeUndefined();
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'nobody_set', packageId: A }))).toBeUndefined();
    });
  });

  describe('narrowed for one holder too: a qualifier naming a non-holder', () => {
    beforeEach(() => ship('permission', 'solo_set', A));

    it('`?package=` of another package: 409 naming the holder (BASE: served alpha\'s)', async () => {
      const err = await refusalOf(() => protocol.getMetaItem({ type: 'permission', name: 'solo_set', packageId: C }));
      expect([err.code, err.status, err.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier']);
      expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }]);
    });

    it('`_env` of a name only a package holds: 409 naming it (BASE: served alpha\'s)', async () => {
      let thrown: unknown;
      try { protocol.admitEnvironmentQualifier({ type: 'permission', name: 'solo_set' }); } catch (e) { thrown = e; }
      expect((thrown as PackageScopedNameRefusedError | undefined)?.refusal?.candidates).toEqual([{ kind: 'package', packageId: A }]);
    });
  });

  describe('`guest_portal` (platform-requested, ADR-0150 D3 Exceptions) keeps one holder, answered as today', () => {
    beforeEach(() => ship('permission', 'guest_portal', A));

    it('bare: the one holder\'s set', async () => {
      expect(labelOf(await protocol.getMetaItem({ type: 'permission', name: 'guest_portal' }))).toBe('alpha permission');
    });

    it('a caller of another package, outside the holder\'s closure, still resolves it', () => {
      expect((registry.resolveItem('permission', 'guest_portal', C) as { label?: string } | undefined)?.label).toBe('alpha permission');
    });

    it('a second package\'s `guest_portal` is still refused at registration', () => {
      expect(() => ship('permission', 'guest_portal', B)).toThrow(/permission set "guest_portal" is already held by package "com\.acme\.alpha"/);
    });
  });
});

/**
 * [#32310, ADR-0150 D3] The caller arm (`?callerPackage=P`) on the dataset
 * read: the name resolves FROM P by the one rule — P's own dataset, else the
 * unique holder in P's declared closure plus `sys`, else `409` naming the
 * candidates — and the read then reads that holder at its exact address.
 * Real registry, real protocol, no stubbed resolver.
 *
 * BASE (main 351c22c9, booted showcase): `?package=P` for a dataset only a
 * dependency of P holds answered `409 not-held-by-qualifier`; the protocol had
 * no caller arm, so P's dashboard could not say who it is.
 */
describe('[#32310] the caller arm resolves a dataset from the reader\'s package (ADR-0150 D3)', () => {
  const P = 'com.acme.app';
  const SYS = 'com.acme.kernel_bits';
  /** Where the arm reads, then the read at that address — what both doors do. */
  const readFrom = async (name: string, callerPackageId: string) => {
    const address = protocol.resolveCallerPackageAddress({ type: 'dataset', name, callerPackageId });
    return protocol.getMetaItem({ type: 'dataset', name, ...(address.kind === 'package' ? { packageId: address.packageId } : {}) });
  };

  beforeEach(() => {
    registry.installPackage({ ...(manifest(P) as object), dependencies: { [A]: '^1.0.0', [B]: '^1.0.0' } } as never, 'code');
    registry.installPackage({ ...(manifest(SYS) as object), namespace: 'sys' } as never, 'code');
  });

  it('P\'s own dataset answers first, though a dependency holds the name too', async () => {
    ship('dataset', 'pipeline', A);
    ship('dataset', 'pipeline', P);
    expect(protocol.resolveCallerPackageAddress({ type: 'dataset', name: 'pipeline', callerPackageId: P }))
      .toEqual({ kind: 'package', packageId: P });
    expect(labelOf(await readFrom('pipeline', P))).toBe('app dataset');
  });

  it('a dataset only a dependency holds is that dependency\'s (`?package=P` refuses it, BASE)', async () => {
    ship('dataset', 'pipeline', A);
    expect(protocol.resolveCallerPackageAddress({ type: 'dataset', name: 'pipeline', callerPackageId: P }))
      .toEqual({ kind: 'package', packageId: A });
    expect(labelOf(await readFrom('pipeline', P))).toBe('alpha dataset');
    const exact = await refusalOf(() => protocol.getMetaItem({ type: 'dataset', name: 'pipeline', packageId: P }));
    expect(exact.refusal.reason).toBe('not-held-by-qualifier');
  });

  it('a registry that cannot judge the name fails closed: 503, never a first match (#32277\'s rule guards the arm)', () => {
    ship('dataset', 'pipeline', A);
    // The exact qualifier's reads gone: the registry cannot say who holds the name.
    Object.defineProperty(registry, 'getPackageScopedItem', { value: undefined, configurable: true });
    let thrown: any;
    try {
      protocol.resolveCallerPackageAddress({ type: 'dataset', name: 'pipeline', callerPackageId: P });
    } catch (e) { thrown = e; }
    expect([thrown?.status, thrown?.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
  });

  it('a `sys` package is in every caller\'s closure', async () => {
    ship('dataset', 'audit', SYS);
    expect(protocol.resolveCallerPackageAddress({ type: 'dataset', name: 'audit', callerPackageId: P }))
      .toEqual({ kind: 'package', packageId: SYS });
  });

  it('two holders in P\'s closure: 409 ambiguous-in-closure naming both, nothing read', async () => {
    ship('dataset', 'pipeline', A);
    ship('dataset', 'pipeline', B);
    const err = await refusalOf(() => readFrom('pipeline', P));
    expect([err.code, err.status, err.refusal.reason, err.refusal.callerPackageId])
      .toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-closure', P]);
    expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }]);
    expect([resolveThrownHttpError(err, 500).status, resolveThrownHttpError(err, 500).code]).toEqual([409, 'RESOURCE_CONFLICT']);
  });

  it('a holder outside P\'s closure: 409 outside-closure naming it', async () => {
    ship('dataset', 'pipeline', C);
    const err = await refusalOf(() => readFrom('pipeline', P));
    expect([err.refusal.reason, err.refusal.candidates]).toEqual(['outside-closure', [{ kind: 'package', packageId: C }]]);
  });

  it('only the environment holds it: 409 outside-closure naming the environment (D3 (a))', async () => {
    envItem('dataset', 'pipeline');
    const err = await refusalOf(() => readFrom('pipeline', P));
    expect([err.refusal.reason, err.refusal.candidates]).toEqual(['outside-closure', [{ kind: 'environment' }]]);
  });

  it('a caller package that is not installed reads at its own address: what `?package=` naming it answers', async () => {
    ship('dataset', 'pipeline', A);
    const ghost = 'com.acme.ghost';
    expect(protocol.resolveCallerPackageAddress({ type: 'dataset', name: 'pipeline', callerPackageId: ghost }))
      .toEqual({ kind: 'package', packageId: ghost });
    const viaArm = await refusalOf(() => readFrom('pipeline', ghost));
    const viaQualifier = await refusalOf(() => protocol.getMetaItem({ type: 'dataset', name: 'pipeline', packageId: ghost }));
    expect(viaArm.refusal).toEqual(viaQualifier.refusal);
    expect(viaArm.refusal.reason).toBe('not-held-by-qualifier');
  });

  it('nothing holds the name: read at P\'s own address, which answers its miss', async () => {
    expect(protocol.resolveCallerPackageAddress({ type: 'dataset', name: 'nowhere', callerPackageId: P }))
      .toEqual({ kind: 'package', packageId: P });
    expect((await readFrom('nowhere', P) as { item?: unknown })?.item ?? null).toBeNull();
  });

  it('CONTROL: the bare read and `?package=` answer as before', async () => {
    ship('dataset', 'pipeline', A);
    ship('dataset', 'twin', A);
    ship('dataset', 'twin', B);
    expect(labelOf(await protocol.getMetaItem({ type: 'dataset', name: 'pipeline' }))).toBe('alpha dataset');
    expect(labelOf(await protocol.getMetaItem({ type: 'dataset', name: 'twin', packageId: B }))).toBe('beta dataset');
    expect((await refusalOf(() => protocol.getMetaItem({ type: 'dataset', name: 'twin' }))).refusal.reason).toBe('ambiguous-in-environment');
  });
});
