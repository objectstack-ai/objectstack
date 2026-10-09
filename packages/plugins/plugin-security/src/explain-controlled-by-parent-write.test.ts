// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0055] `security/explain`'s record-grained UPDATE verdict on a
// `controlled_by_parent` record comes from the master-detail write check
// (`ISecurityService.checkControlledByParentWrite`), the composition step 2.8
// of the write path runs, and every outcome maps the way the door maps it.
//
// The per-record sharing gate (`canEditRecord`) cannot decide such an update:
// plugin-sharing maps `controlled_by_parent` to `public`, so it abstains, and
// its abstention reads as `true`. This file pins the engine's half — which
// outcome refuses, what the report names, when the check is asked and with
// which context — over a deps bag, so each cell isolates one outcome. The
// served member's own parity with the PATCH is pinned in
// `controlled-by-parent-write-member.test.ts`, and the whole REST answer beside
// the REST PATCH in `packages/qa/dogfood/test/cbp-explain-master-write.dogfood.test.ts`.
//
// The mapping (the spec's own consumer rule): `allow` and `not_applicable`
// proceed, so the report is exactly the one a deps bag without the check
// gives; `deny` and `unresolvable` refuse, on the `sharing` layer (the
// record's write gate), naming the leg or the reason; a rejection fails the
// request, so it is reported fail-closed; an outcome outside the vocabulary
// refuses too.
import { describe, it, expect, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
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
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
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
const explainUpdate = (d: ExplainEngineDeps, recordId: string | null = 'r1') =>
  explainAccess(d, { object: OBJECT, operation: 'update', context: EXPLAINED, ...(recordId !== null ? { recordId } : {}) });

const sharingRecordOf = (d: ExplainDecision) => d.layers.find((l) => l.layer === 'sharing')?.record;

const LEGS: ControlledByParentWriteDenialLeg[] = ['object_permission', 'row_level_security', 'record_sharing', 'master_chain'];
const REASONS: Array<[ControlledByParentWriteUnresolvedReason, string]> = [
  ['master_detail_relation_missing', '422 INVALID_METADATA'],
  ['record_not_found', '404 RECORD_NOT_FOUND'],
  ['master_reference_missing', '422 MISSING_REQUIRED_FIELD'],
];

describe('[ADR-0055] explain refuses an update the master-detail write check refuses', () => {
  for (const leg of LEGS) {
    it(`deny on '${leg}': the record is not writable, decided by the sharing layer, which names the leg`, async () => {
      const d = await explainUpdate(deps({ master: answering({ outcome: 'deny', leg }) }));
      expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
      const sharing = sharingRecordOf(d);
      expect(sharing?.outcome).toBe('excluded');
      expect(sharing?.detail).toContain(`refuses this update on its '${leg}' leg`);
      expect(sharing?.detail).toContain('403 PERMISSION_DENIED');
    });
  }

  for (const [reason, answered] of REASONS) {
    it(`unresolvable '${reason}': not writable (fail closed), the sharing layer names the reason and the update's answer`, async () => {
      const d = await explainUpdate(deps({ master: answering({ outcome: 'unresolvable', reason }) }));
      expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
      const sharing = sharingRecordOf(d);
      expect(sharing?.outcome).toBe('not_evaluated');
      expect(sharing?.detail).toContain(`reaches no verdict ('${reason}')`);
      expect(sharing?.detail).toContain(answered);
    });
  }

  it('a rejection (a refused context, a store fault) fails the request, so it is reported fail-closed with no predicate', async () => {
    const fault = Object.assign(new Error('datasource unavailable'), { code: 'ERR_DATASOURCE_UNAVAILABLE', status: 503 });
    const master: Master = vi.fn(async () => { throw fault; });
    const d = await explainUpdate(deps({ master }));
    expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
    const sharing = sharingRecordOf(d);
    expect(sharing?.outcome).toBe('not_evaluated');
    expect(sharing?.rowFilter).toBeUndefined();
    expect(sharing?.matchesRecord).toBeUndefined();
    expect(sharing?.detail).toContain('master-detail write check (controlled_by_parent, ADR-0055) could not be evaluated');
  });

  it('an outcome outside the vocabulary refuses (fail closed), never reads as a pass', async () => {
    const d = await explainUpdate(deps({ master: answering({ outcome: 'maybe' } as unknown as ControlledByParentWriteOutcome) }));
    expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'sharing' });
    expect(sharingRecordOf(d)?.outcome).toBe('not_evaluated');
  });

  it("the record's own row-level security still decides first (step 2.7 runs above step 2.8)", async () => {
    const d = await explainUpdate(deps({
      master: answering({ outcome: 'deny', leg: 'record_sharing' }),
      layer1: { id: 'not_this_record' },
    }));
    expect(d.record).toEqual({ recordId: 'r1', visible: false, decidedBy: 'rls' });
  });
});

describe('[ADR-0055] a proceeding outcome changes nothing in the report', () => {
  it('allow: the report is exactly the one a deps bag without the check gives — the master is not named', async () => {
    const without = await explainUpdate(deps());
    const withAllow = await explainUpdate(deps({ master: answering({ outcome: 'allow' }) }));
    expect(withAllow).toEqual(without);
    expect(withAllow.record).toMatchObject({ visible: true });
    expect(sharingRecordOf(withAllow)?.detail).not.toContain('master');
  });

  it('allow does not lift a refusal the rest of the pipeline makes (the sharing gate refuses)', async () => {
    const without = await explainUpdate(deps({ canEdit: false }));
    const withAllow = await explainUpdate(deps({ canEdit: false, master: answering({ outcome: 'allow' }) }));
    expect(withAllow).toEqual(without);
    expect(withAllow.record).toMatchObject({ visible: false });
  });

  for (const [label, schema, canEdit] of [
    ['public_read_write', { name: OBJECT, sharingModel: 'public_read_write' }, true],
    ['private, the gate admits', { name: OBJECT, sharingModel: 'private' }, true],
    ['private, the gate refuses', { name: OBJECT, sharingModel: 'private' }, false],
  ] as const) {
    it(`not_applicable on a ${label} object: byte-identical to the report without the check`, async () => {
      const without = await explainUpdate(deps({ schema, canEdit }));
      const withCheck = await explainUpdate(deps({ schema, canEdit, master: answering({ outcome: 'not_applicable' }) }));
      expect(withCheck).toEqual(without);
    });
  }

  it('absent check (a kernel without the member): the update keeps the sharing gate\'s answer and claims nothing about a master', async () => {
    const d = await explainUpdate(deps());
    expect(d.record).toMatchObject({ recordId: 'r1', visible: true });
    expect(sharingRecordOf(d)?.detail).not.toContain('master');
  });
});

describe('[ADR-0055] when the check is asked, and for whom', () => {
  it('an update of a record that exists asks it once, for that record, with the EXPLAINED context', async () => {
    const master = answering({ outcome: 'allow' });
    await explainUpdate(deps({ master }));
    expect(master).toHaveBeenCalledTimes(1);
    expect(master).toHaveBeenCalledWith(OBJECT, 'r1', EXPLAINED);
    expect((master as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(EXPLAINED);
  });

  for (const operation of ['read', 'create', 'delete', 'transfer', 'export'] as ExplainOperation[]) {
    it(`a record-grained ${operation} does not ask it`, async () => {
      const master = answering({ outcome: 'deny', leg: 'object_permission' });
      await explainAccess(deps({ master }), { object: OBJECT, operation, context: EXPLAINED, recordId: 'r1' });
      expect(master).not.toHaveBeenCalled();
    });
  }

  it('an object-level update (no recordId) does not ask it, and a record that does not exist is not asked about', async () => {
    const master = answering({ outcome: 'deny', leg: 'object_permission' });
    const objectLevel = await explainUpdate(deps({ master }), null);
    expect(objectLevel.record).toBeUndefined();
    const missing = await explainUpdate(deps({ master, record: null }), 'r_missing');
    expect(missing.record).toEqual({ recordId: 'r_missing', visible: false });
    expect(master).not.toHaveBeenCalled();
  });
});
