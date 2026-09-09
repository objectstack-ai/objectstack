// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// hotcrm#1579 step 5a (#15951) — the in-process handle drives the REAL engine.
//
// One `it` per handle method, each asserting on something ONLY the kernel
// service behind that method can produce: a hook-derived column, a declared
// validation rule's verdict, a screen flow's pause and its resumed write, a
// sandboxed action body's write, a batch seed, a filtered read, a registry
// item, the tenancy posture. The ablation record on the PR breaks each of
// those kernel services in turn and shows exactly the corresponding `it`
// going red while the others stay green — a method whose pin survives its
// service being broken is not testing the service.
//
// The parity block is the card's second acceptance: `hooks.run` and the
// REST write have to agree on the SAME persisted row AND the SAME refusal.
// The refusal half is the one every hand-rolled harness faked away (no
// permission check at all), so it is pinned with a control that FIRES: the
// admin, on the identical call, is admitted by both doors.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { bootStack, bootStackOnce, type VerifyStack, type BootOptions } from './harness.js';
import { isVerifyRefusal } from './handle.js';
import {
  handleFixtureStack,
  HANDLE_MEMBER_SET,
  STAGE_PROBABILITY,
  STAGE_FORECAST,
  today,
} from './handle.fixture.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

/** A module constant, so `bootStackOnce` can key the shared boot on it. */
const BOOT_OPTIONS: BootOptions = { automation: true };

let stack: VerifyStack;
let admin: string;
let member: string;

beforeAll(async () => {
  stack = await bootStackOnce(handleFixtureStack, BOOT_OPTIONS);
  admin = await stack.signIn();
  member = await stack.signUp('handle-member@verify.test');
}, BOOT_TIMEOUT);

afterAll(async () => {
  // This file OWNS its worker's shared boot; a file that merely shares one
  // must not do this (see `bootStackOnce`).
  await stack?.stop().catch(() => undefined);
});

/** Unique per run, so list assertions never see another test's rows. */
const uniq = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codeOf = (e: unknown): string | undefined => (e as any)?.code;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statusOf = (e: unknown): number | undefined => (e as any)?.statusCode ?? (e as any)?.status;

describe('contextFor — the dispatcher resolves the caller, the handle never assembles one', () => {
  it('resolves a member token to that member, not to the system principal', async () => {
    const ec = await stack.contextFor(member);
    expect(typeof ec.userId).toBe('string');
    expect(ec.isSystem).not.toBe(true);
    expect(Array.isArray(ec.positions)).toBe(true);
    // The declared default profile is what the member holds (#7001) — proof
    // the resolver read the permission tables, not a stub.
    expect(ec.permissions).toContain(HANDLE_MEMBER_SET);
  });

  it('refuses a token that resolves to nobody, loudly', async () => {
    await expect(stack.contextFor('not-a-session-token')).rejects.toThrow(/resolved to no signed-in user/);
  });
});

describe('hooks.run — the bound hook chain runs inside the real write', () => {
  it('insert: the L2 lifecycle hook derives probability, expected_revenue and forecast_category', async () => {
    const row = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('deal'), amount: 10_000, stage: 'proposal' },
      { as: member },
    );
    expect(typeof row.id).toBe('string');
    expect(row.probability).toBe(STAGE_PROBABILITY.proposal);
    expect(row.expected_revenue).toBe(6_000);
    expect(row.forecast_category).toBe(STAGE_FORECAST.proposal);
    expect(row.stage_entry_date).toBe(today());
  });

  it('update: the beforeUpdate leg recomputes from the pre-image the engine loads', async () => {
    const created = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('deal'), amount: 10_000, stage: 'proposal' },
      { as: member },
    );
    await stack.hooks.run('hnd_deal', 'update', { id: created.id, amount: 50_000 }, { as: member });
    const [after] = await stack.rows('hnd_deal', { id: created.id });
    // 50k × 60% — the hook read `previous.probability` off the engine's pre-image.
    expect(after.expected_revenue).toBe(30_000);
    expect(after.stage).toBe('proposal');
  });

  it('delete: the engine removes the row (admin)', async () => {
    const created = await stack.hooks.run(
      'hnd_deal',
      'insert',
      { name: uniq('deal'), amount: 1, stage: 'prospecting' },
      { as: admin },
    );
    await stack.hooks.run('hnd_deal', 'delete', { id: created.id }, { as: admin });
    expect(await stack.rows('hnd_deal', { id: created.id })).toEqual([]);
  });

  it('update/delete without an id are refused before the engine is touched', async () => {
    await expect(stack.hooks.run('hnd_deal', 'update', { amount: 1 }, { as: admin })).rejects.toThrow(/input\.id/);
    await expect(stack.hooks.run('hnd_deal', 'delete', {}, { as: admin })).rejects.toThrow(/input\.id/);
  });
});

describe('parity pin — hooks.run is the REST write minus HTTP', () => {
  it('the same input yields the same persisted row through both doors (hook-derived columns included)', async () => {
    const input = { amount: 25_000, stage: 'negotiation' };
    const viaHandle = await stack.hooks.run('hnd_deal', 'insert', { name: uniq('parity'), ...input }, { as: member });
    const viaRest = await stack.apiAs(member, 'POST', '/data/hnd_deal', { name: uniq('parity'), ...input });
    expect(viaRest.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restBody = (await viaRest.json()) as any;
    const restId: string = restBody?.id ?? restBody?.record?.id;
    expect(typeof restId).toBe('string');

    const [handleRow] = await stack.rows('hnd_deal', { id: viaHandle.id });
    const [restRow] = await stack.rows('hnd_deal', { id: restId });
    const derived = (r: Record<string, unknown>) => ({
      probability: r.probability,
      expected_revenue: r.expected_revenue,
      forecast_category: r.forecast_category,
      stage_entry_date: r.stage_entry_date,
      created_by: r.created_by,
    });
    expect(derived(handleRow)).toEqual(derived(restRow));
    expect(handleRow.probability).toBe(STAGE_PROBABILITY.negotiation);
    expect(handleRow.expected_revenue).toBe(20_000);
  });

  it('the same refusal comes out of both doors — and the control (admin) is admitted by both', async () => {
    // The member holds no grant on hnd_vault.
    let handleErr: unknown;
    try {
      await stack.hooks.run('hnd_vault', 'insert', { name: uniq('vault') }, { as: member });
    } catch (e) {
      handleErr = e;
    }
    expect(handleErr, 'hooks.run must REFUSE the ungranted write').toBeDefined();
    expect(codeOf(handleErr)).toBe('PERMISSION_DENIED');
    expect(statusOf(handleErr)).toBe(403);

    const viaRest = await stack.apiAs(member, 'POST', '/data/hnd_vault', { name: uniq('vault') });
    expect(viaRest.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restBody = (await viaRest.json()) as any;
    expect(restBody?.code ?? restBody?.error?.code).toBe('PERMISSION_DENIED');

    // Control that FIRES and DISCRIMINATES: the identical call as the platform
    // admin is admitted by both doors, so the refusal above is the grant
    // being evaluated — not the object being broken.
    const adminRow = await stack.hooks.run('hnd_vault', 'insert', { name: uniq('vault') }, { as: admin });
    expect(typeof adminRow.id).toBe('string');
    const adminRest = await stack.apiAs(admin, 'POST', '/data/hnd_vault', { name: uniq('vault') });
    expect(adminRest.status).toBe(201);
  });
});

describe('validate — the engine validation pass, without a write', () => {
  it('reports the declared rule verdict for a bad row and a clean verdict for a good one', async () => {
    const bad = await stack.validate('hnd_deal', { name: 'x', amount: -5, stage: 'proposal' }, { as: member });
    expect(bad.valid).toBe(false);
    expect(bad.results[0].valid).toBe(false);
    expect(bad.results[0].errors.map((e) => e.message)).toContain('Amount cannot be negative');

    const good = await stack.validate('hnd_deal', { name: 'x', amount: 5, stage: 'proposal' }, { as: member });
    expect(good.valid).toBe(true);
    expect(good.mode).toBe('insert');
  });

  it('writes nothing', async () => {
    const name = uniq('validate-only');
    await stack.validate('hnd_deal', { name, amount: 5, stage: 'proposal' }, { as: member });
    expect(await stack.rows('hnd_deal', { name })).toEqual([]);
  });
});

describe('flows.run / flows.resume — the automation service registered at boot', () => {
  it('pauses on the screen node, then the resumed half performs the declared write', async () => {
    const [note] = await stack.seed('hnd_note', [{ name: uniq('note'), status: 'open' }]);

    const run = await stack.flows.run('hnd_resolve_note', { noteId: note.id }, { as: admin });
    expect(run.status).toBe('paused');
    expect(typeof run.runId).toBe('string');
    expect(run.flowName).toBe('hnd_resolve_note');
    expect(run.screen?.fields.map((f) => f.name)).toContain('resolution');

    const resumed = await stack.flows.resume(run, { resolution: 'called back' }, { as: admin });
    expect(resumed.success).toBe(true);
    expect(resumed.status).not.toBe('paused');

    const [after] = await stack.rows('hnd_note', { id: note.id });
    expect(after.status).toBe('resolved');
    expect(after.resolution).toBe('called back');
  });

  it('a never-dispatched refusal arrives as the route envelope (code + status)', async () => {
    let err: unknown;
    try {
      await stack.flows.run('hnd_no_such_flow', {}, { as: admin });
    } catch (e) {
      err = e;
    }
    expect(isVerifyRefusal(err)).toBe(true);
    expect(statusOf(err)).toBe(404);
    expect(typeof codeOf(err)).toBe('string');
  });
});

describe('actions.run — the declared action, through the route that carries its contract', () => {
  it('runs the sandboxed body against the loaded record and returns its value', async () => {
    const [deal] = await stack.seed('hnd_deal', [{ name: uniq('discount'), amount: 1_000, stage: 'proposal' }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await stack.actions.run('hnd_deal', 'apply_discount', {
      as: admin,
      recordId: deal.id,
      params: { discount: 10 },
    })) as any;
    expect(result?.amount).toBe(900);
    expect(result?.discount).toBe(10);

    const [after] = await stack.rows('hnd_deal', { id: deal.id });
    expect(after.amount).toBe(900);
  });

  it('the ADR-0104 param contract refuses an undeclared key — same envelope a REST client gets', async () => {
    const [deal] = await stack.seed('hnd_deal', [{ name: uniq('discount'), amount: 1_000, stage: 'proposal' }]);
    let err: unknown;
    try {
      await stack.actions.run('hnd_deal', 'apply_discount', {
        as: admin,
        recordId: deal.id,
        params: { discount: 10, not_declared: true },
      });
    } catch (e) {
      err = e;
    }
    expect(isVerifyRefusal(err)).toBe(true);
    expect(statusOf(err)).toBe(400);
    // Control: the body never ran.
    const [after] = await stack.rows('hnd_deal', { id: deal.id });
    expect(after.amount).toBe(1_000);
  });
});

describe('seed / rows — real ObjectQL writes and reads', () => {
  it('seeds a batch through the engine and reads it back filtered', async () => {
    const prefix = uniq('seed');
    const written = await stack.seed('hnd_deal', [
      { name: `${prefix}-a`, amount: 1, stage: 'prospecting', note: prefix },
      { name: `${prefix}-b`, amount: 2, stage: 'negotiation', note: prefix },
      { name: `${prefix}-c`, amount: 3, stage: 'closed_won', note: prefix },
    ]);
    expect(written).toHaveLength(3);
    expect(written.every((r) => typeof r.id === 'string')).toBe(true);
    // The seed went through the real write: the hook derived the column.
    expect(written.map((r) => r.probability)).toEqual([10, 80, 100]);

    // The whole batch reads back — a read that answers fewer rows than were
    // written is the find door lying, not a fixture that forgot a row.
    const batch = await stack.rows('hnd_deal', { note: prefix });
    expect(batch.map((r) => r.name).sort()).toEqual([`${prefix}-a`, `${prefix}-b`, `${prefix}-c`]);

    const negotiating = await stack.rows('hnd_deal', { name: `${prefix}-b` });
    expect(negotiating).toHaveLength(1);
    expect(negotiating[0].stage).toBe('negotiation');
  });

  it('rows as a caller reads under that caller\'s grants (the vault is refused)', async () => {
    let err: unknown;
    try {
      await stack.rows('hnd_vault', {}, { as: member });
    } catch (e) {
      err = e;
    }
    expect(codeOf(err)).toBe('PERMISSION_DENIED');
    // Control: the same read as the admin is admitted.
    expect(Array.isArray(await stack.rows('hnd_vault', {}, { as: admin }))).toBe(true);
  });
});

describe('metadata — the booted registry', () => {
  it('object() and objects() read the registry (system columns injected)', () => {
    const deal = stack.metadata.object('hnd_deal');
    expect(deal?.fields && 'probability' in deal.fields).toBe(true);
    expect(deal?.fields && 'created_at' in deal.fields).toBe(true);
    const names = stack.metadata.objects().map((o) => o.name);
    expect(names).toContain('hnd_deal');
    expect(names).toContain('sys_user');
  });

  it('items(type) lists the registered items of one type, by the registry\'s singular name', () => {
    // `MetadataTypeSchema` spells permission sets `permission` — the registry's
    // vocabulary, not a name the handle invents (the first draft asked for
    // `permission_set` and the registry, correctly, held nothing by that name).
    const sets = stack.metadata.items<{ name: string }>('permission').map((s) => s.name);
    expect(sets).toContain(HANDLE_MEMBER_SET);
  });

  it('types() names the metadata types the registry holds', () => {
    expect(stack.metadata.types()).toContain('object');
  });
});

describe('tenancy — the service AuthPlugin registered', () => {
  it('reports the single-tenant posture a plain boot runs under', () => {
    const t = stack.tenancy();
    expect(t.posture).toBe('single');
    expect(t.requestedPosture).toBe('single');
    expect(t.isolationActive).toBe(false);
    expect(t.degraded).toBe(false);
  });

  // The `single` case alone is satisfied by any stand-in that answers the
  // constant `'single'` — which is exactly what the hand-written tenancy probe
  // this method retires was. So the SAME reader is pointed at a stack booted
  // under the other posture: a constant fails here, and the ablation that
  // breaks the service's isolation probe turns this red while leaving the
  // `single` case above green.
  it('reports the walled posture a multi-tenant boot runs under — same reader, other stack', async () => {
    const walled = await bootStack(handleFixtureStack, { multiTenant: 'posture-only' });
    try {
      const t = walled.tenancy();
      expect(t.requestedPosture).toBe('isolated');
      expect(t.isolationActive).toBe(true);
      expect(t.posture).toBe('isolated');
      expect(t.degraded).toBe(false);
    } finally {
      await walled.stop();
    }
  }, BOOT_TIMEOUT);
});

describe('bootStackOnce — one boot per (config, opts) identity', () => {
  it('hands the same boot back for the same keys, and it is this file\'s stack', async () => {
    const again = bootStackOnce(handleFixtureStack, BOOT_OPTIONS);
    expect(again).toBe(bootStackOnce(handleFixtureStack, BOOT_OPTIONS));
    expect(await again).toBe(stack);
  });

  it('refuses a non-object config rather than memoising on a value', () => {
    expect(() => bootStackOnce('not-a-config' as never)).toThrow(/identity/);
  });

  it('bootStack (unshared) still returns a distinct stack', async () => {
    const other = await bootStack(handleFixtureStack, { automation: true });
    try {
      expect(other).not.toBe(stack);
      expect(typeof other.hooks.run).toBe('function');
    } finally {
      await other.stop();
    }
  }, BOOT_TIMEOUT);
});
