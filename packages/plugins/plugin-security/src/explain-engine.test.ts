// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D6 — explain engine: layer verdicts, attribution, machine artifact.

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator';
import { explainAccess, buildContextForUser, type ExplainEngineDeps } from './explain-engine';

const SALES_USER = PermissionSetSchema.parse({
  name: 'sales_user',
  objects: { leave_request: { allowRead: true, allowCreate: true, readScope: 'unit' } },
});
const ADMIN = PermissionSetSchema.parse({
  name: 'admin_full_access',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
  systemPermissions: ['manage_users'],
});

const PRIVATE_SCHEMA = { name: 'leave_request', sharingModel: 'private' };

function makeDeps(overrides: Partial<ExplainEngineDeps> & { sets?: any[]; schema?: any; rls?: any } = {}): ExplainEngineDeps {
  const evaluator = new PermissionEvaluator();
  return {
    ql: { getSchema: () => overrides.schema ?? PRIVATE_SCHEMA },
    resolveSets: async () => overrides.sets ?? [SALES_USER],
    evaluator,
    getObjectSecurityMeta: async () => ({
      isPrivate: false,
      requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
      fieldRequiredPermissions: {},
    }),
    requiredCaps: (meta: any, op: string) => {
      const bucket = op === 'find' ? 'read' : op === 'insert' ? 'create' : op;
      return [...(meta.all ?? []), ...((meta as any)[bucket] ?? [])];
    },
    computeRlsFilter: async () => overrides.rls !== undefined ? overrides.rls : null,
    getFieldMask: () => ({}),
    fallbackPermissionSet: 'member_default',
    ...overrides,
  };
}

const CTX = { userId: 'u1', positions: ['sales_rep', 'everyone'], permissions: [] };

describe('explainAccess (ADR-0090 D6)', () => {
  it('allows a granted read and attributes the granting set', async () => {
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'read', context: CTX });
    expect(d.allowed).toBe(true);
    expect(d.principal).toMatchObject({ userId: 'u1', positions: ['sales_rep', 'everyone'], permissionSets: ['sales_user'] });
    const crud = d.layers.find((l) => l.layer === 'object_crud')!;
    expect(crud.verdict).toBe('grants');
    expect(crud.contributors).toEqual([{ kind: 'permission_set', name: 'sales_user', via: 'resolved' }]);
    // read decisions carry the composed machine artifact
    expect('readFilter' in d).toBe(true);
  });

  it('reports the full pipeline in order', async () => {
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'read', context: CTX });
    expect(d.layers.map((l) => l.layer)).toEqual([
      'principal', 'required_permissions', 'object_crud', 'fls',
      'owd_baseline', 'depth', 'sharing', 'vama_bypass', 'rls',
    ]);
  });

  it('denies an ungranted operation and explains which layer denied', async () => {
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'delete', context: CTX });
    expect(d.allowed).toBe(false);
    expect(d.layers.find((l) => l.layer === 'object_crud')!.verdict).toBe('denies');
  });

  it('surfaces the required_permissions AND-gate as the denying layer', async () => {
    const deps = makeDeps({
      getObjectSecurityMeta: async () => ({
        isPrivate: false,
        requiredPermissions: { all: ['manage_metadata'], read: [], create: [], update: [], delete: [] },
        fieldRequiredPermissions: {},
      }),
    });
    const d = await explainAccess(deps, { object: 'leave_request', operation: 'read', context: CTX });
    expect(d.allowed).toBe(false);
    const gate = d.layers.find((l) => l.layer === 'required_permissions')!;
    expect(gate.verdict).toBe('denies');
    expect(gate.detail).toContain('manage_metadata');
  });

  it('explains the leave_request incident shape: unset OWD reads as fail-closed private', async () => {
    const d = await explainAccess(
      makeDeps({ schema: { name: 'leave_request' } }), // no sharingModel declared
      { object: 'leave_request', operation: 'read', context: CTX },
    );
    const owd = d.layers.find((l) => l.layer === 'owd_baseline')!;
    expect(owd.verdict).toBe('narrows');
    expect(owd.detail).toContain('ADR-0090 D1');
  });

  it('reports VAMA bypass and org depth for an admin', async () => {
    const d = await explainAccess(makeDeps({ sets: [ADMIN] }), { object: 'leave_request', operation: 'read', context: { userId: 'admin', positions: ['platform_admin', 'everyone'], permissions: [] } });
    expect(d.allowed).toBe(true);
    expect(d.layers.find((l) => l.layer === 'vama_bypass')!.verdict).toBe('widens');
    expect(d.layers.find((l) => l.layer === 'depth')!.detail).toContain("'org'");
  });

  it('an RLS deny-all composition flips the decision to denied', async () => {
    const d = await explainAccess(
      makeDeps({ rls: { id: '__deny_all__' } }),
      { object: 'leave_request', operation: 'read', context: CTX },
    );
    expect(d.allowed).toBe(false);
    expect(d.layers.find((l) => l.layer === 'rls')!.verdict).toBe('denies');
  });

  it('carries D10 dual attribution when the context acts on behalf of a user', async () => {
    const d = await explainAccess(makeDeps(), {
      object: 'leave_request', operation: 'read',
      context: { ...CTX, principalKind: 'agent', onBehalfOf: { userId: 'u9' } },
    });
    expect(d.principal.principalKind).toBe('agent');
    expect(d.principal.onBehalfOf).toEqual({ userId: 'u9' });
    expect(d.layers[0].detail).toContain('on behalf of u9');
  });

  it('lists masked fields in the fls layer', async () => {
    const d = await explainAccess(
      makeDeps({ getFieldMask: () => ({ salary: { readable: false }, name: { readable: true } }) }),
      { object: 'leave_request', operation: 'read', context: CTX },
    );
    const fls = d.layers.find((l) => l.layer === 'fls')!;
    expect(fls.verdict).toBe('narrows');
    expect(fls.detail).toContain('salary');
  });
});

describe('buildContextForUser', () => {
  const ql = {
    async find(object: string, opts: any) {
      if (object === 'sys_user_position') return [{ user_id: 'u2', position: 'hr_specialist' }];
      if (object === 'sys_user_permission_set') return [{ user_id: 'u2', permission_set_id: 'ps1' }];
      if (object === 'sys_permission_set') return [{ id: 'ps1', name: 'payroll_reader' }];
      return [];
    },
  };

  it('reconstructs positions + direct grants + the everyone anchor', async () => {
    const ctx = await buildContextForUser(ql, 'u2');
    expect(ctx).toEqual({ userId: 'u2', positions: ['hr_specialist', 'everyone'], permissions: ['payroll_reader'] });
  });
});
