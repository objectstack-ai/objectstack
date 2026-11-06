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
//   - a required master's leaf is unchanged, and the write gate is unchanged
//     (a null-master insert is still refused, 422).
//
// The fixture mirrors `controlled-by-parent-sharing.test.ts`: the REAL
// security plugin and the REAL sharing service over an in-memory read
// double, the leaf composed the way the engine composes it
// (`readable-ids-in-memory.testkit.ts`), every filter applied by the same
// evaluator the plugin uses. Two read faces are run on every rule: the data
// middleware's injected `where` and `getReadFilter` (the analytics read and
// the engine's `ReadableIds` composer for parent gates).

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectSchema, isComposedReadableIds, isReadableIds } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { composeReadableIdsInMemory } from './readable-ids-in-memory.testkit.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccessForAsker, type ExplainEngineDeps } from './explain-engine.js';

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

describe('[#30905 ruling A] the write gate is unchanged (card 2/3 moves it)', () => {
  it('an insert of an optional-master detail with an empty master reference is still refused, 422', async () => {
    const h = await boot();
    let err: any;
    try {
      await h.insertContact({ id: 'ct_new', account: null, owner_id: REP });
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe('MISSING_REQUIRED_FIELD');
    expect(err?.statusCode).toBe(422);
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
