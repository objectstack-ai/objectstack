// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1; D10] The upgrade report names each installed package
 * whose namespace spells an address literal: the package the boot keeps with
 * one warning, which the install door refuses afterwards. Over the real
 * `SchemaRegistry`: a package installed during the cold boot (never sealed
 * yet) is HELD, so it is in the report; the row carries the install door's own
 * sentence (`validateNamespaceNotAddressLiteral`), verbatim.
 *
 * No stored table is carried by this registry, so the report reads no row and
 * the engine is never asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';
import { collectStoredPackageReferences, type StoredReferenceRegistry } from './stored-package-references.js';

const HOOKS = 'com.acme.hooks';
const TRIGGERS = 'com.acme.triggers';

const manifest = (id: string, namespace: string) =>
  ({ id, name: id, version: '1.0.0', type: 'app', namespace }) as never;

/** The engine is never reached: no stored table is carried. */
const NO_ENGINE = {} as never;

let registry: SchemaRegistry;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  registry = new SchemaRegistry({ multiTenant: false });
});

afterEach(() => {
  warn.mockRestore();
});

const report = () => collectStoredPackageReferences(NO_ENGINE, registry as unknown as StoredReferenceRegistry);

describe('the upgrade report names an installed package under an address-literal namespace', () => {
  it('THE PIN: a held `hooks` package is named with its id, the literal and the install door\'s sentence', async () => {
    // The cold boot re-registers what an earlier release installed (source
    // `marketplace`): both are kept, the `hooks` one with a warning. A package
    // the deployment's own code ships (`code`) is held the same way.
    registry.installPackage(manifest(HOOKS, 'hooks'), 'marketplace');
    registry.installPackage(manifest(TRIGGERS, 'triggers'), 'marketplace');
    registry.sealBareNameHolders();

    const answer = await report();
    expect(answer.literalNamespaces).toEqual([
      { packageId: HOOKS, namespace: 'hooks', message: validateNamespaceNotAddressLiteral('hooks') },
    ]);
    // The other sections are untouched by it.
    expect(answer.stored).toEqual([]);
    expect(answer.picklists).toEqual([]);
    expect(answer.sealedClashes).toEqual([]);
  });

  it('CONTROL: a deployment whose packages spell no literal (`triggers`) reports none', async () => {
    registry.installPackage(manifest(TRIGGERS, 'triggers'), 'marketplace');
    registry.sealBareNameHolders();
    expect((await report()).literalNamespaces).toEqual([]);
  });

  it('CONTROL: a new `hooks` package after the seal is refused at install, so the report never holds it', async () => {
    registry.sealBareNameHolders();
    expect(() => registry.installPackage(manifest(HOOKS, 'hooks'), 'marketplace')).toThrow(
      expect.objectContaining({ code: 'NAMESPACE_CONFLICT', status: 422 }),
    );
    expect((await report()).literalNamespaces).toEqual([]);
  });
});

describe('#32183 — the stored-reference report judges every holder, as the backfills do', () => {
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';

  // [contract review S2] Both registration orders.
  it.each([['enabled first', [A, B]], ['disabled first', [B, A]]] as const)('a row naming a template two packages hold stays refused while one of them is disabled, naming both (%s)', async (_order, order) => {
    for (const [id, namespace] of [[A, 'alpha'], [B, 'beta']]) registry.installPackage(manifest(id, namespace), 'marketplace');
    for (const id of order) {
      registry.registerItem('email_template', { name: 'shared_notice', label: 'n', subject: 'n', body: 'n', locale: 'en-US' }, 'name' as never, id);
    }
    registry.sealBareNameHolders();
    registry.disablePackage(B);
    vi.spyOn(registry, 'getObject').mockImplementation(((name: string) => (name === 'sys_email_template' ? { name } : undefined)) as never);
    let asked = 0;
    const engine = {
      find: async (table: string) => (table === 'sys_email_template' && asked++ === 0
        ? [{ id: 't1', name: 'shared_notice', package_id: null }]
        : []),
    } as never;

    const answer = await collectStoredPackageReferences(engine, registry as unknown as StoredReferenceRegistry);
    expect(answer.stored).toEqual([
      expect.objectContaining({
        d8: 'R20', table: 'sys_email_template', id: 't1', name: 'shared_notice', reason: 'ambiguous',
        candidates: order.map((packageId) => expect.objectContaining({ packageId })),
      }),
    ]);
  });
});

/**
 * [#31699 F2, the epic's ruling] A locale Studio added in an App's pair, which
 * two packages of the App both ship the template of, cannot say whose member
 * it is: each holder's exact read refuses it, and the report lists the row so
 * the operator can declare the base it customizes. This registry carries
 * `sys_metadata` (a stand-in `getObject`), so the report reads its rows.
 */
describe('[#31699 F2] the upgrade report lists a pair member row two holders could own', () => {
  const APP = 'com.acme.suite';
  const X = 'com.acme.suitex';
  const Y = 'com.acme.suitey';
  const PAIR = `${APP}.custom`;
  const memberOf = (id: string) => ({
    id, name: id, version: '1.0.0', type: 'module', namespace: id.split('.').pop(), dependencies: { [APP]: '^1.0.0' },
  }) as never;
  let rows: Array<Record<string, unknown>>;
  const engine = {
    // One page: the walk's cursor query (an `$and`) reads past the end.
    async find(object: string, options?: { where?: Record<string, unknown> }) {
      if (object !== 'sys_metadata' || options?.where?.$and !== undefined) return [];
      return rows.map((r) => ({ ...r }));
    },
    async update() { throw new Error('the report writes nothing'); },
  };
  const carrying = () => new Proxy(registry, {
    get: (target, key, receiver) => (key === 'getObject'
      ? (name: string) => (name === 'sys_metadata' ? { name } : undefined)
      : Reflect.get(target, key, receiver)),
  }) as unknown as StoredReferenceRegistry;
  const tpl = (packageId: string) => registry.registerItem('email_template', {
    name: 'welcome', label: 'Welcome', locale: 'en-US', subject: 'hi', bodyHtml: '<p>x</p>',
  }, 'name' as never, packageId);
  const pairRow = (over: Record<string, unknown> = {}) => rows.push({
    id: 'row_fr', type: 'email_template', name: 'welcome', state: 'active', package_id: PAIR, bundle_member: 'fr-FR',
    metadata: JSON.stringify({ name: 'welcome', locale: 'fr-FR', subject: 'salut', bodyHtml: '<p>s</p>', ...over }),
  });

  beforeEach(() => {
    rows = [];
    registry.installPackage(manifest(APP, 'suite'), 'code');
    registry.installPackage(memberOf(X), 'code');
    registry.installPackage(memberOf(Y), 'code');
  });

  it('THE PIN: two holders share the pair, so the row is listed naming both by their addresses', async () => {
    tpl(X);
    tpl(Y);
    pairRow();
    const answer = await collectStoredPackageReferences(engine, carrying());
    expect(answer.pairMembers).toEqual([{
      table: 'sys_metadata', id: 'row_fr', type: 'email_template', name: 'welcome', member: 'fr-FR', pairId: PAIR,
      candidates: [
        { holder: 'package', packageId: X, address: 'suitex/welcome' },
        { holder: 'package', packageId: Y, address: 'suitey/welcome' },
      ],
    }]);
  });

  it('[#32183] one of the two holders disabled: the row is still listed naming both (the report reads every holder)', async () => {
    tpl(X);
    tpl(Y);
    pairRow();
    registry.disablePackage(Y);
    expect((await collectStoredPackageReferences(engine, carrying())).pairMembers.map((f) => f.candidates.map((c) => c.packageId)))
      .toEqual([[X, Y]]);
  });

  it('CONTROL: one holder of the pair, or a row that declares its base, is not listed', async () => {
    tpl(X);
    pairRow();
    expect((await collectStoredPackageReferences(engine, carrying())).pairMembers).toEqual([]);
    tpl(Y);
    rows = [];
    pairRow({ overrides: { package: X } });
    expect((await collectStoredPackageReferences(engine, carrying())).pairMembers).toEqual([]);
  });
});

/**
 * [#31699, epic ruling 6761802819] A package-less `sys_metadata` row of a name
 * two or more packages hold is the customization of one of them and cannot say
 * which: each holder's exact read refuses it, and the report lists it so the
 * operator saves it under the one package it customizes.
 */
describe('[#31699] the upgrade report lists a package-less row two holders could own', () => {
  const X = 'com.acme.alphax';
  const Y = 'com.acme.betay';
  let rows: Array<Record<string, unknown>>;
  const engine = {
    async find(object: string, options?: { where?: Record<string, unknown> }) {
      if (object !== 'sys_metadata' || options?.where?.$and !== undefined) return [];
      return rows.map((r) => ({ ...r }));
    },
    async update() { throw new Error('the report writes nothing'); },
  };
  const carrying = () => new Proxy(registry, {
    get: (target, key, receiver) => (key === 'getObject'
      ? (name: string) => (name === 'sys_metadata' ? { name } : undefined)
      : Reflect.get(target, key, receiver)),
  }) as unknown as StoredReferenceRegistry;
  const tpl = (packageId: string) => registry.registerItem('email_template', {
    name: 'welcome', label: 'Welcome', locale: 'en-US', subject: 'hi', bodyHtml: '<p>x</p>',
  }, 'name' as never, packageId);
  const agent = (packageId: string) => registry.registerItem('agent', { name: 'helper', label: 'Helper', role: 'r', instructions: 'i' }, 'name' as never, packageId);
  const envRow = (id: string, type: string, name: string, member?: string) => rows.push({
    id, type, name, state: 'active', package_id: null, ...(member ? { bundle_member: member } : {}),
    metadata: JSON.stringify({ name }),
  });

  beforeEach(() => {
    rows = [];
    registry.installPackage(manifest(X, 'alphax'), 'code');
    registry.installPackage(manifest(Y, 'betay'), 'code');
  });

  it('THE PIN: two holders, so the package-less row is listed naming both by their addresses, for a bundled type and any other', async () => {
    tpl(X);
    tpl(Y);
    agent(X);
    agent(Y);
    envRow('row_a', 'agent', 'helper');
    envRow('row_fr', 'email_template', 'welcome', 'fr-FR');
    const answer = await collectStoredPackageReferences(engine, carrying());
    expect(answer.packageLessRows).toEqual([
      {
        table: 'sys_metadata', id: 'row_a', type: 'agent', name: 'helper', member: null,
        candidates: [
          { holder: 'package', packageId: X, address: 'alphax/helper' },
          { holder: 'package', packageId: Y, address: 'betay/helper' },
        ],
      },
      {
        table: 'sys_metadata', id: 'row_fr', type: 'email_template', name: 'welcome', member: 'fr-FR',
        candidates: [
          { holder: 'package', packageId: X, address: 'alphax/welcome' },
          { holder: 'package', packageId: Y, address: 'betay/welcome' },
        ],
      },
    ]);
  });

  it('[#32183] one of the two holders disabled: the package-less row is still listed naming both (the report reads every holder)', async () => {
    tpl(X);
    tpl(Y);
    envRow('row_fr', 'email_template', 'welcome', 'fr-FR');
    registry.disablePackage(Y);
    expect((await collectStoredPackageReferences(engine, carrying())).packageLessRows.map((f) => f.candidates.map((c) => c.packageId)))
      .toEqual([[X, Y]]);
  });

  it('CONTROL: one holder, or a row bound to a package, is not listed', async () => {
    tpl(X);
    envRow('row_fr', 'email_template', 'welcome', 'fr-FR');
    expect((await collectStoredPackageReferences(engine, carrying())).packageLessRows).toEqual([]);
    tpl(Y);
    rows = [{ id: 'row_x', type: 'email_template', name: 'welcome', state: 'active', package_id: X, bundle_member: 'fr-FR', metadata: '{}' }];
    expect((await collectStoredPackageReferences(engine, carrying())).packageLessRows).toEqual([]);
  });
});
