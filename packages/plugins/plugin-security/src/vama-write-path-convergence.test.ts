// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#4647] `security/explain` and the DATA WRITE PATH must answer one
// (principal, record, operation) triple the same way.
//
// The reported contradiction: a **View/Modify All Data holder**, a
// `sharingModel: 'private'` object, and a record whose platform ownership
// column is NULL (system-context seeds routinely produce those — the seed
// loader disables `owner_id` injection). `POST /security/explain` answered
// `allowed: true` with a `vama_bypass` layer stating "ownership and sharing
// checks are skipped", while `PATCH /data/…` answered `403 FORBIDDEN`; filling
// `owner_id` in made the same PATCH succeed, proving the write path was running
// a record-level ownership check the bypass layer claimed had been skipped.
// `sys_attachment`'s `canEdit(parent)` gate agreed with PATCH, not with explain.
//
// Maintainer ruling (2026-08-04, option A): Modify All Data means what it says
// — an admin edits any record regardless of ownership (#1883's Salesforce
// reference frame) — so the WRITE PATH was the side missing the bypass, and
// both sides must resolve it through ONE predicate.
//
// This test wires the REAL objects on both sides — SecurityPlugin's registered
// `security` service (whose `hasWriteBypass` is what plugin-sharing probes),
// the real `SharingService`, the real security + sharing middleware chain the
// engine runs for a by-id write, and the real `explain` entry point — over one
// in-memory engine, and asserts the two paths agree. A regression on either
// side breaks it, which is the only property worth pinning here: not "explain
// says X", but "explain and the write it explains say the same thing".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
  resolveEngineDeleteDispatch,
  ENGINE_DELETE_REJECT_MESSAGE,
  ENGINE_UPDATE_REJECT_MESSAGE,
} from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator, superuserBypassBitForOperation } from './permission-evaluator.js';

// ── the repro's metadata ───────────────────────────────────────────────────

/** The reported object: user-owned, `private` OWD, `private` access posture. */
const CONTRACT_SCHEMA = {
  name: 'crm_contract',
  sharingModel: 'private',
  access: { default: 'private' },
  fields: {
    id: { name: 'id' },
    name: { name: 'name' },
    signed_by: { name: 'signed_by' },
    owner_id: { name: 'owner_id' },
    organization_id: { name: 'organization_id' },
  },
};

/** Platform admin: Modify All Data (and View All Data, which Modify implies). */
const ADMIN_FULL_ACCESS: PermissionSet = PermissionSetSchema.parse({
  name: 'admin_full_access',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
});

/**
 * The bit-separation control: View All Data WITHOUT Modify All Data, holding
 * the ordinary edit/delete CRUD bits so the OBJECT-level gate passes and the
 * ROW-level decision is the only thing under test. A read-all auditor must not
 * inherit a write bypass — the widening this issue lands has to be exactly
 * Modify-scoped.
 */
const COMPLIANCE_AUDITOR: PermissionSet = PermissionSetSchema.parse({
  name: 'compliance_auditor',
  objects: {
    '*': { allowRead: true, allowEdit: true, allowDelete: true, viewAllRecords: true },
  },
});

/** The ordinary member — no bypass of any kind, explicit per-object CRUD. */
const MEMBER_DEFAULT: PermissionSet = PermissionSetSchema.parse({
  name: 'member_default',
  objects: { crm_contract: { allowRead: true, allowEdit: true, allowDelete: true } },
});

const PERMISSION_SETS = [ADMIN_FULL_ACCESS, COMPLIANCE_AUDITOR, MEMBER_DEFAULT];

/** The record at the heart of the report: NULL `owner_id` (no owner at all). */
const OWNERLESS = { id: 'rec_ownerless', name: 'Ownerless', owner_id: null, organization_id: 'org1' };
/** Control: an owned record, owned by somebody ELSE. */
const OWNED_BY_OTHER = { id: 'rec_owned', name: 'Owned', owner_id: 'u_other', organization_id: 'org1' };

// ── in-memory engine (the shape both plugins consume) ──────────────────────

function makeEngine() {
  const tables: Record<string, any[]> = {
    crm_contract: [{ ...OWNERLESS }, { ...OWNED_BY_OTHER }],
    sys_record_share: [],
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    // `$or` / `$and` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — a short-circuiting `return` here would discard every
    // sibling equality key in the same object. See #7620.
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const middlewares: any[] = [];
  return {
    _tables: tables,
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => (name === 'crm_contract' ? CONTRACT_SCHEMA : undefined),
    async find(object: string, options: any = {}) {
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    /**
     * The two WRITE VERBS the middleware chain below terminates in. Both open
     * with the **producer's own dispatch predicate** (#4550 / #5480) rather
     * than a hand-mirrored guard, so this double cannot accept a call
     * `ObjectQL.update` / `ObjectQL.delete` would refuse.
     *
     * That line is not decoration here — it is the pin for #6277. This file's
     * `write('delete', …)` used to hand the chain `options: { id }`, a shape
     * the real engine REJECTS (`resolveEngineDeleteDispatch` reads
     * `options.where.id`), so the whole DELETE half was asserting against a
     * call that could never happen. A boolean terminal could not notice; these
     * two can, and do, by throwing exactly what a running server throws.
     */
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets =
        dispatch.kind === 'by-id'
          ? rows.filter((r) => r.id === dispatch.id)
          : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      // `driver.updateMany` resolves a COUNT; a by-id update resolves the row.
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets =
        dispatch.kind === 'by-id'
          ? rows.filter((r) => r.id === dispatch.id)
          : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      // `driver.deleteMany` resolves a COUNT; a by-id delete resolves a boolean.
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

/**
 * The by-id DELETE options this fixture feeds the chain — the **canonical**
 * shape, and the subject of #6277.
 *
 * `ObjectQL.delete` dispatches by-id on a truthy scalar `options.where.id` and
 * on nothing else, and `SecurityPlugin.extractSingleId` reads the same two
 * places (`data.id`, then `options.where.id`). The old spelling here,
 * `options: { id }`, satisfied neither — it is not even a legal delete option
 * bag, since `id` is outside `{ context, where, multi }` + driver passthrough
 * and `rejectUnknownEngineOptions` refuses it at the entry point (#4371). So
 * the security extractor answered `null` and the #1994 row-level pre-image
 * write gate was skipped wholesale on this half: `write('delete', …)` reached
 * only plugin-sharing's `canDelete`, one of the two gates the case name claims.
 * Measured on this branch over all three principals below:
 *
 * ```
 *   options: { id }             extractSingleId -> null              computeRlsFilter: never called
 *   options: { where: { id } }  extractSingleId -> 'rec_ownerless'   computeRlsFilter('delete'): 1 call
 * ```
 *
 * Note what that measurement does NOT say. The gate is now *reached*; its DENY
 * branch is still not exercised here, because `computeRlsFilter` resolves
 * `null` for all three of this file's permission sets — none of them authors an
 * RLS policy, unlike the real `member_default` whose wildcard `owner_only_writes`
 * is the co-gate #5492 measures. So this file pins gate REACHABILITY, not the
 * gate's verdict; the verdict is #5492's subject, and when its paired PR makes
 * `modifyAllRecords` widen the row write gate, the DELETE case below is the
 * place in this file where that becomes load-bearing.
 */
const byIdDeleteOptions = (recordId: string) => ({ where: { id: recordId } });

/** What a dispatch REJECTION reads like — a fixture defect, never a 403. */
const ENGINE_DISPATCH_REJECTIONS: readonly string[] = [
  ENGINE_DELETE_REJECT_MESSAGE,
  ENGINE_UPDATE_REJECT_MESSAGE,
];

// ── the stack: real SecurityPlugin + real SharingService, one engine ───────

interface Stack {
  security: any;
  sharing: SharingService;
  /**
   * Run a by-id write through the REAL middleware chain (security → sharing)
   * and, when both gates admit it, through the engine's own write verb — so
   * `{ ok: true }` means the row was really written, not that a boolean was set.
   */
  write: (
    operation: 'update' | 'delete',
    recordId: string,
    context: any,
  ) => Promise<{ ok: true } | { ok: false; code?: string; message: string }>;
  /** The fixture's rows, for asserting that an admitted write actually landed. */
  rows: (object: string) => any[];
}

async function makeStack(): Promise<Stack> {
  const engine = makeEngine();
  const metadata = {
    get: async (_type: string, name: string) => (name === 'crm_contract' ? CONTRACT_SCHEMA : null),
    list: async () => PERMISSION_SETS,
  };
  // Late-bound on BOTH sides, exactly as the kernel wires them: the sharing
  // service probes `security`, and the explain engine resolves `sharing`.
  let security: any;
  let sharing: SharingService;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    get sharing() { return sharing; },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, impl: any) => {
      if (name === 'security') security = impl;
    },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (!security) throw new Error('SecurityPlugin did not register the security service');

  sharing = new SharingService({ engine: engine as any, securityService: () => security });
  const sharingMw = buildSharingMiddleware(sharing, ctx.logger);
  const securityMw = engine._middlewares[0];

  return {
    security,
    sharing,
    rows: (object: string) => (engine._tables[object] ??= []),
    async write(operation, recordId, context) {
      const opCtx: any = {
        object: 'crm_contract',
        operation,
        context: { ...context },
        ...(operation === 'update'
          ? { data: { id: recordId, signed_by: 'x' } }
          // [#6277] The canonical by-id delete shape — see `byIdDeleteOptions`.
          : { options: byIdDeleteOptions(recordId) }),
      };
      let reached = false;
      try {
        await securityMw(opCtx, async () => {
          await sharingMw(opCtx, async () => {
            // The terminal is the ENGINE's own write verb, not a boolean. This
            // is what keeps the call shape above honest: both verbs open with
            // the producer's dispatch predicate, so a fixture that drifts back
            // to a call the engine refuses fails LOUDLY here instead of quietly
            // collecting a green from gates that never ran (#6277).
            if (operation === 'delete') await engine.delete(opCtx.object, opCtx.options);
            else await engine.update(opCtx.object, opCtx.data, opCtx.options);
            reached = true;
          });
        });
      } catch (e: any) {
        // A dispatch rejection is a defect in THIS fixture, never a permission
        // verdict — it must never be readable as a 403.
        if (ENGINE_DISPATCH_REJECTIONS.includes(String(e?.message))) throw e;
        return { ok: false, code: e?.code, message: String(e?.message ?? e) };
      }
      return reached ? { ok: true } : { ok: false, message: 'middleware swallowed the write' };
    },
  };
}

/** The execution context shape `resolveAuthzContext` hands the middleware. */
const ctxFor = (userId: string, ...permissions: string[]) => ({
  userId, tenantId: 'org1', positions: [], permissions,
});
const ADMIN_CTX = ctxFor('u_admin', 'admin_full_access');
const AUDITOR_CTX = ctxFor('u_auditor', 'compliance_auditor');
const MEMBER_CTX = ctxFor('u_member', 'member_default');

const explainOf = async (stack: Stack, context: any, operation: string, recordId = OWNERLESS.id) =>
  stack.security.explain({ object: 'crm_contract', operation, recordId }, context);

const layerOf = (decision: any, layer: string) =>
  (decision.layers ?? []).find((l: any) => l.layer === layer);

// ───────────────────────────────────────────────────────────────────────────

describe('[#4647] VAMA holder + private OWD + ownerless record — explain vs. the write path', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('UPDATE: explain and the data write path both ADMIT, and explain credits the bypass', async () => {
    const decision = await explainOf(stack, ADMIN_CTX, 'update');
    const write = await stack.write('update', OWNERLESS.id, ADMIN_CTX);

    // The two answers that used to be opposite.
    expect(decision.allowed, 'top-level verdict').toBe(true);
    expect(decision.record, 'record verdict agrees with the top level').toMatchObject({
      recordId: OWNERLESS.id,
      visible: true,
      decidedBy: 'vama_bypass',
    });
    expect(write, 'PATCH-equivalent through the real middleware chain').toEqual({ ok: true });

    // …and the layer that claimed the bypass now shows it at row granularity.
    const vama = layerOf(decision, 'vama_bypass');
    expect(vama.verdict).toBe('widens');
    expect(vama.contributors.map((c: any) => c.name)).toContain('admin_full_access');
    expect(vama.record.outcome).toBe('admitted');
    // No longer "no ownership and no share grants write" next to allowed:true.
    expect(layerOf(decision, 'sharing').record.outcome).toBe('admitted');
    expect(layerOf(decision, 'sharing').record.detail).toContain('Modify All Data bypass');
  });

  it('DELETE: same triple, same convergence (canDelete has no share branch to hide behind)', async () => {
    // [#6277] The precondition the rest of this case rests on, asserted
    // against the PRODUCER'S predicate rather than assumed: the options bag
    // `write('delete', …)` builds is one `ObjectQL.delete` dispatches BY ID.
    // Until this file was fixed it was `options: { id }` — `reject` — and both
    // the engine and `SecurityPlugin.extractSingleId` refused to see an id in
    // it, so the #1994 row-level pre-image write gate never ran on this half
    // and the assertions below were green for want of anything executing.
    expect(resolveEngineDeleteDispatch(byIdDeleteOptions(OWNERLESS.id))).toEqual({
      kind: 'by-id',
      id: OWNERLESS.id,
    });

    const decision = await explainOf(stack, ADMIN_CTX, 'delete');
    const write = await stack.write('delete', OWNERLESS.id, ADMIN_CTX);
    expect(decision.allowed).toBe(true);
    expect(decision.record).toMatchObject({ visible: true, decidedBy: 'vama_bypass' });
    expect(write).toEqual({ ok: true });
    // …and `ok: true` now means the row is GONE, because the chain terminates
    // in the engine's own `delete` rather than in a boolean.
    expect(stack.rows('crm_contract').map((r) => r.id)).toEqual([OWNED_BY_OTHER.id]);
  });

  // ── the #6277 pin: the shape this fixture used to feed cannot come back ──
  it('[#6277] the DELETE shape this fixture used to feed is one the engine REJECTS', async () => {
    // Reverse verification, committed rather than performed once by hand: put
    // the old spelling back and the producer's predicate — the same one the
    // fake engine's `delete` opens with — refuses it. `options: { id }` names
    // neither one row (no `where.id`) nor a bulk intent (no `multi`).
    //
    // Worth stating exactly, because a real server refuses that bag TWICE and
    // this assertion only pins the second refusal: `ObjectQL.delete` runs
    // `rejectUnknownEngineOptions` FIRST (#4371 — `id` is not among delete's
    // legal keys `context`/`where`/`multi` + driver passthrough), so a running
    // server never reaches the dispatch below, and never reaches its middleware
    // chain either — no gate, security's or sharing's, runs for this bag on the
    // real write path. The dispatch verdict pinned here is what the call would
    // get if the key were legal, and it is the one the fake engine enforces.
    expect(resolveEngineDeleteDispatch({ id: OWNERLESS.id })).toEqual({
      kind: 'reject',
      message: ENGINE_DELETE_REJECT_MESSAGE,
    });
    await expect(makeEngine().delete('crm_contract', { id: OWNERLESS.id })).rejects.toThrow(
      ENGINE_DELETE_REJECT_MESSAGE,
    );
    // The asymmetry that let it hide for so long: plugin-sharing's
    // `inferTargetId` DOES accept `options.id`, so `canDelete` kept running and
    // kept answering — one of the two gates, doing the work of two.
    expect(await stack.sharing.canDelete('crm_contract', OWNERLESS.id, MEMBER_CTX as any)).toBe(false);
  });

  it("the sys_attachment canEdit(parent) gate converges too — it calls the SAME gate", async () => {
    // The exact call `attachment-access-hooks.ts` makes before allowing an
    // attach: `sharing.canEdit(parent_object, parent_id, callerContext(ctx))`.
    const attachmentGate = await stack.sharing.canEdit('crm_contract', OWNERLESS.id, {
      userId: ADMIN_CTX.userId,
      tenantId: ADMIN_CTX.tenantId,
      positions: ADMIN_CTX.positions,
      permissions: ADMIN_CTX.permissions,
    } as any);
    const decision = await explainOf(stack, ADMIN_CTX, 'update');
    expect(attachmentGate, 'ATTACHMENT_PARENT_ACCESS no longer fires for a Modify All holder').toBe(true);
    expect(attachmentGate).toBe(decision.record.visible);
  });

  it('an OWNED record was already consistent and stays so (no behaviour drift)', async () => {
    const decision = await explainOf(stack, ADMIN_CTX, 'update', OWNED_BY_OTHER.id);
    const write = await stack.write('update', OWNED_BY_OTHER.id, ADMIN_CTX);
    expect(decision.record!.visible).toBe(true);
    expect(write).toEqual({ ok: true });
  });

  // ── negative control 1: no bypass at all ────────────────────────────────
  it('a NON-VAMA member stays excluded on BOTH paths', async () => {
    const decision = await explainOf(stack, MEMBER_CTX, 'update');
    const write = await stack.write('update', OWNERLESS.id, MEMBER_CTX);
    const attachmentGate = await stack.sharing.canEdit('crm_contract', OWNERLESS.id, MEMBER_CTX as any);

    expect(decision.record).toMatchObject({ visible: false, decidedBy: 'sharing' });
    expect(write.ok).toBe(false);
    expect((write as any).code).toBe('FORBIDDEN');
    expect(attachmentGate).toBe(false);
    expect(layerOf(decision, 'vama_bypass').verdict).toBe('not_applicable');
    // The record verdict — not the object-level `allowed` — is what the write
    // path answers, and they agree.
    expect(decision.record!.visible).toBe(write.ok);
  });

  // ── negative control 2: the widening is exactly Modify-scoped ───────────
  it('View All Data WITHOUT Modify All Data does NOT grant write, on either path', async () => {
    const decision = await explainOf(stack, AUDITOR_CTX, 'update');
    const write = await stack.write('update', OWNERLESS.id, AUDITOR_CTX);
    const attachmentGate = await stack.sharing.canEdit('crm_contract', OWNERLESS.id, AUDITOR_CTX as any);

    expect(decision.record!.visible).toBe(false);
    expect(write.ok).toBe(false);
    expect(attachmentGate).toBe(false);
    // …and the layer explains WHICH bit is missing rather than going silent.
    const vama = layerOf(decision, 'vama_bypass');
    expect(vama.verdict).toBe('not_applicable');
    expect(vama.detail).toContain('View All Data');
    expect(vama.detail).toContain('Modify All Data');
    expect(vama.contributors).toEqual([]);
  });

  it('the same auditor DOES bypass on READ — the two bits are separate powers', async () => {
    const decision = await explainOf(stack, AUDITOR_CTX, 'read');
    const vama = layerOf(decision, 'vama_bypass');
    expect(vama.verdict).toBe('widens');
    expect(vama.contributors.map((c: any) => c.name)).toContain('compliance_auditor');
    expect(decision.record).toMatchObject({ visible: true, decidedBy: 'vama_bypass' });
  });

  it('a deployment WITHOUT the security probe degrades to owner-only (fail closed)', async () => {
    // ADR-0111 D2: the probe is structural on purpose — no plugin-security, no
    // bypass. The gate must not fall open just because it cannot ask.
    const engine = makeEngine();
    const bare = new SharingService({ engine: engine as any });
    expect(await bare.canEdit('crm_contract', OWNERLESS.id, ADMIN_CTX as any)).toBe(false);
    expect(await bare.canDelete('crm_contract', OWNERLESS.id, ADMIN_CTX as any)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('[#4647] PermissionEvaluator.superuserBypassSets — the one predicate', () => {
  const evaluator = new PermissionEvaluator();

  it('the modify bit is required for a WRITE bypass; the view bit is not enough', () => {
    const opts = { isPrivate: true };
    expect(evaluator.superuserBypassSets('crm_contract', [COMPLIANCE_AUDITOR], { ...opts, bit: 'view' }))
      .toEqual(['compliance_auditor']);
    expect(evaluator.superuserBypassSets('crm_contract', [COMPLIANCE_AUDITOR], { ...opts, bit: 'modify' }))
      .toEqual([]);
    expect(evaluator.superuserBypassSets('crm_contract', [ADMIN_FULL_ACCESS], { ...opts, bit: 'modify' }))
      .toEqual(['admin_full_access']);
    // Modify implies View.
    expect(evaluator.superuserBypassSets('crm_contract', [ADMIN_FULL_ACCESS], { ...opts, bit: 'view' }))
      .toEqual(['admin_full_access']);
    expect(evaluator.superuserBypassSets('crm_contract', [MEMBER_DEFAULT], { ...opts, bit: 'view' })).toEqual([]);
  });

  it('the boolean helpers are the same predicate, so explain and enforcement cannot drift', () => {
    const sets = [COMPLIANCE_AUDITOR];
    expect(evaluator.hasSuperuserReadBypass('crm_contract', sets, { isPrivate: true })).toBe(true);
    expect(evaluator.hasSuperuserWriteBypass('crm_contract', sets, { isPrivate: true })).toBe(false);
    expect(evaluator.hasSuperuserWriteBypass('crm_contract', [ADMIN_FULL_ACCESS], { isPrivate: true })).toBe(true);
  });

  it('maps every operation onto the bit that governs it (export reads, writes modify)', () => {
    expect(superuserBypassBitForOperation('find')).toBe('view');
    expect(superuserBypassBitForOperation('findOne')).toBe('view');
    expect(superuserBypassBitForOperation('count')).toBe('view');
    expect(superuserBypassBitForOperation('export')).toBe('view');
    expect(superuserBypassBitForOperation('update')).toBe('modify');
    expect(superuserBypassBitForOperation('delete')).toBe('modify');
    expect(superuserBypassBitForOperation('insert')).toBe('modify');
    expect(superuserBypassBitForOperation('transfer')).toBe('modify');
    expect(superuserBypassBitForOperation('purge')).toBe('modify');
    // An unmapped operation asks for the STRONGER bit (fail closed).
    expect(superuserBypassBitForOperation('some_future_op')).toBe('modify');
  });
});
