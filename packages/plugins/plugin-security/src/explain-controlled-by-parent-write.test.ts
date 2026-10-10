// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055] `security/explain`'s record-grained verdict for every by-id WRITE
// of a `controlled_by_parent` record (an update, a delete, a transfer) comes
// from the master-detail write check
// (`ISecurityService.checkControlledByParentWrite`), the composition step 2.8
// of the write path runs on each of them, and every outcome maps the way the
// door maps it.
//
// The per-record sharing gates (`canEditRecord`, `canDeleteRecord`) cannot
// decide such a write: plugin-sharing maps `controlled_by_parent` to `public`,
// so they abstain, and an abstention reads as `true`. This file pins the
// engine's half — which outcome refuses, what the report names, which verbs
// ask the check and with which context — over a deps bag, so each cell isolates
// one outcome. The served member's own parity with each by-id write is pinned in
// `controlled-by-parent-write-member.test.ts`, and the whole REST answer beside
// the REST door of each verb in
// `packages/qa/dogfood/test/cbp-explain-master-write.dogfood.test.ts`.
//
// The mapping (the spec's own consumer rule): `allow` and `not_applicable`
// proceed, so the report is exactly the one a deps bag without the check
// gives; `deny` and `unresolvable` refuse, on the `sharing` layer (the
// record's write gate), naming the leg or the reason; a rejection fails the
// request, so it is reported fail-closed; an outcome outside the vocabulary
// refuses too.
import { describe, it, expect, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ExplainOperationSchema, type ExplainDecision, type ExplainOperation } from '@objectstack/spec/security';
import type {
  ControlledByParentWriteDenialLeg,
  ControlledByParentWriteOutcome,
  ControlledByParentWriteUnresolvedReason,
} from '@objectstack/spec/contracts';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccess, type ExplainEngineDeps } from './explain-engine.js';

const OBJECT = 'cbx_contract';
const CBP_SCHEMA = { name: OBJECT, sharingModel: 'controlled_by_parent' };

const EDITOR = PermissionSetSchema.parse({
  name: 'cbx_editor',
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true } },
});

/** The principal being EXPLAINED. Kept as one object so a cell can assert the check received this very context. */
const EXPLAINED = { userId: 'u_member', tenantId: 'org1', positions: ['org_member'], permissions: ['cbx_editor'] };
const RECORD = { id: 'r1', organization_id: 'org1', owner_id: 'u_somebody' };

type Master = ExplainEngineDeps['checkControlledByParentWrite'];

function deps(opts: {
  schema?: Record<string, unknown>;
  master?: Master;
  canEdit?: boolean;
  record?: Record<string, unknown> | null;
  layer1?: Record<string, unknown> | null;
} = {}): ExplainEngineDeps {
  return {
    ql: { getSchema: () => opts.schema ?? CBP_SCHEMA },
    resolveSets: async () => [EDITOR],
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
    baselinePermissionSets: ['member_default'],
    computeLayeredRlsFilter: async () => ({ layer0: { organization_id: 'org1' }, layer1: opts.layer1 ?? null }),
    fetchRecord: async () => (opts.record !== undefined ? opts.record : { ...RECORD }),
    sharingReadFilter: async () => null,
    listRecordShares: async () => [],
    // plugin-sharing on a `controlled_by_parent` record: it abstains, and the abstention reads as `true`.
    canEditRecord: async () => opts.canEdit ?? true,
    canDeleteRecord: async () => opts.canEdit ?? true,
    ...(opts.master ? { checkControlledByParentWrite: opts.master } : {}),
  };
}

const answering = (outcome: ControlledByParentWriteOutcome): Master => vi.fn(async () => outcome);

/** `null` asks the object-level question (no `recordId`). */
const explainAs = (d: ExplainEngineDeps, operation: ExplainOperation, recordId: string | null = 'r1') =>
  explainAccess(d, { object: OBJECT, operation, context: EXPLAINED, ...(recordId !== null ? { recordId } : {}) });

/**
 * Every operation `explain` answers, classified against step 2.8 of the write
 * path. The classification is total: a verb added to the explain vocabulary
 * without a row here fails the completeness case below.
 *
 *  - `master_checked`: a by-id write step 2.8 runs the master-detail write
 *    check on, which the EXPLAINED principal's grants let through the object
 *    gate (`EDITOR` holds update, delete and transfer), so the check decides
 *    the record.
 *  - `master_checked_object_gate_first`: a by-id write step 2.8 lists, which
 *    the object gate refuses for every principal (the restore and purge grants
 *    are retired until the lifecycle batch returns them). The check is still
 *    asked, so the report stays the door's on the day the verb is grantable,
 *    and the object-level CRUD layer decides first.
 *  - `not_asked`: a read (the check guards writes), and `create`, whose master
 *    comes from the request body an explanation does not carry.
 */
const VERB_CLASS: Record<ExplainOperation, 'master_checked' | 'master_checked_object_gate_first' | 'not_asked'> = {
  update: 'master_checked',
  delete: 'master_checked',
  transfer: 'master_checked',
  restore: 'master_checked_object_gate_first',
  purge: 'master_checked_object_gate_first',
  read: 'not_asked',
  export: 'not_asked',
  create: 'not_asked',
};
const MASTER_CHECKED = (Object.keys(VERB_CLASS) as ExplainOperation[]).filter((v) => VERB_CLASS[v] === 'master_checked');

const sharingRecordOf = (d: ExplainDecision) => d.layers.find((l) => l.layer === 'sharing')?.record;

const LEGS: ControlledByParentWriteDenialLeg[] = ['object_permission', 'row_level_security', 'record_sharing', 'master_chain'];
const REASONS: Array<[ControlledByParentWriteUnresolvedReason, string]> = [
  ['master_detail_relation_missing', '422 INVALID_METADATA'],
  ['record_not_found', '404 RECORD_NOT_FOUND'],
  ['master_reference_missing', '422 MISSING_REQUIRED_FIELD'],
];

describe('[ADR-0055] explain refuses a by-id write the master-detail write check refuses, for every verb it decides', () => {
  for (const verb of MASTER_CHECKED) {
    for (const leg of LEGS) {
      it(`${verb}, deny on '${leg}': the record is not writable, decided by the sharing layer, which names the leg`, async () => {
        const d = await explainAs(deps({ master: answering({ outcome: 'deny', leg }) }), verb);
        expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
        const sharing = sharingRecordOf(d);
        expect(sharing?.outcome).toBe('excluded');
        expect(sharing?.detail).toContain(`the by-id ${verb} runs refuses this ${verb} on its '${leg}' leg`);
        expect(sharing?.detail).toContain(`The ${verb} answers 403 PERMISSION_DENIED`);
      });
    }

    for (const [reason, answered] of REASONS) {
      it(`${verb}, unresolvable '${reason}': not writable (fail closed), the sharing layer names the reason and the ${verb}'s answer`, async () => {
        const d = await explainAs(deps({ master: answering({ outcome: 'unresolvable', reason }) }), verb);
        expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
        const sharing = sharingRecordOf(d);
        expect(sharing?.outcome).toBe('not_evaluated');
        expect(sharing?.detail).toContain(`reaches no verdict ('${reason}')`);
        expect(sharing?.detail).toContain(`the ${verb} answers ${answered}`);
      });
    }

    it(`${verb}: a rejection (a refused context, a store fault) fails the request, so it is reported fail-closed with no predicate`, async () => {
      const fault = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
      const master: Master = vi.fn(async () => { throw fault; });
      const d = await explainAs(deps({ master }), verb);
      expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
      const sharing = sharingRecordOf(d);
      expect(sharing?.outcome).toBe('not_evaluated');
      expect(sharing?.rowFilter).toBeUndefined();
      expect(sharing?.matchesRecord).toBeUndefined();
      expect(sharing?.detail).toContain('master-detail write check (controlled_by_parent, ADR-0055) could not be evaluated');
      expect(sharing?.detail).toContain(`the by-id ${verb} fails on the same call`);
    });

    it(`${verb}: an outcome outside the vocabulary refuses (fail closed), never reads as a pass`, async () => {
      const d = await explainAs(deps({ master: answering({ outcome: 'maybe' } as unknown as ControlledByParentWriteOutcome) }), verb);
      expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
      expect(sharingRecordOf(d)?.outcome).toBe('not_evaluated');
    });

    it(`${verb}: the record's own row-level security still decides first (step 2.7 runs above step 2.8)`, async () => {
      const d = await explainAs(deps({
        master: answering({ outcome: 'deny', leg: 'record_sharing' }),
        layer1: { id: 'not_this_record' },
      }), verb);
      expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'rls' });
    });
  }
});

describe('[ADR-0055] a proceeding outcome changes nothing in the report', () => {
  for (const verb of MASTER_CHECKED) {
    it(`${verb}, allow: the report is exactly the one a deps bag without the check gives — the master is not named`, async () => {
      const without = await explainAs(deps(), verb);
      const withAllow = await explainAs(deps({ master: answering({ outcome: 'allow' }) }), verb);
      expect(withAllow).toEqual(without);
      expect(withAllow.record).toMatchObject({ visible: true });
      expect(sharingRecordOf(withAllow)?.detail).not.toContain('master');
    });

    it(`${verb}, allow does not lift a refusal the rest of the pipeline makes (the sharing gate refuses)`, async () => {
      const without = await explainAs(deps({ canEdit: false }), verb);
      const withAllow = await explainAs(deps({ canEdit: false, master: answering({ outcome: 'allow' }) }), verb);
      expect(withAllow).toEqual(without);
      expect(withAllow.record).toMatchObject({ visible: false });
    });

    for (const [label, schema, canEdit] of [
      ['public_read_write', { name: OBJECT, sharingModel: 'public_read_write' }, true],
      ['private, the gate admits', { name: OBJECT, sharingModel: 'private' }, true],
      ['private, the gate refuses', { name: OBJECT, sharingModel: 'private' }, false],
    ] as const) {
      it(`${verb}, not_applicable on a ${label} object: byte-identical to the report without the check`, async () => {
        const without = await explainAs(deps({ schema, canEdit }), verb);
        const withCheck = await explainAs(deps({ schema, canEdit, master: answering({ outcome: 'not_applicable' }) }), verb);
        expect(withCheck).toEqual(without);
      });
    }
  }

  it('absent check (a kernel without the member): each write keeps the sharing gate\'s answer and claims nothing about a master', async () => {
    for (const verb of MASTER_CHECKED) {
      const d = await explainAs(deps(), verb);
      expect(d.record, verb).toMatchObject({ recordId: 'r1', visible: true });
      expect(sharingRecordOf(d)?.detail, verb).not.toContain('master');
    }
  });
});

describe('[ADR-0055] which verbs ask the check, and for whom', () => {
  it('the classification is total: every operation explain answers is classified against step 2.8', () => {
    // A verb added to the explain vocabulary lands here unclassified and turns
    // this red, so its parity with the door is decided rather than inherited.
    expect([...ExplainOperationSchema.options].sort()).toEqual(Object.keys(VERB_CLASS).sort());
  });

  for (const verb of MASTER_CHECKED) {
    it(`a ${verb} of a record that exists asks it once, for that record, with the EXPLAINED context`, async () => {
      const master = answering({ outcome: 'allow' });
      await explainAs(deps({ master }), verb);
      expect(master).toHaveBeenCalledTimes(1);
      expect(master).toHaveBeenCalledWith(OBJECT, 'r1', EXPLAINED);
      expect((master as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(EXPLAINED);
    });
  }

  for (const verb of (Object.keys(VERB_CLASS) as ExplainOperation[]).filter((v) => VERB_CLASS[v] === 'master_checked_object_gate_first')) {
    it(`a ${verb} asks it too, and the object gate, which refuses ${verb} to every principal, decides first`, async () => {
      const master = answering({ outcome: 'deny', leg: 'object_permission' });
      const d = await explainAs(deps({ master }), verb);
      expect(master).toHaveBeenCalledTimes(1);
      expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'object_crud' });
      expect(sharingRecordOf(d)?.detail).toContain(`refuses this ${verb} on its 'object_permission' leg`);
    });
  }

  for (const verb of (Object.keys(VERB_CLASS) as ExplainOperation[]).filter((v) => VERB_CLASS[v] === 'not_asked')) {
    it(`a record-grained ${verb} does not ask it`, async () => {
      const master = answering({ outcome: 'deny', leg: 'object_permission' });
      await explainAs(deps({ master }), verb);
      expect(master).not.toHaveBeenCalled();
    });
  }

  it('an object-level write (no recordId) does not ask it, and a record that does not exist is not asked about', async () => {
    const master = answering({ outcome: 'deny', leg: 'object_permission' });
    for (const verb of MASTER_CHECKED) {
      const objectLevel = await explainAs(deps({ master }), verb, null);
      expect(objectLevel.record, verb).toBeUndefined();
      const missing = await explainAs(deps({ master, record: null }), verb, 'r_missing');
      expect(missing.record, verb).toEqual({ recordId: 'r_missing', visible: false });
    }
    expect(master).not.toHaveBeenCalled();
  });
});
