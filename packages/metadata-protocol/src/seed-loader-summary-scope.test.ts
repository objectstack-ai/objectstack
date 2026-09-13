// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';

/**
 * [#17177] The pass-2 summary said `owner_id stays NULL` about 120 rows whose
 * `owner_id` was NOT NULL by the time the boot finished.
 *
 * ## Which side is wrong — answered before anything was edited
 *
 * The WRITE is the designed behaviour, not the surprise. `seed-loader.ts`'s own
 * seed-identity comment says a seeded owner column "simply lands NULL —
 * semantically 'owned by whoever becomes the first admin', which the
 * first-admin handoff (`claimSeedOwnership`) then fills in"; `app-plugin.ts`,
 * `claim-seed-ownership.ts` and `system-names.ts` say the same from their own
 * side. So the platform intends that write, performs it on every boot that
 * mints an admin, and the LOG LINE is the side that is wrong: it made a bare
 * present-tense claim about a column whose value the same boot goes on to
 * change.
 *
 * ## Why the fix is a scope declaration and not a re-read
 *
 * The loader physically cannot describe the end of boot. Its lines are printed
 * inside `AppPlugin.start()`; the kernel runs `start()` for every plugin and
 * only then fires `kernel:ready`, where `bootstrapPlatformAdmin` promotes the
 * first admin and calls `claimSeedOwnership`. Re-reading the table before
 * `load()` returns would therefore read the SAME NULL it just reported — the
 * contradicting write has not happened yet. (And an inline seed that overruns
 * `OS_INLINE_SEED_BUDGET_MS` finishes on the far side of `kernel:ready`, so the
 * two writes are not even in a fixed order to read after.) Declaring the moment
 * is the only repair available from inside the loader.
 *
 * ## What this file pins
 *
 * The contradiction itself is REPRODUCED here, in one process, in the real
 * order: pass 2 reports the reference unresolved, the handoff's predicate write
 * lands, the row reads back non-NULL. That reproduction holds before AND after
 * the fix — it is the control that proves the scenario is the card's. What
 * changes is the sentence the operator is left holding.
 */

const ADMIN_ID = 'usr_dev_admin';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/** `where` matching that treats an absent column as NULL, like a real driver. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

/**
 * A store-backed double. `update` honours BOTH dispatch shapes the real engine
 * has (`@objectstack/metadata-core`'s `assertEngineUpdateDispatch` is the
 * arbiter): `by-id` for the loader's pass-2 back-fill, `multi` for the
 * predicate write the first-admin handoff issues.
 */
function createFaithfulEngine(): { engine: IDataEngine; store: Record<string, any[]> } {
  const store: Record<string, any[]> = {};
  let idCounter = 0;

  const engine = {
    find: vi.fn(async (objectName: string, query?: any) => {
      let records = store[objectName] || [];
      if (query?.where) records = records.filter((r) => matches(r, query.where));
      if (typeof query?.limit === 'number') records = records.slice(0, query.limit);
      return records;
    }),
    findOne: vi.fn(async (objectName: string, query?: any) => {
      assertEngineFindOnePredicate(objectName, query);
      const rows = await (engine.find as any)(objectName, { ...query, limit: 1 });
      return rows[0] ?? null;
    }),
    insert: vi.fn(async (objectName: string, data: any) => {
      if (!store[objectName]) store[objectName] = [];
      if (Array.isArray(data)) {
        const records = data.map((d) => ({ id: `gen-${++idCounter}`, ...d }));
        store[objectName].push(...records);
        return records;
      }
      const record = { id: `gen-${++idCounter}`, ...data };
      store[objectName].push(record);
      return record;
    }),
    update: vi.fn(async (objectName: string, data: any, options?: any) => {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const records = store[objectName] || [];
      if (dispatch.kind === 'multi') {
        const hit = records.filter((r) => matches(r, options?.where ?? {}));
        for (const r of hit) Object.assign(r, data);
        return { updated: hit.length };
      }
      const idx = records.findIndex((r) => r.id === dispatch.id);
      if (idx >= 0) { records[idx] = { ...records[idx], ...data }; return records[idx]; }
      return data;
    }),
    delete: vi.fn(async (_objectName: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return { deleted: 1 };
    }),
    count: vi.fn(async (objectName: string) => (store[objectName] || []).length),
    aggregate: vi.fn(async () => []),
  } as unknown as IDataEngine;

  return { engine, store };
}

/**
 * `claim_contract.owner_id` and `claim_user.contract_id` point at each other,
 * which is what forces the loader to defer the reference to pass 2 at all.
 */
function createMetadata(): IMetadataService {
  const objects: Record<string, any> = {
    claim_contract: {
      name: 'claim_contract',
      fields: {
        name: { type: 'text' },
        owner_id: { type: 'lookup', reference: 'claim_user' },
      },
    },
    claim_user: {
      name: 'claim_user',
      fields: {
        name: { type: 'text' },
        contract_id: { type: 'lookup', reference: 'claim_contract' },
      },
    },
  };
  return {
    getObject: vi.fn(async (name: string) => objects[name]),
    listObjects: vi.fn(async () => Object.values(objects)),
    register: vi.fn(async () => {}),
    get: vi.fn(async (_t: string, name: string) => objects[name]),
    list: vi.fn(async () => []),
    unregister: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    listNames: vi.fn(async () => []),
  } as unknown as IMetadataService;
}

const CONFIG = {
  dryRun: false,
  haltOnError: false,
  multiPass: true,
  defaultMode: 'insert',
  batchSize: 1000,
  transaction: false,
} as any;

/**
 * The later writer, spelled exactly as `claimSeedOwnership` spells it —
 * `packages/plugins/plugin-security/src/claim-seed-ownership.ts`, whose
 * `io.reown` is
 * `ql.update(name, { owner_id: adminUserId }, { where: predicate, multi: true, context: SYSTEM_CTX })`
 * over the `owner_id IS NULL` predicate. Reproduced here rather than imported:
 * `metadata-protocol` does not depend on `plugin-security` (and must not — the
 * dependency runs the other way), so the call shape is copied and the engine
 * double above is what holds it honest.
 */
async function claimUnownedRowsForFirstAdmin(engine: IDataEngine, objectName: string) {
  return (engine as any).update(
    objectName,
    { owner_id: ADMIN_ID },
    { where: { owner_id: null }, multi: true, context: { isSystem: true } },
  );
}

const unresolvedLines = (logger: ReturnType<typeof createLogger>) =>
  logger.error.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((m) => m.includes('UNRESOLVED after pass 2'));

describe('[#17177] the pass-2 deferred-reference summary says WHEN it is true', () => {
  /**
   * The card's boot, reproduced: the loader reports `owner_id` unresolved, the
   * first-admin handoff then claims the row, and the table disagrees with a
   * bare reading of the line. Steps 1-4 are the control and hold on both sides
   * of the fix; step 5 is the repair.
   */
  it('reproduces the contradiction and leaves the operator a line that survives it', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();

    // 1. Seed a contract owned by a user this load never creates — the card's
    //    `clm_contract.owner_id` shape.
    const result = await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [
        {
          object: 'claim_contract',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'ACME-001', owner_id: 'dev-admin' }],
        },
      ] as any,
      config: CONFIG,
    });

    // 2. The row landed; the reference did not. The line fired, and at the
    //    moment it fired it was TRUE — which is the whole reason the write, not
    //    the log, had to be ruled on first.
    const row = () => store.claim_contract.find((r) => r.name === 'ACME-001')!;
    expect(row(), 'the contract row was not seeded — wrong scenario').toBeDefined();
    expect(row().owner_id == null, 'owner_id was already set — nothing to contradict').toBe(true);
    const lines = unresolvedLines(logger);
    expect(lines.length, 'the pass-2 unresolved diagnostic never fired').toBe(1);
    const line = lines[0];
    expect(line).toContain('claim_contract.owner_id');
    expect(result.errors.some((e) => e.message.includes('unresolved after pass 2'))).toBe(true);

    // 3. Boot continues. `kernel:ready` promotes the first admin and
    //    `claimSeedOwnership` claims every NULL-owned row — by design.
    await claimUnownedRowsForFirstAdmin(engine, 'claim_contract');

    // 4. THE CONTRADICTION, reproduced: the summary above is still the only
    //    seed diagnostic an operator has, and the column it reported is no
    //    longer NULL. Nothing re-ran the loader; nothing recomputed the line.
    expect(row().owner_id).toBe(ADMIN_ID);
    expect(unresolvedLines(logger).length, 'the summary was recomputed — the card assumes it is not').toBe(1);

    // 5. THE REPAIR. The line an operator is holding at the end of boot has to
    //    survive being read against that table. It does not assert a state it
    //    cannot vouch for; it says which moment it describes, names the boot
    //    step that can supersede it, and says what the non-NULL value does NOT
    //    mean.
    expect(line, 'the line still makes a bare, unscoped claim about the column').not.toContain('stays NULL');
    expect(line).toContain('is NULL at the end of pass 2');
    expect(line).toContain('END OF PASS 2');
    expect(line).toContain('first-admin handoff');
    expect(line).toContain('not evidence that this reference resolved');

    // The repair is a scope declaration, not a silencing: level, count and
    // remedy are untouched.
    expect(logger.warn).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.summary.totalErrored).toBe(1);
    expect(line).toMatch(/re-run the seed/);
  });

  /**
   * The other branch that names a column and a NULL: the target resolved and
   * the back-fill WRITE failed. Same exposure — the row exists, so the handoff
   * can claim it — so it carries the same scope.
   */
  it('the back-fill-FAILED branch carries the same scope, for the same reason', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();
    const realUpdate = (engine.update as any).getMockImplementation();
    (engine.update as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'claim_contract' && !opts?.multi) throw new Error('UPDATE rejected by validation rule');
      return realUpdate(obj, data, opts);
    });

    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [
        {
          object: 'claim_contract',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'ACME-002', owner_id: 'Ada' }],
        },
        {
          object: 'claim_user',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Ada', contract_id: 'ACME-002' }],
        },
      ] as any,
      config: CONFIG,
    });

    const failed = logger.error.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((m) => m.includes('back-fill FAILED'));
    expect(failed, 'the back-fill-failure diagnostic never fired').toBeDefined();
    expect(failed).not.toContain('stays NULL');
    expect(failed).toContain('is NULL at the end of pass 2');
    expect(failed).toContain('END OF PASS 2');
    // Still carries its own cause — the scope note is additive.
    expect(failed).toContain('UPDATE rejected by validation rule');

    // And the exposure is real: the row is there for the handoff to claim.
    await claimUnownedRowsForFirstAdmin(engine, 'claim_contract');
    expect(store.claim_contract.find((r) => r.name === 'ACME-002')!.owner_id).toBe(ADMIN_ID);
  });

  /**
   * NEGATIVE CONTROL — the guard against fixing this by rewording every line
   * that says NULL. A DROPPED row never landed, so no later boot step can write
   * a column of it: that claim is still true at the end of boot and must NOT be
   * hedged. A blanket reword would fail here.
   */
  it('a DROPPED row — one that never landed — is NOT hedged: no later writer can reach it', async () => {
    const { engine, store } = createFaithfulEngine();
    const logger = createLogger();
    const realInsert = (engine.insert as any).getMockImplementation();
    (engine.insert as any).mockImplementation(async (obj: string, data: any, opts: any) => {
      if (obj === 'claim_contract') throw new Error('CHECK constraint failed: claim_contract');
      return realInsert(obj, data, opts);
    });

    await new SeedLoaderService(engine, createMetadata(), logger).load({
      seeds: [
        {
          object: 'claim_contract',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'ACME-003', owner_id: 'Ada' }],
        },
        {
          object: 'claim_user',
          externalId: 'name',
          mode: 'insert',
          env: ['prod', 'dev', 'test'],
          records: [{ name: 'Ada', contract_id: 'ACME-003' }],
        },
      ] as any,
      config: CONFIG,
    });

    const dropped = logger.error.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((m) => m.includes('Deferred reference DROPPED'));
    expect(dropped, 'the drop diagnostic never fired — wrong scenario').toBeDefined();
    expect(store.claim_contract ?? [], 'the row landed after all — wrong scenario').toHaveLength(0);
    expect(dropped).not.toContain('END OF PASS 2');
    expect(dropped).toContain('is never written');

    // Proof the asymmetry is the right one: the handoff's predicate write
    // matches nothing, because there is no row.
    await claimUnownedRowsForFirstAdmin(engine, 'claim_contract');
    expect(store.claim_contract ?? []).toHaveLength(0);
  });
});
