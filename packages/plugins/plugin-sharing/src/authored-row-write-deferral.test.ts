// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5493 step 2] The by-id write gate DEFERS to an app-authored RLS widener
// before it hard-refuses.
//
// HotCRM's 17.0 GA acceptance sweep measured one mechanism working on half its
// objects. Two RLS update-wideners were declared on the same profile; on
// `crm_campaign_member` a non-owner PATCH returned 200, on `crm_campaign` the
// identical shape returned 403 `FORBIDDEN: insufficient privileges to update
// crm_campaign`. The error SHAPE is the tell: that sentence is this
// middleware's, not the row-gate's `(row-level security)` — so the refusal
// landed BEFORE RLS was consulted and the declared widener was never asked.
//
// The discriminator is not "carries sharing rules" (#5493's own wording) but
// **whether record sharing enforces on the object at all** (round-2 refinement,
// issue comment 5226364929): `checkEdit` abstains — and `canEdit` therefore
// answers `true`, letting the write straight through to RLS — when the
// effective sharing model is `public` (which `controlled_by_parent` maps to) or
// when the schema has no `owner_id` field. A junction object lands in that set;
// an ordinary owned business object does not. Both shapes are fixtures below,
// because "the working half keeps working" is a guard here, not a footnote.
//
// Maintainer rulings this file pins (final, not re-adjudicable):
//   • row-level write authority is ONE composite determination — this
//     middleware must not hard-refuse a by-id write that an APP-AUTHORED RLS
//     update-widener admits by declaration (#5492 comment 5219846435, mirrored
//     for this card in comment 5217346436);
//   • the deferral predicate is answered by a fail-closed verdict ON the
//     security service, never by this middleware re-deriving anything —
//     `ISecurityService.checkAuthoredRowWrite`, landed by step 1 / PR #6841
//     (#5493 comment 5226389104, Q1 = A / Q2 = A1: verdict-shaped, by-id only);
//   • the guarded surface may not shrink — every refusal this middleware
//     correctly produces today still stands.
//
// **What the security stub below is, and what it is not.** `plugin-sharing`
// deliberately does NOT depend on `@objectstack/plugin-security` (the dependency
// runs the other way, so importing it here would be a cycle), and the probe is
// reached through the same structural late-binding this plugin already uses for
// `hasWriteBypass`. So the stub stands in for the service and MODELS the ruled
// semantics of step 1: authored (non-floor) policies only — the platform's
// `created_by` ownership floor is deliberately absent from `AUTHORED_POLICIES`,
// which is the whole point of probe E-A — plus `abstain` for an unknown row, a
// principal-less context and a delegated one. The REAL service driving the REAL
// composition is measured end-to-end on the REAL stack, in
// `packages/qa/dogfood/test/authored-row-write-scope.dogfood.test.ts`
// ([#7281] — plugin-security's `row-write-widener-composition.test.ts` was named
// here until that card measured that its fake engine registers no middleware
// chain: nested re-reads there are never scoped by this plugin's READ filter, so
// it cannot see read scoping and is not an end-to-end measurement of anything
// that depends on it);
// what THIS file owns is the consumer half: which outcomes widen, which do not,
// and that everything that is not a literal `admit` leaves the refusal intact.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { SharingService, type SharingSecurityProbe } from './sharing-service.js';
import { buildSharingMiddleware } from './sharing-plugin.js';

// ── metadata ───────────────────────────────────────────────────────────────

/**
 * The object the sweep FAILED on: ordinary tenant business object, `private`
 * OWD, an `owner_id` column — so record sharing really enforces and `checkEdit`
 * can answer `deny`.
 */
const CAMPAIGN_SCHEMA = {
  name: 'crm_campaign',
  sharingModel: 'private',
  fields: {
    id: { name: 'id' },
    description: { name: 'description' },
    stage: { name: 'stage' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * The object the sweep SUCCEEDED on: the junction. `controlled_by_parent` maps
 * onto the effective `public` model, so `checkEdit` ABSTAINS, `canEdit` answers
 * `true`, and the write reached RLS all along. This is the working half — it
 * must stay working, and it must not acquire a probe round-trip it never needed.
 */
const CAMPAIGN_MEMBER_SCHEMA = {
  name: 'crm_campaign_member',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id' },
    campaign_id: { name: 'campaign_id' },
    status: { name: 'status' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * [#6698] The OTHER member of the abstaining set: `private` OWD but NO
 * `owner_id` column at all. Record sharing abstains, so the platform's
 * `created_by` write floor is that object's only row-level gate — which is
 * exactly what `modifyAllRecords`' published `.describe()` promises since
 * #6698. This file's job on that boundary is to show it is UNTOUCHED: the
 * deferral lives in the refusal branch, and on this shape the gate never
 * refuses, so the probe is never reached.
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
  crm_campaign: CAMPAIGN_SCHEMA,
  crm_campaign_member: CAMPAIGN_MEMBER_SCHEMA,
  crm_note: NOTE_SCHEMA,
};

// ── principals + rows ──────────────────────────────────────────────────────

const U_OTHER = 'u_other';
const U_REP = 'u_rep';
const U_WIDENED = 'u_widened';
const U_CREATOR = 'u_creator';
const U_EDIT_SHARE = 'u_edit_share';
const U_READ_SHARE = 'u_read_share';

/** The HotCRM shape: someone else's campaign, in the stage the widener names. */
const CAMPAIGN_THEIRS = {
  id: 'camp_theirs', description: 'call', stage: 'prospecting',
  owner_id: U_OTHER, created_by: U_OTHER, organization_id: 'org1',
};
/** The rep's own campaign — the positive control ownership must keep admitting. */
const CAMPAIGN_MINE = {
  id: 'camp_mine', description: 'call', stage: 'prospecting',
  owner_id: U_REP, created_by: U_REP, organization_id: 'org1',
};
/**
 * ⭐ The E-A row. Created by `U_CREATOR`, since TRANSFERRED to `U_OTHER`, and in
 * a stage no authored policy names. The platform's ownership floor
 * (`created_by == current_user.id`) MATCHES it; every app-authored policy does
 * not. A deferral keyed on "the composed RLS admits this row" would therefore
 * hand transferred records back to their former creators — which is why the
 * predicate is a provenance-aware verdict and not a composed-filter probe.
 */
const CAMPAIGN_TRANSFERRED = {
  id: 'camp_transferred', description: 'call', stage: 'closed_won',
  owner_id: U_OTHER, created_by: U_CREATOR, organization_id: 'org1',
};
/** The junction row the sweep PATCHed successfully on rc.2. */
const MEMBER_THEIRS = {
  id: 'mbr_theirs', campaign_id: CAMPAIGN_THEIRS.id, status: 'sent',
  owner_id: U_OTHER, created_by: U_OTHER, organization_id: 'org1',
};
/** The owner-less row — the #6698 boundary. */
const NOTE_THEIRS = { id: 'note_theirs', body: 'theirs', created_by: U_OTHER, organization_id: 'org1' };

const SHARE_ROWS = [
  {
    id: 'shr_edit', object_name: 'crm_campaign', record_id: CAMPAIGN_THEIRS.id,
    recipient_type: 'user', recipient_id: U_EDIT_SHARE, access_level: 'edit', source: 'rule',
  },
  {
    id: 'shr_read', object_name: 'crm_campaign', record_id: CAMPAIGN_THEIRS.id,
    recipient_type: 'user', recipient_id: U_READ_SHARE, access_level: 'read', source: 'rule',
  },
];

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine() {
  const tables: Record<string, any[]> = {
    crm_campaign: [{ ...CAMPAIGN_THEIRS }, { ...CAMPAIGN_MINE }, { ...CAMPAIGN_TRANSFERRED }],
    crm_campaign_member: [{ ...MEMBER_THEIRS }],
    crm_note: [{ ...NOTE_THEIRS }],
    sys_record_share: SHARE_ROWS.map((r) => ({ ...r })),
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
  return {
    _tables: tables,
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
    // (#4550 / #5480 / #6277), never a hand-mirrored guard: a double looser
    // than the engine it replaces converts a green suite into no suite at all.
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

// ── the security stub ──────────────────────────────────────────────────────

interface AuthoredPolicy {
  object: string;
  operation: 'update' | 'delete';
  /** The compiled predicate, as a row test. */
  admits: (row: any) => boolean;
}

/**
 * The APP-AUTHORED policies each principal resolves — and NOTHING ELSE. The
 * platform's `owner_only_writes` floor (`created_by == current_user.id`) is
 * deliberately absent: provenance is what separates the two, and modelling the
 * floor here would silently re-open E-A inside the fixture.
 *
 * The two entries are HotCRM's own wideners, restated: an UPDATE-only widener
 * on `crm_campaign`, and the junction's widener that never needed this path.
 */
const AUTHORED_POLICIES: Record<string, AuthoredPolicy[]> = {
  [U_WIDENED]: [
    { object: 'crm_campaign', operation: 'update', admits: (r) => r.stage === 'prospecting' },
    { object: 'crm_campaign_member', operation: 'update', admits: () => true },
  ],
  // The E-A principal HOLDS an authored widener — it simply does not name the
  // transferred row. Without this the E-A case would be pinning "a principal
  // with no policies abstains", which is a weaker fact than the hole needs.
  [U_CREATOR]: [
    { object: 'crm_campaign', operation: 'update', admits: (r) => r.stage === 'prospecting' },
  ],
};

interface SecurityStub extends SharingSecurityProbe {
  calls: Array<{ object: string; recordId: string; operation: string; userId?: string }>;
}

/**
 * A structural stand-in for the `security` service, modelling the semantics
 * step 1 pinned: `admit` iff at least one applicable APP-AUTHORED policy matches
 * the row for that operation; `abstain` in every other case.
 */
function makeSecurityStub(
  engine: ReturnType<typeof makeEngine>,
  overrides: Partial<SharingSecurityProbe> = {},
): SecurityStub {
  const calls: SecurityStub['calls'] = [];
  return {
    calls,
    async checkAuthoredRowWrite(object, recordId, operation, context: any) {
      calls.push({ object, recordId, operation, userId: context?.userId });
      if (!context?.userId) return 'abstain';
      if (context?.onBehalfOf?.userId) return 'abstain';
      const applicable = (AUTHORED_POLICIES[context.userId] ?? []).filter(
        (p) => p.object === object && p.operation === operation,
      );
      // The provenance pre-check: no app-authored policy ⇒ nothing could admit
      // by declaration, whatever the platform floor says about this row.
      if (applicable.length === 0) return 'abstain';
      const row = (engine._tables[object] ?? []).find((r) => r.id === recordId);
      if (!row) return 'abstain';
      // Layer 0 stays AND-ed in — a row in another tenant is admitted by nothing.
      if (context.tenantId && row.organization_id !== context.tenantId) return 'abstain';
      return applicable.some((p) => p.admits(row)) ? 'admit' : 'abstain';
    },
    ...overrides,
  } as SecurityStub;
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
  sharing: SharingService;
  security: SecurityStub | null;
  logger: { info: any; warn: any; error: any; debug: any };
  rows: (object: string) => any[];
  /** The middleware itself, for the shapes `write()` cannot express (bulk). */
  mw: (ctx: any, next: () => Promise<void>) => Promise<void>;
  write: (
    operation: 'update' | 'delete',
    object: string,
    recordId: string,
    context: any,
  ) => Promise<WriteOutcome>;
}

function makeStack(opts: {
  /** Omit the `security` late-binding entirely (a stack with no plugin-security). */
  noSecurityService?: boolean;
  /** The late-bound getter itself throws (`ctx.getService` on an unregistered name). */
  lookupThrows?: boolean;
  /** Replace / remove members of the stub. */
  probe?: Partial<SharingSecurityProbe>;
} = {}): Stack {
  const engine = makeEngine();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const security = opts.noSecurityService || opts.lookupThrows
    ? null
    : makeSecurityStub(engine, opts.probe);
  const sharing = new SharingService({
    engine: engine as any,
    logger,
    securityService: opts.noSecurityService
      ? undefined
      : () => {
          if (opts.lookupThrows) throw new Error('service not registered: security');
          return security;
        },
  });
  const mw = buildSharingMiddleware(sharing, logger);

  return {
    sharing,
    security,
    logger,
    mw: mw as any,
    rows: (object) => (engine._tables[object] ??= []),
    async write(operation, object, recordId, context) {
      const opCtx: any = {
        object,
        operation,
        context: { ...context },
        ...(operation === 'update'
          ? { data: { id: recordId, ...(object === 'crm_campaign_member' ? { status: 'responded' } : object === 'crm_note' ? { body: 'updated' } : { description: 'updated' }) } }
          : { options: { where: { id: recordId } } }),
      };
      let reached = false;
      try {
        await mw(opCtx, async () => {
          if (operation === 'delete') await engine.delete(opCtx.object, opCtx.options);
          else await engine.update(opCtx.object, opCtx.data, opCtx.options);
          reached = true;
        });
      } catch (e: any) {
        return { ok: false, code: e?.code, status: e?.status, message: String(e?.message ?? e) };
      }
      return reached
        ? { ok: true, message: 'written' }
        : { ok: false, message: 'middleware swallowed the write' };
    },
  };
}

/** The execution-context shape `resolveAuthzContext` hands the middleware. */
const ctxFor = (userId: string) => ({ userId, tenantId: 'org1', positions: ['org_member'], permissions: [] });

const REP_CTX = ctxFor(U_REP);
const WIDENED_CTX = ctxFor(U_WIDENED);
const CREATOR_CTX = ctxFor(U_CREATOR);
const EDIT_SHARE_CTX = ctxFor(U_EDIT_SHARE);
const READ_SHARE_CTX = ctxFor(U_READ_SHARE);

/**
 * The refusal this middleware produces, asserted as an ENVELOPE (ADR-0112) and
 * not as "it threw". A bare `toThrow()` carries one bit where the defect has
 * three: which authority refused, with what code, at what status — and the two
 * authorities in play here refuse with DIFFERENT sentences, which is the tell
 * the whole issue turns on.
 */
function expectSharingRefusal(out: WriteOutcome, operation: 'update' | 'delete', object: string, id: string) {
  expect(out.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(out.code, 'ADR-0112 error code').toBe('FORBIDDEN');
  expect(out.status, 'ADR-0112 HTTP status').toBe(403);
  expect(out.message).toContain(`FORBIDDEN: insufficient privileges to ${operation} ${object} ${id}`);
}

const rowById = (stack: Stack, object: string, id: string) =>
  stack.rows(object).find((r) => r.id === id);

// ───────────────────────────────────────────────────────────────────────────

describe('[#5493] an app-authored RLS update-widener is consulted before the write gate refuses', () => {
  let stack: Stack;
  beforeEach(() => { stack = makeStack(); });

  it('the HotCRM shape: a non-owner whose profile authors an update-widener PATCHes and the row really changes', async () => {
    // The premise, restated as a measurement: record sharing DOES enforce here
    // and it DOES refuse this principal on its own terms. Without this the case
    // below could pass because sharing never objected in the first place.
    await expect(
      stack.sharing.checkEdit('crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX as any),
    ).resolves.toBe('deny');

    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id)?.description).toBe('updated');
  });

  it('the widening is the SECURITY service answering `admit`, not this middleware re-deriving anything', async () => {
    await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expect(stack.security!.calls).toEqual([
      { object: 'crm_campaign', recordId: CAMPAIGN_THEIRS.id, operation: 'update', userId: U_WIDENED },
    ]);
  });

  it('a member with NO authored widener and no share is still refused (the guarded surface may not shrink)', async () => {
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, REP_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id)?.description).toBe('call');
  });

  it("an owner's own write still passes without consulting the probe at all", async () => {
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_MINE.id, REP_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    // The deferral lives in the refusal branch only: an `allow` never pays for
    // a cross-service round-trip.
    expect(stack.security!.calls).toEqual([]);
  });
});

describe('[#5493 E-A] a creator who is no longer the owner is NOT handed the record back', () => {
  let stack: Stack;
  beforeEach(() => { stack = makeStack(); });

  it('the fixture really is the E-A shape: the platform ownership floor matches this row, the authored policy does not', () => {
    const row = rowById(stack, 'crm_campaign', CAMPAIGN_TRANSFERRED.id)!;
    // `created_by == current_user.id` — the floor `member_default` ships — is TRUE here…
    expect(row.created_by).toBe(U_CREATOR);
    // …while ownership has moved on, which is what sharing refuses on…
    expect(row.owner_id).toBe(U_OTHER);
    // …and the principal's own authored widener names a stage this row is not in.
    expect(AUTHORED_POLICIES[U_CREATOR]!.every((p) => !p.admits(row))).toBe(true);
  });

  it('the transferred record stays refused — the verdict abstains and the deferral must not widen it', async () => {
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_TRANSFERRED.id, CREATOR_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_TRANSFERRED.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_TRANSFERRED.id)?.description).toBe('call');
    // Refused BY the abstention, not by never asking: the probe ran and said no.
    expect(stack.security!.calls).toHaveLength(1);
    await expect(
      stack.security!.checkAuthoredRowWrite!('crm_campaign', CAMPAIGN_TRANSFERRED.id, 'update', CREATOR_CTX),
    ).resolves.toBe('abstain');
  });

  it('the same creator IS admitted on a row their authored policy really names (the guard is the row, not the person)', async () => {
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, CREATOR_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
  });
});

describe('[#5493 / ADR-0111 D3] the verb boundary survives the deferral', () => {
  let stack: Stack;
  beforeEach(() => { stack = makeStack(); });

  it('an UPDATE-only authored widener does not open DELETE', async () => {
    const out = await stack.write('delete', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expectSharingRefusal(out, 'delete', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id), 'row survives').toBeDefined();
    // The probe was asked for `delete` — the verb is threaded through, not
    // collapsed onto `update` — and answered `abstain`.
    expect(stack.security!.calls).toEqual([
      { object: 'crm_campaign', recordId: CAMPAIGN_THEIRS.id, operation: 'delete', userId: U_WIDENED },
    ]);
    // …and the ADR-0111 D10 delete breadcrumb still fires on the surviving refusal.
    expect(stack.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('an edit-level share does not grant delete'),
      expect.anything(),
    );
  });

  it('an EDIT-level share still widens UPDATE and still does NOT widen DELETE', async () => {
    const upd = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, EDIT_SHARE_CTX);
    expect(upd, upd.message).toMatchObject({ ok: true });
    // Sharing answered `allow` on its own — the probe was never needed.
    expect(stack.security!.calls).toEqual([]);

    const del = await stack.write('delete', 'crm_campaign', CAMPAIGN_THEIRS.id, EDIT_SHARE_CTX);
    expectSharingRefusal(del, 'delete', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id), 'row survives').toBeDefined();
  });

  it('a READ-level share target is still refused an UPDATE — read shares never widen writes', async () => {
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, READ_SHARE_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id)?.description).toBe('call');
  });
});

describe('[#5493] the abstaining half of the object surface is untouched', () => {
  let stack: Stack;
  beforeEach(() => { stack = makeStack(); });

  it('the junction (`controlled_by_parent` ⇒ effective `public`) still passes through, with no probe round-trip', async () => {
    await expect(
      stack.sharing.checkEdit('crm_campaign_member', MEMBER_THEIRS.id, WIDENED_CTX as any),
    ).resolves.toBe('abstain');
    const out = await stack.write('update', 'crm_campaign_member', MEMBER_THEIRS.id, WIDENED_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(rowById(stack, 'crm_campaign_member', MEMBER_THEIRS.id)?.status).toBe('responded');
    // The working half never entered the refusal branch, so it never asked.
    expect(stack.security!.calls).toEqual([]);
  });

  it('[#6698] an object with NO owner field is unchanged: sharing abstains, the probe is never reached, the platform floor decides', async () => {
    await expect(
      stack.sharing.checkEdit('crm_note', NOTE_THEIRS.id, REP_CTX as any),
    ).resolves.toBe('abstain');
    // This middleware lets it through exactly as before — the `created_by`
    // floor in plugin-security is this object's only row-level write gate and
    // this PR neither consults nor displaces it.
    const out = await stack.write('update', 'crm_note', NOTE_THEIRS.id, REP_CTX);
    expect(out, out.message).toMatchObject({ ok: true });
    expect(stack.security!.calls).toEqual([]);
  });
});

describe('[#5493] every non-`admit` outcome is byte-for-byte the refusal of a stack that never asked', () => {
  it('no `security` service at all (a deployment without plugin-security)', async () => {
    const stack = makeStack({ noSecurityService: true });
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id)?.description).toBe('call');
  });

  it('the late-bound lookup itself throws (`getService` on an unregistered name)', async () => {
    const stack = makeStack({ lookupThrows: true });
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
  });

  it('a security service that PREDATES the method — absence and `abstain` are one instruction', async () => {
    const stack = makeStack({ probe: { checkAuthoredRowWrite: undefined } });
    expect(typeof stack.security!.checkAuthoredRowWrite).toBe('undefined');
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id)?.description).toBe('call');
  });

  it('a probe that THROWS — the refusal stands and the breadcrumb names the abstention', async () => {
    const stack = makeStack({
      probe: { checkAuthoredRowWrite: async () => { throw new Error('security exploded'); } },
    });
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(rowById(stack, 'crm_campaign', CAMPAIGN_THEIRS.id)?.description).toBe('call');
    expect(stack.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('the authored-row-write probe'),
      expect.any(Error),
    );
  });

  it('a verdict this consumer does not recognise is not a permission', async () => {
    const stack = makeStack({ probe: { checkAuthoredRowWrite: async () => 'allow' as any } });
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, WIDENED_CTX);
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
  });

  it('[ADR-0090 D10] an on-behalf-of context never defers — the delegator intersection is not resolvable here', async () => {
    const stack = makeStack();
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, {
      ...WIDENED_CTX,
      onBehalfOf: { userId: U_REP },
    });
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    // Declined before the service was even asked — the consumer's own guard,
    // not a property borrowed from the reference implementation (this plugin
    // late-binds structurally to whatever is registered as `security`).
    expect(stack.security!.calls).toEqual([]);
  });

  it('a principal-less context never defers', async () => {
    const stack = makeStack();
    const out = await stack.write('update', 'crm_campaign', CAMPAIGN_THEIRS.id, { tenantId: 'org1' });
    expectSharingRefusal(out, 'update', 'crm_campaign', CAMPAIGN_THEIRS.id);
    expect(stack.security!.calls).toEqual([]);
  });
});

describe('[#5493 / #6736] the BULK path is untouched — a verdict is a by-id answer', () => {
  it('a multi update still composes the write FILTER, unwidened, and never reaches the probe', async () => {
    const stack = makeStack();
    // No inferable id anywhere (`data`, `options.id`, `options.where.id`) ⇒ the
    // bulk branch. Ruling Q2 = A1 is verdict-shaped and by-id ONLY; composing a
    // filter from a per-row verdict is a different problem, tracked as #6736.
    const opCtx: any = {
      object: 'crm_campaign',
      operation: 'update',
      ast: { where: { stage: 'prospecting' } },
      data: { description: 'bulk' },
      options: { multi: true, where: { stage: 'prospecting' } },
      context: { ...WIDENED_CTX },
    };
    let nextCalled = false;
    await stack.mw(opCtx, async () => { nextCalled = true; });
    expect(nextCalled, 'the bulk branch scopes rather than refuses').toBe(true);
    expect(opCtx.ast.where, 'still scoped by OWNERSHIP, unwidened by any authored policy')
      .toEqual({ $and: [{ stage: 'prospecting' }, { owner_id: U_WIDENED }] });
    expect(stack.security!.calls, 'the bulk path asks no verdict').toEqual([]);
  });
});
