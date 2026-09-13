// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seed-ownership claim is NOT a single pass — and it says so.
 *
 * ## The defect these pins are written against
 *
 * `claimSeedOwnership` was reached from `bootstrapPlatformAdmin` exactly once
 * per database lifetime, on the pass that promotes the first admin, and it
 * walked the object registry while the platform's own seeder was still writing
 * in the BACKGROUND — `AppPlugin` races its inline seed against
 * `OS_INLINE_SEED_BUDGET_MS` (default 8 s) and continues an over-budget bundle
 * past kernel start rather than block it. Registry order and seed order are
 * unrelated, so every object whose rows landed after its walk stayed
 * `owner_id IS NULL` forever: nothing ever re-ran the claim. Measured on a CRM
 * bundle at `@objectstack/* 17.4.0` — 73 rows across six objects, the SAME
 * loser set on two independent boots on fresh databases.
 *
 * The consequence is a permission one, which is why the rows cannot just be
 * left: an ownerless row is invisible to every `readScope: 'own'` grant, and
 * under `public_read` it reads fine and answers 403 on every write for any
 * grant at `modifyAllRecords: false` — a granted permission that can never be
 * exercised.
 *
 * ## Two halves, pinned separately
 *
 * **Ordering** — `security-plugin.ts` re-runs the claim on `app:seeded`, the
 * published settle signal for that background continuation. ⛔ Deliberately NOT
 * done by widening `shouldReplayBootstrapFor`: a replayed bootstrap
 * short-circuits on `already_have_admin` and returns BEFORE the claim, so a
 * wider trigger re-runs a pass that cannot do the missed work. The end-to-end
 * pin below therefore drives the real `SecurityPlugin`, not the claim helper —
 * the wiring IS the fix.
 *
 * **The detector** — the silence was part of the defect, not a separate nit.
 * A pass that matched nothing used to log nothing at all, so a boot that left
 * rows permanently ownerless and a boot with nothing to do produced identical
 * evidence. Every pass now reports what it did AND whether its reading was
 * final, keyed on the published `seed-settlement` contract.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SEED_SETTLEMENT_SERVICE } from '@objectstack/spec/contracts';
import type { SeedSettlementSnapshot } from '@objectstack/spec/contracts';
import { SecurityPlugin } from './security-plugin.js';
import { claimSeedOwnership } from './claim-seed-ownership.js';

const ADMIN = 'usr_admin_human';
const SYSTEM = 'usr_system';

// ───────────────────────────────────────────────────────────────────────────
// A generic in-memory engine double
// ───────────────────────────────────────────────────────────────────────────

/**
 * `where` as this package spells it: field equality plus `{ id: { $in: [...] } }`.
 *
 * Anything else is REFUSED rather than answered — a combinator read as a field
 * name, or an unimplemented value operator read as a literal, is silently wrong
 * on exactly the shape a pin exists to judge.
 */
function rowMatches(row: any, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) {
      throw new Error(`this double implements field predicates only; it cannot answer '${k}'`);
    }
    const actual = row?.[k] ?? null;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ops = Object.keys(v as Record<string, unknown>);
      if (ops.length === 1 && ops[0] === '$in') {
        return ((v as any).$in as unknown[]).some((m) => (m ?? null) === actual);
      }
      throw new Error(
        `this double implements equality and $in only; it cannot answer ${JSON.stringify(ops)}`,
      );
    }
    return actual === (v ?? null);
  });
}

/**
 * An in-memory ObjectQL double over a table map.
 *
 * `update` opens with the PRODUCER's own dispatch predicate
 * (`check:engine-double-contract`) rather than a hand-mirrored guard: a double
 * looser than the engine would let a regression to single-id writes pass green.
 * A predicate write resolves the AFFECTED ROW COUNT (#4639), never a record.
 */
function makeEngine(tables: Record<string, any[]>, schemas: any[]) {
  const middlewares: any[] = [];
  const engine: any = {
    tables,
    middlewares,
    registry: { getAllObjects: () => schemas },
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => schemas.find((s) => s.name === name),
    async find(object: string, query: any = {}) {
      const all = tables[object] ?? [];
      let hits = all.filter((r) => rowMatches(r, query?.where ?? {}));
      for (const ord of [...(query?.orderBy ?? [])].reverse()) {
        hits = [...hits].sort((a, b) => {
          const av = a?.[ord.field] ?? '';
          const bv = b?.[ord.field] ?? '';
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return ord.order === 'desc' ? -cmp : cmp;
        });
      }
      if (typeof query?.offset === 'number') hits = hits.slice(query.offset);
      if (typeof query?.limit === 'number') hits = hits.slice(0, query.limit);
      return hits.map((r) => ({ ...r }));
    },
    async findOne(object: string, query: any = {}) {
      // The producer's own predicate, imported rather than re-derived
      // (`check:engine-double-contract`): a double looser than `ObjectQL.findOne`
      // is how a dead code path ships with its suite green.
      assertEngineFindOnePredicate(object, query);
      const rows = await engine.find(object, { ...query, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return { ...data };
    },
    async update(object: string, data: any, options: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = tables[object] ?? [];
      if (dispatch.kind === 'multi') {
        const matched = rows.filter((r) => rowMatches(r, options?.where ?? {}));
        for (const r of matched) Object.assign(r, data);
        return matched.length;
      }
      const target = rows.find((r) => r.id === (data?.id ?? options?.where?.id));
      if (target) Object.assign(target, data);
      return target ? 1 : 0;
    },
  };
  return engine;
}

/** A seed-settlement tracker whose tally the test drives by hand. */
function makeSettlement(initialInFlight: number) {
  let inFlight = initialInFlight;
  return {
    settleOne: () => {
      inFlight = Math.max(0, inFlight - 1);
    },
    service: {
      snapshot: (): SeedSettlementSnapshot => ({ pending: inFlight, inFlight, suppressed: [] }),
    },
  };
}

/** A business object the claim is eligible to walk. */
const businessObject = (name: string) => ({
  name,
  fields: [{ name: 'id' }, { name: 'owner_id' }],
});

/** The seed loader's own write: a plain record, `owner_id` left unset. */
const seedRow = (id: string) => ({ id, owner_id: null });

// ───────────────────────────────────────────────────────────────────────────
// The ordering half — driven through the real plugin
// ───────────────────────────────────────────────────────────────────────────

/**
 * Boot `SecurityPlugin` over the double with one promotable human, one object
 * whose seed rows have already landed, and one whose rows land later.
 */
async function bootPlugin() {
  const settlement = makeSettlement(1);
  const schemas = [businessObject('crm_account'), businessObject('crm_contract')];
  const tables: Record<string, any[]> = {
    // The seeder's identity row plus one human who can authenticate — the
    // promotion target.
    sys_user: [
      { id: SYSTEM, email: 'system@objectstack', created_at: '2020-01-01T00:00:00.000Z' },
      { id: ADMIN, email: 'admin@objectos.ai', created_at: '2026-01-01T00:00:00.000Z' },
    ],
    sys_account: [{ id: 'acc_1', user_id: ADMIN, provider_id: 'credential' }],
    sys_user_permission_set: [],
    sys_permission_set: [],
    // WINNER: rows the seeder already wrote before the promotion instant.
    crm_account: [seedRow('acc_seed_1'), seedRow('acc_seed_2')],
    // LOSER: the object whose rows the background seed has not reached yet.
    crm_contract: [],
  };
  const engine = makeEngine(tables, schemas);
  const hooks: Array<[string, (...a: any[]) => any]> = [];
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async () => null, list: async () => [] },
    [SEED_SETTLEMENT_SERVICE]: settlement.service,
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: any = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: (name: string, cb: any) => hooks.push([name, cb]),
  };

  const plugin = new SecurityPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);

  const fire = async (event: string, payload?: unknown) => {
    const matching = hooks.filter(([n]) => n === event);
    for (const [, cb] of matching) await cb(payload);
    return matching.length;
  };
  const ownerOf = (object: string) => (tables[object] ?? []).map((r) => r.owner_id);
  return { tables, logger, fire, ownerOf, settlement };
}

describe('seed-ownership claim — the one-shot pass and the seed it races', () => {
  it('re-owns rows seeded AFTER the promotion pass, once the seed settles', async () => {
    const rig = await bootPlugin();

    // ── Boot: the promotion pass runs while the seeder is still writing ─────
    const readyHooks = await rig.fire('kernel:ready');
    expect(readyHooks).toBeGreaterThan(0);

    // Positive control. The one-shot pass is REAL and does claim: without this
    // line a fixture that claimed nothing at all would satisfy the assertions
    // below for the wrong reason.
    expect(rig.ownerOf('crm_account')).toEqual([ADMIN, ADMIN]);

    // ── The background seed lands its remaining rows, past kernel start ─────
    rig.tables.crm_contract.push(seedRow('con_1'), seedRow('con_2'), seedRow('con_3'));
    // Ownerless at this instant — this is the defect's own moment, measured
    // rather than asserted away: the one-shot pass walked `crm_contract` before
    // these rows existed and nothing re-reads it.
    expect(rig.ownerOf('crm_contract')).toEqual([null, null, null]);

    // ── The settle signal for exactly that continuation ─────────────────────
    rig.settlement.settleOne();
    const seededHooks = await rig.fire('app:seeded', { appId: 'com.example.crm', overBudget: true });
    expect(seededHooks).toBe(1);

    // The rows the one-shot pass missed are now owned by the SAME admin.
    expect(rig.ownerOf('crm_contract')).toEqual([ADMIN, ADMIN, ADMIN]);
  });

  it('moves ownership for the missed rows ONLY — a row a human already owns is untouched', async () => {
    const rig = await bootPlugin();
    await rig.fire('kernel:ready');

    // Three rows the background seed lands late, in the three states the claim
    // can meet: unowned, owned by the seeder's own identity, and owned by a
    // DIFFERENT human. The third is the permission boundary this repair must
    // not move — re-owning it would be a change of who owns a row beyond the
    // rows the one-shot pass missed.
    rig.tables.crm_contract.push(
      { id: 'con_null', owner_id: null },
      { id: 'con_system', owner_id: SYSTEM },
      { id: 'con_other', owner_id: 'usr_someone_else' },
    );

    rig.settlement.settleOne();
    await rig.fire('app:seeded', { appId: 'com.example.crm', overBudget: true });

    expect(rig.ownerOf('crm_contract')).toEqual([ADMIN, ADMIN, 'usr_someone_else']);
  });

  it('claims to the SAME admin on a later boot, where the promotion short-circuits', async () => {
    // `already_have_admin`: the grant row already exists, so no promotion
    // happens and the old code never reached the claim at all. The pass still
    // knows who the admin is, and the settle re-run claims to that user.
    const rig = await bootPlugin();
    rig.tables.sys_user_permission_set.push({
      id: 'ups_existing',
      user_id: ADMIN,
      permission_set_id: 'ps_admin_full_access',
      organization_id: null,
    });
    rig.tables.sys_permission_set.push({ id: 'ps_admin_full_access', name: 'admin_full_access' });

    await rig.fire('kernel:ready');
    rig.tables.crm_contract.push(seedRow('con_late'));
    rig.settlement.settleOne();
    await rig.fire('app:seeded', { appId: 'com.example.crm', overBudget: true });

    expect(rig.ownerOf('crm_contract')).toEqual([ADMIN]);
  });

  it('does nothing when no admin has been resolved yet', async () => {
    // An in-budget seed settles before any human exists. There is nobody to
    // claim to, and the promotion that follows does its own claim against a
    // seed that has already settled.
    const rig = await bootPlugin();
    rig.tables.sys_user = [];
    rig.tables.sys_account = [];
    await rig.fire('kernel:ready');
    rig.tables.crm_contract.push(seedRow('con_1'));

    rig.settlement.settleOne();
    await rig.fire('app:seeded', { appId: 'com.example.crm', overBudget: false });

    expect(rig.ownerOf('crm_contract')).toEqual([null]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The detector half
// ───────────────────────────────────────────────────────────────────────────

/** The smallest rig that runs one claim pass and captures what it reported. */
async function runClaim(rows: any[], seedSettlement: SeedSettlementSnapshot | undefined) {
  const schemas = [businessObject('crm_contract')];
  const engine = makeEngine({ crm_contract: rows }, schemas);
  const logger = { info: vi.fn(), warn: vi.fn() };
  const results = await claimSeedOwnership(engine, ADMIN, { logger, seedSettlement });
  return { results, logger };
}

describe('seed-ownership claim — "claimed 0 of 0" versus "nothing to claim"', () => {
  it('WARNS that a pass taken while a seed is still writing is provisional', async () => {
    // The defect's own shape: the walk reaches an object whose rows have not
    // landed yet, matches nothing, and — before this — said nothing at all.
    const { results, logger } = await runClaim([], { pending: 1, inFlight: 1, suppressed: [] });

    expect(results).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, meta] = logger.warn.mock.calls[0]!;
    expect(message).toContain('handed 0 seeded record(s)');
    expect(message).toContain('PROVISIONAL');
    expect(message).toContain('app:seeded');
    expect(meta).toMatchObject({ claimed: 0, eligibleObjects: 1, seedInFlight: 1 });
    // ⚠️ The whole point: this is NOT the line a settled pass emits.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('reports a settled pass as FINAL — the same count, a different fact', async () => {
    const { results, logger } = await runClaim([], { pending: 0, inFlight: 0, suppressed: [] });

    expect(results).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message] = logger.info.mock.calls[0]!;
    expect(message).toContain('handed 0 seeded record(s)');
    expect(message).toContain('final');
    expect(message).toContain('nothing left to claim');
  });

  it('the two zero-row passes are distinguishable — the count alone is not', async () => {
    // Both walked one eligible object and claimed nothing. Before the repair
    // they produced BYTE-IDENTICAL evidence (none), which is what let a boot
    // that permanently orphaned 73 rows report healthy.
    const provisional = await runClaim([], { pending: 1, inFlight: 1, suppressed: [] });
    const settled = await runClaim([], { pending: 0, inFlight: 0, suppressed: [] });

    expect(provisional.results).toEqual(settled.results);
    const said = (rig: typeof provisional) =>
      [...rig.logger.warn.mock.calls, ...rig.logger.info.mock.calls].map((c) => String(c[0]));
    expect(said(provisional)).not.toEqual(said(settled));
    expect(said(provisional).join(' ')).toContain('PROVISIONAL');
    expect(said(settled).join(' ')).toContain('final');
  });

  it('a suppressed source is NOT in flight — a multi-tenant boot is final, not provisional', async () => {
    // Suppressed sources (multi-tenant replay, `skipSeedData`) never settle and
    // write no rows during this boot, so there is nothing for this pass to
    // miss on their account. Keying finality on `pending` would mark every such
    // boot provisional forever — a permanent warning about correct behaviour.
    const { logger } = await runClaim([], {
      pending: 1,
      inFlight: 0,
      suppressed: ['multi-tenant-replay'],
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(String(logger.info.mock.calls[0]![0])).toContain('final');
  });

  it('says so when no settlement probe is registered, rather than guessing', async () => {
    const { logger } = await runClaim([], undefined);

    expect(logger.warn).not.toHaveBeenCalled();
    const [message] = logger.info.mock.calls[0]!;
    expect(message).toContain('unattested');
    expect(message).not.toContain('final');
  });

  it('reports the claimed count and the walked population on a productive pass', async () => {
    const { results, logger } = await runClaim(
      [seedRow('c1'), { id: 'c2', owner_id: SYSTEM }, { id: 'c3', owner_id: 'usr_other' }],
      { pending: 0, inFlight: 0, suppressed: [] },
    );

    expect(results).toEqual([{ object: 'crm_contract', count: 2 }]);
    const [message, meta] = logger.info.mock.calls[0]!;
    expect(message).toContain('handed 2 seeded record(s)');
    expect(message).toContain('1 of 1 eligible object(s)');
    expect(meta).toMatchObject({ claimed: 2, eligibleObjects: 1 });
  });
});
