// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT — does a BULK write reach the ADR-0058 D4 write-`check` gate?
 *
 * The gate at `security-plugin.ts` step 3.6 is entered only when the payload is
 * NOT an array (`!Array.isArray(opCtx.data)`), and that block is the only
 * production site that computes the check filter or installs
 * `opCtx.postHookWriteImageCheck`. Whether anything can arrive array-shaped is
 * the open question; this file answers it from the faces a real caller uses.
 *
 * Each arm writes THE SAME violating row — a member whose parent lives in an
 * organization the caller does not hold, so the app's `beforeInsert` stamp
 * lands `employer_org = org_b` on a caller holding only `org_a`. The single-row
 * arm is the CONTROL: without it, a bulk write refused for some unrelated
 * reason would read as coverage.
 *
 * Three facts are read per arm, never inferred:
 *   1. the SHAPE `opCtx.data` carries when the security middleware runs;
 *   2. whether the gate body ran at all (`computeWriteCheckFilter` call count,
 *      and whether `postHookWriteImageCheck` was installed on the context);
 *   3. what is in the driver's own table afterwards, read past every scope.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OWN_ORG = 'org_a';
const OTHER_ORG = 'org_b';

const OBJECTS = [
  {
    name: 'qa_employer',
    label: 'Employer',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      employer_org: { name: 'employer_org', type: 'text' },
    },
  },
  {
    name: 'qa_employer_member',
    label: 'Employer member',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      employer: { name: 'employer', type: 'lookup', reference: 'qa_employer' },
      employer_org: { name: 'employer_org', type: 'text' },
      role: { name: 'role', type: 'text' },
    },
  },
];

const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const EMPLOYER_ADMIN: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_employer_admin',
  objects: {
    qa_employer: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_employer_member: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    {
      name: 'employer_admin_members',
      object: 'qa_employer_member',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
  ],
});

const SYS_CTX = { isSystem: true, userId: 'usr_system' };
const CALLER = {
  userId: 'usr_admin_a',
  email: 'admin@a.example',
  positions: ['employer_admin'],
  permissions: ['qa_employer_admin'],
  posture: 'MEMBER',
};

interface Seen {
  object: string;
  operation: string;
  isArray: boolean;
  gateInstalled: boolean;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.bulk-write-check-reachability',
    name: 'Bulk write check reachability',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  // The app's stamp: reads the parent OUTSIDE RLS and overwrites the scoping
  // field from it, whatever the caller sent (ADR-0055's denormalised shape).
  const stamp = async (ctx: { input: { data: Record<string, unknown> } }) => {
    const employerId = ctx.input.data.employer;
    if (typeof employerId !== 'string' || employerId === '') return;
    const parent = (await engine.findOne('qa_employer', {
      where: { id: employerId },
      context: SYS_CTX,
    } as never)) as Record<string, unknown> | null;
    if (parent?.employer_org != null) ctx.input.data.employer_org = parent.employer_org;
  };
  engine.on('beforeInsert', 'qa_employer_member', stamp as never);
  engine.on('beforeUpdate', 'qa_employer_member', stamp as never);

  const resolver = {
    keys: ['employer_org_ids'],
    resolve: vi.fn(async () => ({ employer_org_ids: [OWN_ORG] })),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, EMPLOYER_ADMIN],
    },
    [RLS_MEMBERSHIP_RESOLVER_SERVICE]: resolver,
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  // The gate body's own entry point, counted rather than argued about.
  const checkFilterSpy = vi.spyOn(plugin as unknown as {
    computeWriteCheckFilter: (...a: unknown[]) => Promise<unknown>;
  }, 'computeWriteCheckFilter');
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  // Registered AFTER the security middleware, so it runs inside its `next()` —
  // i.e. after step 3.6 has had its say. It reads the very `opCtx` the guard
  // read, and whether the guard installed the insert seam on it.
  const seen: Seen[] = [];
  (engine as unknown as {
    registerMiddleware(fn: (c: Record<string, unknown>, n: () => Promise<void>) => Promise<void>): void;
  }).registerMiddleware(async (opCtx, next) => {
    if (opCtx.operation === 'insert' || opCtx.operation === 'update') {
      seen.push({
        object: String(opCtx.object),
        operation: String(opCtx.operation),
        isArray: Array.isArray(opCtx.data),
        gateInstalled: opCtx.postHookWriteImageCheck != null,
      });
    }
    await next();
  });

  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn')
    .mockImplementation(() => undefined);

  await engine.insert(
    'qa_employer',
    [
      { id: 'emp_a', name: 'A', employer_org: OWN_ORG },
      { id: 'emp_b', name: 'B', employer_org: OTHER_ORG },
    ],
    { context: SYS_CTX } as never,
  );
  seen.length = 0;
  checkFilterSpy.mockClear();

  const protocol = new ObjectStackProtocolImplementation(engine as never);

  const stored = async () => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: (t: string) => unknown } })
      .getDriver('qa_employer_member');
    return (await (driver.knex as unknown as (t: string) => {
      select: (...c: string[]) => Promise<Array<Record<string, unknown>>>;
    })('qa_employer_member').select('id', 'employer', 'employer_org')) as Array<Record<string, unknown>>;
  };

  return { engine, protocol, seen, checkFilterSpy, stored };
}

interface Outcome { ok: boolean; value?: unknown; code?: string; status?: number; message?: string; developerMessage?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    const value = await run();
    return { ok: true, value };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string; developerMessage?: string };
    return {
      ok: false,
      code: err.code,
      status: err.statusCode ?? err.status,
      message: String(err.message ?? e),
      developerMessage: err.developerMessage,
    };
  }
};

/** The violating row: its parent lives in an organization the caller does not hold. */
const violatingRow = (id: string) => ({ id, employer: 'emp_b', employer_org: OWN_ORG, role: 'admin' });

describe('bulk write × the ADR-0058 D4 write-check gate — reachability', () => {
  it('CONTROL — the single-row face refuses the violating row, and nothing lands', async () => {
    const b = await boot();

    const outcome = await attempt(() =>
      b.engine.insert('qa_employer_member', violatingRow('mem_single'), { context: CALLER } as never),
    );

    // eslint-disable-next-line no-console
    console.log('[single-row] outcome=', JSON.stringify(outcome), 'seen=', JSON.stringify(b.seen),
      'checkFilterCalls=', b.checkFilterSpy.mock.calls.length, 'stored=', JSON.stringify(await b.stored()));

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('PERMISSION_DENIED');
    expect(outcome.status).toBe(403);
    expect(b.seen.filter((s) => s.object === 'qa_employer_member'))
      .toEqual([{ object: 'qa_employer_member', operation: 'insert', isArray: false, gateInstalled: true }]);
    expect(await b.stored()).toEqual([]);
  });

  it('MEASURE — ObjectQL.insertMany (the engine bulk door)', async () => {
    const b = await boot();

    const outcome = await attempt(() =>
      b.engine.insertMany('qa_employer_member', [violatingRow('mem_many')], { context: CALLER } as never),
    );

    // eslint-disable-next-line no-console
    console.log('[insertMany] outcome=', JSON.stringify(outcome), 'seen=', JSON.stringify(b.seen),
      'checkFilterCalls=', b.checkFilterSpy.mock.calls.length, 'stored=', JSON.stringify(await b.stored()));
    expect(true).toBe(true);
  });

  it('MEASURE — protocol.createManyData (what POST /data/:object/createMany calls)', async () => {
    const b = await boot();

    const outcome = await attempt(() =>
      (b.protocol as unknown as {
        createManyData(r: { object: string; records: unknown[]; context?: unknown }): Promise<unknown>;
      }).createManyData({ object: 'qa_employer_member', records: [violatingRow('mem_rest')], context: CALLER }),
    );

    // eslint-disable-next-line no-console
    console.log('[createManyData] outcome=', JSON.stringify(outcome), 'seen=', JSON.stringify(b.seen),
      'checkFilterCalls=', b.checkFilterSpy.mock.calls.length, 'stored=', JSON.stringify(await b.stored()));
    expect(true).toBe(true);
  });

  it('MEASURE — protocol.insertManyData (the partial-success / import face)', async () => {
    const b = await boot();

    const outcome = await attempt(() =>
      (b.protocol as unknown as {
        insertManyData(r: { object: string; records: unknown[]; context?: unknown }): Promise<unknown>;
      }).insertManyData({ object: 'qa_employer_member', records: [violatingRow('mem_import')], context: CALLER }),
    );

    // eslint-disable-next-line no-console
    console.log('[insertManyData] outcome=', JSON.stringify(outcome), 'seen=', JSON.stringify(b.seen),
      'checkFilterCalls=', b.checkFilterSpy.mock.calls.length, 'stored=', JSON.stringify(await b.stored()));
    expect(true).toBe(true);
  });

  it('MEASURE — protocol.batchData create rows (POST /data/:object/batch)', async () => {
    const b = await boot();

    const outcome = await attempt(() =>
      (b.protocol as unknown as {
        batchData(r: { object: string; request: unknown; context?: unknown }): Promise<unknown>;
      }).batchData({
        object: 'qa_employer_member',
        request: { operation: 'create', records: [{ data: violatingRow('mem_batch') }] },
        context: CALLER,
      }),
    );

    // eslint-disable-next-line no-console
    console.log('[batchData] outcome=', JSON.stringify(outcome), 'seen=', JSON.stringify(b.seen),
      'checkFilterCalls=', b.checkFilterSpy.mock.calls.length, 'stored=', JSON.stringify(await b.stored()));
    expect(true).toBe(true);
  });

  it('MEASURE — protocol.updateManyData (POST /data/:object/updateMany)', async () => {
    const b = await boot();
    // Seed the row IN scope so the `using` pre-image gate admits the caller and
    // the CHECK is the gate under test.
    await b.engine.insert(
      'qa_employer_member',
      { id: 'mem_upd', employer: 'emp_a', employer_org: OWN_ORG, role: 'admin' },
      { context: SYS_CTX } as never,
    );
    b.seen.length = 0;
    b.checkFilterSpy.mockClear();

    const outcome = await attempt(() =>
      (b.protocol as unknown as {
        updateManyData(r: { object: string; records: unknown[]; context?: unknown }): Promise<unknown>;
      }).updateManyData({
        object: 'qa_employer_member',
        records: [{ id: 'mem_upd', data: { employer_org: OTHER_ORG, role: 'lead' } }],
        context: CALLER,
      }),
    );

    // eslint-disable-next-line no-console
    console.log('[updateManyData] outcome=', JSON.stringify(outcome), 'seen=', JSON.stringify(b.seen),
      'checkFilterCalls=', b.checkFilterSpy.mock.calls.length, 'stored=', JSON.stringify(await b.stored()));
    expect(true).toBe(true);
  });
});
