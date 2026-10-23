// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [Ruling of record 6355206139, letter B] What explain says about an EXTERNAL
 * principal: the baseline it resolves is named `external_default` (never the
 * configured member baseline), and the OWD it meets is owner_only unless a held
 * grant's RLS speaks for the object — the same answer the middleware stamps for
 * plugin-sharing. A member is the control on every assertion.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator';
import { explainAccess, type ExplainEngineDeps } from './explain-engine';

const EXTERNAL_DEFAULT = PermissionSetSchema.parse({
  name: 'external_default',
  objects: { board: { allowRead: true, allowEdit: true } },
});
const MEMBER_DEFAULT = PermissionSetSchema.parse({
  name: 'member_default',
  objects: { board: { allowRead: true, allowEdit: true } },
});

const BOARD = { name: 'board', sharingModel: 'public_read_write' };

function makeDeps(sets: any[], grantSpeaks: boolean): ExplainEngineDeps {
  return {
    ql: { getSchema: () => BOARD },
    resolveSets: async () => sets,
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
    externalGrantSpeaks: () => grantSpeaks,
  };
}

const EXTERNAL = { userId: 'x1', tenantId: 'org-1', positions: ['org_external'], permissions: [], audience: 'external', posture: 'EXTERNAL' };
const MEMBER = { userId: 'u1', tenantId: 'org-1', positions: ['org_member', 'everyone'], permissions: [], posture: 'MEMBER' };

const layer = (d: any, name: string) => d.layers.find((l: any) => l.layer === name);

describe('explain — the external baseline is named', () => {
  it('an external’s baseline is attributed as external_default, not the member baseline', async () => {
    const d = await explainAccess(makeDeps([EXTERNAL_DEFAULT], false), { object: 'board', operation: 'read', context: EXTERNAL });
    expect(layer(d, 'principal')?.contributors).toContainEqual({ kind: 'permission_set', name: 'external_default', via: 'external baseline (org_external)' });
  });

  it('CONTROL: a member’s baseline is the additive baseline', async () => {
    const d = await explainAccess(makeDeps([MEMBER_DEFAULT], false), { object: 'board', operation: 'read', context: MEMBER });
    expect(layer(d, 'principal')?.contributors).toContainEqual({ kind: 'permission_set', name: 'member_default', via: 'additive baseline (ADR-0090 D5)' });
  });
});

describe('explain — the OWD an external meets', () => {
  for (const operation of ['read', 'update'] as const) {
    it(`${operation}: public_read_write reads as owner_only for an external with no grant speaking`, async () => {
      const d = await explainAccess(makeDeps([EXTERNAL_DEFAULT], false), { object: 'board', operation, context: EXTERNAL });
      const owd = layer(d, 'owd_baseline');
      expect(owd?.verdict).toBe('narrows');
      expect(owd?.detail).toContain('owner_only for an external principal');
    });
  }

  it('a held grant’s RLS speaking lifts the floor: the object’s own model stands', async () => {
    const d = await explainAccess(makeDeps([EXTERNAL_DEFAULT], true), { object: 'board', operation: 'read', context: EXTERNAL });
    const owd = layer(d, 'owd_baseline');
    expect(owd?.verdict).toBe('neutral');
    expect(owd?.detail).not.toContain('owner_only');
  });

  it('CONTROL: a member meets the object’s own model, grant or no grant', async () => {
    const d = await explainAccess(makeDeps([MEMBER_DEFAULT], false), { object: 'board', operation: 'read', context: MEMBER });
    expect(layer(d, 'owd_baseline')?.verdict).toBe('neutral');
  });
});
