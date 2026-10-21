// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22067] What the seed ownership claim's write DISPATCHES — measured on a REAL
 * `ObjectQL` over a real `SqlDriver` (better-sqlite3 `:memory:`).
 *
 * The claim re-owns seed rows to the platform admin. That is attribution, the
 * step that completes the seed, not a user event — so its write runs under
 * `{ isSystem: true, skipAutomations: true }`. This file pins what that context
 * reaches on the engine, because a flag that is silently dropped on the
 * predicate-write path would read as green in every double:
 *
 *  1. **the metadata-hook filter** — a hook bound through the real binder
 *     (`bindHooksToEngine`, which is what stamps `entry.meta`) does not fire,
 *     before or after, on any claimed row;
 *  2. **the per-row hook path** — code-registered hooks DO fire, once per
 *     matched row, and every per-row context carries the flag;
 *  3. **the record-change trigger's reading point** — every one of those
 *     contexts has `session.skipTriggers === true`, the one field
 *     `RecordChangeTrigger`'s handler reads before it dispatches a flow
 *     (`skipAutomations` implies it, `engine.ts` `buildSession`). The booted-app
 *     half — the real trigger, approvals, notifications, audit rows and the
 *     sharing projection — is `packages/qa/dogfood/test/
 *     seed-ownership-claim-dispatch.dogfood.test.ts`.
 *
 * And it measures the claim's one structural dependency on hook dispatch, the
 * per-row hook ceiling: the claim's fallback page size is derived from it, so
 * if the flag ever exempted a write from the ceiling the fallback would be dead
 * code and the page size wrong. It does not — the engine asks whether ANY hook
 * covers the object before it counts the matched rows, and code-registered
 * hooks still do — so an over-ceiling claim is still refused whole and still
 * pages to every row.
 *
 * Each case carries its positive control on the SAME engine: a plain
 * `{ isSystem: true }` predicate write over the same rows fires the metadata
 * hook per row. Without it, "the hook fired 0 times" could be a hook that was
 * never bound.
 *
 * [#23354] The NULL arm re-owns only the rows the seed reported landing on, as
 * `owner_id IS NULL AND id IN (chunk)`, one write per chunk of half the
 * ceiling. So its writes are under the ceiling by construction, and the
 * over-ceiling case is driven through the seed-identity arm, which is still
 * one predicate over every such row. The chunked write is measured here on the
 * real driver too: an `IN` list that size binds one parameter per id.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE,
  MAX_BULK_PER_ROW_HOOK_ROWS,
} from '@objectstack/spec/data';

import { claimSeedOwnership } from './claim-seed-ownership.js';
import { relaxEveryTenantColumn } from './pre-18-tenant-column.testkit.js';

const SYS = { context: { isSystem: true } } as const;
const ADMIN = 'usr_admin_human';
const SEED_IDENTITY = 'usr_system';
const OBJECT = 'probe_deal';

/** [#23354] The seed's report of the rows it landed on: every id given. */
const seededAre = (ids: string[]) => (object: string): readonly string[] => (object === OBJECT ? ids : []);

const PROBE_OBJECT: any = {
  name: OBJECT,
  label: 'Probe Deal',
  fields: {
    id: { type: 'text', label: 'Id', primary: true },
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    owner_id: { type: 'text', label: 'Owner' },
  },
};

/** One dispatch a hook saw: what the engine handed it, reduced to the flags. */
interface Seen {
  event: string;
  mode: unknown;
  isSystem: unknown;
  skipAutomations: unknown;
  skipTriggers: unknown;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * A booted engine with ONE metadata-bound hook and ONE code-registered hook on
 * the probe object, both on `beforeUpdate` and `afterUpdate`.
 *
 * The metadata hook is bound through `bindHooksToEngine` — the binder an app's
 * `defineStack({ hooks })` goes through — so its entry carries `meta` exactly as
 * a shipped app hook's does. The code hook is `registerHook` with no metadata,
 * the shape of plugin-audit's writer, plugin-sharing's rule projection and
 * `RecordChangeTrigger`'s per-flow handler.
 */
async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.claim-dispatch-22067',
    name: 'Claim dispatch',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [PROBE_OBJECT],
  } as any);
  await engine.syncSchemas();
  // The organization-less holdings and rows below exist only on a store built
  // before 18.x (ADR-0131 D1 makes a fresh tenant column NOT NULL): this is it.
  await relaxEveryTenantColumn(engine, [PROBE_OBJECT]);
  engines.push(engine);

  const metadataHook: Seen[] = [];
  const codeHook: Seen[] = [];
  const record = (into: Seen[]) => async (ctx: any) => {
    into.push({
      event: ctx.event,
      mode: ctx.dispatch?.mode,
      isSystem: ctx.session?.isSystem,
      skipAutomations: ctx.session?.skipAutomations,
      skipTriggers: ctx.session?.skipTriggers,
    });
  };

  const bound = bindHooksToEngine(
    engine,
    [
      {
        name: 'probe_app_hook',
        object: OBJECT,
        events: ['beforeUpdate', 'afterUpdate'],
        handler: record(metadataHook),
      } as any,
    ],
    { packageId: 'com.objectstack.claim-dispatch-22067' },
  );
  expect(bound.registered, 'the metadata hook must be bound for its absence to mean anything').toBe(2);

  for (const event of ['beforeUpdate', 'afterUpdate'] as const) {
    engine.registerHook(event, record(codeHook), { object: OBJECT, packageId: 'probe.code-hook' });
  }

  return { engine, metadataHook, codeHook };
}

/**
 * Seed rows straight through the driver — the seed path is not the subject
 * here, and the claim reads only what is stored. Chunked, so no single
 * statement nears SQLite's bound-parameter limit.
 */
async function seed(engine: ObjectQL, rows: Record<string, unknown>[]): Promise<void> {
  const driver = (engine as any).getDriverForObject(OBJECT);
  for (let i = 0; i < rows.length; i += 500) {
    await driver.bulkCreate(OBJECT, rows.slice(i, i + 500));
  }
}

async function ownersOf(engine: ObjectQL): Promise<Map<string, unknown>> {
  const rows = await (engine as any).find(OBJECT, { fields: ['id', 'owner_id'] }, SYS);
  return new Map(rows.map((r: any) => [r.id, r.owner_id ?? null]));
}

describe('[#22067] the seed ownership claim dispatches no metadata-bound automation (real engine)', () => {
  it('the whole-set write: no metadata hook fires, code hooks fire per row with the flag and skipTriggers', async () => {
    const { engine, metadataHook, codeHook } = await boot();
    const N = 40;
    const rows = Array.from({ length: N }, (_, i) => ({
      id: `d${i}`,
      name: `Deal ${i}`,
      stage: 'open',
      owner_id: i % 2 === 0 ? null : SEED_IDENTITY,
    }));
    await seed(engine, rows);

    const result = await claimSeedOwnership(engine, ADMIN, { seededRecordIds: seededAre(rows.map((r) => r.id)) });

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    const owners = await ownersOf(engine);
    expect(owners.size).toBe(N);
    for (const owner of owners.values()) expect(owner).toBe(ADMIN);

    // ⭐ 1 — the metadata-hook filter: not one dispatch, before or after.
    expect(metadataHook, 'a metadata-bound hook fired for the claim').toEqual([]);

    // ⭐ 2 — the per-row path still runs code-registered hooks, one context per
    // matched row and phase, so audit and sharing keep their per-row input.
    expect(codeHook.filter((s) => s.event === 'beforeUpdate')).toHaveLength(N);
    expect(codeHook.filter((s) => s.event === 'afterUpdate')).toHaveLength(N);
    // ⭐ 3 — every one of those contexts carries the flag AND `skipTriggers`,
    // the field the record-change trigger reads before dispatching a flow.
    for (const s of codeHook) {
      expect(s).toEqual({
        event: s.event,
        mode: 'per-row',
        isSystem: true,
        skipAutomations: true,
        skipTriggers: true,
      });
    }

    // Positive control, same engine, same rows: a plain system predicate write
    // fires the metadata hook per row and phase, and carries no skip flag.
    metadataHook.length = 0;
    codeHook.length = 0;
    await (engine as any).update(OBJECT, { stage: 'touched' }, {
      where: { owner_id: ADMIN },
      multi: true,
      context: { isSystem: true },
    });
    expect(metadataHook).toHaveLength(2 * N);
    expect(codeHook).toHaveLength(2 * N);
    for (const s of codeHook) {
      expect(s.skipAutomations).toBeUndefined();
      expect(s.skipTriggers).toBeUndefined();
    }
  }, 120_000);

  it('over the per-row hook ceiling: still refused whole under the flag, and the fallback pages to every row', async () => {
    const { engine, metadataHook, codeHook } = await boot();
    const N = MAX_BULK_PER_ROW_HOOK_ROWS + 500;
    await seed(engine, Array.from({ length: N }, (_, i) => ({
      id: `d${String(i).padStart(6, '0')}`,
      name: `Deal ${i}`,
      stage: 'open',
      owner_id: SEED_IDENTITY,
    })));

    // The measurement the fallback's page size rests on: with metadata hooks
    // switched off, code-registered hooks still cover the object, so the
    // ceiling still applies and refuses the whole write — nothing written,
    // no hook run.
    await expect(
      (engine as any).update(OBJECT, { owner_id: ADMIN }, {
        where: { owner_id: SEED_IDENTITY },
        multi: true,
        context: { isSystem: true, skipAutomations: true },
      }),
    ).rejects.toMatchObject({ code: BULK_PER_ROW_HOOK_LIMIT_ERROR_CODE, limit: MAX_BULK_PER_ROW_HOOK_ROWS });
    expect([...(await ownersOf(engine)).values()].every((o) => o === SEED_IDENTITY)).toBe(true);
    expect(codeHook).toEqual([]);

    const result = await claimSeedOwnership(engine, ADMIN);

    // Every row claimed, through the fallback: more than one landed write,
    // none of them over the ceiling.
    expect(result).toEqual([{ object: OBJECT, count: N }]);
    const owners = await ownersOf(engine);
    expect(owners.size).toBe(N);
    for (const owner of owners.values()) expect(owner).toBe(ADMIN);
    const afterDispatches = codeHook.filter((s) => s.event === 'afterUpdate');
    expect(afterDispatches).toHaveLength(N);
    expect(metadataHook, 'a metadata-bound hook fired on a fallback page').toEqual([]);
    for (const s of codeHook) {
      expect(s.skipAutomations).toBe(true);
      expect(s.skipTriggers).toBe(true);
    }

    // Positive control on this engine too, kept under the ceiling.
    metadataHook.length = 0;
    await (engine as any).update(OBJECT, { stage: 'touched' }, {
      where: { id: { $in: ['d000000', 'd000001', 'd000002'] } },
      multi: true,
      context: { isSystem: true },
    });
    expect(metadataHook).toHaveLength(6);
  }, 180_000);

  it('[#23354] the NULL arm in chunks of seeded ids: never refused, every seeded row claimed, an unreported row left alone', async () => {
    const { engine, metadataHook, codeHook } = await boot();
    const N = MAX_BULK_PER_ROW_HOOK_ROWS + 500;
    const seededRows = Array.from({ length: N }, (_, i) => ({
      id: `d${String(i).padStart(6, '0')}`,
      name: `Deal ${i}`,
      stage: 'open',
      owner_id: null,
    }));
    // Unowned, and never reported by the seed: a guest's, a form's (ADR-0138 D1).
    const unreported = { id: 'guest_row', name: 'Guest enquiry', stage: 'new', owner_id: null };
    await seed(engine, [...seededRows, unreported]);

    const result = await claimSeedOwnership(engine, ADMIN, { seededRecordIds: seededAre(seededRows.map((r) => r.id)) });

    expect(result).toEqual([{ object: OBJECT, count: N }]);
    const owners = await ownersOf(engine);
    expect(owners.get('guest_row')).toBeNull();
    expect([...owners.entries()].filter(([id]) => id !== 'guest_row').every(([, o]) => o === ADMIN)).toBe(true);
    // Every matched row went through the per-row path under the flag, and no
    // write was refused whole: one afterUpdate per seeded row, none for the
    // unreported one.
    expect(codeHook.filter((s) => s.event === 'afterUpdate')).toHaveLength(N);
    expect(metadataHook).toEqual([]);
  }, 180_000);
});
