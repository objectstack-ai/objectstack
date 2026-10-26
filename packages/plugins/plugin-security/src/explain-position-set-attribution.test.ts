// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4; #24757] The explain panel attributes a permission set to a
 * position exactly when that position's DEFINITION names it.
 *
 * Both a position's definition-bound sets and the directly assigned ones reach
 * the explainer as `context.permissions` (§6b of `resolveUserAuthzGrants`), so
 * the attribution reads the held positions' definitions to tell them apart. It
 * used to read the position NAMES instead — the position-name fold's view —
 * which labelled a definition-bound set "direct grant" and a direct grant that
 * happened to share a held position's name `position:NAME`. #24757 retired the
 * fold; this pins the attribution that replaces it, and what it says when the
 * definitions cannot be read.
 *
 * [#25799] A set held through BOTH channels names both, read from the
 * resolver's own split (`directPermissions`), so the direct row is not hidden
 * behind the position.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator';
import { explainAccess, type ExplainEngineDeps } from './explain-engine';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const set = (name: string) => PermissionSetSchema.parse({ name, objects: { leave_request: { allowRead: true } } });
const BOUND = set('crm_sales_user');
const DIRECT = set('forecasting');
/** Directly assigned, and named like a position the principal holds whose definition does not list it. */
const NAMESAKE = set('sales_manager');

const SCHEMA = { name: 'leave_request' };

function deps(ql: unknown): ExplainEngineDeps {
  return {
    ql: ql as any,
    resolveSets: async () => [BOUND, DIRECT, NAMESAKE],
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
  };
}

const CONTEXT = {
  userId: 'u1',
  posture: 'MEMBER',
  positions: ['sales_rep', 'sales_manager'],
  permissions: ['crm_sales_user', 'forecasting', 'sales_manager'],
};

async function attributions(ql: unknown, context: Record<string, unknown> = CONTEXT): Promise<Record<string, string | undefined>> {
  const d = await explainAccess(deps(ql), { object: 'leave_request', operation: 'read', context });
  const principal = d.layers.find((l) => l.layer === 'principal');
  return Object.fromEntries(
    (principal?.contributors ?? []).filter((c) => c.kind === 'permission_set').map((c) => [c.name, c.via]),
  );
}

describe('[ADR-0131 D3/D4; #24757] explain attributes a set to a position only through its definition', () => {
  const withCatalog = () => bindTestSecurityCatalog({ getSchema: () => SCHEMA }, {
    positions: [
      { name: 'sales_rep', permissionSets: ['crm_sales_user'] },
      { name: 'sales_manager', permissionSets: [] },
    ],
    permissions: [BOUND, DIRECT, NAMESAKE],
  });

  it('a set the held position\'s definition names is attributed to that position', async () => {
    expect((await attributions(withCatalog())).crm_sales_user).toBe('position:sales_rep');
  });

  it('a set no held definition names is a direct grant', async () => {
    expect((await attributions(withCatalog())).forecasting).toBe('direct grant');
  });

  it('a direct grant sharing a held position\'s name is a direct grant, not that position\'s', async () => {
    expect((await attributions(withCatalog())).sales_manager).toBe('direct grant');
  });

  it('a set held both through the user\'s own grant row and through a held position\'s definition names both channels (#25799)', async () => {
    // `crm_sales_user` is bound by `sales_rep` AND assigned directly, as the
    // resolver's own split says (`directPermissions`): revoking the position
    // would not remove the access, so the attribution must not read as the
    // position's alone.
    const dual = { ...CONTEXT, directPermissions: ['crm_sales_user', 'forecasting', 'sales_manager'] };
    const out = await attributions(withCatalog(), dual);
    expect(out.crm_sales_user).toBe('direct grant + position:sales_rep');
    // The other two are direct only, through either reading.
    expect(out.forecasting).toBe('direct grant');
    expect(out.sales_manager).toBe('direct grant');
  });

  it('with the definitions unreadable it says it cannot tell the two apart, rather than guessing either', async () => {
    const out = await attributions({ getSchema: () => SCHEMA });
    for (const name of ['crm_sales_user', 'forecasting', 'sales_manager']) {
      expect(out[name], name).toBe('direct grant or position definition (the position definitions could not be read)');
    }
  });
});
