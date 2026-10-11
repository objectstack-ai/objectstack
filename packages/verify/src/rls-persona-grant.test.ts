// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The RLS probe persona is provisioned through the REGISTRY:
 * `provisionRlsProbePersona` asks the security catalog whether the probe set is
 * registered, writes ONE grant naming it, and mints no `sys_permission_set`
 * row.
 *
 * The grant still writes BOTH columns of `sys_user_permission_set` —
 * `permission_set_id` (still a required column) and `permission_set` — and the
 * two agree: the id is the boot-seeded catalog row's, READ by name, and the name
 * is that row's `name`.
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

function stackDouble(seed: { sys_permission_set?: any[]; catalog?: SecurityCatalogReader } = {}) {
  const tables: Record<string, any[]> = {
    sys_user: [{ id: 'usr_probe', email: RLS_PROBE_EMAIL }],
    sys_permission_set: seed.sys_permission_set ?? [],
    sys_user_permission_set: [],
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
  it('grants the registered set by name, with the boot-seeded row id, and mints no set row', async () => {
    const { stack, tables, inserted } = stackDouble({
      sys_permission_set: [{ ...SEEDED_ROW }],
      catalog: catalogServing([PROBE_SET]),
    });
    const persona = await provisionRlsProbePersona(stack, { objects: [] });

    expect(persona.permissionSet).toBe(PROBE_SET);
    expect(inserted).toEqual(['sys_user_permission_set']);
    expect(tables.sys_permission_set).toEqual([SEEDED_ROW]);
    const grants = tables.sys_user_permission_set;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      user_id: 'usr_probe',
      permission_set: PROBE_SET,
      permission_set_id: SEEDED_ROW.id,
    });
  });

  it('refuses, writing nothing, when the boot seeded no row for the registered set', async () => {
    const { stack, inserted } = stackDouble({ catalog: catalogServing([PROBE_SET]) });
    await expect(provisionRlsProbePersona(stack, { objects: [] })).rejects.toThrow(PROBE_SET);
    expect(inserted).toEqual([]);
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
