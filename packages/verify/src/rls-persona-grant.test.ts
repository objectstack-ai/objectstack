// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The RLS probe persona is provisioned through the REGISTRY:
 * `provisionRlsProbePersona` asks the security catalog whether the probe set is
 * registered, writes ONE grant naming it, and mints no `sys_permission_set`
 * row.
 *
 * The grant names its set alone (`permission_set`): no `sys_permission_set`
 * row is read or needed, and `permission_set_id` is not written (ADR-0131 D4,
 * D10's first step).
 *
 * Driven through the SHIPPED writer over a stack double whose engine stores
 * exactly the payloads it is handed and whose catalog is bound with core's own
 * `bindSecurityCatalogReader` — the binding `securityCatalogReaderOf` reads in
 * production. No platform hook stands behind the writer here, so what lands is
 * the writer's own payload. Every refusal is pinned to write NOTHING: a writer
 * that falls back to minting the set row, or that grants a set the catalog does
 * not serve, turns this red.
 */

import { describe, expect, it } from 'vitest';

import {
  bindSecurityCatalogReader,
  type SecurityCatalogEntry,
  type SecurityCatalogReader,
} from '@objectstack/core';

import { provisionRlsProbePersona, RLS_PROBE_EMAIL } from './rls.js';

const PROBE_SET = 'verify_rls_probe';

/**
 * The double's WHERE matcher: equality on plain keys, and a combinator it does
 * not implement is REFUSED rather than read as a field name
 * (`check:where-matcher`).
 */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error(`stack double: unsupported operator ${k}`);
    if (row[k] !== v) return false;
  }
  return true;
}

/** A catalog that serves exactly `names` as permission sets. */
function catalogServing(names: string[]): SecurityCatalogReader {
  const entry = (name: string): SecurityCatalogEntry => ({
    type: 'permission',
    name,
    definition: { name },
    source: 'registry',
  });
  return {
    async resolve(type, name) {
      return type === 'permission' && names.includes(name) ? entry(name) : undefined;
    },
    async list(type) {
      return type === 'permission' ? names.map(entry) : [];
    },
  };
}

function stackDouble(
  seed: { sys_permission_set?: any[]; sys_member?: any[]; catalog?: SecurityCatalogReader } = {},
) {
  const tables: Record<string, any[]> = {
    sys_user: [{ id: 'usr_probe', email: RLS_PROBE_EMAIL }],
    sys_permission_set: seed.sys_permission_set ?? [],
    sys_user_permission_set: [],
    sys_member: seed.sys_member ?? [],
  };
  const inserted: string[] = [];
  const ql = {
    async find(object: string, query: any) {
      const where = query?.where ?? {};
      const rows = (tables[object] ?? []).filter((r) => matches(r, where));
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    },
    async insert(object: string, data: any) {
      inserted.push(object);
      (tables[object] ??= []).push({ ...data });
      return { ...data };
    },
  };
  if (seed.catalog) bindSecurityCatalogReader(ql, seed.catalog);
  const stack = {
    async signUp() { return 'tok_signup'; },
    async signIn() { return 'tok_signin'; },
    kernel: { async getServiceAsync(name: string) { return name === 'objectql' ? ql : undefined; } },
  };
  return { stack: stack as any, tables, inserted };
}

const SEEDED_ROW = { id: 'ps_seeded_probe', name: PROBE_SET };

describe('[ADR-0131 D3/D4] the verify RLS persona is provisioned through the registry', () => {
  it('grants the registered set by name alone, with ZERO sys_permission_set rows, and mints no set row', async () => {
    const { stack, tables, inserted } = stackDouble({ catalog: catalogServing([PROBE_SET]) });
    const persona = await provisionRlsProbePersona(stack, { objects: [] });

    expect(persona.permissionSet).toBe(PROBE_SET);
    expect(inserted).toEqual(['sys_user_permission_set']);
    expect(tables.sys_permission_set).toEqual([]);
    const grants = tables.sys_user_permission_set;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ user_id: 'usr_probe', permission_set: PROBE_SET });
    expect(grants[0].permission_set_id).toBeUndefined();
  });

  // [ADR-0131 D3/D9] An assignment is an organization row: the persona's grant
  // belongs to the organization the persona is a member of — under `single`,
  // the Default Organization every sign-up joins.
  it('owns the grant by the persona\'s organization, and names none for a persona that belongs to none', async () => {
    const member = stackDouble({
      catalog: catalogServing([PROBE_SET]),
      sys_member: [{ id: 'mem_1', user_id: 'usr_probe', organization_id: 'org_default' }],
    });
    await provisionRlsProbePersona(member.stack, { objects: [] });
    expect(member.tables.sys_user_permission_set[0]).toMatchObject({ user_id: 'usr_probe', organization_id: 'org_default' });

    for (const sys_member of [[], [
      { id: 'mem_1', user_id: 'usr_probe', organization_id: 'org_a' },
      { id: 'mem_2', user_id: 'usr_probe', organization_id: 'org_b' },
    ]]) {
      const orgLess = stackDouble({ catalog: catalogServing([PROBE_SET]), sys_member });
      await provisionRlsProbePersona(orgLess.stack, { objects: [] });
      expect('organization_id' in orgLess.tables.sys_user_permission_set[0]).toBe(false);
    }
  });

  it('refuses, writing nothing, when the catalog does not serve the set — a row alone is not the probe set', async () => {
    const { stack, inserted } = stackDouble({
      sys_permission_set: [{ ...SEEDED_ROW }],
      catalog: catalogServing(['admin_full_access']),
    });
    await expect(provisionRlsProbePersona(stack, { objects: [] })).rejects.toThrow(PROBE_SET);
    expect(inserted).toEqual([]);
  });

  it('refuses, writing nothing, when no catalog is bound to the engine at all', async () => {
    const { stack, inserted } = stackDouble({ sys_permission_set: [{ ...SEEDED_ROW }] });
    await expect(provisionRlsProbePersona(stack, { objects: [] })).rejects.toThrow(PROBE_SET);
    expect(inserted).toEqual([]);
  });
});
