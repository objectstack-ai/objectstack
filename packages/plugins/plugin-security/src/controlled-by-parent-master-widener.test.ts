// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8679] "May I edit this master?" must answer the SAME whether it is asked
// directly or on behalf of a child.
//
// ## The divergence this suite pins
//
// #5493 (merged as PR #6909) taught the by-id write gate to DEFER before it
// hard-refuses: when record sharing says "not editable", the refusal is checked
// against `checkAuthoredRowWrite` — "does an APP-AUTHORED row-level policy admit
// this row for this write, on its own?" — and only stands when that verdict is
// not `admit`. That composition lives in the sharing middleware's refusal
// branch, deliberately and only there (`SharingService.probeAuthoredRowWrite`:
// folding it into `canEdit` would make the two authorities read each other in a
// circle).
//
// `assertControlledByParentWrite` — the ADR-0055 master-accessibility
// resolution for WRITE — asks the SAME question of the master through
// `resolveSharingCanEdit`, and hard-refused on `false` without ever asking the
// authored half. So one principal, one master record, one operation got two
// different answers depending on who was asking:
//
//   • PATCH the master itself   → allowed (the widener is consulted)
//   • INSERT/UPDATE its child   → 403 "master ... not editable by this user
//                                 (record sharing)"
//
// ## The isolation (measured on 17.0.0 GA, reproduced below)
//
// One variable — WHO CREATED THE MASTER. Everything else identical: same
// principal, same objects, same payloads. `marketing` authors
// `marketing_campaign_updates`, an `operation: 'update'` policy with
// `using: 'id != null'` on `crm_campaign`, and holds no share on any campaign.
//
//   | step                                   | master by ADMIN | master by MARKETING |
//   |----------------------------------------|-----------------|---------------------|
//   | 1. PATCH the campaign itself (by id)   | allowed         | allowed             |
//   | 2. INSERT a child                      | REFUSED (bug)   | allowed             |
//   | 3. UPDATE an admin-created child       | REFUSED (bug)   | allowed             |
//   | 4. control: admin writes the same child| allowed         | allowed             |
//
// Row 1 is the witness that makes rows 2-3 a DIVERGENCE rather than a policy
// question: the platform already permits this principal to edit that exact
// master row. It is asserted here on the same stack, in the same test, so the
// two answers cannot drift apart again without a red.
//
// ## Why both directions are pinned
//
// A suite asserting only "the child write now succeeds" is satisfiable by
// RELAXING the master check, which is exactly what must not happen. Every
// positive case below is mirrored by `NEGATIVE:` cases on the same route with
// the same shape and the opposite verdict — a principal with no widener and no
// share is still refused, with the same sentence, and the refusal still names
// `record sharing`.

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
 * The MASTER. `sharingModel: 'private'` with an `owner_id` column is the
 * posture on which record sharing actually ENFORCES — without it `canEdit`
 * abstains, the refusal never happens, and this whole family is unreachable.
 */
const CAMPAIGN_SCHEMA = {
  name: 'crm_campaign',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    description: { name: 'description', type: 'text' },
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
    crm_lead: { name: 'crm_lead', type: 'lookup', reference: 'crm_lead' },
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
  sys_record_share: SHARE_SCHEMA,
};

/** The shipped platform seed — the source of the `owner_only_writes` floor. */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

/**
 * The app's real declaration: an object grant PLUS an RLS update-widener that
 * says "marketing works ANY campaign". Nothing else — no share, no ownership,
 * no bypass. The widener is the ONLY widening mechanism in play, which is what
 * makes the verdicts below attributable to it.
 */
const MARKETING: PermissionSet = PermissionSetSchema.parse({
  name: 'marketing',
  objects: { crm_campaign: { ...CRUD }, crm_campaign_member: { ...CRUD } },
  rowLevelSecurity: [
    {
      name: 'marketing_campaign_updates',
      object: 'crm_campaign',
      operation: 'update',
      using: 'id != null',
    },
  ],
});

/**
 * The NEGATIVE principal: byte-identical CRUD, no `rowLevelSecurity` at all.
 * Everything the positive cases rely on except the declaration itself, so a
 * fix that relaxed the master check rather than consulting the widener would
 * turn these green and be caught here.
 */
const MARKETING_NO_WIDENER: PermissionSet = PermissionSetSchema.parse({
  name: 'marketing_no_widener',
  objects: { crm_campaign: { ...CRUD }, crm_campaign_member: { ...CRUD } },
});

/**
 * A SELECT-only authored policy on the same object. It declares no `using`
 * scope for a write class at all, so it can admit no row for `update` — the
 * verdict must stay an abstention and the refusal must stand. Without this the
 * suite could not tell "consults the authored WRITE widener" from "notices the
 * caller authored something".
 */
const MARKETING_SELECT_ONLY: PermissionSet = PermissionSetSchema.parse({
  name: 'marketing_select_only',
  objects: { crm_campaign: { ...CRUD }, crm_campaign_member: { ...CRUD } },
  rowLevelSecurity: [
    {
      name: 'marketing_campaign_reads',
      object: 'crm_campaign',
      operation: 'select',
      using: 'id != null',
    },
  ],
});

/** The control principal — owns everything, needs no widener. */
const ADMIN_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'admin_set',
  objects: {
    crm_campaign: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
    crm_campaign_member: { ...CRUD, viewAllRecords: true, modifyAllRecords: true },
  },
});

const PERMISSION_SETS: PermissionSet[] = [
  MEMBER_DEFAULT,
  MARKETING,
  MARKETING_NO_WIDENER,
  MARKETING_SELECT_ONLY,
  ADMIN_SET,
];

type Row = Record<string, unknown>;

/** An `edit`-level grant on one master — the sharing leg's OWN positive basis. */
interface ShareSpec {
  record: string;
  level: 'read' | 'edit';
}

/**
 * The fixture. Two campaigns differing ONLY in provenance, and children chosen
 * so the detail's own ownership floor can be held constant while the master's
 * creator varies:
 *
 *   • `mem_admin_selfmade` — created BY the caller, master created by admin.
 *     The by-id UPDATE route to the master gate.
 *   • `mem_mkt`            — created by the caller under its own master. The
 *     "always worked" column.
 *   • `mem_admin` / `mem_mkt_byadmin` — created by someone else. These are
 *     refused earlier, by the detail's own floor at the by-id pre-image gate,
 *     so they are deliberately NOT the route any case below takes.
 *
 * `sys_record_share` is EMPTY by default: the card's isolation has no grant
 * anywhere, so nothing below can be explained by one.
 */
function fixtureRows(share?: ShareSpec): Record<string, Row[]> {
  return {
    crm_campaign: [
      { id: 'camp_admin', name: 'Admin Campaign', description: 'a', owner_id: ADMIN, created_by: ADMIN, organization_id: ORG },
      { id: 'camp_mkt', name: 'Marketing Campaign', description: 'b', owner_id: MKT, created_by: MKT, organization_id: ORG },
      // The TRANSFERRED master (#5493's probe E-A shape): created by the
      // caller, since handed to someone else. It is the one row on which the
      // master's write RLS admits (the platform floor matches `created_by`)
      // while record sharing refuses (the OWNER is another user) — so it is the
      // only fixture row that can prove the record-sharing leg still fires on
      // its own after this card. Without it, deleting that leg outright would
      // leave every other case here green.
      { id: 'camp_transferred', name: 'Transferred Campaign', description: 'c', owner_id: ADMIN, created_by: MKT, organization_id: ORG },
    ],
    crm_campaign_member: [
      { id: 'mem_admin', crm_campaign: 'camp_admin', crm_lead: 'lead_1', status: 'sent', created_by: ADMIN, organization_id: ORG },
      { id: 'mem_mkt', crm_campaign: 'camp_mkt', crm_lead: 'lead_2', status: 'sent', created_by: MKT, organization_id: ORG },
      { id: 'mem_admin_selfmade', crm_campaign: 'camp_admin', crm_lead: 'lead_3', status: 'sent', created_by: MKT, organization_id: ORG },
      { id: 'mem_mkt_byadmin', crm_campaign: 'camp_mkt', crm_lead: 'lead_4', status: 'sent', created_by: ADMIN, organization_id: ORG },
    ],
    sys_record_share: share
      ? [
          {
            id: 'shr_1',
            object_name: 'crm_campaign',
            record_id: share.record,
            recipient_type: 'user',
            recipient_id: MKT,
            access_level: share.level,
            owner_id: ADMIN,
          },
        ]
      : [],
  };
}

/**
 * READ-only engine double — `find`, `findOne`, `getSchema`, and nothing else.
 * It declares NO write verb on purpose: no case here writes through it (the
 * terminal `next()` only records that the chain was reached), and a double
 * without a verb cannot be looser than the engine on that verb. Filtering runs
 * through `matchesFilterCondition`, the evaluator the plugin itself compiles
 * against, so a filter these cases turn on is a filter that really applied.
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

/**
 * Boot the REAL pair: `SecurityPlugin`'s middleware and the REAL sharing
 * middleware over the REAL `SharingService`, wired to each other through the
 * same late binding the kernel uses (`securityService: () => security`). That
 * binding is what carries #5493's authored-row-write verdict, so the by-id
 * deferral under test is the shipped one and not a stand-in.
 */
async function boot(options: { share?: ShareSpec } = {}) {
  const store = makeStore(fixtureRows(options.share));

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
  const run = async (opCtx: any): Promise<{ ok: boolean; message: string }> => {
    let reached = false;
    try {
      await securityMw(opCtx, async () => {
        await sharingMw(opCtx, async () => {
          reached = true;
        });
      });
    } catch (e: any) {
      return { ok: false, message: String(e?.message ?? e) };
    }
    return reached ? { ok: true, message: 'written' } : { ok: false, message: 'chain swallowed the write' };
  };

  const ctxFor = (userId: string, ...permissions: string[]) => ({
    userId,
    tenantId: ORG,
    positions: ['org_member'],
    permissions,
  });

  return {
    store,
    plugin,
    security,
    ctxFor,
    /** Step 1 — the master, by id, directly. */
    updateCampaign: (id: string, context: any) =>
      run({
        object: 'crm_campaign',
        operation: 'update',
        data: { id, description: 'x' },
        options: { where: { id } },
        context,
      }),
    /** Step 2 — the DERIVED write: a child insert naming the master on the body. */
    insertMember: (campaignId: string, context: any) =>
      run({
        object: 'crm_campaign_member',
        operation: 'insert',
        data: { crm_campaign: campaignId, crm_lead: 'lead_9', status: 'sent' },
        options: {},
        context,
      }),
    /** Step 3 — the DERIVED write: a by-id child update. */
    updateMember: (id: string, context: any) =>
      run({
        object: 'crm_campaign_member',
        operation: 'update',
        data: { id, status: 'responded' },
        options: { where: { id } },
        context,
      }),
  };
}


/**
 * The gate's own sentence. The PARENTHETICAL is load-bearing: it names which
 * leg decided, and the two legs are pinned apart below because they answer
 * different questions and only one of them is what this card changes.
 */
const REFUSED_BY_RECORD_SHARING =
  /requires edit access to its master record \(master '\w+' not editable by this user \(record sharing\)\)/;
const REFUSED_BY_MASTER_RLS =
  /requires edit access to its master record \(master '\w+' not editable by this user \(row-level security\)\)/;

describe('[#8679] the master-editability check consults the same authored-write widener the by-id path does', () => {
  // ── Row 1: the WITNESS ────────────────────────────────────────────────────
  it('WITNESS: the same principal may PATCH the admin-created master itself, by id', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // Neither owner nor creator nor share recipient — admitted purely by the
    // app-authored update-widener, through the deferral #6909 installed on the
    // by-id path. This is what makes the derived refusal a DIVERGENCE.
    expect(await h.updateCampaign('camp_admin', mkt)).toMatchObject({ ok: true });
    expect(await h.updateCampaign('camp_mkt', mkt)).toMatchObject({ ok: true });
  });

  it('WITNESS: `checkAuthoredRowWrite` admits that exact master row for `update`', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    // The composition's own verdict, read directly off the security service —
    // the value the derived path must consult. `admit` on the very row the
    // derived path used to refuse.
    await expect(
      h.security.checkAuthoredRowWrite('crm_campaign', 'camp_admin', 'update', mkt),
    ).resolves.toBe('admit');
  });

  // ── Row 2: the derived INSERT ─────────────────────────────────────────────
  //
  // The cleanest route to the master gate: an insert has no pre-image, so no
  // other row-level gate can answer first and the verdict is the master gate's
  // alone.
  it('INSERT: a child under the RLS-widened master is permitted', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    expect(await h.insertMember('camp_admin', mkt)).toMatchObject({ ok: true });
  });

  // ── Row 3: the derived by-id UPDATE ───────────────────────────────────────
  //
  // `mem_admin_selfmade` is created BY the caller and hangs off the
  // admin-created master, which holds the detail's own ownership floor constant
  // and leaves exactly one variable: who created the MASTER. (A child created
  // by someone else is refused earlier, by the detail's own floor at the by-id
  // pre-image gate — a separate surface this card does not touch.)
  it('UPDATE: a by-id child update under the RLS-widened master is permitted', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    expect(await h.updateMember('mem_admin_selfmade', mkt)).toMatchObject({ ok: true });
  });

  it('the one variable really is the master\'s creator: the self-created column always worked', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    expect(await h.insertMember('camp_mkt', mkt)).toMatchObject({ ok: true });
    expect(await h.updateMember('mem_mkt', mkt)).toMatchObject({ ok: true });
  });

  // ── the opposite direction: same route, same shape, opposite verdict ───────
  //
  // These are the cases a RELAXATION of the master check would turn green. They
  // run the identical route with the identical payload; the ONLY thing removed
  // is the app-authored declaration.
  it('NEGATIVE: no widener and no share — the derived INSERT is still refused', async () => {
    const h = await boot();
    const plain = h.ctxFor(MKT, 'marketing_no_widener');
    const r = await h.insertMember('camp_admin', plain);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(REFUSED_BY_MASTER_RLS);
  });

  it('NEGATIVE: no widener and no share — the derived by-id UPDATE is still refused', async () => {
    const h = await boot();
    const plain = h.ctxFor(MKT, 'marketing_no_widener');
    const r = await h.updateMember('mem_admin_selfmade', plain);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(REFUSED_BY_MASTER_RLS);
  });

  it('NEGATIVE: the refusal is not blanket — that same principal keeps its own column', async () => {
    const h = await boot();
    const plain = h.ctxFor(MKT, 'marketing_no_widener');
    // Without this the two cases above would also pass against a gate that
    // refused everything, which would prove nothing about the widener.
    expect(await h.insertMember('camp_mkt', plain)).toMatchObject({ ok: true });
    expect(await h.updateMember('mem_mkt', plain)).toMatchObject({ ok: true });
  });

  it('NEGATIVE: a SELECT-only authored policy admits no write, so the refusal stands', async () => {
    const h = await boot();
    const selectOnly = h.ctxFor(MKT, 'marketing_select_only');
    // The caller DID author a policy on this object — just not one that scopes
    // a write. Without this case the suite could not tell "consults the authored
    // WRITE widener" from "notices the caller authored something".
    await expect(
      h.security.checkAuthoredRowWrite('crm_campaign', 'camp_admin', 'update', selectOnly),
    ).resolves.toBe('abstain');
    const r = await h.insertMember('camp_admin', selectOnly);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(REFUSED_BY_MASTER_RLS);
  });

  it('the deferral is a REFUSAL-branch step: a satisfied sharing leg never consults it', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    const probe = vi.spyOn(h.plugin as any, 'checkAuthoredRowWrite');
    // `camp_mkt` is owned by the caller, so record sharing answers "editable"
    // on its own. The authored verdict must not be asked at all — this mirrors
    // the by-id path, where only the middleware's refusal branch consults it,
    // and it is what keeps the change from adding a probe to the happy path.
    expect(await h.insertMember('camp_mkt', mkt)).toMatchObject({ ok: true });
    expect(probe).not.toHaveBeenCalled();
  });

  it('the deferral asks about the MASTER, for `update`, whatever the detail\'s own verb is', async () => {
    const h = await boot();
    const mkt = h.ctxFor(MKT, 'marketing');
    const probe = vi.spyOn(h.plugin as any, 'checkAuthoredRowWrite');
    // The gate's question is EDIT access to the master. Asking with the
    // detail's verb would be wrong twice over: `insert` is not an
    // `AuthoredRowWriteOperation` at all, and a child DELETE does not require
    // deleting the master. The two legs above already hardcode `update`; this
    // pins that the third leg agrees with them.
    expect(await h.insertMember('camp_admin', mkt)).toMatchObject({ ok: true });
    expect(probe).toHaveBeenCalledWith('crm_campaign', 'camp_admin', 'update', expect.anything());
  });

  it('NEGATIVE: the record-sharing leg still refuses on its own after this change', async () => {
    const h = await boot();
    const plain = h.ctxFor(MKT, 'marketing_no_widener');
    // `camp_transferred` passes the master's write RLS (the platform floor
    // matches `created_by`) and fails record sharing (owned by someone else).
    // So this refusal can only come from the leg this card edits — it proves
    // the leg is still live, and that the deferral did not swallow it.
    const r = await h.insertMember('camp_transferred', plain);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(REFUSED_BY_RECORD_SHARING);
  });

  it('the sharing leg keeps its own positive basis: an edit-level share admits', async () => {
    const h = await boot({ share: { record: 'camp_transferred', level: 'edit' } });
    const plain = h.ctxFor(MKT, 'marketing_no_widener');
    // Same principal, same row, same route as the case above — one grant added,
    // no widener anywhere. The leg was given a second declared way to be
    // satisfied, not disabled.
    expect(await h.insertMember('camp_transferred', plain)).toMatchObject({ ok: true });
  });

  it('NEGATIVE: a read-level share does not admit a derived WRITE', async () => {
    const h = await boot({ share: { record: 'camp_transferred', level: 'read' } });
    const plain = h.ctxFor(MKT, 'marketing_no_widener');
    const r = await h.insertMember('camp_transferred', plain);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(REFUSED_BY_RECORD_SHARING);
  });

  it('NEGATIVE: a principal-less context is not admitted by the widener', async () => {
    const h = await boot();
    // No `userId` — `checkAuthoredRowWrite` abstains by contract, so the
    // deferral can never turn an unmeasurable context into an admission.
    await expect(
      h.security.checkAuthoredRowWrite('crm_campaign', 'camp_admin', 'update', {
        tenantId: ORG,
        positions: ['org_member'],
        permissions: ['marketing'],
      }),
    ).resolves.toBe('abstain');
  });

  it('NEGATIVE: the widener does not reach across the tenant wall', async () => {
    const h = await boot();
    // `id != null` is as wide as an authored predicate gets, and Layer 0 still
    // stands: a master in another organization is admitted by nothing.
    const otherOrg = { ...h.ctxFor(MKT, 'marketing'), tenantId: 'org-2' };
    await expect(
      h.security.checkAuthoredRowWrite('crm_campaign', 'camp_admin', 'update', otherOrg),
    ).resolves.toBe('abstain');
    const r = await h.insertMember('camp_admin', otherOrg);
    expect(r.ok).toBe(false);
  });

  // ── the invariant the two call sites owe each other ───────────────────────
  it('INVARIANT: direct master edit and derived child write agree, row by row', async () => {
    const h = await boot();
    // The whole card in one assertion: for every (principal, master) pair, the
    // answer to "may I edit this master" must not depend on whether the question
    // was asked directly or on behalf of a child. The INSERT route is used for
    // the derived half because it reaches the master gate with nothing else in
    // front of it.
    const observed: Record<string, string> = {};
    for (const permissionSet of ['marketing', 'marketing_no_widener'] as const) {
      const context = h.ctxFor(MKT, permissionSet);
      for (const campaign of ['camp_admin', 'camp_mkt'] as const) {
        const direct = await h.updateCampaign(campaign, context);
        const derived = await h.insertMember(campaign, context);
        observed[`${permissionSet} ${campaign}`] = `direct=${direct.ok} derived=${derived.ok}`;
      }
    }
    expect(observed).toEqual({
      // The widened principal: allowed on BOTH masters, by both routes.
      'marketing camp_admin': 'direct=true derived=true',
      'marketing camp_mkt': 'direct=true derived=true',
      // The unwidened principal: refused on the admin-created master by both
      // routes, allowed on its own by both. Agreement is not the empty
      // agreement — the table carries a refusal in each column.
      'marketing_no_widener camp_admin': 'direct=false derived=false',
      'marketing_no_widener camp_mkt': 'direct=true derived=true',
    });
  });
});
