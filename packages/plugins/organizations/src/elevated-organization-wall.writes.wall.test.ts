// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation's WRITES are bounded by its caller's organization
 * wall, for every caller the wall judges — not only
 * one the wall may deny (`elevated-organization-wall.wall.test.ts` holds the
 * read and denial matrix):
 *
 * - a write that names an organization names one the caller's wall admits,
 *   and an update never empties the organization of a row: a member of one
 *   organization's action body can neither land a new row in another
 *   organization nor move a row there (ADR-0095 D1; the plain door's answer
 *   is `403 PERMISSION_DENIED`);
 * - the row a by-id write names is judged where the write runs: inside the
 *   body's own transaction, a row the transaction wrote is the caller's to
 *   write again, as at the plain door.
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

const APP = {
  manifest: { id: 'com.example.eoww', namespace: 'eoww', version: '0.0.1', type: 'app', name: 'Elevated Org Wall Writes Fixture' },
  requires: ['automation'],
  objects: [
    {
      name: TASK,
      label: 'Task',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' }, touched: { type: 'text', label: 'Touched' } },
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
  ],
};

const SYS = { context: { isSystem: true } } as const;

describe('an app-authored elevation writes through the organization wall what its caller writes there', () => {
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
    it('an action body handler cannot land a new row in another organization', async () => {
      await reseed();
      const r = await run(alice, 'eoww_land', { name: 'LAND-B', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('LAND-B')).toBeUndefined();
    });

    it('a declared action body cannot land a new row in another organization', async () => {
      await reseed();
      const r = await run(alice, 'eoww_body_land', { name: 'BODY-LAND-B', org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await rowNamed('BODY-LAND-B')).toBeUndefined();
    });

    it('an action body handler cannot move its organization’s row into another organization', async () => {
      await reseed();
      const a1 = await rowNamed('A1');
      const r = await run(alice, 'eoww_move', { target: a1!.id, org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('A1'))!.organization_id).toBe(orgA);
    });

    it('a declared action body cannot move its organization’s row into another organization', async () => {
      await reseed();
      const a1 = await rowNamed('A1');
      const r = await run(alice, 'eoww_body_move', { target: a1!.id, org: orgB });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect((await rowNamed('A1'))!.organization_id).toBe(orgA);
    });

    it('an action body handler cannot leave its organization’s row in no organization', async () => {
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
