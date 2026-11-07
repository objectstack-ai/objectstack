// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055 §1 and §2 as amended · #30905, maintainer ruling A] A
// `controlled_by_parent` object whose only `master_detail` is declared
// `required: false` has an OPTIONAL master. A detail row that names its
// master is read through it, exactly as before; a row whose master reference
// is empty belongs to no master and is read through a second arm, OR-ed with
// the master arm inside `computeControlledByParentFilter` — the one
// chokepoint every read door composes — by its owner (`owner_id`) and by a
// holder of View All on the detail, and by nobody else.
//
// The rules the card states, one case each:
//   - a row that names a master is never read through the owner arm, and a
//     row that names none never through the master arm;
//   - View All on the detail admits the null-master rows only: it does not
//     open the master arm;
//   - a null-master row with no owner (an ADR-0142 queue row), or on an
//     object with no `owner_id` column, is read by View All alone;
//   - a chain's intermediate level whose own master is empty is read by its
//     owner, and its children's master arm sees exactly that;
//   - a caller who reads another master does not see the null-master rows
//     they do not own;
//   - a required master's leaf is unchanged.
//
// [ADR-0055 §3 as amended · #30906, card 2 of ruling A] The write gate judges
// the null-master row (the last top-level block, on the real engine): its
// owner or a holder of Modify All on the detail writes it, every other
// principal is refused `403`; an insert that names no master is admitted and
// its creator owns it; setting a master asks edit on it, and emptying one asks
// edit on the master it leaves — never the opt-in owner leg; a chain hop whose
// master names none asks the same owner rule; a predicate write judges each
// selected row that way, and an on-behalf-of write asks it of both principals.
//
// The fixture mirrors `controlled-by-parent-sharing.test.ts`: the REAL
// security plugin and the REAL sharing service over an in-memory read
// double, the leaf composed the way the engine composes it
// (`readable-ids-in-memory.testkit.ts`), every filter applied by the same
// evaluator the plugin uses. Two read faces are run on every rule: the data
// middleware's injected `where` and `getReadFilter` (the analytics read and
// the engine's `ReadableIds` composer for parent gates).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, buildSharingMiddleware, SysRecordShare, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
import { ObjectQL, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { ObjectSchema, isComposedReadableIds, isReadableIds } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import type { ControlledByParentWriteOutcome } from '@objectstack/spec/contracts';
import { composeReadableIdsInMemory } from './readable-ids-in-memory.testkit.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccessForAsker, type ExplainEngineDeps } from './explain-engine.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const REP = 'usr_rep';
const OTHER = 'usr_other';

/** The MASTER — owner-scoped by OWD (`private`), with no authored RLS. */
const ACCOUNT_SCHEMA = {
  name: 'crm_account',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

/** The DETAIL, its master OPTIONAL — the shape ruling A admits. */
const CONTACT_OPTIONAL = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'master_detail', required: false, reference: 'crm_account' },
    owner_id: { name: 'owner_id', type: 'lookup', reference: 'sys_user' },
  },
};

/** The same detail with a REQUIRED master — the leaf it answers must not move. */
const CONTACT_REQUIRED = {
  ...CONTACT_OPTIONAL,
  fields: {
    ...CONTACT_OPTIONAL.fields,
    account: { name: 'account', type: 'master_detail', required: true, reference: 'crm_account' },
  },
};

/** The optional-master detail on an object that carries no `owner_id` column (`ownership` other than `'user'`). */
const CONTACT_OPTIONAL_NO_OWNER_COLUMN = {
  name: 'crm_contact',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text' },
    account: { name: 'account', type: 'master_detail', required: false, reference: 'crm_account' },
  },
};

/**
 * A detail of the contact — a chain whose intermediate level (the contact)
 * has an optional master. Its own master is required.
 */
const NOTE_SCHEMA = {
  name: 'crm_contact_note',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id', type: 'text' },
    contact: { name: 'contact', type: 'master_detail', required: true, reference: 'crm_contact' },
  },
};

const DETAILS = {
  optional: CONTACT_OPTIONAL,
  required: CONTACT_REQUIRED,
  'optional-no-owner-column': CONTACT_OPTIONAL_NO_OWNER_COLUMN,
} as const;

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

const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

/** The rep: full CRUD, no View All, no RLS — record access is OWD, sharing and the derivation. */
const REP_SET = {
  name: 'crm_rep',
  label: 'CRM Rep',
  objects: { crm_account: CRUD, crm_contact: CRUD, crm_contact_note: CRUD },
} as unknown as PermissionSet;

/** The same, plus View All on the DETAIL (not on the master). */
const VIEW_ALL_CONTACTS_SET = {
  name: 'crm_rep',
  label: 'CRM Rep with View All contacts',
  objects: {
    crm_account: CRUD,
    crm_contact: { ...CRUD, viewAllRecords: true },
    crm_contact_note: CRUD,
  },
} as unknown as PermissionSet;

type Row = Record<string, unknown>;

/**
 * The rows, identical for every case.
 *
 * - `acct_us` is OTHER's and shared to the rep (read); `acct_eu` is OTHER's and
 *   NOT shared; `acct_own` is the rep's.
 * - `ct_eu_mine` names `acct_eu` and is OWNED BY THE REP: a row that names a
 *   master the rep cannot read — the owner arm must not reach it.
 * - `ct_orphan_mine` / `ct_orphan_other` / `ct_queue` name no master: the
 *   rep's, OTHER's, and nobody's (an ADR-0142 queue row).
 */
function fixtureRows(): Record<string, Row[]> {
  return {
    crm_account: [
      { id: 'acct_us', name: 'US Corp', owner_id: OTHER },
      { id: 'acct_eu', name: 'EU Corp', owner_id: OTHER },
      { id: 'acct_own', name: 'Own Corp', owner_id: REP },
    ],
    crm_contact: [
      { id: 'ct_us', account: 'acct_us', owner_id: OTHER },
      { id: 'ct_eu_mine', account: 'acct_eu', owner_id: REP },
      { id: 'ct_own', account: 'acct_own', owner_id: OTHER },
      { id: 'ct_orphan_mine', account: null, owner_id: REP },
      { id: 'ct_orphan_other', account: null, owner_id: OTHER },
      { id: 'ct_queue', account: null, owner_id: null, queue: 'support' },
    ],
    crm_contact_note: [
      { id: 'nt_us', contact: 'ct_us' },
      { id: 'nt_orphan_mine', contact: 'ct_orphan_mine' },
      { id: 'nt_orphan_other', contact: 'ct_orphan_other' },
      { id: 'nt_eu_mine', contact: 'ct_eu_mine' },
    ],
    sys_record_share: [
      {
        id: 'shr_1',
        object_name: 'crm_account',
        record_id: 'acct_us',
        recipient_type: 'user',
        recipient_id: REP,
        access_level: 'read',
      },
    ],
  };
}

async function boot(options: { detail?: keyof typeof DETAILS; sets?: PermissionSet[] } = {}) {
  const rows = fixtureRows();
  const schemas: Record<string, unknown> = {
    crm_account: ACCOUNT_SCHEMA,
    crm_contact: DETAILS[options.detail ?? 'optional'],
    crm_contact_note: NOTE_SCHEMA,
    sys_record_share: SHARE_SCHEMA,
  };
  const store = {
    rows,
    getSchema: (object: string) => schemas[object],
    find: vi.fn(async (object: string, opts: any = {}) =>
      (rows[object] ?? []).filter((r) => matchesFilterCondition(r, opts?.where ?? null))),
    findOne: vi.fn(async (object: string, opts: any = {}) => {
      assertEngineFindOnePredicate(object, opts);
      return (rows[object] ?? []).find((r) => matchesFilterCondition(r, opts?.where ?? null)) ?? null;
    }),
  };
  const sets = options.sets ?? [REP_SET];

  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: store.getSchema,
    find: store.find,
    findOne: store.findOne,
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async (n: string) => store.getSchema(n), list: async () => sets },
    sharing: new SharingService({ engine: store as unknown as SharingEngine }),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ defaultPermissionSets: sets, fallbackPermissionSet: 'crm_rep' });
  await plugin.init(ctx);
  await plugin.start(ctx);

  const repContext = () => ({ userId: REP, tenantId: 'org-1', positions: [], permissions: [] });
  const compose = (where: unknown, context: any) =>
    composeReadableIdsInMemory(where, context, {
      rows: (object) => store.rows[object],
      readAdmission: (object, c) => plugin.canReadObject(object, c),
      readScope: (object, c) => plugin.getReadFilter(object, c),
    });

  /** The `where` the data middleware injects for a find of `object`, uncomposed. */
  const injected = async (object: string): Promise<unknown> => {
    const opCtx: any = { object, operation: 'find', ast: {}, options: {}, context: repContext() };
    await middleware(opCtx, async () => {});
    return opCtx.ast.where ?? null;
  };
  const apply = (object: string, where: unknown) =>
    (store.rows[object] ?? []).filter((r) => matchesFilterCondition(r, where as any)).map((r) => String(r.id)).sort();

  /** The data middleware's read face. */
  const visible = async (object: string) => apply(object, await compose(await injected(object), repContext()));
  /** The `getReadFilter` face: analytics, and the engine's composer for parent gates and chains. */
  const readFilterVisible = async (object: string) =>
    apply(object, await compose((await plugin.getReadFilter(object, repContext())) ?? null, repContext()));

  /** The INSERT face: whether the executor was reached; a refusal throws. */
  const insertContact = async (data: Row): Promise<boolean> => {
    const opCtx: any = { object: 'crm_contact', operation: 'insert', data, options: {}, context: repContext() };
    let reached = false;
    await middleware(opCtx, async () => {
      reached = true;
    });
    return reached;
  };

  return { plugin, ctx, injected, visible, readFilterVisible, insertContact };
}

/** The node at `path` inside `where`. */
function leafAt(where: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((node, key) => (node as any)?.[key], where);
}

describe('[#30905 ruling A] the cbp read leaf of an OPTIONAL master — one $or, two arms that never share a row', () => {
  it('the leaf the middleware injects: the master arm unchanged, OR-ed with `fk IS NULL AND owner_id = caller`', async () => {
    const h = await boot();
    const where = (await h.injected('crm_contact')) as Record<string, any>;
    // Everything the middleware ANDs in is one `$and` of layers or the cbp
    // layer itself; find the cbp layer as the node carrying the `$or`.
    const layers: any[] = Array.isArray(where?.$and) ? where.$and : [where];
    const cbp = layers.find((l) => l && Array.isArray(l.$or));
    expect(cbp, JSON.stringify(where)).toBeDefined();
    expect(cbp.$or).toHaveLength(2);
    const [masterArm, nullArm] = cbp.$or;
    expect(Object.keys(masterArm)).toEqual(['account']);
    expect(isReadableIds(leafAt(masterArm, ['account', '$in']))).toBe(true);
    expect(isComposedReadableIds(leafAt(masterArm, ['account', '$in']))).toBe(false);
    expect(nullArm).toEqual({ $and: [{ account: null }, { owner_id: REP }] });
  });

  it('a REQUIRED master answers the leaf it always did: no $or, no owner arm', async () => {
    const h = await boot({ detail: 'required' });
    const where = (await h.injected('crm_contact')) as Record<string, any>;
    const layers: any[] = Array.isArray(where?.$and) ? where.$and : [where];
    expect(layers.some((l) => l && '$or' in l)).toBe(false);
    const cbp = layers.find((l) => l && 'account' in l);
    expect(Object.keys(cbp)).toEqual(['account']);
    expect(isReadableIds(cbp.account.$in)).toBe(true);
    // And the rows: the null-master row the rep owns is NOT read through a required master.
    expect(await h.visible('crm_contact')).toEqual(['ct_own', 'ct_us']);
  });

  for (const face of ['visible', 'readFilterVisible'] as const) {
    describe(`read face: ${face === 'visible' ? 'the data middleware' : 'getReadFilter (analytics, ReadableIds composer)'}`, () => {
      it('the rep reads the rows of masters they read, and the null-master rows they own — nothing else', async () => {
        const h = await boot();
        expect(await h[face]('crm_contact')).toEqual(['ct_orphan_mine', 'ct_own', 'ct_us']);
      });

      it('a row that NAMES a master is never read through the owner arm (the rep owns ct_eu_mine, cannot read acct_eu)', async () => {
        const h = await boot();
        expect(await h[face]('crm_contact')).not.toContain('ct_eu_mine');
      });

      it('a caller who reads another master does not see the null-master rows they do not own', async () => {
        const h = await boot();
        const rows = await h[face]('crm_contact');
        // The rep reads acct_us (OTHER's, shared) and still not OTHER's orphan.
        expect(rows).toContain('ct_us');
        expect(rows).not.toContain('ct_orphan_other');
      });

      it('a null-master row with no owner (an ADR-0142 queue row) is not read through the owner arm', async () => {
        const h = await boot();
        expect(await h[face]('crm_contact')).not.toContain('ct_queue');
      });

      it('View All on the detail reads every null-master row, the queue row included — and does NOT open the master arm', async () => {
        const h = await boot({ sets: [VIEW_ALL_CONTACTS_SET] });
        expect(await h[face]('crm_contact')).toEqual(['ct_orphan_mine', 'ct_orphan_other', 'ct_own', 'ct_queue', 'ct_us']);
      });

      it('on an object with no owner_id column, a null-master row is View All\'s alone', async () => {
        const plain = await boot({ detail: 'optional-no-owner-column' });
        expect(await plain[face]('crm_contact')).toEqual(['ct_own', 'ct_us']);
        const viewAll = await boot({ detail: 'optional-no-owner-column', sets: [VIEW_ALL_CONTACTS_SET] });
        expect(await viewAll[face]('crm_contact')).toEqual(['ct_orphan_mine', 'ct_orphan_other', 'ct_own', 'ct_queue', 'ct_us']);
      });

      it('chain: the children of an intermediate row with no master are read by that row\'s owner, and exactly those', async () => {
        const h = await boot();
        expect(await h[face]('crm_contact_note')).toEqual(['nt_orphan_mine', 'nt_us']);
      });
    });
  }

  it('the answer is the disjoint union of the two arms', async () => {
    // The master arm reads the rows naming a master the rep reads; the
    // null-master arm the rep's own rows naming none. No row is in both.
    const h = await boot();
    const rows = await h.visible('crm_contact');
    const masterArmRows = ['ct_own', 'ct_us'];
    const nullArmRows = ['ct_orphan_mine'];
    expect(rows).toEqual([...masterArmRows, ...nullArmRows].sort());
  });
});

describe('[#30906] the write gate admits an insert of an optional-master detail that names no master', () => {
  it('an empty master reference reaches the executor — no 422', async () => {
    const h = await boot();
    expect(await h.insertContact({ id: 'ct_new', account: null, owner_id: REP })).toBe(true);
    expect(await h.insertContact({ id: 'ct_new_2', owner_id: REP })).toBe(true);
  });

  it('an insert naming a master the rep owns reaches the executor, as before', async () => {
    const h = await boot();
    expect(await h.insertContact({ id: 'ct_new', account: 'acct_own', owner_id: REP })).toBe(true);
  });
});

describe('[#30905 ruling A] the relation resolver reads the optional master — and an omitted required stays unresolved', () => {
  it('the optional master resolves: no "resolves no master relation" report', async () => {
    const h = await boot();
    await h.visible('crm_contact');
    const reports = (h.ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('resolves no master relation'));
    expect(reports).toEqual([]);
  });

  it('the parse accepts the optional detail whole, so a parsed registry agrees with the raw one', () => {
    const parsed = ObjectSchema.safeParse({ ...CONTACT_OPTIONAL, fields: { account: CONTACT_OPTIONAL.fields.account } });
    expect(parsed.success).toBe(true);
  });
});

// ── security/explain narrates the null-master arm ───────────────────────────

describe('[#30905 ruling A] security/explain narrates the null-master arm on a record read', () => {
  const OBJECT = 'crm_contact';
  const EDITOR = PermissionSetSchema.parse({ name: 'crm_rep', objects: { [OBJECT]: CRUD } });
  const EXPLAINED = { userId: REP, tenantId: 'org1', positions: [], permissions: ['crm_rep'] };

  const deps = (opts: { record: Row; absent: boolean; schema?: unknown; sets?: PermissionSet[] }): ExplainEngineDeps => ({
    ql: { getSchema: () => opts.schema ?? CONTACT_OPTIONAL },
    resolveSets: async () => opts.sets ?? [EDITOR],
    evaluator: new PermissionEvaluator(),
    getObjectSecurityMeta: async () => ({
      isPrivate: false,
      requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
      fieldRequiredPermissions: {},
    }),
    requiredCaps: () => [],
    computeRlsFilter: async () => null,
    getFieldMask: () => ({}),
    getPartialMaskRules: async () => ({}),
    baselinePermissionSets: [],
    tenancyPosture: 'single',
    computeLayeredRlsFilter: async () => ({ layer0: { organization_id: 'org1' }, layer1: null }),
    fetchRecord: async () => ({ organization_id: 'org1', ...opts.record }),
    sharingReadFilter: async () => null,
    listRecordShares: async () => [],
    canEditRecord: async () => true,
    canDeleteRecord: async () => true,
    // The read door withholds the record from the EXPLAINED principal (or not); the asker always reads it.
    recordAbsentToCaller: vi.fn(async (_o: string, _r: string, context: unknown) => (context === EXPLAINED ? opts.absent : false)),
  });
  const sharingDetail = (d: any): string =>
    String(d.layers.find((l: any) => l.layer === 'sharing')?.record?.detail ?? '');
  // Asked by an administrator who reads the record, as `security/explain` is
  // for another principal: a principal explaining itself a record the door
  // withholds is told what an id no row carries gets.
  const ASKER = { userId: 'usr_admin', tenantId: 'org1', positions: [], permissions: [] };
  const explain = (d: ExplainEngineDeps) =>
    explainAccessForAsker(d, { object: OBJECT, operation: 'read', context: EXPLAINED, recordId: 'r1' }, {
      context: ASKER,
      cannotRead: (o, id) => d.recordAbsentToCaller!(o, id, ASKER),
    });

  it('a null-master row the read door returns: names the empty reference and the owner arm', async () => {
    const d = await explain(deps({ record: { id: 'r1', account: null, owner_id: REP }, absent: false }));
    expect(d.record).toMatchObject({ recordId: 'r1', visible: true });
    expect(sharingDetail(d)).toContain("its master reference 'account' is empty");
    expect(sharingDetail(d)).toContain('through the null-master arm — the principal owns it');
  });

  it('a null-master row the read door withholds: who reads it instead, and a queue row is View All\'s alone', async () => {
    const owned = await explain(deps({ record: { id: 'r1', account: null, owner_id: OTHER }, absent: true }));
    expect(owned.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
    expect(sharingDetail(owned)).toContain("its master reference 'account' is empty, so it is read only by its owner and by a holder of View All on the object");
    expect(sharingDetail(owned)).not.toContain('queue row');

    const queue = await explain(deps({ record: { id: 'r1', account: null, owner_id: null }, absent: true }));
    expect(sharingDetail(queue)).toContain('it has no owner (a queue row), so View All alone reads it');
  });

  it('a row that names its master, and any row of a required master, keep the master-scope narration', async () => {
    const named = await explain(deps({ record: { id: 'r1', account: 'acct_eu', owner_id: REP }, absent: true }));
    expect(sharingDetail(named)).toContain("so its master is outside the principal's read scope");
    expect(sharingDetail(named)).not.toContain('null-master');

    const required = await explain(deps({ record: { id: 'r1', account: null, owner_id: REP }, absent: true, schema: CONTACT_REQUIRED }));
    expect(sharingDetail(required)).toContain("so its master is outside the principal's read scope");
  });
});

// ── [#30906] the write gate judges the null-master row — on the real engine ──
//
// Card 2 of ruling A (ADR-0055 §3 as amended). The real `SecurityPlugin` over a
// real `ObjectQL` and SQL driver (better-sqlite3, in memory), the real
// `SharingService` with its middleware on the engine after this plugin's, and
// the platform's own `member_default` set carrying the ownership floor — the
// `controlled-by-parent-owner-may-edit.test.ts` rig. Step 2.7 hands a detail's
// floor to the master gate on a by-id write, so for a row that names no master
// the gate's owner rule is the only row-level write gate left: every refusal
// below is asserted on its envelope (`code`, `status` and the `details` that
// name the write and the record it judged) AND on the stored row.
//
//   onm_contact --account?--> onm_account   optional master, ownership: user
//   onm_lead    --account?--> onm_account   optional master, ownerMayEdit opt-in
//   onm_memo    --account?--> onm_account   optional master, ownership: none (no owner_id)
//   onm_note    --contact---> onm_contact   required master: a chain over an optional one
//   onm_task    --account---> onm_account   REQUIRED master: the control

const W_ACCOUNT = 'onm_account';
const W_CONTACT = 'onm_contact';
const W_LEAD = 'onm_lead';
const W_MEMO = 'onm_memo';
const W_NOTE = 'onm_note';
const W_TASK = 'onm_task';
const W_DETAILS = [W_CONTACT, W_LEAD, W_MEMO, W_NOTE, W_TASK];
const W_ORG = 'org_onm';
const W_SYS = { context: { isSystem: true } } as never;

/** Creates every seeded row (`created_by`) unless a case names its creator; never a caller. */
const W_REP = 'usr_onm_rep';
/** Owns the null-master rows; reads every account and edits the ones it owns. */
const W_OWNER = 'usr_onm_owner';
/** Reads every detail row (View All on the details); owns none; no Modify All. */
const W_VIEWER = 'usr_onm_viewer';
/** Modify All on the details; owns none. */
const W_MODIFIER = 'usr_onm_modifier';
/** Edits every account (Modify All on the master) and reads every detail row; owns none. */
const W_EDITOR = 'usr_onm_editor';
/** Delegators bound by no floor (no `sys_member` row): one reads every detail row, one holds Modify All on them. */
const W_DEL_VIEW = 'usr_onm_del_view';
const W_DEL_MODIFY = 'usr_onm_del_modify';

const W_CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const wDetails = (extra: Record<string, boolean> = {}) =>
  Object.fromEntries(W_DETAILS.map((o) => [o, { ...W_CRUD, ...extra }]));
const W_OWNER_SET = PermissionSetSchema.parse({
  name: 'onm_owner',
  objects: { [W_ACCOUNT]: { allowRead: true, allowEdit: true, viewAllRecords: true }, ...wDetails() },
});
const W_VIEWER_SET = PermissionSetSchema.parse({
  name: 'onm_viewer',
  objects: { [W_ACCOUNT]: { allowRead: true, viewAllRecords: true }, ...wDetails({ viewAllRecords: true }) },
});
const W_MODIFIER_SET = PermissionSetSchema.parse({
  name: 'onm_modifier',
  objects: { [W_ACCOUNT]: { allowRead: true, viewAllRecords: true }, ...wDetails({ viewAllRecords: true, modifyAllRecords: true }) },
});
const W_EDITOR_SET = PermissionSetSchema.parse({
  name: 'onm_editor',
  objects: {
    [W_ACCOUNT]: { allowRead: true, allowEdit: true, viewAllRecords: true, modifyAllRecords: true },
    ...wDetails({ viewAllRecords: true }),
  },
});
const W_MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const W_SETS = [W_MEMBER_DEFAULT, W_OWNER_SET, W_VIEWER_SET, W_MODIFIER_SET, W_EDITOR_SET];

/** The execution context `resolveAuthzContext` hands the middleware for an organization member holding the sets. */
const wMemberOf = (userId: string, set: string) => ({
  userId,
  tenantId: W_ORG,
  positions: ['org_member'],
  permissions: [set, 'member_default'],
  posture: 'MEMBER',
});
const W_OWNER_CALLER = wMemberOf(W_OWNER, W_OWNER_SET.name);
const W_VIEWER_CALLER = wMemberOf(W_VIEWER, W_VIEWER_SET.name);
const W_MODIFIER_CALLER = wMemberOf(W_MODIFIER, W_MODIFIER_SET.name);
const W_EDITOR_CALLER = wMemberOf(W_EDITOR, W_EDITOR_SET.name);
const wOnBehalfOf = (caller: object, delegator: string) => ({ ...caller, onBehalfOf: { userId: delegator } });

type WAnswer =
  | { kind: 'admitted' }
  | { kind: 'refused'; code?: string; status?: number; details?: Record<string, unknown> };

const wLanded = (p: Promise<unknown>): Promise<WAnswer> =>
  p.then(
    () => ({ kind: 'admitted' as const }),
    (e: any) => ({
      kind: 'refused' as const,
      code: e?.code == null ? undefined : String(e.code),
      status: e?.statusCode ?? e?.status,
      details: e?.details,
    }),
  );

/**
 * The gate's refusal, by its envelope and the record it names: `403
 * PERMISSION_DENIED`, the caller's object and operation (#7474), and `recordId`
 * — the detail row the owner rule judged, or the master row a master-edit leg
 * refused. Prose is not pinned: no consumer parses it.
 */
function expectRefusal(answer: WAnswer, operation: string, object: string, recordId: string): void {
  expect(answer).toMatchObject({
    kind: 'refused',
    code: 'PERMISSION_DENIED',
    status: 403,
    details: { operation, object, recordId },
  });
}

const W_OPT_IN = { sharing: { controlledByParent: { ownerMayEdit: true } } };
const wDetail = (name: string, fk: string, reference: string, required: boolean, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  sharingModel: 'controlled_by_parent',
  tenancy: { enabled: false },
  fields: {
    id: { name: 'id', type: 'text', primaryKey: true },
    name: { name: 'name', type: 'text' },
    [fk]: { name: fk, type: 'master_detail', reference, required },
    created_by: { name: 'created_by', type: 'text' },
  },
  ...extra,
});

describe('[#30906] the write gate judges a row whose OPTIONAL master is empty — the real engine', () => {
  let engine: ObjectQL;
  let security: {
    checkControlledByParentWrite: (object: string, id: string, context: unknown) => Promise<ControlledByParentWriteOutcome>;
  };
  let seq = 0;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.controlled-by-parent-optional-master-write',
      name: 'A controlled_by_parent detail whose master is optional, written',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        SysRecordShare,
        SysUser,
        SysOrganization,
        SysMember,
        SysUserPosition,
        SysUserPermissionSet,
        {
          name: W_ACCOUNT,
          label: 'Account',
          sharingModel: 'private',
          tenancy: { enabled: false },
          fields: {
            id: { name: 'id', type: 'text', primaryKey: true },
            name: { name: 'name', type: 'text' },
            owner_id: { name: 'owner_id', type: 'text' },
            created_by: { name: 'created_by', type: 'text' },
          },
        },
        // No owner column of their own: the registry injects `owner_id` (ownership: 'user').
        wDetail(W_CONTACT, 'account', W_ACCOUNT, false),
        wDetail(W_LEAD, 'account', W_ACCOUNT, false, W_OPT_IN),
        wDetail(W_MEMO, 'account', W_ACCOUNT, false, { ownership: 'none' }),
        wDetail(W_NOTE, 'contact', W_CONTACT, true),
        wDetail(W_TASK, 'account', W_ACCOUNT, true),
      ],
    } as never);
    await engine.syncSchemas();

    await engine.insert('sys_user', [W_REP, W_OWNER, W_VIEWER, W_MODIFIER, W_EDITOR, W_DEL_VIEW, W_DEL_MODIFY].map((id) => ({
      id, name: id, email: `${id}@onm.test`,
    })), W_SYS);
    await engine.insert('sys_organization', [{ id: W_ORG, name: 'ONM', slug: 'onm' }], W_SYS);
    // Each delegator holds its set through a stored direct grant row owned by
    // the organization, and NO `sys_member` row, so no ownership floor binds
    // its pass: on a delegated write the gate's delegator pass is what is left.
    const grants = (engine as any).getDriver('sys_user_permission_set');
    await grants.create('sys_user_permission_set', {
      id: 'ups_onm_del_view', user_id: W_DEL_VIEW, permission_set: W_VIEWER_SET.name, organization_id: W_ORG,
    });
    await grants.create('sys_user_permission_set', {
      id: 'ups_onm_del_modify', user_id: W_DEL_MODIFY, permission_set: W_MODIFIER_SET.name, organization_id: W_ORG,
    });

    let securityService: unknown;
    let sharing: SharingService | undefined;
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (type: string, name: string) =>
          type === 'permission' ? W_SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
        list: async () => W_SETS,
      },
      get sharing() { return sharing; },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: (name: string, svc: unknown) => { if (name === 'security') securityService = svc; },
      hook: () => undefined,
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    wireEngineSecuritySource(engine, () => plugin);
    sharing = new SharingService({ engine: engine as never, securityService: () => securityService as never });
    engine.registerMiddleware(buildSharingMiddleware(sharing, ctx.logger) as never, { object: '*' });
    security = securityService as typeof security;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** An account owned by `owner`, created by the rep (so the floor never names the caller). */
  async function account(owner: string): Promise<string> {
    const id = `acct_${++seq}`;
    await engine.insert(W_ACCOUNT, [{ id, name: `account ${seq}`, owner_id: owner, created_by: W_REP }], W_SYS);
    return id;
  }

  /** One detail row, written as system: `master` (null for none) under its master field, owned by `owner`. */
  async function row(
    object: string,
    opts: { master?: string | null; owner?: string | null; createdBy?: string } = {},
  ): Promise<string> {
    const id = `${object}_${++seq}`;
    const fk = object === W_NOTE ? 'contact' : 'account';
    const data: Record<string, unknown> = { id, name: 'as seeded', [fk]: opts.master ?? null, created_by: opts.createdBy ?? W_REP };
    if (opts.owner !== undefined) data.owner_id = opts.owner;
    await engine.insert(object, [data], W_SYS);
    return id;
  }

  const stored = (object: string, id: string) =>
    engine.findOne(object, { where: { id }, context: { isSystem: true } } as never) as Promise<Record<string, unknown> | null>;
  const updateById = (object: string, id: string, caller: object, data: Record<string, unknown> = { name: 'edited' }) =>
    wLanded(engine.update(object, data, { where: { id }, context: { ...caller } } as never));
  const deleteById = (object: string, id: string, caller: object) =>
    wLanded(engine.delete(object, { where: { id }, context: { ...caller } } as never));
  const updateMany = (object: string, ids: string[], caller: object, data: Record<string, unknown> = { name: 'edited' }) =>
    wLanded(engine.update(object, data, { where: { id: { $in: ids } }, multi: true, context: { ...caller } } as never));
  const deleteMany = (object: string, ids: string[], caller: object) =>
    wLanded(engine.delete(object, { where: { id: { $in: ids } }, multi: true, context: { ...caller } } as never));

  describe('create: a row that names no master is created, and its creator owns it', () => {
    it('an insert with no master reference, and one with `account: null`, land owned by the caller', async () => {
      const omitted = (await engine.insert(W_CONTACT, { name: 'no account' }, { context: { ...W_OWNER_CALLER } } as never)) as { id: string };
      const nulled = (await engine.insert(W_CONTACT, { name: 'null account', account: null }, { context: { ...W_OWNER_CALLER } } as never)) as { id: string };
      for (const id of [omitted.id, nulled.id]) {
        expect(await stored(W_CONTACT, id)).toMatchObject({ account: null, owner_id: W_OWNER });
      }
    });

    it('a batch: rows naming no master land, and a row naming a master the caller cannot edit refuses the whole batch', async () => {
      const others = await account(W_REP);
      const before = ((await engine.find(W_CONTACT, { context: { isSystem: true } } as never)) as unknown[]).length;
      const refused = await wLanded(engine.insert(W_CONTACT, [
        { name: 'batch, no account' },
        { name: 'batch, under an account the owner reads', account: others },
      ], { context: { ...W_OWNER_CALLER } } as never));
      expectRefusal(refused, 'insert', W_CONTACT, others);
      expect(((await engine.find(W_CONTACT, { context: { isSystem: true } } as never)) as unknown[]).length).toBe(before);
      expect(await wLanded(engine.insert(W_CONTACT, [{ name: 'batch a' }, { name: 'batch b' }], { context: { ...W_OWNER_CALLER } } as never)))
        .toEqual({ kind: 'admitted' });
    });
  });

  describe('update and delete by id: its owner or Modify All on the detail, and nobody else', () => {
    it('the owner updates and deletes it', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      expect(await updateById(W_CONTACT, id, W_OWNER_CALLER)).toEqual({ kind: 'admitted' });
      expect((await stored(W_CONTACT, id))?.name).toBe('edited');
      expect(await deleteById(W_CONTACT, id, W_OWNER_CALLER)).toEqual({ kind: 'admitted' });
      expect(await stored(W_CONTACT, id)).toBeNull();
    });

    it('a principal who READS it (View All) and does not own it is refused both, and the row is as seeded', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      expectRefusal(await updateById(W_CONTACT, id, W_VIEWER_CALLER), 'update', W_CONTACT, id);
      expectRefusal(await deleteById(W_CONTACT, id, W_VIEWER_CALLER), 'delete', W_CONTACT, id);
      expect(await stored(W_CONTACT, id)).toMatchObject({ name: 'as seeded', owner_id: W_OWNER });
    });

    it('Modify All on the detail updates and deletes it without owning it', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      expect(await updateById(W_CONTACT, id, W_MODIFIER_CALLER)).toEqual({ kind: 'admitted' });
      expect((await stored(W_CONTACT, id))?.name).toBe('edited');
      expect(await deleteById(W_CONTACT, id, W_MODIFIER_CALLER)).toEqual({ kind: 'admitted' });
      expect(await stored(W_CONTACT, id)).toBeNull();
    });

    it('a row with no owner (a queue row) is Modify All\'s alone', async () => {
      const id = await row(W_CONTACT, { owner: null });
      expectRefusal(await updateById(W_CONTACT, id, W_VIEWER_CALLER), 'update', W_CONTACT, id);
      expect((await stored(W_CONTACT, id))?.name).toBe('as seeded');
      expect(await updateById(W_CONTACT, id, W_MODIFIER_CALLER)).toEqual({ kind: 'admitted' });
    });

    it('on an object with no owner_id column, every such row is Modify All\'s alone', async () => {
      const id = await row(W_MEMO);
      expectRefusal(await updateById(W_MEMO, id, W_VIEWER_CALLER), 'update', W_MEMO, id);
      expect((await stored(W_MEMO, id))?.name).toBe('as seeded');
      expect(await updateById(W_MEMO, id, W_MODIFIER_CALLER)).toEqual({ kind: 'admitted' });
      expect((await stored(W_MEMO, id))?.name).toBe('edited');
    });

    it('a principal who cannot READ it meets the read door first: not found, never the gate', async () => {
      const id = await row(W_CONTACT, { owner: W_VIEWER });
      expect(await updateById(W_CONTACT, id, W_OWNER_CALLER)).toMatchObject({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
      expect((await stored(W_CONTACT, id))?.name).toBe('as seeded');
    });
  });

  describe('setting and emptying the master', () => {
    it('setting a master asks EDIT on it: refused under an account the owner only reads, admitted under one it edits', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      const others = await account(W_REP);
      const mine = await account(W_OWNER);
      expectRefusal(await updateById(W_CONTACT, id, W_OWNER_CALLER, { account: others }), 'update', W_CONTACT, others);
      expect((await stored(W_CONTACT, id))?.account).toBeNull();
      expect(await updateById(W_CONTACT, id, W_OWNER_CALLER, { account: mine })).toEqual({ kind: 'admitted' });
      expect((await stored(W_CONTACT, id))?.account).toBe(mine);
    });

    it('a principal who edits every account but does not own the row cannot adopt it: the row\'s own rule is asked first', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      const mine = await account(W_EDITOR);
      expectRefusal(await updateById(W_CONTACT, id, W_EDITOR_CALLER, { account: mine }), 'update', W_CONTACT, id);
      expect((await stored(W_CONTACT, id))?.account).toBeNull();
    });

    it('emptying a master asks EDIT on the master it leaves: refused while the owner only reads it, even under the ownerMayEdit opt-in', async () => {
      const others = await account(W_REP);
      const id = await row(W_LEAD, { master: others, owner: W_OWNER });
      // CONTROL — the opt-in admits the owner's ordinary update with read on the master.
      expect(await updateById(W_LEAD, id, W_OWNER_CALLER)).toEqual({ kind: 'admitted' });
      // …and does not admit a body that detaches the row from that master.
      expectRefusal(await updateById(W_LEAD, id, W_OWNER_CALLER, { account: null }), 'update', W_LEAD, others);
      expect((await stored(W_LEAD, id))?.account).toBe(others);
    });

    it('emptying a master the caller edits is admitted, and the row then follows the owner rule', async () => {
      const mine = await account(W_OWNER);
      const id = await row(W_CONTACT, { master: mine, owner: W_OWNER });
      expect(await updateById(W_CONTACT, id, W_OWNER_CALLER, { account: null })).toEqual({ kind: 'admitted' });
      expect((await stored(W_CONTACT, id))?.account).toBeNull();
      expectRefusal(await updateById(W_CONTACT, id, W_VIEWER_CALLER), 'update', W_CONTACT, id);
      expect(await updateById(W_CONTACT, id, W_OWNER_CALLER, { name: 'still mine' })).toEqual({ kind: 'admitted' });
    });
  });

  describe('chain: a hop whose master names no master of its own asks the owner rule of that row', () => {
    it('the contact\'s owner writes its notes; a principal who reads them and does not own the contact is refused', async () => {
      const contact = await row(W_CONTACT, { owner: W_OWNER });
      const note = await row(W_NOTE, { master: contact });
      expect(await updateById(W_NOTE, note, W_OWNER_CALLER)).toEqual({ kind: 'admitted' });
      expect((await stored(W_NOTE, note))?.name).toBe('edited');

      const other = await row(W_NOTE, { master: contact });
      expectRefusal(await updateById(W_NOTE, other, W_VIEWER_CALLER), 'update', W_NOTE, contact);
      expect((await stored(W_NOTE, other))?.name).toBe('as seeded');
      expectRefusal(
        await wLanded(engine.insert(W_NOTE, { name: 'under it', contact }, { context: { ...W_VIEWER_CALLER } } as never)),
        'insert', W_NOTE, contact,
      );
      // Modify All on the hop's own object admits it.
      expect(await updateById(W_NOTE, other, W_MODIFIER_CALLER)).toEqual({ kind: 'admitted' });
    });
  });

  describe('predicate writes (multi: true): every selected row that names no master is judged', () => {
    it('the owner\'s predicate update of its own rows lands', async () => {
      const ids = [await row(W_CONTACT, { owner: W_OWNER, createdBy: W_OWNER }), await row(W_CONTACT, { owner: W_OWNER, createdBy: W_OWNER })];
      expect(await updateMany(W_CONTACT, ids, W_OWNER_CALLER)).toEqual({ kind: 'admitted' });
      for (const id of ids) expect((await stored(W_CONTACT, id))?.name).toBe('edited');
    });

    it('a reader who owns none of them is refused, update and delete, on the first such row, and nothing is written', async () => {
      const ids = [await row(W_CONTACT, { owner: W_OWNER, createdBy: W_VIEWER }), await row(W_CONTACT, { owner: W_OWNER, createdBy: W_VIEWER })];
      expectRefusal(await updateMany(W_CONTACT, ids, W_VIEWER_CALLER), 'update', W_CONTACT, ids[0]!);
      expectRefusal(await deleteMany(W_CONTACT, ids, W_VIEWER_CALLER), 'delete', W_CONTACT, ids[0]!);
      for (const id of ids) expect((await stored(W_CONTACT, id))?.name).toBe('as seeded');
    });

    it('Modify All on the detail is admitted', async () => {
      const ids = [await row(W_CONTACT, { owner: W_OWNER })];
      expect(await updateMany(W_CONTACT, ids, W_MODIFIER_CALLER)).toEqual({ kind: 'admitted' });
    });

    it('a body naming a master is asked of it even when every selected row names none', async () => {
      const others = await account(W_REP);
      const ids = [await row(W_CONTACT, { owner: W_OWNER, createdBy: W_OWNER })];
      expectRefusal(await updateMany(W_CONTACT, ids, W_OWNER_CALLER, { account: others }), 'update', W_CONTACT, others);
      expect((await stored(W_CONTACT, ids[0]!))?.account).toBeNull();
    });
  });

  describe('on behalf of: both principals are asked the owner rule', () => {
    it('the agent owns the row and the delegator only reads it: refused on the delegator\'s pass; a Modify All delegator is admitted', async () => {
      // The agent CREATED the row, so its own floor (kept on a delegated by-id
      // write, ADR-0090 D10) passes, and the delegators are bound by none: the
      // gate's two passes are what decide.
      const id = await row(W_CONTACT, { owner: W_OWNER, createdBy: W_OWNER });
      expectRefusal(await updateById(W_CONTACT, id, wOnBehalfOf(W_OWNER_CALLER, W_DEL_VIEW)), 'update', W_CONTACT, id);
      expect((await stored(W_CONTACT, id))?.name).toBe('as seeded');
      expect(await updateById(W_CONTACT, id, wOnBehalfOf(W_OWNER_CALLER, W_DEL_MODIFY))).toEqual({ kind: 'admitted' });
      expect((await stored(W_CONTACT, id))?.name).toBe('edited');
    });

    it('ISecurityService.checkControlledByParentWrite asks it of each pass: the agent\'s and the delegator\'s', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      expect(await security.checkControlledByParentWrite(W_CONTACT, id, wOnBehalfOf(W_OWNER_CALLER, W_DEL_MODIFY))).toEqual({ outcome: 'allow' });
      // The delegator's pass refuses.
      expect(await security.checkControlledByParentWrite(W_CONTACT, id, wOnBehalfOf(W_OWNER_CALLER, W_DEL_VIEW)))
        .toEqual({ outcome: 'deny', leg: 'master_chain' });
      // The agent's pass refuses.
      expect(await security.checkControlledByParentWrite(W_CONTACT, id, wOnBehalfOf(W_VIEWER_CALLER, W_DEL_MODIFY)))
        .toEqual({ outcome: 'deny', leg: 'master_chain' });
    });
  });

  describe('ISecurityService.checkControlledByParentWrite answers as the write path does', () => {
    it('allow for the owner and for Modify All; deny on the master_chain leg for a reader who owns nothing', async () => {
      const id = await row(W_CONTACT, { owner: W_OWNER });
      expect(await security.checkControlledByParentWrite(W_CONTACT, id, { ...W_OWNER_CALLER })).toEqual({ outcome: 'allow' });
      expect(await security.checkControlledByParentWrite(W_CONTACT, id, { ...W_MODIFIER_CALLER })).toEqual({ outcome: 'allow' });
      expect(await security.checkControlledByParentWrite(W_CONTACT, id, { ...W_VIEWER_CALLER })).toEqual({ outcome: 'deny', leg: 'master_chain' });
    });

    it('CONTROL — a REQUIRED master\'s stored empty reference is still unresolvable, master_reference_missing (422)', async () => {
      // Planted through the driver: no door the platform serves writes a
      // required master empty.
      const id = `${W_TASK}_${++seq}`;
      await (engine as any).getDriver(W_TASK).create(W_TASK, { id, name: 'planted', account: null, owner_id: W_OWNER, created_by: W_REP });
      expect(await security.checkControlledByParentWrite(W_TASK, id, { ...W_MODIFIER_CALLER }))
        .toEqual({ outcome: 'unresolvable', reason: 'master_reference_missing' });
    });
  });
});
