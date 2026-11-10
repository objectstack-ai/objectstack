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
import { resolveThrownHttpError } from '@objectstack/types';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';
import { PACKAGE_SCOPED_READ_TYPES, PackageScopedNameRefusedError } from './package-scoped-read.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const C = 'com.acme.gamma';
const PAIR_A = `${A}.custom`;

const manifest = (id: string) => ({
  id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop()!,
}) as never;

let registry: SchemaRegistry;
let protocol: ObjectStackProtocolImplementation;
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
  const engine = {
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
