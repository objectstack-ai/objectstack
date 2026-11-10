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

  describe('(a) a bare read of a type whose one-holder rule holds keeps `getItem`', () => {
    it.each(UNWIRED_COVERED_TYPES)('%s: the read naming no package serves the one holder, as on main', async (type) => {
      shipValid(type, 'solo', A);
      expect(labelOf(await protocol.getMetaItem({ type, name: 'solo' }))).toBe(`alpha ${type}`);
    });
  });

  describe('(b) a bare read of a type narrowed to the namespace, read through `getItem`, is refused 501', () => {
    /** This file's registry, read through a view that answers `false` for every type. */
    let readsNothingByPackage: ObjectStackProtocolImplementation;
    beforeEach(() => {
      const view = new Proxy(registry, {
        get(target, prop) {
          if (prop === 'readsByPackage') return () => false;
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

    it('CONTROL: the registry WITH the resolver reads the narrowed types by package and serves them', async () => {
      for (const type of NAMESPACE_SCOPED_BARE_NAME_TYPES) {
        expect(registry.readsByPackage(type), type).toBe(true);
        shipValid(type, 'solo', A);
        expect(labelOf(await protocol.getMetaItem({ type, name: 'solo' }))).toBe(`alpha ${type}`);
      }
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
