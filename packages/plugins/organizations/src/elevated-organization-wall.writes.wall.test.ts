// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation's WRITES are judged by its caller's organization
 * wall, for every caller the wall judges — not only
 * one the wall may deny (`elevated-organization-wall.wall.test.ts` holds the
 * read and denial matrix):
 *
 * - a write whose own data names an organization the caller's wall does not
 *   admit, and an update whose own data empties a row's organization, are
 *   refused `403 PERMISSION_DENIED`;
 * - the row a by-id write names is judged where the write runs: inside the
 *   body's own transaction, a row the transaction wrote is the caller's to
 *   write again, as at the plain door;
 * - a write is judged as it will be stored: an organization the write's
 *   before-hooks leave on the row is held to the same wall as one the write
 *   sent;
 * - an organization the operation's option bag names (`tenantId`,
 *   `tenantIds`) is held to the caller's wall: a write naming one outside it
 *   is refused `403`, and a read naming one is answered by the read rule.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`) under `isolated`: auth (better-auth
 * organizations), the security plugin, the app plugin, the automation engine,
 * and THIS package's `OrganizationsPlugin`. Every action runs through
 * `POST /api/v1/actions/...`. Rows are seeded and read back as SYSTEM.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { OrganizationsPlugin } from './organizations-plugin.js';

const WALLED_BOOT_ENV = [
  ['OS_TENANCY_POSTURE', 'isolated'],
  ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
] as const;

const TASK = 'eoww_task';

const BODY_LAND = "await ctx.api.object('eoww_task').insert({ name: input.name, organization_id: input.org }); return { landed: 1 };";
const BODY_MOVE = "await ctx.api.object('eoww_task').update({ id: input.target, organization_id: input.org }); return { moved: 1 };";
// Bodies that forward their caller's input into the option bag of each verb.
const BODY_BAG_FIND =
  "const rows = await ctx.api.object('eoww_task').find({ where: {}, tenantId: input.org }); return { seen: rows.map((r) => r.name).sort() };";
const BODY_BAG_FIND_MANY =
  "const rows = await ctx.api.object('eoww_task').find({ where: {}, tenantIds: input.orgs }); return { seen: rows.map((r) => r.name).sort() };";
const BODY_BAG_UPDATE =
  "await ctx.api.object('eoww_task').update({ touched: 'bag' }, { where: { name: input.name }, multi: true, tenantId: input.org }); return { wrote: 1 };";
const BODY_BAG_UPDATE_BY_ID =
  "await ctx.api.object('eoww_task').update({ id: input.target, touched: 'bag' }, { tenantId: input.org }); return { wrote: 1 };";
const BODY_BAG_DELETE =
  "await ctx.api.object('eoww_task').delete({ where: { name: input.name }, multi: true, tenantId: input.org }); return { removed: 1 };";

const APP = {
  manifest: { id: 'com.example.eoww', namespace: 'eoww', version: '0.0.1', type: 'app', name: 'Elevated Org Wall Writes Fixture' },
  requires: ['automation'],
  objects: [
    {
      name: TASK,
      label: 'Task',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        touched: { type: 'text', label: 'Touched' },
        hint: { type: 'text', label: 'Hint' },
      },
    },
  ],
  actions: [
    { name: 'eoww_land', label: 'Land', objectName: TASK, type: 'script', target: 'eowwLand' },
    { name: 'eoww_move', label: 'Move', objectName: TASK, type: 'script', target: 'eowwMove' },
    {
      name: 'eoww_body_land',
      label: 'Body land',
      objectName: TASK,
      type: 'script',
      body: { language: 'js', source: BODY_LAND, capabilities: ['api.read', 'api.write'] },
    },
    {
      name: 'eoww_body_move',
      label: 'Body move',
      objectName: TASK,
      type: 'script',
      body: { language: 'js', source: BODY_MOVE, capabilities: ['api.read', 'api.write'] },
    },
    { name: 'eoww_tx_touch', label: 'Transaction touch', objectName: TASK, type: 'script', target: 'eowwTxTouch' },
    { name: 'eoww_touch', label: 'Touch', objectName: TASK, type: 'script', target: 'eowwTouch' },
    { name: 'eoww_hooked_land', label: 'Hooked land', objectName: TASK, type: 'script', target: 'eowwHookedLand' },
    { name: 'eoww_hooked_touch', label: 'Hooked touch', objectName: TASK, type: 'script', target: 'eowwHookedTouch' },
    { name: 'eoww_hooked_sweep', label: 'Hooked sweep', objectName: TASK, type: 'script', target: 'eowwHookedSweep' },
    { name: 'eoww_late_bag', label: 'Late bag', objectName: TASK, type: 'script', target: 'eowwLateBag' },
    { name: 'eoww_late_read', label: 'Late read', objectName: TASK, type: 'script', target: 'eowwLateRead' },
    ...(
      [
        ['eoww_bag_find', BODY_BAG_FIND],
        ['eoww_bag_find_many', BODY_BAG_FIND_MANY],
        ['eoww_bag_update', BODY_BAG_UPDATE],
        ['eoww_bag_update_by_id', BODY_BAG_UPDATE_BY_ID],
        ['eoww_bag_delete', BODY_BAG_DELETE],
      ] as const
    ).map(([name, source]) => ({
      name,
      label: name,
      objectName: TASK,
      type: 'script',
      body: { language: 'js', source, capabilities: ['api.read', 'api.write'] },
    })),
  ],
};

const SYS = { context: { isSystem: true } } as const;

describe('an app-authored elevation’s writes are judged by its caller’s organization wall', () => {
  const restoreEnv: Array<[string, string | undefined]> = [];
  let stack: VerifyStack;
  let ql: any;
  let alice: string;
  let operator: string;
  let orgA: string;
  let orgB: string;
  let orgOp: string;

  const answer = async (res: Response) => ({ status: res.status, body: (await res.json().catch(() => undefined)) as any });
  const run = async (token: string, action: string, params: Record<string, unknown> = {}) =>
    answer(await stack.apiAs(token, 'POST', `/actions/${TASK}/${action}`, { params }));
  const rowNamed = async (name: string): Promise<Record<string, unknown> | undefined> =>
    (await ql.find(TASK, { where: { name }, limit: 1 }, SYS))[0];
  const reseed = async () => {
    for (const r of await ql.find(TASK, { where: {} }, SYS)) {
      await ql.delete(TASK, { where: { id: r.id }, context: { isSystem: true, tenantId: r.organization_id ?? orgA } });
    }
    for (const [org, name] of [[orgA, 'A1'], [orgB, 'B1'], [orgOp, 'O1']] as const) {
      await ql.insert(TASK, { name }, { context: { isSystem: true, tenantId: org } });
    }
  };

  beforeAll(async () => {
    for (const [name, value] of WALLED_BOOT_ENV) {
      restoreEnv.push([name, process.env[name]]);
      process.env[name] = value;
    }
    stack = await bootStack(APP as never, { extraPlugins: [new OrganizationsPlugin()], automation: true });
    ql = await stack.kernel.getServiceAsync('objectql');
    ql.registerAction(TASK, 'eowwLand', async (ctx: any) => {
      await ctx.engine.insert(TASK, { name: ctx.params?.name, organization_id: ctx.params?.org });
      return { landed: 1 };
    });
    ql.registerAction(TASK, 'eowwMove', async (ctx: any) => {
      await ctx.engine.update(TASK, String(ctx.params?.target), { organization_id: ctx.params?.org });
      return { moved: 1 };
    });
    ql.registerAction(TASK, 'eowwTxTouch', async (ctx: any) => {
      const id = await ctx.api.transaction(async (trx: any) => {
        const row = await trx.object(TASK).insert({ name: ctx.params?.name });
        await trx.object(TASK).update({ id: row.id, touched: 'tx' });
        return row.id;
      });
      return { id };
    });
    // A before-hook that names an organization on the row it is handed: the
    // `hint` the write carries.
    for (const event of ['beforeInsert', 'beforeUpdate']) {
      ql.registerHook(
        event,
        async (ctx: any) => {
          const data = ctx.input?.data;
          if (data && typeof data.hint === 'string' && data.hint !== '') data.organization_id = data.hint;
        },
        { object: TASK },
      );
    }
    // A before-hook that writes a tenant key into the option bag of a write it
    // is handed, and one that writes it into the bag of a read.
    ql.registerHook(
      'beforeUpdate',
      async (ctx: any) => {
        const touched = ctx.input?.data?.touched;
        if (typeof touched === 'string' && touched.startsWith('late:') && ctx.input.options) {
          ctx.input.options.tenantId = touched.slice('late:'.length);
        }
      },
      { object: TASK },
    );
    let lateReadOrg: string | undefined;
    ql.registerHook(
      'beforeFind',
      async (ctx: any) => {
        if (lateReadOrg !== undefined && ctx.input?.options) ctx.input.options.tenantId = lateReadOrg;
      },
      { object: TASK },
    );
    ql.registerAction(TASK, 'eowwHookedLand', async (ctx: any) => {
      await ctx.engine.insert(TASK, { name: ctx.params?.name, hint: ctx.params?.org });
      return { landed: 1 };
    });
    ql.registerAction(TASK, 'eowwHookedTouch', async (ctx: any) => {
      await ctx.engine.update(TASK, String(ctx.params?.target), { touched: 'hooked', hint: ctx.params?.org });
      return { wrote: 1 };
    });
    ql.registerAction(TASK, 'eowwHookedSweep', async (ctx: any) => {
      await ctx.api.object(TASK).update({ touched: 'swept', hint: ctx.params?.org }, { where: { name: 'A1' }, multi: true });
      return { wrote: 1 };
    });
    ql.registerAction(TASK, 'eowwLateBag', async (ctx: any) => {
      await ctx.api
        .object(TASK)
        .update({ touched: `late:${String(ctx.params?.org)}` }, { where: { name: { $in: ['A1', ctx.params?.name] } }, multi: true });
      return { wrote: 1 };
    });
    ql.registerAction(TASK, 'eowwLateRead', async (ctx: any) => {
      lateReadOrg = String(ctx.params?.org);
      try {
        const rows = await ctx.api.object(TASK).find({ where: {} });
        return { seen: rows.map((r: any) => r.name).sort() };
      } finally {
        lateReadOrg = undefined;
      }
    });
    ql.registerAction(TASK, 'eowwTouch', async (ctx: any) => {
      await ctx.engine.update(TASK, String(ctx.params?.target), { touched: 'touch' });
      return { wrote: 1 };
    });

    alice = await stack.signUp('eoww-alice@verify.test');
    const bob = await stack.signUp('eoww-bob@verify.test');
    const create = async (token: string, slug: string) => {
      const r = await answer(await stack.apiAs(token, 'POST', '/auth/organization/create', { name: slug, slug }));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.id as string;
    };
    orgA = await create(alice, 'eoww-org-a');
    orgB = await create(bob, 'eoww-org-b');
    // The platform operator (the harness's seeded admin) works in an
    // organization of its own.
    operator = await stack.signIn();
    orgOp = await create(operator, 'eoww-org-op');
    for (const [token, org] of [[alice, orgA], [operator, orgOp]] as const) {
      expect((await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId: org })).status).toBe(200);
    }
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    for (const [name, value] of restoreEnv.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('PREMISE: the wall is up, and the operator holds the platform rung', async () => {
    const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('isolated');
    const session = await answer(await stack.apiAs(operator, 'GET', '/auth/get-session'));
    expect(session.body?.session?.activeOrganizationId).toBe(orgOp);
    const grants = await resolveUserAuthzGrants(ql, session.body?.user?.id, { tenantId: orgOp });
    expect(grants.posture).toBe('PLATFORM_ADMIN');
  });

  describe('a member with an active organization', () => {
    it('an action body handler’s insert that names another organization is refused', async () => {
      await reseed();
      const r = await run(alice, 'eoww_land', { name: 'LAND-B', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('LAND-B')).toBeUndefined();
    });

    it('a declared action body’s insert that names another organization is refused', async () => {
      await reseed();
      const r = await run(alice, 'eoww_body_land', { name: 'BODY-LAND-B', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('BODY-LAND-B')).toBeUndefined();
    });

    it('an action body handler’s update that names another organization is refused', async () => {
      await reseed();
      const a1 = await rowNamed('A1');
      const r = await run(alice, 'eoww_move', { target: a1!.id, org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('A1'))!.organization_id).toBe(orgA);
    });

    it('a declared action body’s update that names another organization is refused', async () => {
      await reseed();
      const a1 = await rowNamed('A1');
      const r = await run(alice, 'eoww_body_move', { target: a1!.id, org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('A1'))!.organization_id).toBe(orgA);
    });

    it('an action body handler’s update that empties the organization is refused', async () => {
      await reseed();
      const a1 = await rowNamed('A1');
      const r = await run(alice, 'eoww_move', { target: a1!.id, org: null });
      expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
      expect(['PERMISSION_DENIED', 'VALIDATION_FAILED']).toContain(r.body.error.code);
      expect((await rowNamed('A1'))!.organization_id).toBe(orgA);
    });

    it('control: a row named for its own organization lands there, and a row kept in it updates', async () => {
      await reseed();
      const landed = await run(alice, 'eoww_land', { name: 'LAND-A', org: orgA });
      expect(landed.status, JSON.stringify(landed.body)).toBe(200);
      expect((await rowNamed('LAND-A'))!.organization_id).toBe(orgA);
      const a1 = await rowNamed('A1');
      const kept = await run(alice, 'eoww_move', { target: a1!.id, org: orgA });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      expect((await rowNamed('A1'))!.organization_id).toBe(orgA);
    });
  });

  describe('a write is judged as it will be stored', () => {
    it('an organization a before-hook places on an insert outside the caller’s wall is refused 403', async () => {
      await reseed();
      const r = await run(alice, 'eoww_hooked_land', { name: 'HOOKED-B', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('HOOKED-B')).toBeUndefined();
    });

    it('an organization a before-hook places on a by-id update outside the caller’s wall is refused 403', async () => {
      await reseed();
      const a1 = await rowNamed('A1');
      const r = await run(alice, 'eoww_hooked_touch', { target: a1!.id, org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('A1')).toMatchObject({ organization_id: orgA });
      expect((await rowNamed('A1'))!.touched ?? null).toBeNull();
    });

    it('an organization a before-hook places on a predicate update outside the caller’s wall is refused 403', async () => {
      await reseed();
      const r = await run(alice, 'eoww_hooked_sweep', { org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('A1')).toMatchObject({ organization_id: orgA });
      expect((await rowNamed('A1'))!.touched ?? null).toBeNull();
    });

    it('control: a before-hook that places the row in the caller’s own organization lands it there', async () => {
      await reseed();
      const landed = await run(alice, 'eoww_hooked_land', { name: 'HOOKED-A', org: orgA });
      expect(landed.status, JSON.stringify(landed.body)).toBe(200);
      expect((await rowNamed('HOOKED-A'))!.organization_id).toBe(orgA);
      const a1 = await rowNamed('A1');
      const kept = await run(alice, 'eoww_hooked_touch', { target: a1!.id, org: orgA });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      expect(await rowNamed('A1')).toMatchObject({ organization_id: orgA, touched: 'hooked' });
    });
  });

  describe('the option bag’s organization is held to the caller’s wall', () => {
    it('a read whose bag names another organization is answered by the read rule', async () => {
      await reseed();
      const one = await run(alice, 'eoww_bag_find', { org: orgB });
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body.data).toEqual({ seen: [] });
      const many = await run(alice, 'eoww_bag_find_many', { orgs: [orgA, orgB] });
      expect(many.status, JSON.stringify(many.body)).toBe(200);
      expect(many.body.data).toEqual({ seen: [] });
    });

    it('a predicate update whose bag names another organization is refused 403', async () => {
      await reseed();
      const r = await run(alice, 'eoww_bag_update', { name: 'B1', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('B1'))!.touched ?? null).toBeNull();
    });

    it('a by-id update whose bag names another organization is refused 403', async () => {
      await reseed();
      const b1 = await rowNamed('B1');
      const r = await run(alice, 'eoww_bag_update_by_id', { target: b1!.id, org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('B1'))!.touched ?? null).toBeNull();
    });

    it('a delete whose bag names another organization is refused 403', async () => {
      await reseed();
      const r = await run(alice, 'eoww_bag_delete', { name: 'B1', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('B1')).toBeDefined();
    });

    it('a tenant key a before-hook writes into the bag of a write is held to the wall too', async () => {
      await reseed();
      const r = await run(alice, 'eoww_late_bag', { name: 'B1', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('B1'))!.touched ?? null).toBeNull();
      expect((await rowNamed('A1'))!.touched ?? null).toBeNull();
    });

    it('a tenant key a before-hook writes into the bag of a read is answered by the read rule', async () => {
      await reseed();
      const r = await run(alice, 'eoww_late_read', { org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ seen: [] });
      const own = await run(alice, 'eoww_late_read', { org: orgA });
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data).toEqual({ seen: ['A1'] });
    });

    it('control: a bag naming the caller’s own organization reads and writes there', async () => {
      await reseed();
      const read = await run(alice, 'eoww_bag_find', { org: orgA });
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body.data).toEqual({ seen: ['A1'] });
      const wrote = await run(alice, 'eoww_bag_update', { name: 'A1', org: orgA });
      expect(wrote.status, JSON.stringify(wrote.body)).toBe(200);
      expect((await rowNamed('A1'))!.touched).toBe('bag');
    });

    it('control: platform system work that runs for no caller keeps the organization its bag names', async () => {
      await reseed();
      const seen = await ql.find(TASK, { where: {}, tenantId: orgB, context: { isSystem: true } });
      expect(seen.map((r: any) => r.name).sort()).toEqual(['B1']);
      await ql.update(TASK, { touched: 'platform' }, { where: { name: 'B1' }, multi: true, tenantId: orgB, context: { isSystem: true } });
      expect((await rowNamed('B1'))!.touched).toBe('platform');
    });
  });

  describe('a platform operator under a walled posture, inside the body’s own transaction', () => {
    it('a row the transaction inserted is the operator’s to update by id in the same transaction', async () => {
      await reseed();
      const r = await run(operator, 'eoww_tx_touch', { name: 'TX-OP' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const row = await rowNamed('TX-OP');
      expect(row?.organization_id).toBe(orgOp);
      expect(row?.touched).toBe('tx');
    }, 30_000);

    it('the check of the row the by-id write names is read inside that same transaction', async () => {
      await reseed();
      // The wall's check reads the addressed row as the platform, by the
      // wall's predicate (`{ $and: [{ id }, <the caller's Layer 0>] }`). On a
      // store with one connection per transaction (Postgres) a read outside it
      // cannot see the row the transaction inserted, and on a store with one
      // connection in all it waits on that connection; so it is asked inside.
      const findOne = vi.spyOn(ql, 'findOne');
      try {
        const r = await run(operator, 'eoww_tx_touch', { name: 'TX-OP-2' });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        const checks = findOne.mock.calls.filter(
          ([object, options]: any[]) =>
            object === TASK && Array.isArray(options?.where?.$and) && options?.context?.isSystem === true,
        );
        expect(checks.length, 'the wall checked the addressed row').toBeGreaterThan(0);
        for (const [, options] of checks as any[]) expect(options.context.transaction, 'the check carries the write’s transaction').toBeDefined();
      } finally {
        findOne.mockRestore();
      }
    }, 30_000);

    it('control: a row of another organization still answers as a row that is not there', async () => {
      await reseed();
      const b1 = await rowNamed('B1');
      const r = await run(operator, 'eoww_touch', { target: b1!.id });
      expect(r.status, JSON.stringify(r.body)).toBe(404);
      expect(r.body.error.code).toBe('RECORD_NOT_FOUND');
      expect((await rowNamed('B1'))!.touched ?? null).toBeNull();
    });

    it('control: its own organization’s row updates by id', async () => {
      await reseed();
      const o1 = await rowNamed('O1');
      const r = await run(operator, 'eoww_touch', { target: o1!.id });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await rowNamed('O1'))!.touched).toBe('touch');
    });
  });
});
