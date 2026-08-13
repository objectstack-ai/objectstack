// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5103] Record delete ⇒ every `sys_record_share` row on that record goes,
 * whatever its `source`.
 *
 * #4779 (PR #5102) added an `afterDelete`, but inside the sharing-RULE package:
 * it revokes only `source: 'rule'` rows, and it binds only on objects that
 * appear in `sys_sharing_rule`. So an object that uses nothing but manual
 * shares had no delete hook at all, and its share rows outlived their records
 * forever — a latent authorization defect the moment a record id is reused.
 *
 * Maintainer ruling (2026-08-04): option A — plugin-sharing binds `afterDelete`
 * on all sharing-enabled objects (posture read from `sharingModel` METADATA,
 * not from the rules table) and revokes ALL sources; plus a boot sweep keyed on
 * "does the record still exist".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { ShareLinkService } from './share-link-service.js';
import {
  bindRecordShareCascade,
  unbindRecordShareCascade,
  objectCanCarryRecordShares,
  objectCanCarryShareLinks,
  orphanShareSweepQueue,
  RECORD_SHARE_CASCADE_PACKAGE,
} from './record-share-cascade.js';
import { bindRuleHooks, SHARING_RULE_HOOK_PACKAGE } from './rule-hooks.js';
import { AFFECTED_ROWS_STASH_KEY, RULE_RECOMPUTE_ROW_CAP } from './bulk-recompute.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true, positions: [], permissions: [] } as any;
const ADMIN_SESSION = { isSystem: false, userId: 'admin' };

type HookEntry = { event: string; handler: (ctx: any) => any; options: Row };

/**
 * A fake ObjectQL engine reproducing the parts of the write pipeline this fix
 * depends on:
 *
 *  - `before*` / `after*` of one write share ONE `HookContext` instance (the
 *    real engine mutates `ctx.event` in place);
 *  - a hook registered with no `object` option fires for EVERY object, which is
 *    `ObjectQLEngine.triggerHooks`' documented per-object matching and the
 *    seam the cascade's global bind rides on;
 *  - a predicate delete leaves `input.id` undefined;
 *  - `delete` refuses a predicate-shaped call without `multi: true`, pinned to
 *    the engine's own exported dispatch predicate (#4434, #4550).
 */
function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const schemas: Record<string, Row> = {};
  const hooks: HookEntry[] = [];
  const ensure = (n: string) => (tables[n] ??= []);
  const deleteCalls: Array<{ object: string; options: any }> = [];
  const findCalls: Array<{ object: string; options: any }> = [];

  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    // `$or` / `$and` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — a short-circuiting `return` here would discard every
    // sibling equality key in the same object. See #7620.
    if (Array.isArray(f.$or) && !f.$or.some((x: any) => matches(row, x))) return false;
    if (Array.isArray(f.$and) && !f.$and.every((x: any) => matches(row, x))) return false;
    for (const [k, v] of Object.entries(f)) {
      if (k === '$or' || k === '$and') continue;
      const rv = row[k];
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(rv)) return false;
        continue;
      }
      if (v != null && typeof v === 'object' && '$gt' in (v as any)) {
        if (!(String(rv) > String((v as any).$gt))) return false;
        continue;
      }
      if (rv !== v) return false;
    }
    return true;
  }

  const engine = {
    _tables: tables,
    _schemas: schemas,
    _deleteCalls: deleteCalls,
    _findCalls: findCalls,
    /** Set to make `find` throw for one object (the failed-probe branch). */
    failFindOn: null as string | null,
    getSchema(name: string) { return schemas[name]; },
    registry: {
      getObject(name: string) { return schemas[name]; },
    },
    async find(o: string, opts?: any) {
      if (engine.failFindOn === o) throw new Error(`boom: ${o} unavailable`);
      findCalls.push({ object: o, options: opts });
      const f = opts?.filter ?? opts?.where;
      let rows = ensure(o).filter((r) => matches(r, f));
      const order = opts?.orderBy?.[0];
      if (order?.field) {
        rows = [...rows].sort((a, b) => (String(a[order.field]) < String(b[order.field]) ? -1 : 1));
      }
      return rows.slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) { const row = { ...data }; ensure(o).push(row); return row; },
    async update(o: string, idOrData: any, dataOrOpts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : dataOrOpts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const t = ensure(o); const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(o: string, opts?: any) {
      assertEngineDeleteDispatch(opts);
      deleteCalls.push({ object: o, options: opts });
      const t = ensure(o); const where = opts?.where ?? {};
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
    registerHook(event: string, handler: (ctx: any) => any, options: Row = {}) {
      hooks.push({ event, handler, options });
      hooks.sort((a, b) => (a.options.priority ?? 100) - (b.options.priority ?? 100));
    },
    unregisterHooksByPackage(packageId: string) {
      let removed = 0;
      for (let i = hooks.length - 1; i >= 0; i--) {
        if (hooks[i].options.packageId === packageId) { hooks.splice(i, 1); removed++; }
      }
      return removed;
    },
    boundFor(packageId: string) { return hooks.filter((h) => h.options.packageId === packageId); },

    /** `triggerHooks`' matching: no `object` option ⇒ every object. */
    async fire(event: string, object: string, ctx: any) {
      for (const h of [...hooks]) {
        if (h.event !== event) continue;
        const target = h.options.object;
        if (target != null) {
          const targets = Array.isArray(target) ? target : [target];
          if (!targets.includes('*') && !targets.includes(object)) continue;
        }
        await h.handler(ctx);
      }
    },

    /** A single-id delete — `input.id` is populated, as the engine does. */
    async simulateDeleteById(object: string, id: string, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object,
        event: 'beforeDelete',
        input: { id, options: { where: { id } } },
        session,
      };
      await engine.fire('beforeDelete', object, ctx);
      const t = ensure(object);
      const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t.splice(i, 1);
      ctx.event = 'afterDelete';
      ctx.result = { id };
      await engine.fire('afterDelete', object, ctx);
      return ctx;
    },

    /** A predicate delete — no `input.id`, the #4779 precondition. */
    async simulateBulkDelete(object: string, where: any, session: any = ADMIN_SESSION) {
      const ctx: any = {
        object,
        event: 'beforeDelete',
        input: { id: undefined, options: { where, multi: true } },
        session,
      };
      await engine.fire('beforeDelete', object, ctx);
      const t = ensure(object);
      for (let i = t.length - 1; i >= 0; i--) if (where == null || matches(t[i], where)) t.splice(i, 1);
      ctx.event = 'afterDelete';
      await engine.fire('afterDelete', object, ctx);
      return ctx;
    },
  };
  return engine;
}

type Engine = ReturnType<typeof makeEngine>;

const shares = (engine: Engine) => engine._tables.sys_record_share ?? [];
const shareIds = (engine: Engine) => shares(engine).map((r) => String(r.id)).sort();

function manualShare(engine: Engine, object: string, recordId: string, recipient: string, id = `shr_${recordId}_${recipient}`) {
  (engine._tables.sys_record_share ??= []).push({
    id,
    object_name: object,
    record_id: recordId,
    recipient_type: 'user',
    recipient_id: recipient,
    access_level: 'read',
    source: 'manual',
    granted_by: 'admin',
  });
  return id;
}

// ── [#5190] the `sys_share_link` half ────────────────────────────────────────
const shareLinks = (engine: Engine) => engine._tables.sys_share_link ?? [];
const shareLinkIds = (engine: Engine) => shareLinks(engine).map((r) => String(r.id)).sort();

/** A capability token on `(object, recordId)` — no recipient, by design. */
function shareLink(engine: Engine, object: string, recordId: string, id = `shl_${recordId}`, extra: Row = {}) {
  (engine._tables.sys_share_link ??= []).push({
    id,
    token: `tok_${id}_aaaaaaaaaaaa`,
    object_name: object,
    record_id: recordId,
    permission: 'view',
    audience: 'link_only',
    expires_at: null,
    revoked_at: null,
    created_by: 'admin',
    use_count: 0,
    last_used_at: null,
    ...extra,
  });
  return id;
}

describe('#5103 objectCanCarryRecordShares — the runtime, metadata-driven posture', () => {
  it('accepts any object that DECLARES a sharing model', () => {
    for (const sharingModel of ['private', 'public_read', 'public_read_write', 'controlled_by_parent']) {
      expect(objectCanCarryRecordShares({ name: 'account', sharingModel })).toBe(true);
    }
  });

  it('accepts a custom object with no declared model (ADR-0090 D1 secure default is private)', () => {
    expect(objectCanCarryRecordShares({ name: 'inquiry', fields: {} })).toBe(true);
  });

  it('reads the nested `security.sharingModel` spelling too', () => {
    expect(objectCanCarryRecordShares({ name: 'sys_thing', isSystem: true, security: { sharingModel: 'private' } }))
      .toBe(true);
  });

  it('skips an UNMARKED system object — the documented boundary the boot sweep backstops', () => {
    expect(objectCanCarryRecordShares({ name: 'sys_audit_log', isSystem: true })).toBe(false);
    expect(objectCanCarryRecordShares({ name: 'sys_job_run' })).toBe(false);
  });

  it("never cascades on the sharing subsystem's own tables (no share-row delete firing a share-row delete)", () => {
    expect(objectCanCarryRecordShares({ name: 'sys_record_share', sharingModel: 'private' })).toBe(false);
    expect(objectCanCarryRecordShares({ name: 'sys_sharing_rule', sharingModel: 'private' })).toBe(false);
    expect(objectCanCarryRecordShares({ name: 'sys_share_link' })).toBe(false);
  });

  it('falls toward cleanup when the schema cannot be resolved (unknown ≠ "leave the orphan")', () => {
    expect(objectCanCarryRecordShares(undefined)).toBe(true);
    expect(objectCanCarryRecordShares(null)).toBe(true);
  });
});

describe('#5103 record delete revokes every share on the record', () => {
  let engine: Engine;
  let sharing: SharingService;
  let logger: any;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    // An object using ONLY manual shares — no sharing rule anywhere. This is
    // the case #5102's rule-scoped afterDelete could not reach: `bindRuleHooks`
    // enumerates `sys_sharing_rule.object_name`, so nothing was ever bound here.
    engine._schemas.contract = { name: 'contract', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.contract = [
      { id: 'ctr1', owner_id: 'boss' },
      { id: 'ctr2', owner_id: 'boss' },
    ];
    engine._tables.sys_record_share = [];
    engine._tables.sys_sharing_rule = [];
    sharing = new SharingService({ engine: engine as any, logger });
    bindRecordShareCascade(engine as any, sharing, logger);
  });

  it('binds the before/after pair globally — no object filter, so nothing goes stale', () => {
    const bound = engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE);
    expect(bound.map((h) => h.event).sort()).toEqual(['afterDelete', 'beforeDelete']);
    for (const h of bound) expect(h.options.object).toBeUndefined();
  });

  /**
   * THE REPRO — an object with NO rules at all, the case #5102 left uncovered.
   * Revert-proof: unbind the cascade (or restore the `source: 'rule'` clause on
   * the revoke) and the manual row survives its record, so this reads 1, not 0.
   */
  it('revokes a MANUAL share when its record is deleted, on an object with no rules', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    manualShare(engine, 'contract', 'ctr2', 'dave');

    await engine.simulateDeleteById('contract', 'ctr1');

    expect(shareIds(engine)).toEqual(['shr_ctr2_dave']);
  });

  it('leaves the shares of records that were NOT deleted', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    manualShare(engine, 'contract', 'ctr2', 'carol', 'shr_keep');
    // Same record id on a DIFFERENT object — the revoke is keyed on both.
    engine._schemas.invoice = { name: 'invoice', sharingModel: 'private', fields: { owner_id: {} } };
    manualShare(engine, 'invoice', 'ctr1', 'carol', 'shr_other_object');

    await engine.simulateDeleteById('contract', 'ctr1');

    expect(shareIds(engine)).toEqual(['shr_keep', 'shr_other_object']);
  });

  it('revokes on a SYSTEM-context delete too (the record is gone either way)', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');

    await engine.simulateDeleteById('contract', 'ctr1', SYS);

    expect(shareIds(engine)).toEqual([]);
  });

  it('revokes every id of a BOUNDED predicate delete (`multi: true`, no input.id)', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    manualShare(engine, 'contract', 'ctr2', 'dave');
    engine._tables.contract.push({ id: 'ctr3', owner_id: 'other' });
    manualShare(engine, 'contract', 'ctr3', 'erin');

    await engine.simulateBulkDelete('contract', { owner_id: 'boss' });

    expect(shareIds(engine)).toEqual(['shr_ctr3_erin']);
  });

  it('issues a set-based revoke, not one delete per share row', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    manualShare(engine, 'contract', 'ctr1', 'dave');
    manualShare(engine, 'contract', 'ctr2', 'erin');
    engine._deleteCalls.length = 0;

    await engine.simulateBulkDelete('contract', { owner_id: 'boss' });

    const shareDeletes = engine._deleteCalls.filter((c) => c.object === 'sys_record_share');
    expect(shareDeletes).toHaveLength(1);
    expect(shareDeletes[0].options).toMatchObject({
      multi: true,
      where: { object_name: 'contract', record_id: { $in: ['ctr1', 'ctr2'] } },
    });
    expect(shares(engine)).toEqual([]);
  });

  it('skips objects whose metadata puts them outside sharing (no query on the hot path)', async () => {
    engine._schemas.sys_audit_log = { name: 'sys_audit_log', isSystem: true };
    engine._tables.sys_audit_log = [{ id: 'evt1' }];
    manualShare(engine, 'sys_audit_log', 'evt1', 'carol');
    engine._deleteCalls.length = 0;

    await engine.simulateDeleteById('sys_audit_log', 'evt1');

    expect(engine._deleteCalls.filter((c) => c.object === 'sys_record_share')).toHaveLength(0);
    expect(shareIds(engine)).toEqual(['shr_evt1_carol']); // the boot sweep's job
  });

  it('covers an object that gains `sharingModel` AFTER boot — no rebind needed', async () => {
    engine._schemas.late = { name: 'late', isSystem: true }; // unmarked system object → skipped
    engine._tables.late = [{ id: 'late1' }, { id: 'late2' }];
    manualShare(engine, 'late', 'late1', 'carol');
    await engine.simulateDeleteById('late', 'late1');
    expect(shareIds(engine)).toEqual(['shr_late1_carol']);

    // Metadata hot-update: the object turns on sharing. Nothing is re-bound.
    engine._schemas.late = { name: 'late', isSystem: true, sharingModel: 'private', fields: { owner_id: {} } };
    manualShare(engine, 'late', 'late2', 'dave');

    await engine.simulateDeleteById('late', 'late2');

    expect(shareIds(engine)).toEqual(['shr_late1_carol']); // only the pre-flip orphan remains
  });

  it('never fails the write when the revoke throws — and names the repair', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    const boom = {
      revokeSharesForDeletedRecords: vi.fn(async () => { throw new Error('driver down'); }),
      sweepOrphanedRecordShares: vi.fn(async () => ({ scanned: 0, revoked: 0, unresolvedObjects: [], truncated: false })),
    };
    unbindRecordShareCascade(engine as any);
    bindRecordShareCascade(engine as any, boom as any, logger);

    await expect(engine.simulateDeleteById('contract', 'ctr1')).resolves.toBeDefined();

    expect(boom.revokeSharesForDeletedRecords).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('next '),
      expect.objectContaining({ object: 'contract' }),
    );
  });

  it('unbinds cleanly (idempotent re-bind never doubles the hooks)', () => {
    bindRecordShareCascade(engine as any, sharing, logger);
    expect(engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE)).toHaveLength(2);
    expect(unbindRecordShareCascade(engine as any)).toBe(2);
    expect(engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE)).toHaveLength(0);
  });
});

describe('#5103 an UNBOUNDED delete reclaims by sweep, never by revoking the object', () => {
  let engine: Engine;
  let sharing: SharingService;
  let logger: any;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._schemas.contract = { name: 'contract', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.contract = [{ id: 'ctr1', owner_id: 'boss' }, { id: 'ctr2', owner_id: 'boss' }];
    engine._tables.sys_record_share = [];
    sharing = new SharingService({ engine: engine as any, logger });
    bindRecordShareCascade(engine as any, sharing, logger);
  });

  it('sweeps by record-existence when the delete names no predicate at all', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    manualShare(engine, 'contract', 'ctr2', 'dave');

    await engine.simulateBulkDelete('contract', undefined);
    await orphanShareSweepQueue.whenIdle();

    expect(engine._tables.contract).toEqual([]);
    expect(shareIds(engine)).toEqual([]);
  });

  it('spares shares whose record survived the unbounded delete', async () => {
    // A survivor: the sweep asks each share row's record, so a row whose
    // record is still there is untouched — the property that makes sweeping
    // manual shares safe at all.
    engine._tables.contract.push({ id: 'ctr3', owner_id: 'boss' });
    manualShare(engine, 'contract', 'ctr1', 'carol');
    manualShare(engine, 'contract', 'ctr3', 'erin', 'shr_survivor');
    const originalDelete = engine.delete.bind(engine);
    // Simulate the engine's own row-scoping: the bulk delete removes only ctr1.
    engine.delete = originalDelete;

    const ctx: any = {
      object: 'contract',
      event: 'beforeDelete',
      input: { id: undefined, options: { where: undefined, multi: true } },
      session: ADMIN_SESSION,
    };
    await engine.fire('beforeDelete', 'contract', ctx);
    engine._tables.contract = engine._tables.contract.filter((r) => r.id !== 'ctr1');
    ctx.event = 'afterDelete';
    await engine.fire('afterDelete', 'contract', ctx);
    await orphanShareSweepQueue.whenIdle();

    expect(shareIds(engine)).toEqual(['shr_survivor']);
  });

  it('never revokes the object wholesale — the rule path\'s revoke-then-regrant is not available here', async () => {
    manualShare(engine, 'contract', 'ctr2', 'dave');
    engine._deleteCalls.length = 0;

    await engine.simulateBulkDelete('contract', undefined);

    // Not a single `{ object_name: 'contract' }`-only delete: that shape would
    // destroy manual grants nothing could ever re-create.
    for (const call of engine._deleteCalls.filter((c) => c.object === 'sys_record_share')) {
      expect(call.options.where).not.toEqual({ object_name: 'contract' });
    }
  });

  it('treats an over-cap predicate as unbounded and still converges', async () => {
    engine._tables.contract = [];
    for (let i = 0; i < RULE_RECOMPUTE_ROW_CAP + 1; i++) {
      engine._tables.contract.push({ id: `big${i}`, owner_id: 'boss' });
    }
    manualShare(engine, 'contract', 'big0', 'carol');

    const ctx = await engine.simulateBulkDelete('contract', { owner_id: 'boss' });
    expect((ctx as any)[AFFECTED_ROWS_STASH_KEY]).toMatchObject({ kind: 'unbounded', reason: 'over-cap' });
    await orphanShareSweepQueue.whenIdle();

    expect(shareIds(engine)).toEqual([]);
  });
});

describe('#5103 boot sweep — the record-existence predicate', () => {
  let engine: Engine;
  let sharing: SharingService;
  let logger: any;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._schemas.contract = { name: 'contract', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.contract = [{ id: 'ctr_live', owner_id: 'boss' }];
    engine._tables.sys_record_share = [];
    sharing = new SharingService({ engine: engine as any, logger });
  });

  it('removes historical orphans of EVERY source and keeps the valid rows', async () => {
    manualShare(engine, 'contract', 'ctr_live', 'carol', 'shr_live_manual');
    manualShare(engine, 'contract', 'ctr_gone', 'carol', 'shr_dead_manual');
    (engine._tables.sys_record_share ??= []).push(
      { id: 'shr_live_rule', object_name: 'contract', record_id: 'ctr_live', recipient_type: 'user', recipient_id: 'wes', access_level: 'read', source: 'rule', source_id: 'srule_1' },
      { id: 'shr_dead_rule', object_name: 'contract', record_id: 'ctr_gone', recipient_type: 'user', recipient_id: 'wes', access_level: 'read', source: 'rule', source_id: 'srule_1' },
    );

    const result = await sharing.sweepOrphanedRecordShares();

    expect(result).toMatchObject({ scanned: 4, revoked: 2, unresolvedObjects: [], truncated: false });
    expect(shareIds(engine)).toEqual(['shr_live_manual', 'shr_live_rule']);
  });

  it('is idempotent — a second boot finds nothing to do', async () => {
    manualShare(engine, 'contract', 'ctr_gone', 'carol');
    expect((await sharing.sweepOrphanedRecordShares()).revoked).toBe(1);
    expect((await sharing.sweepOrphanedRecordShares()).revoked).toBe(0);
    expect((await sharing.sweepOrphanedRecordShares()).revoked).toBe(0);
  });

  it('covers the posture the cascade skips (an unmarked system object)', async () => {
    engine._schemas.sys_audit_log = { name: 'sys_audit_log', isSystem: true };
    engine._tables.sys_audit_log = [];
    manualShare(engine, 'sys_audit_log', 'evt_gone', 'carol');

    expect((await sharing.sweepOrphanedRecordShares()).revoked).toBe(1);
    expect(shareIds(engine)).toEqual([]);
  });

  /**
   * "Could not ask" is not "the record is gone". A probe failure that deleted
   * would turn a transient driver error into permanent access loss — the
   * inverse of the #4757 lesson ("nothing was queried" ≠ "nothing matched").
   */
  it('LEAVES rows alone when the existence probe fails, and reports the object', async () => {
    manualShare(engine, 'contract', 'ctr_gone', 'carol');
    engine.failFindOn = 'contract';

    const result = await sharing.sweepOrphanedRecordShares();

    expect(result.revoked).toBe(0);
    expect(result.unresolvedObjects).toEqual(['contract']);
    expect(shareIds(engine)).toEqual(['shr_ctr_gone_carol']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not check whether records still exist'),
      expect.objectContaining({ object: 'contract' }),
    );
  });

  it('scopes to one object when asked (the unbounded-delete repair)', async () => {
    engine._schemas.invoice = { name: 'invoice', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.invoice = [];
    manualShare(engine, 'contract', 'ctr_gone', 'carol', 'shr_contract_orphan');
    manualShare(engine, 'invoice', 'inv_gone', 'carol', 'shr_invoice_orphan');

    const result = await sharing.sweepOrphanedRecordShares({ object: 'contract' });

    expect(result).toMatchObject({ scanned: 1, revoked: 1 });
    expect(shareIds(engine)).toEqual(['shr_invoice_orphan']);
  });

  it('probes existence in ONE batched query per object per page, not one per share row', async () => {
    for (let i = 0; i < 25; i++) manualShare(engine, 'contract', `ctr_gone_${i}`, 'carol', `shr_${i}`);
    engine._findCalls.length = 0;

    await sharing.sweepOrphanedRecordShares({ batchSize: 100 });

    const probes = engine._findCalls.filter((c) => c.object === 'contract');
    expect(probes).toHaveLength(1);
    expect(probes[0].options.where).toMatchObject({ id: { $in: expect.any(Array) } });
    expect(shares(engine)).toEqual([]);
  });

  it('pages by keyset and REPORTS a scan that its cap cut short', async () => {
    for (let i = 0; i < 12; i++) manualShare(engine, 'contract', `ctr_gone_${i}`, 'carol', `shr_${String(i).padStart(2, '0')}`);

    const result = await sharing.sweepOrphanedRecordShares({ batchSize: 5, max: 10 });

    expect(result.scanned).toBe(10);
    expect(result.truncated).toBe(true);
    // A capped pass still cleans what it saw, and the rest survive for the next.
    expect(result.revoked).toBe(10);
    expect(shares(engine)).toHaveLength(2);
  });

  it('walks past rows it just deleted (a seek, never an OFFSET — #4363)', async () => {
    // Every row on this page is an orphan and gets deleted; an offset-paged
    // walk would then skip the next page's rows entirely.
    for (let i = 0; i < 9; i++) manualShare(engine, 'contract', `ctr_gone_${i}`, 'carol', `shr_${i}`);

    const result = await sharing.sweepOrphanedRecordShares({ batchSize: 3 });

    expect(result.scanned).toBe(9);
    expect(result.revoked).toBe(9);
    expect(shares(engine)).toEqual([]);
  });
});

describe('#5103 coexistence with the #5102 rule hooks', () => {
  let engine: Engine;
  let sharing: SharingService;
  let rules: SharingRuleService;
  let logger: any;

  beforeEach(async () => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._schemas.opportunity = { name: 'opportunity', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.opportunity = [
      { id: 'opp1', region: 'east', owner_id: 'boss' },
      { id: 'opp2', region: 'east', owner_id: 'boss' },
    ];
    engine._tables.sys_record_share = [];
    engine._tables.sys_sharing_rule = [{
      id: 'srule_east',
      name: 'east_to_alice',
      label: 'East → Alice',
      object_name: 'opportunity',
      criteria_json: JSON.stringify({ region: 'east' }),
      recipient_type: 'user',
      recipient_id: 'alice',
      access_level: 'edit',
      active: true,
    }];
    sharing = new SharingService({ engine: engine as any, logger });
    rules = new SharingRuleService({ engine: engine as any, sharing, logger });
    bindRuleHooks(engine as any, rules, await rules.listRules({ activeOnly: true }, SYS), logger);
    bindRecordShareCascade(engine as any, sharing, logger);
  });

  it('revokes BOTH the rule grant and the manual share on a rules-bearing object', async () => {
    await rules.evaluateRule('srule_east', SYS);
    expect(shares(engine).filter((r) => r.source === 'rule')).toHaveLength(2);
    manualShare(engine, 'opportunity', 'opp1', 'carol', 'shr_manual_opp1');
    manualShare(engine, 'opportunity', 'opp2', 'carol', 'shr_manual_opp2');

    await engine.simulateDeleteById('opportunity', 'opp1');

    const left = shares(engine);
    expect(left.every((r) => r.record_id === 'opp2')).toBe(true);
    expect(left.map((r) => r.source).sort()).toEqual(['manual', 'rule']);
  });

  /**
   * #5102's pin, re-asserted from this branch: a rule RECOMPUTE (record still
   * exists) must never touch a manual share. Only a record DELETE may, and
   * only because the record is gone.
   */
  it('rule recompute still never touches a manual share (#5102 stays pinned)', async () => {
    await rules.evaluateRule('srule_east', SYS);
    manualShare(engine, 'opportunity', 'opp1', 'carol', 'shr_manual_survivor');

    // Move opp1 out of the rule's criteria — the rule grant goes, the manual
    // share stays, because opp1 is still a record a human made a decision about.
    const ctx: any = {
      object: 'opportunity',
      event: 'beforeUpdate',
      input: { id: undefined, data: { region: 'west' }, options: { where: { id: 'opp1' }, multi: true } },
      session: ADMIN_SESSION,
    };
    await engine.fire('beforeUpdate', 'opportunity', ctx);
    engine._tables.opportunity[0].region = 'west';
    ctx.event = 'afterUpdate';
    await engine.fire('afterUpdate', 'opportunity', ctx);

    const left = shares(engine);
    expect(left.find((r) => r.id === 'shr_manual_survivor')).toBeDefined();
    expect(left.filter((r) => r.source === 'rule' && r.record_id === 'opp1')).toEqual([]);
  });

  it('resolves the write\'s row set ONCE for both hook packages (shared stash)', async () => {
    manualShare(engine, 'opportunity', 'opp1', 'carol');
    engine._findCalls.length = 0;

    const ctx = await engine.simulateBulkDelete('opportunity', { region: 'east' });

    expect((ctx as any)[AFFECTED_ROWS_STASH_KEY]).toMatchObject({ kind: 'rows' });
    // Exactly one predicate resolve against the target object across both
    // `beforeDelete` hooks — the stash is reused, not recomputed.
    const resolves = engine._findCalls.filter(
      (c) => c.object === 'opportunity' && c.options?.limit === RULE_RECOMPUTE_ROW_CAP + 1,
    );
    expect(resolves).toHaveLength(1);
  });

  it('both packages bind, and neither unbind touches the other', () => {
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE).length).toBeGreaterThan(0);
    expect(engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE)).toHaveLength(2);

    unbindRecordShareCascade(engine as any);

    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE).length).toBeGreaterThan(0);
    expect(engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE)).toHaveLength(0);
  });
});

/**
 * [#5190] The same cascade, for `sys_share_link`.
 *
 * `sys_record_share` orphans (#5103) at least name their beneficiaries. A share
 * link is an identity-less CAPABILITY token: whoever holds the URL has the
 * access. So the same orphan is strictly worse here — on a reused record id the
 * new record is handed to whoever kept a link that morally died with the old
 * one, and that holder can be anyone the record was ever shared with.
 *
 * Two halves, and BOTH are tested: `resolveToken`'s existence check
 * (share-link-service.test.ts) holds whether or not a hook ever ran; this file
 * covers the cascade and boot sweep that stop the rows from accumulating in the
 * first place.
 */
describe('#5190 objectCanCarryShareLinks — a DIFFERENT posture question', () => {
  it('accepts any object that declares publicSharing', () => {
    expect(objectCanCarryShareLinks({ name: 'ai_conversations', publicSharing: { enabled: true } })).toBe(true);
  });

  /**
   * THE PREDICATE REPRO. Link minting is gated by `publicSharing`, which is
   * INDEPENDENT of `sharingModel` — so the object most likely to hold links (a
   * platform object that opted into link sharing) is exactly one the
   * record-share predicate skips. Reuse `objectCanCarryRecordShares` for links
   * and this object's links outlive their records forever.
   */
  it('covers a publicSharing object the RECORD-SHARE predicate skips', () => {
    const schema = { name: 'sys_report', isSystem: true, publicSharing: { enabled: true } };
    expect(objectCanCarryRecordShares(schema)).toBe(false);
    expect(objectCanCarryShareLinks(schema)).toBe(true);
  });

  it('still covers an object whose publicSharing was turned OFF (links outlive the flip)', () => {
    expect(objectCanCarryShareLinks({ name: 'sys_report', isSystem: true, publicSharing: { enabled: false } })).toBe(true);
  });

  it('covers everything the record-share cascade already covers (system mints need no opt-in)', () => {
    expect(objectCanCarryShareLinks({ name: 'contract', sharingModel: 'private' })).toBe(true);
    expect(objectCanCarryShareLinks({ name: 'inquiry', fields: {} })).toBe(true);
  });

  it('skips an UNMARKED system object — the same documented boundary #5103 drew', () => {
    expect(objectCanCarryShareLinks({ name: 'sys_audit_log', isSystem: true })).toBe(false);
  });

  it("never cascades on the sharing subsystem's own tables", () => {
    expect(objectCanCarryShareLinks({ name: 'sys_share_link', publicSharing: { enabled: true } })).toBe(false);
    expect(objectCanCarryShareLinks({ name: 'sys_record_share' })).toBe(false);
  });

  it('falls toward cleanup when the schema cannot be resolved', () => {
    expect(objectCanCarryShareLinks(undefined)).toBe(true);
    expect(objectCanCarryShareLinks(null)).toBe(true);
  });
});

describe('#5190 record delete revokes the share LINKS of that record', () => {
  let engine: Engine;
  let sharing: SharingService;
  let linkService: ShareLinkService;
  let logger: any;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._schemas.contract = { name: 'contract', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.contract = [
      { id: 'ctr1', owner_id: 'boss' },
      { id: 'ctr2', owner_id: 'boss' },
    ];
    engine._tables.sys_record_share = [];
    engine._tables.sys_share_link = [];
    sharing = new SharingService({ engine: engine as any, logger });
    linkService = new ShareLinkService({ engine: engine as any, logger });
    bindRecordShareCascade(engine as any, sharing, logger, () => linkService);
  });

  /**
   * THE REPRO. Revert the link half (or the `links` argument) and the token row
   * survives its record, so this reads both ids instead of one.
   */
  it('deletes the link rows of a deleted record, on an object with no rules', async () => {
    shareLink(engine, 'contract', 'ctr1');
    shareLink(engine, 'contract', 'ctr2');

    await engine.simulateDeleteById('contract', 'ctr1');

    expect(shareLinkIds(engine)).toEqual(['shl_ctr2']);
  });

  it('leaves the links of records that were NOT deleted, and of other objects', async () => {
    shareLink(engine, 'contract', 'ctr1');
    shareLink(engine, 'contract', 'ctr2', 'shl_keep');
    engine._schemas.invoice = { name: 'invoice', sharingModel: 'private', fields: { owner_id: {} } };
    // Same record id on a DIFFERENT object — the revoke is keyed on both.
    shareLink(engine, 'invoice', 'ctr1', 'shl_other_object');

    await engine.simulateDeleteById('contract', 'ctr1');

    expect(shareLinkIds(engine)).toEqual(['shl_keep', 'shl_other_object']);
  });

  it('revokes on a SYSTEM-context delete too', async () => {
    shareLink(engine, 'contract', 'ctr1');

    await engine.simulateDeleteById('contract', 'ctr1', SYS);

    expect(shareLinkIds(engine)).toEqual([]);
  });

  it('revokes every id of a BOUNDED predicate delete', async () => {
    shareLink(engine, 'contract', 'ctr1');
    shareLink(engine, 'contract', 'ctr2');
    engine._tables.contract.push({ id: 'ctr3', owner_id: 'other' });
    shareLink(engine, 'contract', 'ctr3');

    await engine.simulateBulkDelete('contract', { owner_id: 'boss' });

    expect(shareLinkIds(engine)).toEqual(['shl_ctr3']);
  });

  it('issues a set-based revoke per table, not one delete per link row', async () => {
    shareLink(engine, 'contract', 'ctr1', 'shl_a');
    shareLink(engine, 'contract', 'ctr1', 'shl_b');
    shareLink(engine, 'contract', 'ctr2', 'shl_c');
    manualShare(engine, 'contract', 'ctr1', 'carol');
    engine._deleteCalls.length = 0;

    await engine.simulateBulkDelete('contract', { owner_id: 'boss' });

    const linkDeletes = engine._deleteCalls.filter((c) => c.object === 'sys_share_link');
    expect(linkDeletes).toHaveLength(1);
    expect(linkDeletes[0].options).toMatchObject({
      multi: true,
      where: { object_name: 'contract', record_id: { $in: ['ctr1', 'ctr2'] } },
    });
    expect(shareLinks(engine)).toEqual([]);
    // …and the share half still issued exactly its own one statement.
    expect(engine._deleteCalls.filter((c) => c.object === 'sys_record_share')).toHaveLength(1);
  });

  /**
   * The publicSharing-only object: the SHARE half declines it (unmarked system
   * object), the LINK half must not. A single shared predicate for both halves
   * fails here.
   */
  it('revokes links on a publicSharing object the share half skips', async () => {
    engine._schemas.sys_report = { name: 'sys_report', isSystem: true, publicSharing: { enabled: true } };
    engine._tables.sys_report = [{ id: 'rep1' }];
    shareLink(engine, 'sys_report', 'rep1');
    manualShare(engine, 'sys_report', 'rep1', 'carol');
    engine._deleteCalls.length = 0;

    await engine.simulateDeleteById('sys_report', 'rep1');

    expect(shareLinkIds(engine)).toEqual([]);
    // The share row is untouched — that posture is still the boot sweep's job.
    expect(engine._deleteCalls.filter((c) => c.object === 'sys_record_share')).toHaveLength(0);
    expect(shareIds(engine)).toEqual(['shr_rep1_carol']);
  });

  it('skips an object outside BOTH postures (no query on the hot path)', async () => {
    engine._schemas.sys_audit_log = { name: 'sys_audit_log', isSystem: true };
    engine._tables.sys_audit_log = [{ id: 'evt1' }];
    shareLink(engine, 'sys_audit_log', 'evt1');
    engine._deleteCalls.length = 0;

    await engine.simulateDeleteById('sys_audit_log', 'evt1');

    expect(engine._deleteCalls.filter((c) => c.object === 'sys_share_link')).toHaveLength(0);
    expect(shareLinkIds(engine)).toEqual(['shl_evt1']); // the boot sweep's job
  });

  it('covers an object that gains `publicSharing` AFTER boot — no rebind needed', async () => {
    engine._schemas.late = { name: 'late', isSystem: true }; // outside both postures
    engine._tables.late = [{ id: 'late1' }, { id: 'late2' }];
    shareLink(engine, 'late', 'late1');
    await engine.simulateDeleteById('late', 'late1');
    expect(shareLinkIds(engine)).toEqual(['shl_late1']);

    engine._schemas.late = { name: 'late', isSystem: true, publicSharing: { enabled: true } };
    shareLink(engine, 'late', 'late2');

    await engine.simulateDeleteById('late', 'late2');

    expect(shareLinkIds(engine)).toEqual(['shl_late1']); // only the pre-flip orphan
  });

  /**
   * The two halves are isolated: they are different tables, and the token is the
   * more dangerous leftover, so a driver error reclaiming grants must not also
   * skip the links. One shared `try` around both fails this test.
   */
  it('still revokes the LINKS when the share revoke throws', async () => {
    shareLink(engine, 'contract', 'ctr1');
    const boom = {
      revokeSharesForDeletedRecords: vi.fn(async () => { throw new Error('driver down'); }),
      sweepOrphanedRecordShares: vi.fn(async () => ({ scanned: 0, revoked: 0, unresolvedObjects: [], truncated: false })),
    };
    unbindRecordShareCascade(engine as any);
    bindRecordShareCascade(engine as any, boom as any, logger, () => linkService);

    await expect(engine.simulateDeleteById('contract', 'ctr1')).resolves.toBeDefined();

    expect(boom.revokeSharesForDeletedRecords).toHaveBeenCalled();
    expect(shareLinkIds(engine)).toEqual([]);
  });

  it('never fails the write when the LINK revoke throws — and names the repair', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    const brokenLinks = {
      revokeLinksForDeletedRecords: vi.fn(async () => { throw new Error('link table down'); }),
      sweepOrphanedShareLinks: vi.fn(async () => ({ scanned: 0, revoked: 0, unresolvedObjects: [], truncated: false })),
    };
    unbindRecordShareCascade(engine as any);
    bindRecordShareCascade(engine as any, sharing, logger, () => brokenLinks);

    await expect(engine.simulateDeleteById('contract', 'ctr1')).resolves.toBeDefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('share links'),
      expect.objectContaining({ object: 'contract' }),
    );
    // The share half still ran — isolation cuts both ways.
    expect(shareIds(engine)).toEqual([]);
  });

  it('degrades to shares-only when no link service is wired (and never throws)', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    shareLink(engine, 'contract', 'ctr1');
    unbindRecordShareCascade(engine as any);
    bindRecordShareCascade(engine as any, sharing, logger); // no `links` argument

    await expect(engine.simulateDeleteById('contract', 'ctr1')).resolves.toBeDefined();

    expect(shareIds(engine)).toEqual([]);
    expect(shareLinkIds(engine)).toEqual(['shl_ctr1']); // left to the boot sweep
  });

  it('survives a link-service getter that throws', async () => {
    manualShare(engine, 'contract', 'ctr1', 'carol');
    unbindRecordShareCascade(engine as any);
    bindRecordShareCascade(engine as any, sharing, logger, () => { throw new Error('registry tearing down'); });

    await expect(engine.simulateDeleteById('contract', 'ctr1')).resolves.toBeDefined();
    expect(shareIds(engine)).toEqual([]);
  });

  /**
   * Both halves of the fix, on one timeline: a real link minted through the real
   * service stops resolving AND stops existing when its record is deleted.
   */
  it('end to end — a minted link is gone from the table and unresolvable', async () => {
    engine._schemas.contract.publicSharing = { enabled: true };
    const link = await linkService.createLink(
      { object: 'contract', recordId: 'ctr1', audience: 'link_only', permission: 'view' },
      { isSystem: true },
    );
    expect(await linkService.resolveToken(link.token)).not.toBeNull();

    await engine.simulateDeleteById('contract', 'ctr1');

    expect(shareLinks(engine)).toEqual([]);
    expect(await linkService.resolveToken(link.token)).toBeNull();
  });
});

describe('#5190 an UNBOUNDED delete reclaims the links by sweep too', () => {
  let engine: Engine;
  let sharing: SharingService;
  let linkService: ShareLinkService;
  let logger: any;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._schemas.contract = { name: 'contract', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.contract = [{ id: 'ctr1', owner_id: 'boss' }, { id: 'ctr2', owner_id: 'boss' }];
    engine._tables.sys_record_share = [];
    engine._tables.sys_share_link = [];
    sharing = new SharingService({ engine: engine as any, logger });
    linkService = new ShareLinkService({ engine: engine as any, logger });
    bindRecordShareCascade(engine as any, sharing, logger, () => linkService);
  });

  it('sweeps links by record-existence when the delete names no predicate at all', async () => {
    shareLink(engine, 'contract', 'ctr1');
    shareLink(engine, 'contract', 'ctr2');

    await engine.simulateBulkDelete('contract', undefined);
    await orphanShareSweepQueue.whenIdle();

    expect(engine._tables.contract).toEqual([]);
    expect(shareLinkIds(engine)).toEqual([]);
  });

  it('spares links whose record survived the unbounded delete', async () => {
    engine._tables.contract.push({ id: 'ctr3', owner_id: 'boss' });
    shareLink(engine, 'contract', 'ctr1');
    shareLink(engine, 'contract', 'ctr3', 'shl_survivor');

    const ctx: any = {
      object: 'contract',
      event: 'beforeDelete',
      input: { id: undefined, options: { where: undefined, multi: true } },
      session: ADMIN_SESSION,
    };
    await engine.fire('beforeDelete', 'contract', ctx);
    engine._tables.contract = engine._tables.contract.filter((r) => r.id !== 'ctr1');
    ctx.event = 'afterDelete';
    await engine.fire('afterDelete', 'contract', ctx);
    await orphanShareSweepQueue.whenIdle();

    expect(shareLinkIds(engine)).toEqual(['shl_survivor']);
  });

  it('never revokes the object wholesale — a token nobody can re-mint is unrecoverable', async () => {
    shareLink(engine, 'contract', 'ctr2');
    engine._deleteCalls.length = 0;

    await engine.simulateBulkDelete('contract', undefined);

    for (const call of engine._deleteCalls.filter((c) => c.object === 'sys_share_link')) {
      expect(call.options.where).not.toEqual({ object_name: 'contract' });
    }
  });

  it('queues both sweeps on the SAME serialized queue (no parallel table walks)', async () => {
    shareLink(engine, 'contract', 'ctr1');
    manualShare(engine, 'contract', 'ctr1', 'carol');

    await engine.simulateBulkDelete('contract', undefined);
    // One `whenIdle` settles both halves — a second queue would leave rows here.
    await orphanShareSweepQueue.whenIdle();

    expect(shareLinkIds(engine)).toEqual([]);
    expect(shareIds(engine)).toEqual([]);
  });
});

describe('#5190 boot sweep — orphaned share links', () => {
  let engine: Engine;
  let linkService: ShareLinkService;
  let logger: any;

  beforeEach(() => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    engine._schemas.contract = { name: 'contract', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.contract = [{ id: 'ctr_live', owner_id: 'boss' }];
    engine._tables.sys_share_link = [];
    linkService = new ShareLinkService({ engine: engine as any, logger });
  });

  it('removes historical orphans and keeps the valid links', async () => {
    shareLink(engine, 'contract', 'ctr_live', 'shl_live');
    shareLink(engine, 'contract', 'ctr_gone', 'shl_dead');
    // A REVOKED link on a live record: still a valid audit row, not an orphan.
    shareLink(engine, 'contract', 'ctr_live', 'shl_revoked', { revoked_at: '2026-01-01T00:00:00.000Z' });

    const result = await linkService.sweepOrphanedShareLinks();

    expect(result).toMatchObject({ scanned: 3, revoked: 1, unresolvedObjects: [], truncated: false });
    expect(shareLinkIds(engine)).toEqual(['shl_live', 'shl_revoked']);
  });

  it('is idempotent — a second boot finds nothing to do', async () => {
    shareLink(engine, 'contract', 'ctr_gone');
    expect((await linkService.sweepOrphanedShareLinks()).revoked).toBe(1);
    expect((await linkService.sweepOrphanedShareLinks()).revoked).toBe(0);
  });

  it('covers the posture the cascade skips (an unmarked system object)', async () => {
    engine._schemas.sys_audit_log = { name: 'sys_audit_log', isSystem: true };
    engine._tables.sys_audit_log = [];
    shareLink(engine, 'sys_audit_log', 'evt_gone');

    expect((await linkService.sweepOrphanedShareLinks()).revoked).toBe(1);
    expect(shareLinkIds(engine)).toEqual([]);
  });

  /**
   * "Could not ask" is not "the record is gone" — for the LINK table as much as
   * for the share table. A probe failure that deleted would turn a transient
   * driver error into a link nobody can get back (nothing can re-mint a token
   * someone already holds).
   */
  it('LEAVES links alone when the existence probe fails, and reports the object', async () => {
    shareLink(engine, 'contract', 'ctr_gone');
    engine.failFindOn = 'contract';

    const result = await linkService.sweepOrphanedShareLinks();

    expect(result.revoked).toBe(0);
    expect(result.unresolvedObjects).toEqual(['contract']);
    expect(shareLinkIds(engine)).toEqual(['shl_ctr_gone']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not check whether records still exist'),
      expect.objectContaining({ object: 'contract' }),
    );
  });

  it('scopes to one object when asked (the unbounded-delete repair)', async () => {
    engine._schemas.invoice = { name: 'invoice', sharingModel: 'private', fields: { owner_id: {} } };
    engine._tables.invoice = [];
    shareLink(engine, 'contract', 'ctr_gone', 'shl_contract_orphan');
    shareLink(engine, 'invoice', 'inv_gone', 'shl_invoice_orphan');

    const result = await linkService.sweepOrphanedShareLinks({ object: 'contract' });

    expect(result).toMatchObject({ scanned: 1, revoked: 1 });
    expect(shareLinkIds(engine)).toEqual(['shl_invoice_orphan']);
  });

  it('probes existence in ONE batched query per object per page', async () => {
    for (let i = 0; i < 25; i++) shareLink(engine, 'contract', `ctr_gone_${i}`, `shl_${i}`);
    engine._findCalls.length = 0;

    await linkService.sweepOrphanedShareLinks({ batchSize: 100 });

    const probes = engine._findCalls.filter((c) => c.object === 'contract');
    expect(probes).toHaveLength(1);
    expect(probes[0].options.where).toMatchObject({ id: { $in: expect.any(Array) } });
    expect(shareLinks(engine)).toEqual([]);
  });

  it('pages by keyset and REPORTS a scan that its cap cut short', async () => {
    for (let i = 0; i < 12; i++) shareLink(engine, 'contract', `ctr_gone_${i}`, `shl_${String(i).padStart(2, '0')}`);

    const result = await linkService.sweepOrphanedShareLinks({ batchSize: 5, max: 10 });

    expect(result.scanned).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.revoked).toBe(10);
    expect(shareLinks(engine)).toHaveLength(2);
  });

  it('walks past rows it just deleted (a seek, never an OFFSET — #4363)', async () => {
    for (let i = 0; i < 9; i++) shareLink(engine, 'contract', `ctr_gone_${i}`, `shl_${i}`);

    const result = await linkService.sweepOrphanedShareLinks({ batchSize: 3 });

    expect(result).toMatchObject({ scanned: 9, revoked: 9 });
    expect(shareLinks(engine)).toEqual([]);
  });

  it('sweeps the two tables independently — neither can hide the other', async () => {
    const sharing = new SharingService({ engine: engine as any, logger });
    manualShare(engine, 'contract', 'ctr_gone', 'carol', 'shr_orphan');
    shareLink(engine, 'contract', 'ctr_gone', 'shl_orphan');

    expect((await sharing.sweepOrphanedRecordShares()).revoked).toBe(1);
    expect(shareLinkIds(engine)).toEqual(['shl_orphan']); // untouched by the share sweep
    expect((await linkService.sweepOrphanedShareLinks()).revoked).toBe(1);
    expect(shareLinkIds(engine)).toEqual([]);
    expect(shareIds(engine)).toEqual([]);
  });
});

/**
 * [#5190] The link half on a RULES-BEARING object.
 *
 * Every link-cascade case above runs on an object with no sharing rules, which
 * leaves the one interaction that only exists on the objects carrying the MOST
 * sharing machinery unpinned: where rules exist, #5102's `bindRuleHooks`
 * registers its own `beforeDelete` / `afterDelete` under a DIFFERENT hook
 * package, and both packages read the same stashed row set
 * ({@link AFFECTED_ROWS_STASH_KEY}). A link cascade that happened to work only
 * while it was the sole `beforeDelete` writer — or one that let the rule
 * package's recompute consume the stash first — would pass all of them and
 * still leak tokens exactly where the risk is highest.
 *
 * So this asserts the three revocations on one timeline, from one delete: the
 * rule grant (#5102), the manual share (#5103) and the capability token
 * (#5190).
 */
describe('#5190 the LINK cascade on a rules-bearing object', () => {
  let engine: Engine;
  let sharing: SharingService;
  let rules: SharingRuleService;
  let linkService: ShareLinkService;
  let logger: any;

  beforeEach(async () => {
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    engine = makeEngine();
    // A rules-bearing object that ALSO opted into link sharing — the realistic
    // shape, and the one where all three revocation paths meet.
    engine._schemas.opportunity = {
      name: 'opportunity',
      sharingModel: 'private',
      publicSharing: { enabled: true },
      fields: { owner_id: {} },
    };
    engine._tables.opportunity = [
      { id: 'opp1', region: 'east', owner_id: 'boss' },
      { id: 'opp2', region: 'east', owner_id: 'boss' },
    ];
    engine._tables.sys_record_share = [];
    engine._tables.sys_share_link = [];
    engine._tables.sys_sharing_rule = [{
      id: 'srule_east',
      name: 'east_to_alice',
      label: 'East → Alice',
      object_name: 'opportunity',
      criteria_json: JSON.stringify({ region: 'east' }),
      recipient_type: 'user',
      recipient_id: 'alice',
      access_level: 'edit',
      active: true,
    }];
    sharing = new SharingService({ engine: engine as any, logger });
    rules = new SharingRuleService({ engine: engine as any, sharing, logger });
    linkService = new ShareLinkService({ engine: engine as any, logger });
    bindRuleHooks(engine as any, rules, await rules.listRules({ activeOnly: true }, SYS), logger);
    bindRecordShareCascade(engine as any, sharing, logger, () => linkService);
  });

  it('revokes the rule grant, the manual share AND the link of the deleted record', async () => {
    await rules.evaluateRule('srule_east', SYS);
    expect(shares(engine).filter((r) => r.source === 'rule')).toHaveLength(2);
    manualShare(engine, 'opportunity', 'opp1', 'carol', 'shr_manual_opp1');
    shareLink(engine, 'opportunity', 'opp1', 'shl_opp1');
    shareLink(engine, 'opportunity', 'opp2', 'shl_opp2');

    await engine.simulateDeleteById('opportunity', 'opp1');

    // The token goes with the record…
    expect(shareLinkIds(engine)).toEqual(['shl_opp2']);
    // …and so do BOTH share sources, while opp2 keeps everything.
    expect(shares(engine).every((r) => r.record_id === 'opp2')).toBe(true);
    expect(shares(engine).map((r) => r.source)).toEqual(['rule']);
  });

  it('a BOUNDED predicate delete across both hook packages takes every link with it', async () => {
    await rules.evaluateRule('srule_east', SYS);
    shareLink(engine, 'opportunity', 'opp1', 'shl_opp1');
    shareLink(engine, 'opportunity', 'opp2', 'shl_opp2');
    engine._deleteCalls.length = 0;

    await engine.simulateBulkDelete('opportunity', { region: 'east' });

    expect(engine._tables.opportunity).toEqual([]);
    expect(shareLinkIds(engine)).toEqual([]);
    // Still ONE set-based statement for the links, even with the rule package
    // sharing the same stash.
    expect(engine._deleteCalls.filter((c) => c.object === 'sys_share_link')).toHaveLength(1);
  });

  it('both hook packages stay bound, and unbinding the cascade leaves the rule hooks', () => {
    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE).length).toBeGreaterThan(0);
    expect(engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE)).toHaveLength(2);

    unbindRecordShareCascade(engine as any);

    expect(engine.boundFor(SHARING_RULE_HOOK_PACKAGE).length).toBeGreaterThan(0);
    expect(engine.boundFor(RECORD_SHARE_CASCADE_PACKAGE)).toHaveLength(0);
  });
});
