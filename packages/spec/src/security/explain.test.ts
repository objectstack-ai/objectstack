// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Contract lock for the public explain / access-matrix schemas (ADR-0090 D6).
 *
 * These schemas are the wire contract that downstream consumers depend on —
 * notably the ADR-0091 **L3** enterprise product (cloud `security-enterprise`:
 * recertification review UX, evidence export, break-glass attribution) reads
 * `ExplainDecision.layers[].contributors[]` and `AccessMatrixEntry` directly.
 *
 * `api-surface.json` already locks the export NAMES (a removed export fails the
 * lint gate); this file locks the FIELD SHAPE (a removed/renamed field, a
 * dropped enum member, or a changed default). Together they make explain a
 * stable contract cloud can consume without drift fear. Any break here is a
 * deliberate, reviewable protocol change — bump the protocol major with it.
 */

import { describe, it, expect } from 'vitest';
import {
  ExplainOperationSchema,
  ExplainLayerSchema,
  ExplainRequestSchema,
  ExplainDecisionSchema,
  AccessMatrixEntrySchema,
  AccessMatrixSchema,
  AuthzPostureSchema,
  ExplainMatchedRuleSchema,
  ExplainRecordAttributionSchema,
} from './explain.zod';

describe('ExplainOperationSchema — the operation vocabulary is fixed', () => {
  it('accepts exactly the seven CRUD + lifecycle operations', () => {
    for (const op of ['read', 'create', 'update', 'delete', 'transfer', 'restore', 'purge']) {
      expect(ExplainOperationSchema.parse(op)).toBe(op);
    }
  });
  it('rejects an unknown operation', () => {
    expect(() => ExplainOperationSchema.parse('list')).toThrow();
  });
});

describe('ExplainLayerSchema — the ten-layer pipeline + contributor shape', () => {
  const LAYERS = [
    // [ADR-0095 D1] Layer 0 — the always-first tenant wall, ahead of principal.
    'tenant_isolation',
    'principal', 'required_permissions', 'object_crud', 'fls',
    'owd_baseline', 'depth', 'sharing', 'vama_bypass', 'rls',
  ];
  it('locks the ten layer ids, including the ADR-0095 tenant_isolation Layer 0', () => {
    for (const layer of LAYERS) {
      expect(ExplainLayerSchema.parse({ layer, verdict: 'neutral', detail: 'x' }).layer).toBe(layer);
    }
    // A near-miss ('tenant') is still rejected — only the full id is a member.
    expect(() => ExplainLayerSchema.parse({ layer: 'tenant', verdict: 'neutral', detail: 'x' })).toThrow();
  });

  it('locks the six verdicts', () => {
    for (const verdict of ['grants', 'denies', 'narrows', 'widens', 'neutral', 'not_applicable']) {
      expect(ExplainLayerSchema.parse({ layer: 'rls', verdict, detail: 'x' }).verdict).toBe(verdict);
    }
    expect(() => ExplainLayerSchema.parse({ layer: 'rls', verdict: 'allows', detail: 'x' })).toThrow();
  });

  it('contributors default to [] and carry kind / name / via / state', () => {
    const bare = ExplainLayerSchema.parse({ layer: 'principal', verdict: 'neutral', detail: 'x' });
    expect(bare.contributors).toEqual([]);

    const full = ExplainLayerSchema.parse({
      layer: 'principal',
      verdict: 'neutral',
      detail: 'x',
      contributors: [
        { kind: 'position', name: 'approver', via: 'delegation from u_boss until 2026-08-01', state: 'active' },
        { kind: 'permission_set', name: 'approve_set', via: 'position:approver' },
        { kind: 'position', name: 'payroll_approver', via: 'held until 2026-07-01 — expired', state: 'expired' },
        { kind: 'system', name: 'platform_admin' },
      ],
    });
    expect(full.contributors.map((c) => c.kind)).toEqual(['position', 'permission_set', 'position', 'system']);
    // [ADR-0091 D2] the lifecycle state member L3 reads for the "expired" report
    expect(full.contributors[2].state).toBe('expired');
    expect(full.contributors[1].state).toBeUndefined();
  });

  it('rejects an unknown contributor kind or lifecycle state', () => {
    expect(() => ExplainLayerSchema.parse({
      layer: 'principal', verdict: 'neutral', detail: 'x',
      contributors: [{ kind: 'role', name: 'x' }],
    })).toThrow();
    expect(() => ExplainLayerSchema.parse({
      layer: 'principal', verdict: 'neutral', detail: 'x',
      contributors: [{ kind: 'position', name: 'x', state: 'suspended' }],
    })).toThrow();
  });

  it('[C2] kernelTier + record are optional — object-level layers omit them', () => {
    const bare = ExplainLayerSchema.parse({ layer: 'sharing', verdict: 'not_applicable', detail: 'x' });
    expect(bare.kernelTier).toBeUndefined();
    expect(bare.record).toBeUndefined();
  });

  it('[ADR-0095 D1] kernelTier tags Layer 0 vs Layer 1; rejects other values', () => {
    expect(ExplainLayerSchema.parse({
      layer: 'tenant_isolation', verdict: 'narrows', detail: 'x', kernelTier: 'layer_0_tenant',
    }).kernelTier).toBe('layer_0_tenant');
    expect(ExplainLayerSchema.parse({
      layer: 'rls', verdict: 'narrows', detail: 'x', kernelTier: 'layer_1_business',
    }).kernelTier).toBe('layer_1_business');
    expect(() => ExplainLayerSchema.parse({
      layer: 'rls', verdict: 'narrows', detail: 'x', kernelTier: 'layer_2',
    })).toThrow();
  });

  it('[C2] a record-grained layer carries per-record attribution', () => {
    const layer = ExplainLayerSchema.parse({
      layer: 'sharing', verdict: 'widens', detail: 'x', kernelTier: 'layer_1_business',
      record: {
        outcome: 'admitted',
        rowFilter: { owner: 'u2' },
        matchesRecord: true,
        rules: [
          { kind: 'record_share', name: 'share_row_42', grants: 'read', via: 'group:sales_team', effect: 'admits' },
          { kind: 'ownership', name: 'owner-check', via: 'owner', effect: 'neutral' },
        ],
        detail: 'admitted: an explicit share targets this row',
      },
    });
    expect(layer.record?.outcome).toBe('admitted');
    expect(layer.record?.matchesRecord).toBe(true);
    expect(layer.record?.rules.map((r) => r.kind)).toEqual(['record_share', 'ownership']);
    expect(layer.record?.rules[0].grants).toBe('read');
  });
});

describe('[ADR-0095 D2] AuthzPostureSchema — the monotonic posture ladder', () => {
  it('locks the four rungs', () => {
    for (const rung of ['PLATFORM_ADMIN', 'TENANT_ADMIN', 'MEMBER', 'EXTERNAL']) {
      expect(AuthzPostureSchema.parse(rung)).toBe(rung);
    }
    expect(() => AuthzPostureSchema.parse('SUPERUSER')).toThrow();
  });
});

describe('[C2] ExplainMatchedRule / ExplainRecordAttribution — row-level attribution', () => {
  it('matched rule locks its kinds, effect, and optional grants/via/predicate', () => {
    for (const kind of ['tenant_filter', 'owd_baseline', 'ownership', 'record_share', 'sharing_rule', 'team', 'territory', 'rls_policy']) {
      expect(ExplainMatchedRuleSchema.parse({ kind, name: 'r', effect: 'admits' }).kind).toBe(kind);
    }
    expect(() => ExplainMatchedRuleSchema.parse({ kind: 'guess', name: 'r', effect: 'admits' })).toThrow();
    expect(() => ExplainMatchedRuleSchema.parse({ kind: 'ownership', name: 'r', effect: 'maybe' })).toThrow();
    const full = ExplainMatchedRuleSchema.parse({
      kind: 'sharing_rule', name: 'open_leads_to_sales', grants: 'edit',
      via: 'criteria: status == open', predicate: { status: 'open' }, effect: 'admits',
    });
    expect(full.grants).toBe('edit');
    expect(full.predicate).toEqual({ status: 'open' });
  });

  it('record attribution defaults rules to [] and locks outcome', () => {
    const bare = ExplainRecordAttributionSchema.parse({ outcome: 'excluded' });
    expect(bare.rules).toEqual([]);
    expect(bare.matchesRecord).toBeUndefined();
    expect(() => ExplainRecordAttributionSchema.parse({ outcome: 'hidden' })).toThrow();
  });
});

describe('ExplainRequestSchema — the request contract', () => {
  it('requires object + operation; userId optional', () => {
    expect(ExplainRequestSchema.parse({ object: 'leave_request', operation: 'read' })).toMatchObject({
      object: 'leave_request', operation: 'read',
    });
    expect(ExplainRequestSchema.parse({ object: 'x', operation: 'update', userId: 'u2' }).userId).toBe('u2');
    expect(() => ExplainRequestSchema.parse({ operation: 'read' })).toThrow();
  });

  it('[C2] recordId is optional and round-trips; object-level requests stay backward-compatible', () => {
    // Backward compat: the pre-C2 object-level request still parses, recordId absent.
    const objectLevel = ExplainRequestSchema.parse({ object: 'leave_request', operation: 'read' });
    expect(objectLevel.recordId).toBeUndefined();
    // Record-grained request round-trips the recordId.
    const recordLevel = ExplainRequestSchema.parse({ object: 'leave_request', operation: 'update', recordId: 'lr_42' });
    expect(recordLevel.recordId).toBe('lr_42');
  });
});

describe('ExplainDecisionSchema — the full decision report L3 consumes', () => {
  it('round-trips a representative decision with every field L3 reads', () => {
    const decision = {
      allowed: true,
      object: 'leave_request',
      operation: 'read',
      principal: {
        userId: 'u2',
        positions: ['approver', 'everyone'],
        permissionSets: ['approve_set', 'member_default'],
        principalKind: 'human',
        onBehalfOf: { userId: 'u9' },
      },
      layers: [
        {
          layer: 'principal', verdict: 'neutral', detail: '…',
          contributors: [{ kind: 'position', name: 'approver', via: 'delegation from u_boss until 2026-08-01', state: 'active' }],
        },
        { layer: 'rls', verdict: 'narrows', detail: '…', contributors: [] },
      ],
      readFilter: { owner: 'u2' },
    };
    const parsed = ExplainDecisionSchema.parse(decision);
    expect(parsed.allowed).toBe(true);
    expect(parsed.principal.userId).toBe('u2');
    expect(parsed.principal.positions).toContain('approver');
    expect(parsed.principal.permissionSets).toContain('approve_set');
    expect(parsed.principal.principalKind).toBe('human');
    expect(parsed.principal.onBehalfOf).toEqual({ userId: 'u9' });
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.readFilter).toEqual({ owner: 'u2' });
  });

  it('[C2] round-trips a record-grained decision with posture + per-record trace', () => {
    const decision = {
      allowed: false,
      object: 'leave_request',
      operation: 'update',
      principal: {
        userId: 'u2',
        positions: ['approver', 'everyone'],
        permissionSets: ['approve_set', 'member_default'],
        principalKind: 'human',
        posture: 'MEMBER',
      },
      layers: [
        {
          layer: 'tenant_isolation', verdict: 'narrows', detail: '…', kernelTier: 'layer_0_tenant',
          record: { outcome: 'admitted', matchesRecord: true, rules: [{ kind: 'tenant_filter', name: 'org_wall', effect: 'admits' }] },
        },
        {
          layer: 'sharing', verdict: 'not_applicable', detail: '…', kernelTier: 'layer_1_business',
          record: {
            outcome: 'excluded',
            rowFilter: { owner: 'u2' },
            matchesRecord: false,
            rules: [{ kind: 'ownership', name: 'owner-check', via: 'owner', effect: 'excludes' }],
            detail: 'excluded: you are not the owner and no share targets this row',
          },
        },
      ],
      record: { recordId: 'lr_42', visible: false, decidedBy: 'sharing' },
    };
    const parsed = ExplainDecisionSchema.parse(decision);
    expect(parsed.principal.posture).toBe('MEMBER');
    expect(parsed.record?.recordId).toBe('lr_42');
    expect(parsed.record?.visible).toBe(false);
    expect(parsed.record?.decidedBy).toBe('sharing');
    expect(parsed.layers[0].kernelTier).toBe('layer_0_tenant');
    expect(parsed.layers[1].record?.outcome).toBe('excluded');
  });

  it('[C2] object-level decisions omit record + posture (backward-compatible)', () => {
    const parsed = ExplainDecisionSchema.parse({
      allowed: true, object: 'x', operation: 'read',
      principal: { userId: 'u2' },
      layers: [{ layer: 'rls', verdict: 'narrows', detail: 'x', contributors: [] }],
      readFilter: { owner: 'u2' },
    });
    expect(parsed.record).toBeUndefined();
    expect(parsed.principal.posture).toBeUndefined();
  });

  it('[ADR-0095] rejects an unknown posture or decidedBy layer', () => {
    expect(() => ExplainDecisionSchema.parse({
      allowed: true, object: 'x', operation: 'read',
      principal: { userId: 'u', posture: 'GOD_MODE' }, layers: [],
    })).toThrow();
    expect(() => ExplainDecisionSchema.parse({
      allowed: true, object: 'x', operation: 'read',
      principal: { userId: 'u' }, layers: [],
      record: { recordId: 'r1', visible: true, decidedBy: 'quantum' },
    })).toThrow();
  });

  it('principal.userId is nullable (anonymous), positions/permissionSets default to []', () => {
    const parsed = ExplainDecisionSchema.parse({
      allowed: false, object: 'x', operation: 'read',
      principal: { userId: null },
      layers: [],
    });
    expect(parsed.principal.userId).toBeNull();
    expect(parsed.principal.positions).toEqual([]);
    expect(parsed.principal.permissionSets).toEqual([]);
  });

  it('rejects an unknown principalKind', () => {
    expect(() => ExplainDecisionSchema.parse({
      allowed: true, object: 'x', operation: 'read',
      principal: { userId: 'u', principalKind: 'robot' }, layers: [],
    })).toThrow();
  });
});

describe('AccessMatrix schemas — the authoring-time companion', () => {
  it('AccessMatrixEntry locks the crud bits + super-user bypass + scopes + sharingModel', () => {
    const entry = AccessMatrixEntrySchema.parse({
      permissionSet: 'crm_admin', object: 'crm_lead',
      create: true, read: true, edit: true, delete: false,
      viewAllRecords: true, modifyAllRecords: false,
      readScope: 'unit_and_below', writeScope: 'own', sharingModel: 'private',
    });
    expect(entry).toMatchObject({
      permissionSet: 'crm_admin', object: 'crm_lead',
      create: true, read: true, edit: true, delete: false,
      viewAllRecords: true, modifyAllRecords: false,
      readScope: 'unit_and_below', writeScope: 'own', sharingModel: 'private',
    });
  });

  it('the crud + bypass bits are REQUIRED (a missing bit is a contract break)', () => {
    expect(() => AccessMatrixEntrySchema.parse({
      permissionSet: 'x', object: 'y', create: true, read: true, edit: true, delete: true,
      viewAllRecords: true, /* modifyAllRecords missing */
    })).toThrow();
  });

  it('AccessMatrix defaults version=1 and entries=[]', () => {
    expect(AccessMatrixSchema.parse({})).toEqual({ version: 1, entries: [] });
    expect(() => AccessMatrixSchema.parse({ version: 2 })).toThrow();
  });
});
