// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8757] ONE row-write authority for a `controlled_by_parent` detail — and the
// COVERAGE PRECONDITION that licenses removing the other one.
//
// ## What was measured on 17.0.0 GA (the card)
//
// On an ADR-0055 `controlled_by_parent` detail, a by-id UPDATE of a child row
// created by another user was refused at the by-id write pre-image gate (step
// 2.7) — before `assertControlledByParentWrite` (step 2.8) ran at all —
// regardless of whether the caller may edit the master. The refusal was
// `record_access_denied`, not the master-editability sentence.
//
//   1. the platform floor `owner_only_writes` is declared `object '*'`, so it
//      applies to the detail like any other object;
//   2. step 2.7 dropped the floor only on `resolveSharingWriteVerdict === 'allow'`;
//   3. that verdict comes from `SharingService.checkEdit`, which returns
//      `abstain` for any object whose `effectiveSharingModel` is `public` — and
//      `controlled_by_parent` maps to `public` there;
//   4. the `public` early return sits ABOVE the `modifyAllRecords` branch, so the
//      bypass is never consulted.
//
// Net: the detail's own floor was unconditional and unwidenable — not by
// ownership depth, not by an `edit`-level `sys_record_share`, not by Modify All
// Data. The detail declares NOTHING about who may write it, so that creator-only
// rule was derived from nothing an author wrote, while ADR-0055 says access
// derives from the master.
//
// ## The ruling, and why this file leads with the precondition
//
// Maintainer ruling 2026-08-15 (delegated adjudication): the master gate is the
// SOLE row-write authority for a `controlled_by_parent` detail — under one hard
// precondition, quoted because it is the thing this suite exists to discharge:
//
//   > a test proving `assertControlledByParentWrite` actually runs on every
//   > by-id write path where the floor is being removed — the floor comes off
//   > only where the master gate demonstrably covers the same operation;
//   > otherwise the change is a bare widening.
//
// So section 1 is not a regression suite for the fix — it is the fix's licence,
// and it is written to be capable of RED: every case there refuses with step
// 2.7's `record_access_denied` sentence before the change, because the floor is
// what answers first. A green section 1 is the statement "on this path, the
// master gate is what decides".
//
// Section 3 is the other half of the same precondition, and the reason the floor
// is dropped from a CALL SITE rather than from the object's posture alone: on a
// BULK (AST) write `assertControlledByParentWrite` returns early
// (`extractSingleId == null`), so nothing there replaces the floor and the floor
// therefore STAYS. That is a residual, pinned, not an oversight.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, buildSharingMiddleware, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const MKT = 'usr_marketing';
const ADMIN = 'usr_admin';
const ORG = 'org-1';

/**
 * The MASTER. `sharingModel: 'private'` with an `owner_id` column is the posture
 * on which record sharing actually ENFORCES — the master gate's sharing leg has
 * to have something to answer.
 */
const CAMPAIGN_SCHEMA = {
  name: 'crm_campaign',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
    created_by: { name: 'created_by', type: 'lookup', reference: 'sys_user' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

/** The DETAIL — ADR-0055 `controlled_by_parent`, access derived through the FK. */
const MEMBER_SCHEMA = {
  name: 'crm_campaign_member',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    crm_campaign: {
      name: 'crm_campaign',
      type: 'master_detail',
      required: true,
      reference: 'crm_campaign',
    },
    status: { name: 'status', type: 'text' },
    created_by: { name: 'created_by', type: 'lookup', reference: 'sys_user' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

/**
 * The CONTROL object for section 4: sharing abstains here too — no owner field,
 * so `checkEdit` returns `abstain` at its `hasOwnerField` gate — but the object
 * is NOT `controlled_by_parent`, so no master gate covers it and the floor is
 * still the only row-level write gate it has (#5492's E2 measurement, #6698's
 * trigger). If the change leaked past the `controlled_by_parent` posture this
 * goes green and must not.
 */
const NOTE_SCHEMA = {
  name: 'crm_note',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    body: { name: 'body', type: 'text' },
    created_by: { name: 'created_by', type: 'lookup', reference: 'sys_user' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

/**
 * A `controlled_by_parent` detail whose `master_detail` declaration is BROKEN —
 * the posture is declared, the relation to derive it from is missing. The floor
 * comes off (the object declares cbp), so this is the sharpest "did the change
 * open a hole" probe in the file: with nothing to derive from, the master gate
 * must still REFUSE, and with a metadata error rather than an access verdict
 * (#7474).
 */
const ORPHAN_SCHEMA = {
  name: 'crm_orphan_detail',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    status: { name: 'status', type: 'text' },
    created_by: { name: 'created_by', type: 'lookup', reference: 'sys_user' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

/**
 * [#8865] A MASTER on which record sharing ABSTAINS — `private`, but with no
 * owner field, so `checkEdit` returns `abstain` at its `hasOwnerField` gate
 * before the `modifyAllRecords` branch is ever reached.
 *
 * It is the tri-state's negative half, and the sharpest probe that leg 1 drops
 * the master's floor on `allow` ALONE. `abstain` means record sharing does not
 * enforce on this master at all, so the platform floor is the only row-level
 * write gate it has (#5492's E2 measurement) — and a composition that read the
 * boolean projection (`canEdit`, which is `!== 'deny'`) instead of the verdict
 * would drop the floor here and go green while opening exactly that hole.
 */
const PROGRAM_SCHEMA = {
  name: 'crm_program',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    created_by: { name: 'created_by', type: 'lookup', reference: 'sys_user' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

/** Its `controlled_by_parent` detail — same posture as the campaign member. */
const PROGRAM_STEP_SCHEMA = {
  name: 'crm_program_step',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    crm_program: {
      name: 'crm_program',
      type: 'master_detail',
      required: true,
      reference: 'crm_program',
    },
    status: { name: 'status', type: 'text' },
    created_by: { name: 'created_by', type: 'lookup', reference: 'sys_user' },
    organization_id: { name: 'organization_id', type: 'text' },
  },
};

const SHARE_SCHEMA = {
  name: 'sys_record_share',
  isSystem: true,
  fields: {
    id: { name: 'id', type: 'text' },
    object_name: { name: 'object_name', type: 'text' },
    record_id: { name: 'record_id', type: 'text' },
    recipient_type: { name: 'recipient_type', type: 'text' },
    recipient_id: { name: 'recipient_id', type: 'text' },
    access_level: { name: 'access_level', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

const SCHEMAS: Record<string, unknown> = {
  crm_campaign: CAMPAIGN_SCHEMA,
  crm_campaign_member: MEMBER_SCHEMA,
  crm_note: NOTE_SCHEMA,
  crm_orphan_detail: ORPHAN_SCHEMA,
  crm_program: PROGRAM_SCHEMA,
  crm_program_step: PROGRAM_STEP_SCHEMA,
  sys_record_share: SHARE_SCHEMA,
};

/** The shipped platform seed — the source of the `owner_only_writes` floor. */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * Object grants wide enough that NO case below is decided by the CRUD check.
 *
 * The lifecycle three are here for a measured reason. Step 2.7 and step 2.8 are
 * both pre-wired for `transfer` / `restore` / `purge` (#1883), but each maps to
 * its own grant (`allowTransfer` / `allowRestore` / `allowPurge`,
 * `permission.zod.ts`), so a principal holding only CRUD is refused by the
 * OBJECT-level check long before either row gate runs — with
 * `insufficient_permission`, not a row verdict. Granting them is what makes §1's
 * per-operation coverage claim about the row gates rather than about the CRUD
 * bit that never let the operation through.
 */
const CRUD = {
  allowRead: true,
  allowCreate: true,
  allowEdit: true,
  allowDelete: true,
  allowTransfer: true,
  allowRestore: true,
  allowPurge: true,
};

/**
 * An ordinary member: object grants on everything, no RLS, no share, no bypass.
 * Every verdict below is therefore attributable to the platform floor and the
 * master gate alone — the two authorities this card puts in order.
 */
const MARKETING: PermissionSet = PermissionSetSchema.parse({
  name: 'marketing',
  objects: {
    crm_campaign: { ...CRUD },
    crm_campaign_member: { ...CRUD },
    crm_note: { ...CRUD },
    crm_orphan_detail: { ...CRUD },
    crm_program: { ...CRUD },
    crm_program_step: { ...CRUD },
  },
});

/**
 * The Modify All Data principal — the card's sharp case. It carries
 * `modifyAllRecords` on BOTH objects and was still refused on a detail row it
 * did not personally create, under a master it can fully edit, because the
 * `public` early return in `checkEdit` sits above the bypass branch.
 */
const ADMIN_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'admin_set',
  objects: {
    crm_campaign: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    crm_campaign_member: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    crm_note: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    crm_orphan_detail: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    crm_program: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    crm_program_step: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
  },
});

/**
 * [#8865] An APP-AUTHORED write policy on the MASTER, carried by a set that
 * grants nothing else. Nothing the platform ships spells it, so it is the
 * provenance control: dropping the PLATFORM floor must leave this policy
 * compiling and refusing exactly as before (ADR-0049 — a declared security
 * property stays declared; ADR-0105 F1 — a token match must not swallow an
 * authored policy that happens to look like the floor).
 */
const AUTHORED_CAMPAIGN_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'campaign_authored',
  // No object grants of its own: the CRUD bits come from `admin_set`, so this
  // set contributes exactly one thing — the authored row-level policy.
  objects: {},
  rowLevelSecurity: [
    {
      name: 'campaign_owner_writes',
      object: 'crm_campaign',
      operation: 'update',
      using: 'owner_id == current_user.id',
    },
  ],
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, MARKETING, ADMIN_SET, AUTHORED_CAMPAIGN_SET];

type Row = Record<string, unknown>;

/**
 * Two campaigns differing only in who owns/created them, and four children
 * chosen so the DETAIL's own floor and the MASTER's editability vary
 * independently:
 *
 *   • `mem_mkt_byadmin`  — created by ADMIN, under the master MKT owns.
 *     Floor refuses; master gate would allow. The card's line 1.
 *   • `mem_admin`        — created by ADMIN, under the master ADMIN owns.
 *     Floor refuses; master gate ALSO refuses for MKT. The negative twin.
 *   • `mem_mkt`          — created by MKT under its own master: the column that
 *     always worked, and the control that keeps a green run from being vacuous.
 *   • `mem_admin_selfmade` — created by MKT under ADMIN's master. The card's
 *     line 3 for `admin_set`.
 */
function fixtureRows(): Record<string, Row[]> {
  return {
    crm_campaign: [
      { id: 'camp_admin', name: 'Admin Campaign', owner_id: ADMIN, created_by: ADMIN, organization_id: ORG },
      { id: 'camp_mkt', name: 'Marketing Campaign', owner_id: MKT, created_by: MKT, organization_id: ORG },
    ],
    crm_campaign_member: [
      { id: 'mem_mkt_byadmin', crm_campaign: 'camp_mkt', status: 'sent', created_by: ADMIN, organization_id: ORG },
      { id: 'mem_admin', crm_campaign: 'camp_admin', status: 'sent', created_by: ADMIN, organization_id: ORG },
      { id: 'mem_mkt', crm_campaign: 'camp_mkt', status: 'sent', created_by: MKT, organization_id: ORG },
      { id: 'mem_admin_selfmade', crm_campaign: 'camp_admin', status: 'sent', created_by: MKT, organization_id: ORG },
    ],
    crm_note: [
      { id: 'note_admin', body: 'a', created_by: ADMIN, organization_id: ORG },
      { id: 'note_mkt', body: 'b', created_by: MKT, organization_id: ORG },
    ],
    crm_orphan_detail: [
      { id: 'orph_admin', status: 'sent', created_by: ADMIN, organization_id: ORG },
    ],
    // [#8865] The owner-less master, one per principal so each case can be run
    // against a master the principal did NOT create — the only state in which
    // the floor has anything to say. The pair mirrors the campaign fixture
    // exactly but for the missing owner column, which is what turns the sharing
    // verdict from `allow` into `abstain`.
    crm_program: [
      { id: 'prog_admin', name: 'Admin Program', created_by: ADMIN, organization_id: ORG },
      { id: 'prog_mkt', name: 'Marketing Program', created_by: MKT, organization_id: ORG },
    ],
    crm_program_step: [
      { id: 'step_admin', crm_program: 'prog_admin', status: 'sent', created_by: ADMIN, organization_id: ORG },
      { id: 'step_mkt', crm_program: 'prog_mkt', status: 'sent', created_by: MKT, organization_id: ORG },
    ],
    sys_record_share: [],
  };
}

/**
 * [#8865] An `edit`-level record share — one of the three wideners the platform
 * declares, and the one that is neither ownership nor a superuser bit. Seeding
 * it is how a case varies the SHARING VERDICT and nothing else.
 */
function editShare(object: string, recordId: string, recipientId: string): Row {
  return {
    id: `shr_${object}_${recordId}_${recipientId}`,
    object_name: object,
    record_id: recordId,
    recipient_type: 'user',
    recipient_id: recipientId,
    access_level: 'edit',
    owner_id: ADMIN,
  };
}

/**
 * READ-only engine double — `find`, `findOne`, `getSchema`, and nothing else. No
 * case here writes through it (the terminal `next()` only records that the chain
 * was reached), and a double without a verb cannot be looser than the engine on
 * that verb. Filtering runs through `matchesFilterCondition`, the evaluator the
 * plugin itself compiles against, so a filter these cases turn on is a filter
 * that really applied.
 */
function makeStore(rows: Record<string, Row[]>) {
  return {
    rows,
    getSchema: (object: string) => SCHEMAS[object],
    find: vi.fn(async (object: string, options: any = {}) => {
      const all = rows[object] ?? [];
      const hits = all.filter((r) => matchesFilterCondition(r, options?.where ?? options?.filter ?? null));
      return typeof options?.limit === 'number' ? hits.slice(0, options.limit) : hits;
    }),
    findOne: vi.fn(async (object: string, options: any = {}) => {
      const all = rows[object] ?? [];
      return all.find((r) => matchesFilterCondition(r, options?.where ?? options?.filter ?? null)) ?? null;
    }),
  };
}

/** What a driven operation answered — the whole ADR-0112 envelope, not a boolean. */
interface Outcome {
  ok: boolean;
  /** `undefined` when the write was permitted. */
  code?: string;
  status?: number;
  message: string;
  /** Step 2.7 localizes its message and carries the operator sentence here. */
  developerMessage?: string;
}

/**
 * Boot the REAL pair: `SecurityPlugin`'s middleware and the REAL sharing
 * middleware over the REAL `SharingService`, wired through the same late binding
 * the kernel uses.
 */
async function boot(seed: { shares?: Row[] } = {}) {
  const rows = fixtureRows();
  // [#8865] The ONLY fixture axis a case may vary: which record shares exist.
  // Everything else is fixed, so a verdict that moves moved because the declared
  // widener moved.
  if (seed.shares) rows.sys_record_share = seed.shares;
  const store = makeStore(rows);

  const securityMiddlewares: any[] = [];
  const ql = {
    registerMiddleware: (mw: any) => securityMiddlewares.push(mw),
    getSchema: store.getSchema,
    find: store.find,
    findOne: store.findOne,
  };

  let security: any;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: {
      get: async (...args: unknown[]) => SCHEMAS[String(args[args.length - 1])] ?? null,
      list: async () => PERMISSION_SETS,
    },
    'org-scoping': { name: 'org-scoping' },
  };

  const sharing = new SharingService({
    engine: store as unknown as SharingEngine,
    securityService: () => security,
  });
  services.sharing = sharing;

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

  const securityMw = securityMiddlewares[0];
  const sharingMw = buildSharingMiddleware(sharing, ctx.logger);

  /** Drive one operation through BOTH gates, in the kernel's chain order. */
  const run = async (opCtx: any): Promise<Outcome> => {
    let reached = false;
    try {
      await securityMw(opCtx, async () => {
        await sharingMw(opCtx, async () => {
          reached = true;
        });
      });
    } catch (e: any) {
      return {
        ok: false,
        code: e?.code,
        status: e?.statusCode,
        message: String(e?.message ?? e),
        developerMessage: e?.developerMessage,
      };
    }
    return reached
      ? { ok: true, message: 'written' }
      : { ok: false, message: 'chain swallowed the write' };
  };

  const ctxFor = (userId: string, ...permissions: string[]) => ({
    userId,
    tenantId: ORG,
    positions: ['org_member'],
    permissions,
  });

  return {
    store,
    security,
    ctxFor,
    /** A by-id write on the detail, for any operation in step 2.7's set. */
    byIdDetailWrite: (operation: string, id: string, context: any, object = 'crm_campaign_member') =>
      run({
        object,
        operation,
        ...(operation === 'delete' || operation === 'purge' ? {} : { data: { id, status: 'responded' } }),
        options: { where: { id } },
        context,
      }),
    /** A by-id write on a NON-`controlled_by_parent` object. */
    byIdNoteWrite: (operation: string, id: string, context: any) =>
      run({
        object: 'crm_note',
        operation,
        ...(operation === 'delete' ? {} : { data: { id, body: 'x' } }),
        options: { where: { id } },
        context,
      }),
    /**
     * A BULK write — carries an `ast`, addresses no single id. Returns the
     * opCtx too: a bulk/read scope is ENFORCED by injection into `opCtx.ast`,
     * so the injected tree is the only place the scope is observable (the
     * engine double is never called with it).
     */
    bulkDetailWrite: async (operation: string, where: Record<string, unknown>, context: any) => {
      const opCtx: any = {
        object: 'crm_campaign_member',
        operation,
        ...(operation === 'delete' ? {} : { data: { status: 'responded' } }),
        options: { where },
        ast: { where },
        context,
      };
      const outcome = await run(opCtx);
      return { outcome, injected: JSON.stringify(opCtx.ast ?? null) };
    },
    /** An INSERT of a child naming its master on the body — no pre-image at all. */
    insertMember: (campaignId: string, context: any) =>
      run({
        object: 'crm_campaign_member',
        operation: 'insert',
        data: { crm_campaign: campaignId, status: 'sent' },
        options: {},
        context,
      }),
    /** A READ of the detail — the path this card must not touch. */
    readMember: async (id: string, context: any) => {
      const opCtx: any = {
        object: 'crm_campaign_member',
        operation: 'find',
        options: { where: { id } },
        ast: { where: { id } },
        context,
      };
      const outcome = await run(opCtx);
      return { outcome, injected: JSON.stringify(opCtx.ast ?? null) };
    },
  };
}

/**
 * The two gates' own sentences. Which one answers IS the measurement — both are
 * `403 PERMISSION_DENIED`, so a bare status assertion cannot tell them apart and
 * would have been green on the defect.
 */
const MASTER_GATE_SENTENCE = /requires edit access to its master record/;
const PRE_IMAGE_GATE_SENTENCE = /row-level security\)$/;

/** Step 2.7's set — the operations whose floor this card removes on a cbp detail. */
const BY_ID_WRITE_OPERATIONS = ['update', 'delete', 'transfer', 'restore', 'purge'] as const;

describe('[#8757] §1 PRECONDITION — the master gate runs on every by-id write path the floor comes off', () => {
  // The ruling's licence condition, stated once per operation in step 2.7's
  // set. The principal cannot edit `camp_admin` (not owner, not creator, no
  // share, no bypass) and did not create `mem_admin`, so BOTH authorities would
  // refuse — which is exactly what makes the sentence diagnostic: it says which
  // one actually answered.
  //
  // Predicted direction before the fix: RED on every case, with step 2.7's
  // `record_access_denied` sentence, because the floor answers first. Predicted
  // after: the master gate's sentence, on all five.
  for (const operation of BY_ID_WRITE_OPERATIONS) {
    it(`${operation}: the refusal comes from \`assertControlledByParentWrite\`, not the ownership floor`, async () => {
      const h = await boot();
      const mkt = h.ctxFor(MKT, 'marketing');
      const outcome = await h.byIdDetailWrite(operation, 'mem_admin', mkt);

      expect(outcome.ok).toBe(false);
      // ADR-0112 envelope — asserted alongside the sentence, never instead of
      // it: both gates answer 403/PERMISSION_DENIED.
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.message).toMatch(MASTER_GATE_SENTENCE);
      expect(outcome.message).toContain("master 'crm_campaign' not editable by this user");
      // …and NOT the pre-image gate. Step 2.7 localizes its user-facing message
      // and puts the operator sentence on `developerMessage`; the master gate
      // carries none. Asserting the absence is what makes this a proof that the
      // floor did not answer first, rather than a proof that something refused.
      expect(outcome.developerMessage).toBeUndefined();
    });
  }

  it('the coverage is the MASTER gate, not a relaxation: the same principal is permitted once the master is editable', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // Same object, same operation, same non-creator posture — only the master
    // changes. `camp_mkt` is owned by MKT, so the master gate admits, and the
    // detail's own creator (`ADMIN`) stops being the deciding fact. A suite
    // holding only the refusals above would be satisfied by a gate that refuses
    // everything.
    expect(await h.byIdDetailWrite('update', 'mem_mkt_byadmin', mkt)).toMatchObject({ ok: true });
  });

  it('a cbp detail with a BROKEN `master_detail` declaration still refuses — 422, not a silent allow', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // The floor comes off (the object declares `controlled_by_parent`) and there
    // is nothing to derive access from. #7474 makes this a metadata verdict
    // rather than an access one, and the point here is only that the write does
    // not fall through: no relation, no admission.
    const outcome = await h.byIdDetailWrite('update', 'orph_admin', mkt, 'crm_orphan_detail');
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('INVALID_METADATA');
    expect(outcome.status).toBe(422);
  });
});

describe('[#8757] §2 the card\'s three measured refusals become the master gate\'s answer', () => {
  it('a cross-creator by-id UPDATE under an editable master is permitted', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // Card line 1: `update marketing mem_mkt_byadmin` → "You do not have access
    // to this record…". MKT owns `camp_mkt`; ADMIN created the child.
    expect(await h.byIdDetailWrite('update', 'mem_mkt_byadmin', mkt)).toMatchObject({ ok: true });
  });

  it('Modify All Data finally reaches a detail row the holder did not create', async () => {
    const h = await boot();
    const admin = h.ctxFor(ADMIN, 'admin_set');
    // Card line 3. `admin_set` carries `modifyAllRecords: true` on BOTH objects
    // and was refused on `mem_admin_selfmade` (created by MKT) under a master it
    // owns, because `checkEdit`'s `public` early return sits above the bypass
    // branch and the detail's floor was therefore undroppable by anything.
    expect(await h.byIdDetailWrite('update', 'mem_admin_selfmade', admin)).toMatchObject({ ok: true });
  });

  it('[#8865 LANDED] card line 2 is permitted — the master gate\'s write-RLS leg dropped the MASTER floor too', async () => {
    const h = await boot();
    const admin = h.ctxFor(ADMIN, 'admin_set');
    // The card's sharpest line — `admin_set` updating `mem_mkt`, a child it did
    // not create, under a master it does not own. #8757 took the DETAIL's floor
    // off, and this assertion then pinned the REFUSAL that survived one gate
    // later: the master gate's write-RLS leg (leg 1) still ran
    // `computeRlsFilter(master, 'update')` with the MASTER's platform ownership
    // floor standing, while the by-id path dropped it on a sharing `allow`.
    // That was the #8679 divergence surviving in the sibling leg, filed as
    // #8865, and it is what this assertion said until #8865 landed.
    //
    // Maintainer ruling 2026-08-15 (direction 1): leg 1 adopts step 2.7's
    // composition — `resolveSharingWriteVerdict('update', master, masterId, …)`,
    // floor dropped on `allow`. `admin_set` holds `modifyAllRecords` on
    // `crm_campaign`, so the verdict is `allow`, the master floor comes off, and
    // the two paths now answer the same. §5 below is what proves the flip is
    // THAT composition and not a relaxation.
    expect(await h.byIdDetailWrite('update', 'mem_mkt', admin)).toMatchObject({ ok: true });
    // THE WITNESS, unchanged from the day it was written: the same principal,
    // the same master row, the same operation — asked DIRECTLY — is permitted.
    // It was the proof that the refusal above was a divergence; it is now the
    // proof that the permission above is the SAME answer rather than a second
    // one that happens to agree today.
    expect(await h.byIdDetailWrite('update', 'camp_mkt', admin, 'crm_campaign')).toMatchObject({ ok: true });
  });

  it('the master gate still refuses when the master is not editable — the widening is bounded by it', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // The negative twin of the two cases above, same route, opposite verdict.
    // Without it, "the floor is gone" and "the detail is open" are the same
    // green.
    const outcome = await h.byIdDetailWrite('update', 'mem_admin', mkt);
    expect(outcome).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(outcome.message).toMatch(MASTER_GATE_SENTENCE);
  });
});

describe('[#8757] §3 RESIDUAL — the floor STAYS where the master gate does not run', () => {
  it('a BULK write on the detail keeps the ownership floor', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // `assertControlledByParentWrite` returns early on a bulk write
    // (`extractSingleId == null` — "scoped by the read filter on the AST"), so
    // no master gate covers this path and the precondition is NOT satisfied
    // here. The floor is therefore dropped from the by-id CALL SITE, never from
    // the object's posture alone, and this case is what holds that shape: the
    // AST-injected filter must still carry `created_by == current_user.id`.
    const { injected } = await h.bulkDetailWrite('update', { status: 'sent' }, mkt);
    expect(injected).toContain('created_by');
    expect(injected).toContain(MKT);
  });
});

describe('[#8757] §4 NON-REGRESSION — everything the floor is still the only gate for', () => {
  it('the floor still refuses a cross-creator by-id UPDATE on a NON-cbp object', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // `crm_note` has no owner field, so `checkEdit` abstains here too — the
    // #5492 E2 / #6698 shape. Nothing derives its access from a master, so the
    // floor is the only row-level write gate it has and must hold.
    const outcome = await h.byIdNoteWrite('update', 'note_admin', mkt);
    expect(outcome).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(outcome.developerMessage).toMatch(PRE_IMAGE_GATE_SENTENCE);
    // The creator's own row is untouched by any of this.
    expect(await h.byIdNoteWrite('update', 'note_mkt', mkt)).toMatchObject({ ok: true });
  });

  it('the floor still refuses a cross-creator by-id DELETE on a NON-cbp object', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    expect(await h.byIdNoteWrite('delete', 'note_admin', mkt)).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
      status: 403,
    });
  });

  it('INSERT is unchanged — it never went through the pre-image gate', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    expect(await h.insertMember('camp_mkt', mkt)).toMatchObject({ ok: true });
    // …and is still gated by the master, in the direction that refuses.
    const refused = await h.insertMember('camp_admin', mkt);
    expect(refused).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toMatch(MASTER_GATE_SENTENCE);
  });

  it('the READ path is unchanged — the detail is still scoped to readable masters', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    const { outcome, injected } = await h.readMember('mem_admin', mkt);
    expect(outcome).toMatchObject({ ok: true });
    // The ADR-0055 read derivation (`masterFK IN (accessible master ids)`) is
    // what scopes a detail read, and it must still be there: the floor removal
    // is a write-side construct and the read path never carried the floor (its
    // policies are `update` / `delete` only).
    expect(injected).toContain('crm_campaign');
    expect(injected).not.toContain('created_by');
  });
});

// ---------------------------------------------------------------------------

/**
 * [#8865] §5 ONE ownership composition, both paths — and the bounds that make
 * the flip above attributable to it.
 *
 * ## What this section is for
 *
 * §2's card-line-2 assertion flipped from a refusal to a permission. A flip on
 * its own is ambiguous: any relaxation anywhere upstream produces the same
 * green. So every case here varies ONE input of leg 1's new composition and
 * asserts the verdict moves with it, in BOTH directions:
 *
 *   • which widener the principal holds (a record share, seeded or not);
 *   • whether the sharing authority answers `allow` or `abstain` (an owner-less
 *     master, where `checkEdit` abstains for everyone — `modifyAllRecords`
 *     included);
 *   • whether the policy standing in the way is the PLATFORM's floor or an
 *     APP-AUTHORED one (only the first is droppable, ADR-0049).
 *
 * ## The DIRECT witness is asserted in every case, deliberately
 *
 * The defect this card closes was never "a child write is refused" — it was
 * "the same principal, the same master row and the same `update` get two
 * answers depending on who asks" (#8679's ruling, one leg over). A case that
 * asserted only the child's verdict would go green on a gate that refuses
 * everything, and — worse — would not notice the divergence coming back on the
 * other side. So each case asserts the master's own by-id write too, and the
 * two must agree.
 *
 * ## Not covered here, and why
 *
 * The ADR-0090 D10 on-behalf-of path: leg 1 excludes it (the delegation link is
 * read off `opCtx.context`, which both of the gate's per-principal passes
 * share), so a delegated write keeps BOTH principals' floors exactly as before.
 * This harness cannot reach that path — `resolveDelegatorContext` reconstructs
 * the delegator from `sys_user` and its grant tables, and with none of them in
 * the fixture the write is refused at delegator resolution, long before either
 * row gate runs. The exclusion is therefore the unchanged-behaviour direction
 * by construction rather than by measurement here.
 */
describe('[#8865] §5 leg 1 composes with the SAME ownership authority the by-id path does', () => {
  it('an `edit`-level record share on the MASTER now reaches its children — and the same share is what moved it', async () => {
    // A: no share. `marketing` is not `camp_admin`'s owner or creator and holds
    // no bypass, so the sharing verdict is `deny`, the master's floor stays, and
    // leg 1 refuses. The DIRECT write of the master is refused too — the two
    // paths agree in the refusing direction, which is the state this card was
    // never about breaking.
    const without = await boot();
    const mktA = without.ctxFor(MKT, 'marketing');
    const refused = await without.byIdDetailWrite('update', 'mem_admin', mktA);
    expect(refused).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(refused.message).toContain("master 'crm_campaign' not editable by this user (row-level security)");
    expect(await without.byIdDetailWrite('update', 'camp_admin', mktA, 'crm_campaign')).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
      status: 403,
    });

    // B: the SAME fixture plus one `edit` share on the MASTER. Nothing else
    // moves — same principal, same rows, same permission sets. The verdict
    // becomes `allow`, leg 1 drops the master's platform floor, and the child
    // write lands. This is the mechanism the card named as inert for children:
    // an `edit`-level `sys_record_share` that already worked on the master.
    const withShare = await boot({ shares: [editShare('crm_campaign', 'camp_admin', MKT)] });
    const mktB = withShare.ctxFor(MKT, 'marketing');
    expect(await withShare.byIdDetailWrite('update', 'mem_admin', mktB)).toMatchObject({ ok: true });
    // …and the direct write of that master is permitted on the same stack. Both
    // answers move together, which is the whole of the ruling.
    expect(await withShare.byIdDetailWrite('update', 'camp_admin', mktB, 'crm_campaign')).toMatchObject({
      ok: true,
    });
  });

  it('`abstain` does NOT drop the master floor — an owner-less master keeps it, Modify All Data included', async () => {
    // `crm_program` has no owner field, so `checkEdit` returns `abstain` at its
    // `hasOwnerField` gate — for ADMIN too, because the `modifyAllRecords`
    // branch sits BELOW that gate. `abstain` means record sharing does not
    // enforce on this master at all, which is exactly when the platform floor is
    // its only row-level write gate (#5492's E2 measurement).
    //
    // This is the case that separates the ruled composition (`=== 'allow'`) from
    // the boolean projection leg 2 uses (`canEdit`, i.e. `!== 'deny'`): reading
    // the projection here would drop the floor on an abstention and hand every
    // member cross-creator writes on an owner-less master's children.
    //
    // Each principal is run against a master it did NOT create, so the floor is
    // the deciding fact rather than a formality. The Modify All Data row is the
    // sharp one: it is §2's flipped line with ONE variable changed — the master
    // has no owner column — and it must NOT flip.
    const h = await boot();
    for (const [label, ctx, master, step] of [
      ['an ordinary member', h.ctxFor(MKT, 'marketing'), 'prog_admin', 'step_admin'],
      ['a Modify All Data holder', h.ctxFor(ADMIN, 'admin_set'), 'prog_mkt', 'step_mkt'],
    ] as const) {
      const outcome = await h.byIdDetailWrite('update', step, ctx, 'crm_program_step');
      expect(outcome, label).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
      expect(outcome.message, label).toContain(
        "master 'crm_program' not editable by this user (row-level security)",
      );
      // The direct write of the owner-less master is refused on the same terms
      // — by step 2.7, whose floor is likewise not droppable on an abstention.
      // Same principal, same row, same operation, same answer: no divergence is
      // created in the other direction either.
      const direct = await h.byIdDetailWrite('update', master, ctx, 'crm_program');
      expect(direct, label).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    }
  });

  it('only the PLATFORM floor is droppable — an app-authored policy on the master still refuses', async () => {
    // `campaign_authored` declares `owner_id == current_user.id` for `update` on
    // `crm_campaign`. ADMIN holds `modifyAllRecords`, so the sharing verdict is
    // `allow` and the platform floor comes off — but the authored policy is not
    // the platform's and reaches the compiler untouched, so `camp_mkt`
    // (`owner_id: MKT`) stays outside ADMIN's master write filter.
    const h = await boot();
    const authoredAdmin = h.ctxFor(ADMIN, 'admin_set', 'campaign_authored');
    const outcome = await h.byIdDetailWrite('update', 'mem_mkt', authoredAdmin);
    expect(outcome).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(outcome.message).toContain("master 'crm_campaign' not editable by this user (row-level security)");
    // The direct write of the master is refused by the same authored policy at
    // step 2.7 — the paths agree here too, so the drop's provenance bound is one
    // rule and not two.
    expect(await h.byIdDetailWrite('update', 'camp_mkt', authoredAdmin, 'crm_campaign')).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
      status: 403,
    });
    // The control that keeps the case from being vacuous: WITHOUT the authored
    // set, the identical write is permitted (§2's flipped line). So the refusal
    // above is attributable to the authored policy alone.
    const plainAdmin = h.ctxFor(ADMIN, 'admin_set');
    expect(await h.byIdDetailWrite('update', 'mem_mkt', plainAdmin)).toMatchObject({ ok: true });
  });

  it('the master gate still refuses when NOTHING widens the master — leg 1, not a fallthrough', async () => {
    // The negative twin of the whole section, on the sharpest fixture: MKT
    // updating a child of `camp_admin` with no share, no ownership and no
    // bypass. The verdict is `deny`, the floor stays, and leg 1 answers with its
    // own sentence — asserted rather than the shared prefix, because leg 2
    // refuses with `(record sharing)` and a prefix-only assertion cannot tell
    // which leg is still doing its job.
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    const outcome = await h.byIdDetailWrite('update', 'mem_admin', mkt);
    expect(outcome).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(outcome.message).toContain("master 'crm_campaign' not editable by this user (row-level security)");
    // Step 2.7 localizes its refusal and carries the operator sentence on
    // `developerMessage`; the master gate carries none. Asserting the absence is
    // what proves the DETAIL's own floor is not what answered.
    expect(outcome.developerMessage).toBeUndefined();
  });
});
