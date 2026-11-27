// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36689, ruling A] The stdio data bridge refuses a disabled package's data
 * to EVERY caller, a system context included, at the addressed object and at
 * every nested-relation hop, on a host with a `protocol` service and on one
 * without: the posture `callData` takes since the #35526 ruling
 * (「系统身份也一律拒绝」), asked through the same predicate, the engine
 * registry's `isObjectPackageDisabled`.
 *
 * Driven against a REAL `ObjectQL` over an in-memory SQLite driver, with the
 * package disabled and re-enabled on the real registry. Each refusal has its
 * control: the same call, the package re-enabled, is served, so the refusal is
 * the package's and nothing else's. Before the fix, two cells served: a system
 * context on either host (the gate returned before any question), and any
 * caller addressing the object on a host with no protocol service (its copy
 * read cannot refuse).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql/core';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import {
  createStdioDataBridge,
  enforceApiExposure,
  engineObjectPackageDisabled,
  GATED_ACTIONS,
  type StdioProtocolObjectReads,
} from './stdio-data-bridge.js';

const PKG_A = 'dp36689_a';
const PKG_B = 'dp36689_b';
const PKG_C = 'dp36689_c';
const SECRET = 'BETA_SECRET';

const text = (name: string) => ({ name, label: name, type: 'text' });
const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });

const ALPHA = { name: 'dq_alpha', label: 'Alpha', fields: { name: text('name'), b_ref: lookup('b_ref', 'dq_beta'), c_ref: lookup('c_ref', 'dq_gamma') } };
const BETA = { name: 'dq_beta', label: 'Beta', fields: { name: text('name'), secret_note: text('secret_note') } };
const GAMMA = { name: 'dq_gamma', label: 'Gamma', fields: { name: text('name'), b2_ref: lookup('b2_ref', 'dq_beta') } };

const SYSTEM = { isSystem: true } as unknown as ExecutionContext;
const MEMBER = { userId: 'dq_member', isSystem: false, positions: [], permissions: [] } as unknown as ExecutionContext;

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app' }) as any;

const live: ObjectQL[] = [];
afterEach(async () => {
  while (live.length) {
    try { await live.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function makeHarness(opts: { withProtocol: boolean; principal: ExecutionContext }) {
  const engine = new ObjectQL();
  live.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
  await engine.init();
  for (const id of [PKG_A, PKG_B, PKG_C]) engine.registry.installPackage(manifest(id), 'code');
  engine.registry.registerObject(ALPHA as any, PKG_A, undefined, 'own');
  engine.registry.registerObject(BETA as any, PKG_B, undefined, 'own');
  engine.registry.registerObject(GAMMA as any, PKG_C, undefined, 'own');
  // The one organization the rows land in, as the runtime's default-organization testkit installs it.
  engine.registry.registerObject(
    { name: 'sys_organization', label: 'Organization', managedBy: 'better-auth', fields: { name: { type: 'text', label: 'Name' } } } as any,
    '@objectstack/runtime',
  );
  await engine.syncSchemas();
  await engine.getDriverForObject('sys_organization')!.create('sys_organization', { id: 'org_default', name: 'Default' });
  const beta: any = await engine.insert('dq_beta', { name: 'beta', secret_note: SECRET });
  const gamma: any = await engine.insert('dq_gamma', { name: 'gamma', b2_ref: beta.id });
  await engine.insert('dq_alpha', { name: 'alpha', b_ref: beta.id, c_ref: gamma.id });
  const protocol = opts.withProtocol
    ? (new ObjectStackProtocolImplementation(engine as any) as unknown as StdioProtocolObjectReads)
    : undefined;
  // A metadata service holding a copy of each object: the read the gate and
  // the relation walk fall back to (a host with no protocol service, or a
  // protocol whose metadata store is not wired here). A copy cannot say its
  // package is disabled, so it never refuses by itself.
  const copies: Record<string, unknown> = { dq_alpha: ALPHA, dq_beta: BETA, dq_gamma: GAMMA };
  const metadataService = { getObject: async (name: string) => copies[name] } as unknown as IMetadataService;
  const bridge = createStdioDataBridge({
    engine: engine as unknown as IDataEngine,
    metadataService,
    protocol: () => protocol,
    resolvePrincipal: async () => opts.principal,
  });
  return { engine, bridge, metadataService, protocol, betaId: String(beta.id) };
}

type Harness = Awaited<ReturnType<typeof makeHarness>>;

const VERBS = {
  query: (h: Harness) => h.bridge.query('dq_beta', { limit: 5 }),
  get: (h: Harness) => h.bridge.get('dq_beta', h.betaId),
  create: (h: Harness) => h.bridge.create('dq_beta', { name: 'new' }),
  update: (h: Harness) => h.bridge.update('dq_beta', h.betaId, { name: 'renamed' }),
  remove: (h: Harness) => h.bridge.remove('dq_beta', h.betaId),
  aggregate: (h: Harness) => h.bridge.aggregate!('dq_beta', { aggregations: [{ function: 'count', alias: 'n' }] }),
} as const;

const envelope = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, param: e?.param });

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  const err = await run().then(() => undefined, (e: unknown) => e);
  expect(err, 'served where callData refuses').toBeInstanceOf(Error);
  return err;
}

const count = async (h: Harness, where: Record<string, unknown>) => {
  const res: any = await h.bridge.aggregate!('dq_alpha', { where, aggregations: [{ function: 'count', alias: 'n' }] });
  const rows = Array.isArray(res) ? res : (res?.rows ?? res?.records ?? res?.value ?? []);
  return Number(rows?.[0]?.n ?? 0);
};

for (const withProtocol of [true, false]) {
  const host = withProtocol ? 'a host with a protocol service' : 'a host that registers no protocol service';

  for (const [who, principal] of [['a system context', SYSTEM], ['a member', MEMBER]] as const) {
    describe(`[#36689] ${host}, ${who}: a disabled package's object is refused, 404 OBJECT_PACKAGE_DISABLED`, () => {
      it.each(Object.keys(VERBS) as Array<keyof typeof VERBS>)('%s on the addressed object', async (verb) => {
        const h = await makeHarness({ withProtocol, principal });
        h.engine.registry.disablePackage(PKG_B);
        const err = await refusalOf(() => VERBS[verb](h));
        expect(envelope(err)).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dq_beta', param: undefined });
        // Nothing was written: the row is still there, unchanged, once re-enabled.
        h.engine.registry.enablePackage(PKG_B);
        const row: any = await h.engine.findOne('dq_beta', { where: { id: h.betaId } });
        expect(row?.name).toBe('beta');
      });

      for (const [shape, where, param] of [
        ['one hop', { b_ref: { secret_note: SECRET } }, 'where.b_ref'],
        ['two hops', { c_ref: { b2_ref: { secret_note: SECRET } } }, 'where.c_ref.b2_ref'],
      ] as const) {
        it(`a nested-relation condition into it (${shape}) is refused at its full position, the stored value or any other`, async () => {
          const h = await makeHarness({ withProtocol, principal });
          h.engine.registry.disablePackage(PKG_B);
          for (const value of [SECRET, 'NOPE']) {
            const probe = JSON.parse(JSON.stringify(where).replace(SECRET, value));
            const err = await refusalOf(() => count(h, probe));
            expect(envelope(err)).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dq_beta', param });
          }
        });
      }
    });
  }

  describe(`[#36689] ${host}: CONTROL the package re-enabled, a system context is served again`, () => {
    it('the addressed object is read, and its row comes back', async () => {
      const h = await makeHarness({ withProtocol, principal: SYSTEM });
      h.engine.registry.disablePackage(PKG_B);
      await refusalOf(() => VERBS.query(h));
      h.engine.registry.enablePackage(PKG_B);
      const res: any = await VERBS.query(h);
      expect(JSON.stringify(res)).toContain(SECRET);
    });

    it('a two-hop condition counts the stored value and not another: the refusal above was the package\'s', async () => {
      const h = await makeHarness({ withProtocol, principal: SYSTEM });
      h.engine.registry.disablePackage(PKG_B);
      h.engine.registry.enablePackage(PKG_B);
      expect(await count(h, { c_ref: { b2_ref: { secret_note: SECRET } } })).toBe(1);
      expect(await count(h, { c_ref: { b2_ref: { secret_note: 'NOPE' } } })).toBe(0);
    });
  });

  describe(`[#36689] ${host}: the record resource's gate asks the same question of a system context`, () => {
    it('refuses while disabled, lets the system context through once re-enabled', async () => {
      const h = await makeHarness({ withProtocol, principal: SYSTEM });
      // The reads `plugin.ts` hands the `objectstack://` record resource.
      const reads = {
        metadataService: h.metadataService,
        protocol: () => h.protocol,
        isObjectPackageDisabled: engineObjectPackageDisabled(h.engine),
      };
      h.engine.registry.disablePackage(PKG_B);
      const err = await refusalOf(() => enforceApiExposure(reads, 'dq_beta', GATED_ACTIONS.get, SYSTEM));
      expect(envelope(err)).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dq_beta', param: undefined });
      h.engine.registry.enablePackage(PKG_B);
      await expect(enforceApiExposure(reads, 'dq_beta', GATED_ACTIONS.get, SYSTEM)).resolves.toBeUndefined();
    });
  });
}
