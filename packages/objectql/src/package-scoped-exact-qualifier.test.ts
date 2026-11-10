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
