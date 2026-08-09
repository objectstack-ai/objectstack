// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5492] The row-level WRITE gate composes by PROVENANCE.
//
// HotCRM's 17.0 GA acceptance sweep measured two declared write-widening
// mechanisms as completely inert on `@objectstack/*` 17.0.0-rc.2:
//
//   1. a manager profile carrying `viewAllRecords` + `modifyAllRecords` got
//      403 "(row-level security)" on EVERY cross-owner write — update and
//      delete, four objects — while its reads widened exactly as declared
//      (43/43, 9/9);
//   2. all three `edit`-level sharing rules materialised into
//      `sys_record_share` correctly and widened READS exactly, yet a PATCH by
//      the share target got 403 every time.
//
// One root cause: row-level write access was two authorities AND-ed together
// with no knowledge of each other. `plugin-sharing` reads write DEPTH, the
// share level and the `modifyAllRecords` bypass; `plugin-security`'s pre-image
// gate read only RLS — and sitting in that RLS is the platform's OWN ownership
// floor (`owner_only_writes` / `owner_only_deletes`, `created_by ==
// current_user.id`, applicability `positions: ['org_member']`). Every member
// resolves it additively, a manager included, so the widener-blind copy of
// "ownership" always won.
//
// Maintainer ruling (2026-08-07, issue comment 5219846435): "enforce both
// declared write-widening mechanisms. The row-level write gate must consult
// `modifyAllRecords` (profile axis) and `sys_record_share.access_level =
// 'edit'` (share axis)." Route: PR #6564's tri-state `ISharingService` verdict,
// composed by provenance — `allow` replaces the platform floor, `abstain` and
// `deny` leave it standing.
//
// This file drives the REAL stack for that composition: the real SecurityPlugin
// middleware, the real SharingService (late-bound to the security service's own
// `hasWriteBypass`, so the bypass is the same predicate `security/explain`
// reports), the real sharing middleware, and — crucially — the REAL platform
// `member_default` seed, whose wildcard `owner_only_*` policies are the co-gate
// the issue measured. `vama-write-path-convergence.test.ts` cannot see this
// defect: none of its three permission sets authors an RLS policy at all, so
// `computeRlsFilter` answers `null` for every principal there (measured in
// #5492 comment 5224112673).
//
// The object is deliberately an ORDINARY tenant business object —
// `sharingModel: 'private'` but NO `access.default: 'private'` — because that
// posture is exactly what withholds the ADR-0066 ① Layer-1 superuser
// short-circuit, and it is the shape HotCRM ships.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

/**
 * The measured shape: user-owned, `private` OWD, and an ORDINARY access posture
 * (no `access.default: 'private'`). That last omission is load-bearing —
 * `posturePermits` is false for it, so the Layer-1 superuser short-circuit is
 * withheld and the platform ownership floor is the only thing standing between
 * a Modify-All holder and the row.
 */
const OPPORTUNITY_SCHEMA = {
  name: 'crm_opportunity',
  sharingModel: 'private',
  fields: {
    id: { name: 'id' },
    name: { name: 'name' },
    next_step: { name: 'next_step' },
    stage: { name: 'stage' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * The #5492 E2 control: an object with **no `owner_id` column at all** — the
 * most common shape for an author-defined object. Record sharing does not
 * enforce on it (`checkEdit` → `abstain`), which means the platform's
 * `created_by` floor is its ONLY row-level write gate. E2 measured what happens
 * when an abstention is read as permission: an ordinary member's cross-creator
 * UPDATE went from 403 to 200. The cases below pin that it does not.
 */
const NOTE_SCHEMA = {
  name: 'crm_note',
  sharingModel: 'private',
  fields: {
    id: { name: 'id' },
    body: { name: 'body' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = {
  crm_opportunity: OPPORTUNITY_SCHEMA,
  crm_note: NOTE_SCHEMA,
};

/** The platform seed under test — the source of `owner_only_writes/deletes`. */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/** The app's manager profile: View + Modify All Data on its own objects. */
const CRM_MANAGER: PermissionSet = PermissionSetSchema.parse({
  name: 'crm_manager',
  objects: {
    crm_opportunity: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
    crm_note: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
});

/**
 * The app's rank-and-file profile: ordinary CRUD, no bypass of any kind. The
 * DELETE bit is granted deliberately so that when a delete is refused below it
 * is the ROW-level gate refusing, never the object-level CRUD bit.
 */
const CRM_REP: PermissionSet = PermissionSetSchema.parse({
  name: 'crm_rep',
  objects: {
    crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    crm_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

/**
 * [#5493 control] The SAME profile plus an APP-AUTHORED RLS update-widener:
 * "anyone may update an opportunity still in `prospecting`". Applicable policies
 * OR-combine, so at the RLS layer this widens PAST the platform ownership floor
 * — which is the shape #5493 reports from the other side: the security gate
 * admits the row and the SHARING middleware refuses it first.
 *
 * It arrived as a CONTROL of the OLD position (#5492 left #5493's symptom
 * standing deliberately). #5493 step 2 fixed it, so the case at the bottom of
 * this file now measures the DEFERRAL: sharing still refuses on its own terms,
 * consults `checkAuthoredRowWrite`, gets `admit`, and the write lands.
 */
const CRM_REP_WIDENED: PermissionSet = PermissionSetSchema.parse({
  name: 'crm_rep_widened',
  objects: {
    crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    {
      name: 'app_open_stage_updates',
      object: 'crm_opportunity',
      operation: 'update',
      using: "stage == 'prospecting'",
    },
  ],
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, CRM_MANAGER, CRM_REP, CRM_REP_WIDENED];

// ── rows ───────────────────────────────────────────────────────────────────

const U_OTHER = 'u_other';
const U_MANAGER = 'u_manager';
const U_REP = 'u_rep';
const U_EDIT_SHARE = 'u_edit_share';
const U_READ_SHARE = 'u_read_share';

/** Owned AND created by somebody else — the cross-owner row the sweep probed. */
const OPP_THEIRS = {
  id: 'opp_theirs', name: 'Theirs', next_step: 'call', stage: 'prospecting',
  owner_id: U_OTHER, created_by: U_OTHER, organization_id: 'org1',
};
/** The rep's own row — the positive control the floor must keep admitting. */
const OPP_MINE = {
  id: 'opp_mine', name: 'Mine', next_step: 'call', stage: 'prospecting',
  owner_id: U_REP, created_by: U_REP, organization_id: 'org1',
};
/** Owner-less object, created by somebody else (the E2 shape). */
const NOTE_THEIRS = { id: 'note_theirs', body: 'theirs', created_by: U_OTHER, organization_id: 'org1' };

/** The share rows the rule evaluator materialises — both levels, same record. */
const SHARE_ROWS = [
  {
    id: 'shr_edit', object_name: 'crm_opportunity', record_id: OPP_THEIRS.id,
    recipient_type: 'user', recipient_id: U_EDIT_SHARE, access_level: 'edit', source: 'rule',
  },
  {
    id: 'shr_read', object_name: 'crm_opportunity', record_id: OPP_THEIRS.id,
    recipient_type: 'user', recipient_id: U_READ_SHARE, access_level: 'read', source: 'rule',
  },
];

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine() {
  const tables: Record<string, any[]> = {
    crm_opportunity: [{ ...OPP_THEIRS }, { ...OPP_MINE }],
    crm_note: [{ ...NOTE_THEIRS }],
    sys_record_share: SHARE_ROWS.map((r) => ({ ...r })),
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or)) return filter.$or.some((f: any) => matches(row, f));
    if (Array.isArray(filter.$and)) return filter.$and.every((f: any) => matches(row, f));
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
    getSchema: (name: string) => SCHEMAS[name],
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
    // Both write verbs open with the PRODUCER's own dispatch predicate
    // (#4550 / #5480 / #6277), never a hand-mirrored guard: a fixture that
    // drifts to a call shape `ObjectQL` would refuse fails loudly here instead
    // of collecting a green from gates that never ran.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

// ── the stack ──────────────────────────────────────────────────────────────

interface WriteOutcome {
  ok: boolean;
  /** ADR-0112 envelope of the refusal — asserted, never a bare `toThrow()`. */
  code?: string;
  status?: number;
  message: string;
}

interface Stack {
  security: any;
  sharing: SharingService;
  write: (
    operation: 'update' | 'delete',
    object: string,
    recordId: string,
    context: any,
  ) => Promise<WriteOutcome>;
  rows: (object: string) => any[];
}

async function makeStack(): Promise<Stack> {
  const engine = makeEngine();
  const metadata = {
    get: async (_type: string, name: string) => SCHEMAS[name] ?? null,
    list: async () => PERMISSION_SETS,
  };
  let security: any;
  let sharing: SharingService;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    // Org scoping active, exactly as a multi-tenant deployment wires it — so
    // Layer 0 contributes a real tenant predicate the composition must preserve.
    'org-scoping': { name: 'org-scoping' },
    get sharing() { return sharing; },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, impl: any) => { if (name === 'security') security = impl; },
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
    async write(operation, object, recordId, context) {
      const opCtx: any = {
        object,
        operation,
        context: { ...context },
        ...(operation === 'update'
          ? { data: { id: recordId, next_step: 'updated' } }
          : { options: { where: { id: recordId } } }),
      };
      let reached = false;
      try {
        await securityMw(opCtx, async () => {
          await sharingMw(opCtx, async () => {
            if (operation === 'delete') await engine.delete(opCtx.object, opCtx.options);
            else await engine.update(opCtx.object, opCtx.data, opCtx.options);
            reached = true;
          });
        });
      } catch (e: any) {
        return {
          ok: false,
          code: e?.code,
          status: e?.statusCode,
          message: String(e?.message ?? e),
        };
      }
      return reached
        ? { ok: true, message: 'written' }
        : { ok: false, message: 'middleware swallowed the write' };
    },
  };
}

/**
 * The execution-context shape `resolveAuthzContext` hands the middleware. The
 * `org_member` position is not decoration: it is the applicability domain of
 * `owner_only_writes` / `owner_only_deletes`, and a manager is an org member
 * too — which is precisely why the floor used to override their profile.
 */
const ctxFor = (userId: string, ...permissions: string[]) => ({
  userId, tenantId: 'org1', positions: ['org_member'], permissions,
});

const MANAGER_CTX = ctxFor(U_MANAGER, 'crm_manager');
const REP_CTX = ctxFor(U_REP, 'crm_rep');
const EDIT_SHARE_CTX = ctxFor(U_EDIT_SHARE, 'crm_rep');
const READ_SHARE_CTX = ctxFor(U_READ_SHARE, 'crm_rep');
const WIDENED_CTX = ctxFor('u_widened', 'crm_rep_widened');

/**
 * The refusal this issue is about, asserted as an ENVELOPE and not as "it
 * threw". A bare `toThrow()` carries one bit where the defect has three: which
 * gate refused, with what code, at what status. The row-level pre-image gate is
 * the only place that produces this exact sentence.
 */
function expectRowLevelDenial(outcome: WriteOutcome, operation: 'update' | 'delete', object: string) {
  expect(outcome.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message).toContain(
    `[Security] Access denied: not permitted to ${operation} this '${object}' record (row-level security)`,
  );
}

const rowById = (stack: Stack, object: string, id: string) =>
  stack.rows(object).find((r) => r.id === id);

// ───────────────────────────────────────────────────────────────────────────

describe('[#5492] `modifyAllRecords` widens the row-level write gate (profile axis)', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('cross-owner UPDATE succeeds and the row really changes', async () => {
    const out = await stack.write('update', 'crm_opportunity', OPP_THEIRS.id, MANAGER_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id)?.next_step).toBe('updated');
  });

  it('cross-owner DELETE succeeds and the row is really gone (MODIFY_ALL_WRITE_KEYS covers delete)', async () => {
    const out = await stack.write('delete', 'crm_opportunity', OPP_THEIRS.id, MANAGER_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id)).toBeUndefined();
  });

  it('the widening is the SHARING authority answering `allow`, not this side recomputing it', async () => {
    // The composition delegates; it never re-derives owner/depth/share/bypass.
    // If these two verdicts ever stop being `allow`, the two cases above are
    // passing for some other reason and the delegation has been bypassed.
    await expect(
      stack.sharing.checkEdit('crm_opportunity', OPP_THEIRS.id, MANAGER_CTX as any),
    ).resolves.toBe('allow');
    await expect(
      stack.sharing.checkDelete('crm_opportunity', OPP_THEIRS.id, MANAGER_CTX as any),
    ).resolves.toBe('allow');
  });
});

describe("[#5492] an `edit`-level `sys_record_share` widens UPDATE only (share axis, ADR-0111 D3)", () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('PATCH by the edit-share target succeeds on the shared record', async () => {
    const out = await stack.write('update', 'crm_opportunity', OPP_THEIRS.id, EDIT_SHARE_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id)?.next_step).toBe('updated');
  });

  it('DELETE by the same edit-share target is still REFUSED — a share widens rows, never verbs', async () => {
    const out = await stack.write('delete', 'crm_opportunity', OPP_THEIRS.id, EDIT_SHARE_CTX);
    expectRowLevelDenial(out, 'delete', 'crm_opportunity');
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id), 'row survives').toBeDefined();
    // Refused by the ROW gate, not by a missing CRUD bit: the profile grants delete.
    expect((CRM_REP.objects as any).crm_opportunity.allowDelete).toBe(true);
    await expect(
      stack.sharing.checkDelete('crm_opportunity', OPP_THEIRS.id, EDIT_SHARE_CTX as any),
    ).resolves.toBe('deny');
  });

  it('a READ-level share target is still REFUSED an UPDATE (the guarded surface may not shrink)', async () => {
    const out = await stack.write('update', 'crm_opportunity', OPP_THEIRS.id, READ_SHARE_CTX);
    expectRowLevelDenial(out, 'update', 'crm_opportunity');
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id)?.next_step).toBe('call');
  });

  it('an unrelated member with no share and no bypass is still REFUSED', async () => {
    const out = await stack.write('update', 'crm_opportunity', OPP_THEIRS.id, REP_CTX);
    expectRowLevelDenial(out, 'update', 'crm_opportunity');
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id)?.next_step).toBe('call');
  });
});

describe('[#5492] the platform ownership floor still stands where nothing replaces it', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it("a member's own record is still writable (the floor admits its owner, unchanged)", async () => {
    const out = await stack.write('update', 'crm_opportunity', OPP_MINE.id, REP_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_opportunity', OPP_MINE.id)?.next_step).toBe('updated');
  });

  it('[E2] on an object with NO owner field the floor is the only gate, and it holds', async () => {
    // `checkEdit` ABSTAINS here (record sharing does not enforce on an
    // owner-less object). #5492's E2 experiment let an abstention count as
    // permission and this exact write turned 403 into 200. It must stay 403.
    await expect(
      stack.sharing.checkEdit('crm_note', NOTE_THEIRS.id, REP_CTX as any),
    ).resolves.toBe('abstain');
    const out = await stack.write('update', 'crm_note', NOTE_THEIRS.id, REP_CTX);
    expectRowLevelDenial(out, 'update', 'crm_note');
    expect(rowById(stack, 'crm_note', NOTE_THEIRS.id)?.body).toBe('theirs');
  });

  it('[E2] an abstention does not become permission for a Modify-All holder either', async () => {
    // Deliberate and measured, not an oversight: an `abstain` is "record
    // sharing does not enforce on this row", so the composition has no declared
    // authority to promote and the floor stays. ADR-0066 ① withholds the
    // superuser RLS short-circuit on an ordinary business posture, so a
    // Modify-All holder is still bounded by `created_by` on an owner-less
    // object. Widening THIS cell would require the security side to re-derive
    // the bypass itself — the second implementation this composition removes.
    await expect(
      stack.sharing.checkEdit('crm_note', NOTE_THEIRS.id, MANAGER_CTX as any),
    ).resolves.toBe('abstain');
    const out = await stack.write('update', 'crm_note', NOTE_THEIRS.id, MANAGER_CTX);
    expectRowLevelDenial(out, 'update', 'crm_note');
  });
});

describe('[#5493] the sharing middleware DEFERS to an app-authored RLS widener instead of hard-refusing', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('an APP-AUTHORED RLS update-widener passes the security gate AND the write now lands', async () => {
    // ── what this case used to assert, and why it flipped ──────────────────
    // #5492 (this file's subject) landed the composition and left #5493's
    // symptom standing on purpose, so this case was written as a CONTROL of
    // the old position: the security pre-image gate admitted the row and the
    // SHARING middleware refused it first with `FORBIDDEN`. #5493 step 2 is
    // the fix for exactly that, so the control flips — the two authorities are
    // ONE composite determination (maintainer ruling, #5492 comment
    // 5219846435; mirrored for this card in comment 5217346436), and this
    // middleware may not hard-refuse a by-id write an app-authored widener
    // admits by declaration.
    //
    // Everything the old case measured is still measured here, and the load
    // is the same load: sharing STILL refuses on its own terms (`checkEdit` →
    // `deny`, unchanged — nothing widened the sharing verdict), the security
    // gate STILL admits the row through the app policy `stage ==
    // 'prospecting'` OR-combining past the platform ownership floor. What
    // changed is the composition between them: the middleware consults
    // `checkAuthoredRowWrite` before refusing, gets `admit`, and hands the row
    // to the pre-image gate that makes the final decision. The write lands and
    // the ROW REALLY CHANGES — a completed write with an unchanged row would
    // mean the middleware chain was bypassed, not that the fix works.
    await expect(
      stack.sharing.checkEdit('crm_opportunity', OPP_THEIRS.id, WIDENED_CTX as any),
    ).resolves.toBe('deny');
    // The deferral predicate is the SECURITY service's verdict, not anything
    // this middleware re-derived (ruling Q1 = A, #5493 comment 5226389104).
    await expect(
      stack.security.checkAuthoredRowWrite('crm_opportunity', OPP_THEIRS.id, 'update', WIDENED_CTX),
    ).resolves.toBe('admit');

    const out = await stack.write('update', 'crm_opportunity', OPP_THEIRS.id, WIDENED_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_opportunity', OPP_THEIRS.id)?.next_step).toBe('updated');
  });
});
