// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055] `ISecurityService.checkControlledByParentWrite`, as this plugin
// serves it, answers what a by-id UPDATE of the same record gets from the
// master-detail write check — pinned beside that update, run through the REAL
// engine middleware over the same store, for the same caller.
//
// ## Why parity is pinned rather than assumed
//
// The member exists for gates outside the write path (the `sys_attachment` and
// `sys_comment` parent gates) that must judge a `controlled_by_parent` parent
// as its own update is judged. Its whole promise is that it is the write path's
// composition, run, never re-derived. So every case below asks BOTH faces:
//
//   - `patch(caller, object, id)` — the middleware, on a by-id update, the way
//     the REST door runs it;
//   - `member(caller, object, id)` — the registered service's member.
//
// Where step 2.8 is what refuses the update (the record is readable, its own
// gates pass), the refusal's reason names the same leg the member reports. Where
// a gate the update meets EARLIER refuses it (the record is hidden by the read
// derivation, so step 2.7 answers not-found first), both faces still refuse —
// the member answers the master check alone, which the contract says.
//
// The last block runs `security/explain` for EVERY by-id write verb step 2.8
// runs on (update, delete, transfer) beside that verb's own door through the
// same middleware: explain asks this one member for each, because the check
// judges EDIT of the master whatever the record's verb. A verb whose door's
// master check stopped matching the member's update answer turns it red.
//
// ## The fixture
//
//   cbpm_account   public_read + owner_id   — read by all, edited by its owner
//   cbpm_contact   controlled_by_parent → cbpm_account
//   cbpm_region    public_read_write, no owner — edit gated by an authored
//                  write RLS policy (`region == 'us'`) for the rep
//   cbpm_region_note controlled_by_parent → cbpm_region
//   cbpm_quote     controlled_by_parent → cbpm_account
//   cbpm_line      controlled_by_parent → cbpm_quote (a two-hop chain)
//   cbpm_orphan    controlled_by_parent with NO master_detail relation
//
// The rep holds full CRUD on every object (so every refusal is record-level);
// the viewer — the fallback set every user resolves — holds full CRUD on the
// details and READ only on the masters (the `object_permission` leg).

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { SharingService, type SharingEngine } from '@objectstack/plugin-sharing';
import { matchesFilterCondition } from '@objectstack/formula';
import { ExplainOperationSchema, PermissionSetSchema, type ExplainOperation, type PermissionSet } from '@objectstack/spec/security';
import type { ControlledByParentWriteOutcome, ISecurityService } from '@objectstack/spec/contracts';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

const REP = 'usr_rep';
const OTHER = 'usr_other';
const VIEWER = 'usr_viewer';

const text = (name: string) => ({ name, type: 'text' });
const owner = { name: 'owner_id', type: 'lookup', reference: 'sys_user' };
const masterDetail = (name: string, reference: string) => ({ name, type: 'master_detail', required: true, reference });

const SCHEMAS: Record<string, unknown> = {
  cbpm_account: { name: 'cbpm_account', sharingModel: 'public_read', fields: { id: text('id'), name: text('name'), owner_id: owner } },
  cbpm_contact: {
    name: 'cbpm_contact',
    sharingModel: 'controlled_by_parent',
    fields: { id: text('id'), name: text('name'), account: masterDetail('account', 'cbpm_account') },
  },
  cbpm_region: { name: 'cbpm_region', sharingModel: 'public_read_write', fields: { id: text('id'), region: text('region') } },
  cbpm_region_note: {
    name: 'cbpm_region_note',
    sharingModel: 'controlled_by_parent',
    fields: { id: text('id'), name: text('name'), region_ref: masterDetail('region_ref', 'cbpm_region') },
  },
  cbpm_quote: {
    name: 'cbpm_quote',
    sharingModel: 'controlled_by_parent',
    fields: { id: text('id'), name: text('name'), account: masterDetail('account', 'cbpm_account') },
  },
  cbpm_line: {
    name: 'cbpm_line',
    sharingModel: 'controlled_by_parent',
    fields: { id: text('id'), name: text('name'), quote: masterDetail('quote', 'cbpm_quote') },
  },
  // Authored wrong: `controlled_by_parent` with an OPTIONAL lookup, so there is
  // no relation to derive access from (`resolveCbpRelation` finds none).
  cbpm_orphan: {
    name: 'cbpm_orphan',
    sharingModel: 'controlled_by_parent',
    fields: { id: text('id'), name: text('name'), account: { name: 'account', type: 'lookup', reference: 'cbpm_account' } },
  },
  sys_record_share: {
    name: 'sys_record_share',
    isSystem: true,
    fields: {
      id: text('id'),
      object_name: text('object_name'),
      record_id: text('record_id'),
      recipient_type: text('recipient_type'),
      recipient_id: text('recipient_id'),
      access_level: text('access_level'),
    },
  },
  sys_user: { name: 'sys_user', isSystem: true, fields: { id: text('id'), name: text('name') } },
};

// `allowTransfer` lets a transfer through the object gate, so its record-level
// gates (step 2.7, step 2.8) are what answer it.
const CRUD = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true };
const READ = { allowRead: true };
const DETAILS = ['cbpm_contact', 'cbpm_region_note', 'cbpm_quote', 'cbpm_line', 'cbpm_orphan'];

const REP_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'cbpm_rep',
  objects: Object.fromEntries([...DETAILS, 'cbpm_account', 'cbpm_region'].map((o) => [o, CRUD])),
  rowLevelSecurity: [{ name: 'cbpm_region_us_edits', object: 'cbpm_region', operation: 'update', using: "region == 'us'" }],
});

const VIEWER_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'cbpm_viewer',
  objects: {
    ...Object.fromEntries(DETAILS.map((o) => [o, CRUD])),
    cbpm_account: READ,
    cbpm_region: READ,
  },
});

type Row = Record<string, unknown>;

function fixtureRows(): Record<string, Row[]> {
  return {
    cbpm_account: [
      { id: 'acct_own', name: 'Rep owns', owner_id: REP },
      { id: 'acct_other', name: 'Other owns, not shared', owner_id: OTHER },
      { id: 'acct_shared', name: 'Other owns, shared to the rep at edit', owner_id: OTHER },
    ],
    cbpm_contact: [
      { id: 'c_own', name: 'under acct_own', account: 'acct_own' },
      { id: 'c_other', name: 'under acct_other', account: 'acct_other' },
      { id: 'c_shared', name: 'under acct_shared', account: 'acct_shared' },
      { id: 'c_dangling', name: 'no master reference', account: null },
    ],
    cbpm_region: [
      { id: 'reg_us', region: 'us' },
      { id: 'reg_eu', region: 'eu' },
    ],
    cbpm_region_note: [
      { id: 'rn_us', name: 'under reg_us', region_ref: 'reg_us' },
      { id: 'rn_eu', name: 'under reg_eu', region_ref: 'reg_eu' },
    ],
    cbpm_quote: [
      { id: 'q_own', name: 'under acct_own', account: 'acct_own' },
      { id: 'q_dangling', name: 'no master reference', account: null },
    ],
    cbpm_line: [
      { id: 'line_ok', name: 'under q_own', quote: 'q_own' },
      { id: 'line_above_dangling', name: 'under q_dangling', quote: 'q_dangling' },
    ],
    cbpm_orphan: [{ id: 'orphan_1', name: 'no relation', account: 'acct_own' }],
    sys_record_share: [
      {
        id: 'shr_1',
        object_name: 'cbpm_account',
        record_id: 'acct_shared',
        recipient_type: 'user',
        recipient_id: REP,
        access_level: 'edit',
      },
    ],
    sys_user: [
      { id: REP, name: 'Rep' },
      { id: OTHER, name: 'Other' },
      { id: VIEWER, name: 'Viewer' },
    ],
  };
}

/** The store fault this suite injects: the datasource is down for one record. */
class DatasourceUnavailable extends Error {
  readonly code = 'ERR_DATASOURCE_UNAVAILABLE';
  readonly status = 503;
  readonly statusCode = 503;
}

/**
 * READ-surface-only engine double over `matchesFilterCondition`, the evaluator
 * the plugin itself uses. `faultOn` makes any read naming that id throw a 503,
 * the shape a datasource outage takes.
 */
function makeStore(rows: Record<string, Row[]>, faultOn?: string) {
  const fault = (options: any) => {
    if (faultOn !== undefined && JSON.stringify(options?.where ?? {}).includes(`"${faultOn}"`)) {
      throw new DatasourceUnavailable(`datasource unavailable reading '${faultOn}'`);
    }
  };
  return {
    rows,
    getSchema: (object: string) => SCHEMAS[object],
    find: vi.fn(async (object: string, options: any = {}) => {
      fault(options);
      const hits = (rows[object] ?? []).filter((r) => matchesFilterCondition(r, options?.where ?? null));
      return typeof options?.limit === 'number' ? hits.slice(0, options.limit) : hits;
    }),
    findOne: vi.fn(async (object: string, options: any = {}) => {
      assertEngineFindOnePredicate(object, options);
      fault(options);
      return (rows[object] ?? []).find((r) => matchesFilterCondition(r, options?.where ?? null)) ?? null;
    }),
  };
}

async function boot(options: { faultOn?: string } = {}) {
  const store = makeStore(fixtureRows(), options.faultOn);
  const sets = [VIEWER_SET, REP_SET];
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
  const registerService = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ defaultPermissionSets: sets, fallbackPermissionSet: 'cbpm_viewer' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  const security = registerService.mock.calls.find((c: unknown[]) => c[0] === 'security')?.[1] as ISecurityService;
  if (typeof security?.checkControlledByParentWrite !== 'function') {
    throw new Error('the registered security service does not serve checkControlledByParentWrite');
  }
  const serve = security.checkControlledByParentWrite.bind(security);

  /** A by-id update through the engine middleware. Resolves `'admitted'` or the refusal it threw. */
  const patch = async (context: any, object: string, id: string): Promise<'admitted' | any> => {
    const opCtx: any = { object, operation: 'update', data: { id, name: 'edited' }, options: { where: { id } }, context };
    try {
      await middleware(opCtx, async () => {});
      return 'admitted';
    } catch (e) {
      return e;
    }
  };
  /**
   * A by-id write of any verb through the engine middleware, shaped as the
   * write path builds it (a delete or a purge carries no data). Resolves
   * `'admitted'` or the refusal it threw.
   */
  const write = async (operation: string, context: any, object: string, id: string): Promise<'admitted' | any> => {
    const opCtx: any = {
      object,
      operation,
      ...(operation === 'delete' || operation === 'purge' ? {} : { data: { id, name: 'edited' } }),
      options: { where: { id } },
      context,
    };
    try {
      await middleware(opCtx, async () => {});
      return 'admitted';
    } catch (e) {
      return e;
    }
  };
  const member = (context: any, object: string, id: string) => serve(object, id, context);
  /**
   * [ADR-0055] `security/explain`'s record-grained update verdict through the
   * registered service (`explainAccessForCaller`). `userId` explains another
   * user, as the REST route does; the caller is the second argument.
   */
  const explainAs = (operation: ExplainOperation, callerContext: any, object: string, recordId: string, userId?: string) =>
    security.explain({ object, operation, recordId, ...(userId ? { userId } : {}) }, callerContext);
  const explainUpdate = (callerContext: any, object: string, recordId: string, userId?: string) =>
    explainAs('update', callerContext, object, recordId, userId);
  return { store, ctx, patch, write, member, explainAs, explainUpdate };
}

const rep = () => ({ userId: REP, tenantId: 'org-1', positions: [], permissions: ['cbpm_rep'] });
const viewer = () => ({ userId: VIEWER, tenantId: 'org-1', positions: [], permissions: [] });

/** The reason phrase step 2.8 writes for each leg — how a PATCH refusal names its leg. */
const LEG_REASON: Record<string, RegExp> = {
  object_permission: /requires edit access to its master record \(no edit permission on master/,
  row_level_security: /requires edit access to its master record \(master '[a-z_]+' not editable by this user \(row-level security\)\)/,
  record_sharing: /requires edit access to its master record \(master '[a-z_]+' not editable by this user \(record sharing\)\)/,
};

describe('[ADR-0055] checkControlledByParentWrite answers what the by-id update gets from the master check', () => {
  it('allow ⇔ the update is admitted: an owned master, a master shared at edit, an RLS-admitted master, a two-hop chain', async () => {
    const h = await boot();
    for (const [object, id] of [
      ['cbpm_contact', 'c_own'],
      ['cbpm_contact', 'c_shared'],
      ['cbpm_region_note', 'rn_us'],
      ['cbpm_line', 'line_ok'],
    ] as const) {
      expect(await h.patch(rep(), object, id), `PATCH ${object}/${id}`).toBe('admitted');
      expect(await h.member(rep(), object, id), `member ${object}/${id}`).toEqual({ outcome: 'allow' });
    }
  });

  it('deny on the leg step 2.8 refuses on, for a record the caller can read', async () => {
    const h = await boot();
    const cases: Array<[any, string, string, ControlledByParentWriteOutcome]> = [
      [rep(), 'cbpm_contact', 'c_other', { outcome: 'deny', leg: 'record_sharing' }],
      [rep(), 'cbpm_region_note', 'rn_eu', { outcome: 'deny', leg: 'row_level_security' }],
      [viewer(), 'cbpm_contact', 'c_own', { outcome: 'deny', leg: 'object_permission' }],
    ];
    for (const [context, object, id, expected] of cases) {
      const refused = await h.patch(context, object, id);
      expect(refused, `PATCH ${object}/${id} by ${context.userId}`).not.toBe('admitted');
      expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      expect(String(refused.message)).toMatch(LEG_REASON[(expected as any).leg]);
      expect(await h.member(context, object, id), `member ${object}/${id} by ${context.userId}`).toEqual(expected);
    }
  });

  it('the ADR-0090 D10 delegator leg: the principal may edit the master, the delegator may not ⇒ deny on the delegator\'s leg', async () => {
    const h = await boot();
    const delegated = { ...rep(), onBehalfOf: { userId: VIEWER } };
    // The rep alone may edit c_own's master; on behalf of the viewer, the
    // viewer's pass refuses (no update grant on the master) — first refusal wins.
    expect(await h.member(rep(), 'cbpm_contact', 'c_own')).toEqual({ outcome: 'allow' });
    const refused = await h.patch(delegated, 'cbpm_contact', 'c_own');
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(String(refused.message)).toMatch(LEG_REASON.object_permission);
    expect(await h.member(delegated, 'cbpm_contact', 'c_own')).toEqual({ outcome: 'deny', leg: 'object_permission' });
  });

  it('master_chain: a master above the record\'s own master with no master reference ⇒ deny, and the update refuses', async () => {
    const h = await boot();
    expect(await h.patch(rep(), 'cbpm_line', 'line_above_dangling')).not.toBe('admitted');
    expect(await h.member(rep(), 'cbpm_line', 'line_above_dangling')).toEqual({ outcome: 'deny', leg: 'master_chain' });
  });

  it('unresolvable for the three non-verdicts, and the update refuses each', async () => {
    const h = await boot();
    const cases: Array<[string, string, ControlledByParentWriteOutcome]> = [
      ['cbpm_contact', 'c_missing', { outcome: 'unresolvable', reason: 'record_not_found' }],
      ['cbpm_contact', 'c_dangling', { outcome: 'unresolvable', reason: 'master_reference_missing' }],
      ['cbpm_orphan', 'orphan_1', { outcome: 'unresolvable', reason: 'master_detail_relation_missing' }],
    ];
    for (const [object, id, expected] of cases) {
      expect(await h.patch(rep(), object, id), `PATCH ${object}/${id}`).not.toBe('admitted');
      expect(await h.member(rep(), object, id), `member ${object}/${id}`).toEqual(expected);
    }
  });

  it('not_applicable for an object that derives nothing from a master; a system context answers allow', async () => {
    const h = await boot();
    expect(await h.member(rep(), 'cbpm_account', 'acct_own')).toEqual({ outcome: 'not_applicable' });
    expect(await h.member(rep(), 'cbpm_region', 'reg_eu')).toEqual({ outcome: 'not_applicable' });
    expect(await h.member({ isSystem: true }, 'cbpm_contact', 'c_other')).toEqual({ outcome: 'allow' });
    expect(await h.patch({ isSystem: true }, 'cbpm_contact', 'c_other')).toBe('admitted');
  });

  it('a principal with no user id is judged, not passed: deny where the write path skips step 2.8', async () => {
    // Step 2.8 is guarded by `!!context.userId` on the write path; the member
    // does not mirror the guard (see its docblock). The positions resolve no
    // set, so the principal holds no update grant on the master.
    const h = await boot();
    const guest = { positions: ['guest_like'], permissions: [] };
    expect(await h.patch(guest, 'cbpm_contact', 'c_own')).not.toBe('admitted');
    expect(await h.member(guest, 'cbpm_contact', 'c_own')).toEqual({ outcome: 'deny', leg: 'object_permission' });
  });
});

describe('[ADR-0055] checkControlledByParentWrite rejects where the write path refuses the request, never resolving a verdict', () => {
  it('a principal-less context rejects with the write path\'s own refusal', async () => {
    const h = await boot();
    const refused = await h.patch({}, 'cbpm_contact', 'c_own');
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    await expect(h.member({}, 'cbpm_contact', 'c_own')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      message: refused.message,
    });
  });

  it('an on-behalf-of link naming a delegator who does not exist rejects with the write path\'s own refusal', async () => {
    const h = await boot();
    const dangling = { ...rep(), onBehalfOf: { userId: 'usr_gone' } };
    const refused = await h.patch(dangling, 'cbpm_contact', 'c_own');
    expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    await expect(h.member(dangling, 'cbpm_contact', 'c_own')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
      message: refused.message,
    });
  });

  it('a store fault rejects with the engine\'s own error, unchanged — its 503 is never reported as a verdict', async () => {
    const h = await boot({ faultOn: 'c_own' });
    const rejection = await h.member(rep(), 'cbpm_contact', 'c_own').then(
      (outcome) => ({ resolved: outcome }),
      (e) => e,
    );
    expect(rejection).toBeInstanceOf(DatasourceUnavailable);
    expect(rejection).toMatchObject({ code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
  });
});

describe('[ADR-0055] security/explain answers an update as the PATCH does, from this same check', () => {
  const sharingDetailOf = (d: any): string => String(d.layers.find((l: any) => l.layer === 'sharing')?.record?.detail ?? '');

  it('a refused update is explained refused on the leg the PATCH names; an admitted one is explained writable', async () => {
    const h = await boot();
    for (const [context, object, id, leg] of [
      [rep(), 'cbpm_contact', 'c_other', 'record_sharing'],
      [rep(), 'cbpm_region_note', 'rn_eu', 'row_level_security'],
      [viewer(), 'cbpm_contact', 'c_own', 'object_permission'],
      [rep(), 'cbpm_line', 'line_above_dangling', 'master_chain'],
    ] as const) {
      expect(await h.patch(context, object, id), `PATCH ${object}/${id} by ${context.userId}`).not.toBe('admitted');
      const d = await h.explainUpdate(context, object, id);
      expect(d.record, `explain ${object}/${id} by ${context.userId}`).toEqual({ recordId: id, visible: false, decidedBy: 'sharing' });
      expect(sharingDetailOf(d)).toContain(`refuses this update on its '${leg}' leg`);
    }
    for (const [object, id] of [['cbpm_contact', 'c_own'], ['cbpm_contact', 'c_shared'], ['cbpm_region_note', 'rn_us'], ['cbpm_line', 'line_ok']] as const) {
      expect(await h.patch(rep(), object, id), `PATCH ${object}/${id}`).toBe('admitted');
      const d = await h.explainUpdate(rep(), object, id);
      expect(d.record, `explain ${object}/${id}`).toMatchObject({ recordId: id, visible: true });
      expect(sharingDetailOf(d)).not.toContain('master-detail write check');
    }
  });

  it('explaining ANOTHER user asks the check for THAT user: the system caller would be admitted, the viewer it explains is not', async () => {
    const h = await boot();
    // Asked with the CALLER's context, the check would admit: a system context answers `allow`.
    expect(await h.member({ isSystem: true }, 'cbpm_contact', 'c_own')).toEqual({ outcome: 'allow' });
    // The viewer, explained by user id, resolves to the fallback set — READ only on the master.
    expect(await h.patch(viewer(), 'cbpm_contact', 'c_own')).not.toBe('admitted');
    const d = await h.explainUpdate({ isSystem: true }, 'cbpm_contact', 'c_own', VIEWER);
    expect(d.principal.userId).toBe(VIEWER);
    expect(d.record).toEqual({ recordId: 'c_own', visible: false, decidedBy: 'sharing' });
    expect(sharingDetailOf(d)).toContain("refuses this update on its 'object_permission' leg");
  });
});

/**
 * Every operation `security/explain` answers, classified against step 2.8 of
 * the write path. Total by construction, and checked against the spec's
 * vocabulary below, so a verb added there without a row here fails.
 *
 *  - `by_id_master_checked`: a by-id write the object gate lets through for a
 *    principal holding the grant, on which step 2.8 runs the master check.
 *  - `object_gate_refused`: step 2.8 lists it, but the object gate refuses it
 *    to every principal (its grant is retired until the lifecycle batch).
 *  - `no_by_id_write`: a read, or an insert, whose master step 2.8 reads off
 *    the request body an explanation does not carry.
 */
const VERB_ROWS: Record<ExplainOperation, 'by_id_master_checked' | 'object_gate_refused' | 'no_by_id_write'> = {
  update: 'by_id_master_checked',
  delete: 'by_id_master_checked',
  transfer: 'by_id_master_checked',
  restore: 'object_gate_refused',
  purge: 'object_gate_refused',
  create: 'no_by_id_write',
  read: 'no_by_id_write',
  export: 'no_by_id_write',
};
const verbsOf = (row: (typeof VERB_ROWS)[ExplainOperation]) =>
  (Object.keys(VERB_ROWS) as ExplainOperation[]).filter((v) => VERB_ROWS[v] === row);

describe('[ADR-0055] security/explain answers every by-id write verb as its door does, from this same check', () => {
  const sharingDetailOf = (d: any): string => String(d.layers.find((l: any) => l.layer === 'sharing')?.record?.detail ?? '');

  it('the classification is total: every operation explain answers has a row', () => {
    expect([...ExplainOperationSchema.options].sort()).toEqual(Object.keys(VERB_ROWS).sort());
  });

  for (const verb of verbsOf('by_id_master_checked')) {
    it(`${verb}: refused on the leg its door refuses on; admitted where its door admits`, async () => {
      const h = await boot();
      for (const [context, object, id, leg] of [
        [rep(), 'cbpm_contact', 'c_other', 'record_sharing'],
        [rep(), 'cbpm_region_note', 'rn_eu', 'row_level_security'],
        [viewer(), 'cbpm_contact', 'c_own', 'object_permission'],
        [rep(), 'cbpm_line', 'line_above_dangling', 'master_chain'],
      ] as const) {
        const refused = await h.write(verb, context, object, id);
        expect(refused, `${verb} ${object}/${id} by ${context.userId}`).not.toBe('admitted');
        expect(refused).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(String(refused.message)).toMatch(/requires edit access to its master record/);
        if (LEG_REASON[leg]) expect(String(refused.message)).toMatch(LEG_REASON[leg]);
        const d = await h.explainAs(verb, context, object, id);
        expect(d.record, `explain ${verb} ${object}/${id} by ${context.userId}`).toEqual({
          recordId: id,
          visible: false,
          decidedBy: 'sharing',
        });
        expect(sharingDetailOf(d)).toContain(`refuses this ${verb} on its '${leg}' leg`);
      }
      for (const [object, id] of [['cbpm_contact', 'c_own'], ['cbpm_contact', 'c_shared'], ['cbpm_region_note', 'rn_us'], ['cbpm_line', 'line_ok']] as const) {
        const d = await h.explainAs(verb, rep(), object, id);
        expect(d.record, `explain ${verb} ${object}/${id}`).toMatchObject({ recordId: id, visible: true });
        expect(sharingDetailOf(d)).not.toContain('master-detail write check');
        expect(await h.write(verb, rep(), object, id), `${verb} ${object}/${id}`).toBe('admitted');
      }
    });
  }

  for (const verb of verbsOf('object_gate_refused')) {
    it(`${verb}: the object gate refuses its door for every principal, and explain says the object gate decided`, async () => {
      const h = await boot();
      for (const [context, object, id] of [[rep(), 'cbpm_contact', 'c_own'], [rep(), 'cbpm_contact', 'c_other']] as const) {
        const refused = await h.write(verb, context, object, id);
        expect(refused, `${verb} ${object}/${id}`).not.toBe('admitted');
        expect(String(refused.message)).not.toMatch(/requires edit access to its master record/);
        const d = await h.explainAs(verb, context, object, id);
        expect(d.record, `explain ${verb} ${object}/${id}`).toEqual({ recordId: id, visible: false, decidedBy: 'object_crud' });
      }
    });
  }
});
