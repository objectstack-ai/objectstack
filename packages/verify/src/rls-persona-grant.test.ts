// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] The RLS probe persona's grant writes BOTH columns of
 * `sys_user_permission_set` — `permission_set_id` and `permission_set` — and
 * the two agree: the name is the `name` of the catalog row the id points at.
 *
 * Driven through the SHIPPED writer, `provisionRlsProbePersona`, over a stack
 * double whose engine stores exactly the payloads it is handed: no platform
 * hook stands behind the writer here, so what lands is the writer's own
 * payload — a writer that drops the name turns this red even though, booted
 * for real, the platform would stamp the column behind it. Both of the
 * writer's branches are pinned: the probe set found by name, and the probe
 * set created because none existed.
 */

import { describe, expect, it } from 'vitest';

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

function stackDouble(seed: { sys_permission_set?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    sys_user: [{ id: 'usr_probe', email: RLS_PROBE_EMAIL }],
    sys_permission_set: seed.sys_permission_set ?? [],
    sys_user_permission_set: [],
  };
  const ql = {
    async find(object: string, query: any) {
      const where = query?.where ?? {};
      const rows = (tables[object] ?? []).filter((r) => matches(r, where));
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return { ...data };
    },
  };
  const stack = {
    async signUp() { return 'tok_signup'; },
    async signIn() { return 'tok_signin'; },
    kernel: { async getServiceAsync(name: string) { return name === 'objectql' ? ql : undefined; } },
  };
  return { stack: stack as any, tables };
}

function expectBothColumnsAgree(tables: Record<string, any[]>): void {
  const grants = tables.sys_user_permission_set;
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({ user_id: 'usr_probe', permission_set: PROBE_SET });
  const setRow = tables.sys_permission_set.find((r) => r.id === grants[0].permission_set_id);
  expect(setRow?.name).toBe(grants[0].permission_set);
}

describe('[ADR-0131 D4] the verify RLS persona grant writes both columns, and they agree', () => {
  it('when the probe set row already exists (found by name)', async () => {
    const { stack, tables } = stackDouble({ sys_permission_set: [{ id: 'ps_seeded_probe', name: PROBE_SET }] });
    const persona = await provisionRlsProbePersona(stack, { objects: [] });
    expect(persona.permissionSet).toBe(PROBE_SET);
    expect(tables.sys_user_permission_set[0]?.permission_set_id).toBe('ps_seeded_probe');
    expectBothColumnsAgree(tables);
  });

  it('when the probe set row is created by the writer', async () => {
    const { stack, tables } = stackDouble();
    await provisionRlsProbePersona(stack, { objects: [] });
    expect(tables.sys_permission_set).toHaveLength(1);
    expectBothColumnsAgree(tables);
  });
});
