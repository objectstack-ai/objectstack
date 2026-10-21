// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The parent-record read gates (`sys_activity`, `sys_audit_log`) skip a parent
 * object the caller may not read WITHOUT reading it as the caller — so the
 * security middleware's refusal, and the WARN line it logs for every refusal,
 * never happens for a skip the caller did not ask for.
 *
 * ## Why a real engine, a real driver and the real plugin
 *
 * What is pinned is a composition: `AuditPlugin` resolving the kernel's
 * `security` service at READ time (it registers after the audit plugin here,
 * as it may in a deployment), the gate asking that service's `canReadObject`
 * before any caller-scoped parent read, and the emitted WHERE selecting the
 * same rows through a real driver as the gate selected without it. The rows
 * are written by the real CRUD mirror.
 *
 * ## The one stand-in, and why it is the smallest honest one
 *
 * plugin-security. Its middleware is played by one engine middleware on the
 * vault object, which REFUSES a non-admin's read by throwing (and records the
 * refusal, standing in for its WARN line), and its `canReadObject` gives the
 * same answer for the same caller — the parity plugin-security pins for the
 * real pair in its own `can-read-object-admission.test.ts`. The real pair is
 * driven end to end, logs included, by the dogfood suite's
 * `parent-read-gate-silent-skip.dogfood.test.ts`.
 *
 * The stand-in service can withdraw `canReadObject` — the contract's
 * optional-method state — so every case compares the gate WITH the admission
 * against the gate as it reads without one, on the same kernel and rows.
 *
 * [ADR-0139 E5] Two readers of that admission now. With it, the vault — which
 * carries an object-scoped read middleware (the stand-in for plugin-security's
 * refusal), one of D5's classes — is read through the gate's bounded probe,
 * which asks `canReadObject` first: the behaviour pinned here. Every other
 * parent object is a `ReadableIds` leaf, which the ENGINE composes from
 * `canReadObject` and `getReadFilter` without reading the parent as the
 * caller. Without it, the gate writes no leaf at all and reads every parent
 * through the probe, as the caller (`parent-record-read-gate.ts`: a leaf needs
 * the object-level admission) — the no-admission comparison below.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { AuditPlugin } from './audit-plugin.js';
import { singlePostureTenancy } from './__tests__/single-posture-tenancy.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const ACTIVITY = 'sys_activity';
const LEDGER = 'sys_audit_log';
/** A parent object no member may read: its read is refused (and the refusal recorded). */
const VAULT = 'adm_vault';
/** A parent object every caller reads. */
const OPEN = 'adm_board';
const HARNESS_PACKAGE = 'com.objectstack.audit.test.read-admission';

const SYS = { isSystem: true } as const;
const MEMBER = { userId: 'u_member', tenantId: 'org_1', positions: ['org_member'], __readScope: 'org' };
const ADMIN = { userId: 'u_admin', tenantId: 'org_1', positions: ['org_admin'] };

const READ_OPS = new Set(['find', 'findOne', 'count', 'aggregate']);
const isAdmin = (context: any) => context?.userId === ADMIN.userId;

const objectOf = (name: string, label: string) => ({
  name,
  label,
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
});

/** The security middleware's refusals of a vault read, by caller — its WARN lines, in this harness. */
const refusals: Array<{ object: string; operation: string; userId?: string }> = [];
/** The object-level admission's questions: object and the envelope it was asked with. */
const asked: Array<{ object: string; context: any }> = [];

/**
 * The stand-in `security` service; `canReadObject` is withdrawn by deleting it.
 * `getReadFilter` (no row restriction) is the other half the engine composes a
 * leaf from.
 */
const security: {
  canReadObject?: (object: string, context?: any) => Promise<boolean>;
  getReadFilter: (object: string, context?: any) => Promise<Record<string, unknown> | undefined>;
} = {
  getReadFilter: async () => undefined,
};
const admit = async (object: string, context?: any) => {
  asked.push({ object, context });
  return object !== VAULT || isAdmin(context);
};

function securityStandIn(): Plugin {
  return {
    name: 'test.security-stand-in',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService('security', security);
    },
  };
}

type Row = Record<string, any>;
const ids = (rows: Row[]) => rows.map((r) => String(r.id)).sort();

describe('parent-record read gates: the object-level read admission', () => {
  let kernel: ObjectKernel;
  let engine: ObjectQL;
  const recordIds: Record<string, string> = {};

  /** `run` with the stand-in offering no `canReadObject`, then with it. */
  const withoutAdmission = async <T>(run: () => Promise<T>): Promise<T> => {
    delete security.canReadObject;
    try {
      return await run();
    } finally {
      security.canReadObject = admit;
    }
  };

  /** One read, with the refusals and admission questions it produced. */
  const measure = async <T>(run: () => Promise<T>) => {
    refusals.length = 0;
    asked.length = 0;
    const value = await run();
    return { value, refusals: [...refusals], asked: [...asked] };
  };

  beforeAll(async () => {
    security.canReadObject = admit;
    kernel = new ObjectKernel({ logger: { level: 'silent' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(singlePostureTenancy());
    await kernel.use(new AuditPlugin());
    // Registered AFTER the audit plugin: the gate resolves it per read.
    await kernel.use(securityStandIn());
    await kernel.bootstrap();

    engine = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    engine.registry.registerObject(objectOf(VAULT, 'Vault') as any, HARNESS_PACKAGE);
    engine.registry.registerObject(objectOf(OPEN, 'Board') as any, HARNESS_PACKAGE);
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);

    // plugin-security's refusal of a vault read, for anyone but the admin.
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      if (READ_OPS.has(op.operation) && op.context && !op.context.isSystem && !isAdmin(op.context)) {
        refusals.push({ object: op.object, operation: op.operation, userId: op.context.userId });
        throw Object.assign(new Error(`[Security] Access denied: operation '${op.operation}' on object '${op.object}'`), {
          code: 'PERMISSION_DENIED',
          statusCode: 403,
        });
      }
      return next();
    }, { object: VAULT });

    // Every row below is written by the real audit writer's CRUD mirror.
    recordIds.vault = (await engine.insert(VAULT, { name: 'vault one' }, { context: SYS })).id;
    await engine.update(VAULT, { name: 'vault one, renamed' }, { where: { id: recordIds.vault }, context: SYS });
    recordIds.board = (await engine.insert(OPEN, { name: 'board one' }, { context: SYS })).id;
    await engine.update(OPEN, { name: 'board one, renamed' }, { where: { id: recordIds.board }, context: SYS });
  }, 120_000);

  afterAll(async () => {
    if (kernel) {
      await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    }
  }, 30_000);

  it('control: both gated objects hold rows about both parents, and a member’s direct vault read is refused', async () => {
    for (const object of [ACTIVITY, LEDGER]) {
      const rows: Row[] = await engine.find(object, { context: SYS });
      expect(rows.filter((r) => r.object_name === VAULT && r.record_id === recordIds.vault).length).toBeGreaterThan(0);
      expect(rows.filter((r) => r.object_name === OPEN && r.record_id === recordIds.board).length).toBeGreaterThan(0);
    }
    const direct = await measure(() => engine.find(VAULT, { context: MEMBER }).catch((e: Error) => e));
    expect(direct.value).toBeInstanceOf(Error);
    expect(direct.refusals).toEqual([{ object: VAULT, operation: 'find', userId: MEMBER.userId }]);
  });

  for (const object of [ACTIVITY, LEDGER]) {
    it(`${object}: a member’s list and total skip the vault without reading it, and serve the same rows as before`, async () => {
      const before = await withoutAdmission(() =>
        measure(async () => ({
          rows: ids(await engine.find(object, { context: MEMBER })),
          total: await engine.count(object, {}, { context: MEMBER }),
        })),
      );
      // Armed: without the admission the gate reads the vault as the member,
      // and the security middleware refuses it — once for the rows, once for the total.
      expect(before.refusals.map((r) => `${r.object}:${r.operation}`)).toEqual([`${VAULT}:find`, `${VAULT}:find`]);
      expect(before.value.rows.length).toBeGreaterThan(0);

      const after = await measure(async () => ({
        rows: ids(await engine.find(object, { context: MEMBER })),
        total: await engine.count(object, {}, { context: MEMBER }),
      }));
      expect(after.value).toEqual(before.value);
      expect(after.refusals).toEqual([]);
      // The gate's probe asks about the vault once per read (rows, total), with
      // the member's envelope minus the operation-private keys — the envelope
      // the caller-scoped read gets.
      const probeAsked = after.asked.filter((a) => a.object === VAULT);
      expect(probeAsked).toHaveLength(2);
      for (const a of probeAsked) {
        expect(a.context).toMatchObject({ userId: MEMBER.userId, positions: MEMBER.positions });
        expect(a.context).not.toHaveProperty('__readScope');
      }
      // The board is a ReadableIds leaf: the engine asks about it, once per
      // read, while composing it.
      expect(after.asked.filter((a) => a.object === OPEN)).toHaveLength(2);
    });
  }

  it('an admin, whom the admission admits, still reads the vault rows as before', async () => {
    const before = await withoutAdmission(() => measure(async () => ids(await engine.find(ACTIVITY, { context: ADMIN }))));
    const after = await measure(async () => ids(await engine.find(ACTIVITY, { context: ADMIN })));
    expect(after.value).toEqual(before.value);
    const all: Row[] = await engine.find(ACTIVITY, { context: SYS });
    const vaultRowIds = all.filter((r) => r.object_name === VAULT).map((r) => String(r.id));
    expect(vaultRowIds.length).toBeGreaterThan(0);
    for (const id of vaultRowIds) expect(after.value).toContain(id);
  });
});
