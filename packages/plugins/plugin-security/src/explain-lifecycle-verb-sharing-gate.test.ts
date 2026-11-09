// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30237 PR 4] `security/explain` picks the record's sharing write gate by the
// write CLASS of the explained verb (`rlsOperationForVerb`), as the sharing
// middleware does: the permanent delete's by-id `purge` is explained against
// `canDeleteRecord`, never `canEditRecord`, so an edit share that the door
// refuses for a purge is not reported as admitting it.
import { describe, it, expect, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainOperation } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccess, type ExplainEngineDeps } from './explain-engine.js';

const OBJECT = 'lv_deal';
const SCHEMA = { name: OBJECT, sharingModel: 'private', fields: { id: { name: 'id' }, owner_id: { name: 'owner_id' } } };

/** Every grant the explained verbs need at the object gate, so the record layer decides. */
const BIN_ADMIN = PermissionSetSchema.parse({
  name: 'lv_bin_admin',
  objects: {
    [OBJECT]: { allowRead: true, allowEdit: true, allowDelete: true, manageRecycleBin: true },
  },
});

const EXPLAINED = { userId: 'u_member', tenantId: 'org1', positions: ['org_member'], permissions: ['lv_bin_admin'] };
const RECORD = { id: 'r1', organization_id: 'org1', owner_id: 'u_somebody' };

/** An edit share: the edit gate admits the row, the delete gate does not (ADR-0111 D3). */
function deps() {
  const canEditRecord = vi.fn(async () => true);
  const canDeleteRecord = vi.fn(async () => false);
  const d: ExplainEngineDeps = {
    ql: { getSchema: () => SCHEMA },
    resolveSets: async () => [BIN_ADMIN],
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
    tenancyPosture: 'single',
    computeLayeredRlsFilter: async () => ({ layer0: { organization_id: 'org1' }, layer1: null }),
    fetchRecord: async () => ({ ...RECORD }),
    sharingReadFilter: async () => null,
    listRecordShares: async () => [],
    canEditRecord,
    canDeleteRecord,
  } as ExplainEngineDeps;
  return { d, canEditRecord, canDeleteRecord };
}

const explain = (d: ExplainEngineDeps, operation: ExplainOperation) =>
  explainAccess(d, { object: OBJECT, operation, context: EXPLAINED, recordId: 'r1' });

describe('explain picks the sharing write gate by write class (#30237 PR 4)', () => {
  it.each([['purge'], ['delete']] as const)('%s asks canDeleteRecord, not canEditRecord, and reports the row not writable', async (operation) => {
    const { d, canEditRecord, canDeleteRecord } = deps();
    const decision = await explain(d, operation);
    expect(canDeleteRecord).toHaveBeenCalledTimes(1);
    expect(canEditRecord).not.toHaveBeenCalled();
    expect(decision.record?.visible).toBe(false);
  });

  it('update asks canEditRecord (control): the same edit share admits it', async () => {
    const { d, canEditRecord, canDeleteRecord } = deps();
    await explain(d, 'update');
    expect(canEditRecord).toHaveBeenCalledTimes(1);
    expect(canDeleteRecord).not.toHaveBeenCalled();
  });
});
