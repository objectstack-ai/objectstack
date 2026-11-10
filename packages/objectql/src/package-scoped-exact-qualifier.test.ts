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
