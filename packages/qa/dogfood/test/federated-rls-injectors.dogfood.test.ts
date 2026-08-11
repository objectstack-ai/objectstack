// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7835] plugin-security must not wall a FEDERATED object with a column the
 * remote table does not have — measured against the REAL registry, on a REAL
 * boot, with the SHIPPED showcase federated objects.
 *
 * ## Why this file exists next to the plugin-security unit pins
 *
 * `packages/plugins/plugin-security/src/federated-tenant-layer0.test.ts` proves
 * the DECISION: given a field set that carries the platform's injected
 * `organization_id` anchor on an `external` object, Layer 0 must contribute
 * nothing. Its fixtures build that field set by hand, so it cannot also prove
 * that the real registry still produces one — expectation and reality would
 * share a source, and the pin could not fail.
 *
 * This file supplies the independent witness. Nothing here constructs a schema:
 * the showcase's `showcase_ext_customer` is registered by `applySystemFields`
 * exactly as a deployed app's would be, and the assertions read what that
 * produced. If the registry ever stops injecting phantom anchors into federated
 * objects — the root fix this card deliberately did not take (it lives in
 * `@objectstack/objectql`, outside this lane) — the premise case below goes red
 * and says so, which is the correct way to learn that the ground moved.
 *
 * ## Dialect
 *
 * The showcase's external datasource is **SQLite**, and that is exactly where
 * the pre-fix defect is invisible: an unresolvable identifier degrades to a
 * string literal, so `organization_id = 'org_…'` is constant-false — 0 rows, no
 * error, HTTP 200. Postgres/MySQL raise instead. So the HTTP case here proves
 * the SQLite-shaped symptom only; the filter-shape cases above it are what
 * generalise, because plugin-security composes that `FilterCondition` before any
 * driver — and any dialect — sees it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

/** The federated object the showcase ships, bound to remote table `customers`. */
const FEDERATED = 'showcase_ext_customer';
/** A LOCAL showcase object — the control: its `organization_id` IS provisioned. */
const LOCAL = 'showcase_project';

function fieldNames(schema: unknown): string[] {
  const fields = (schema as { fields?: unknown } | null)?.fields;
  if (Array.isArray(fields)) return fields.map((f) => String((f as { name?: unknown }).name));
  return Object.keys((fields ?? {}) as Record<string, unknown>);
}

function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const b = body as { records?: unknown[]; data?: unknown[] };
  return b?.records ?? b?.data ?? [];
}

/** Every `organization_id` key anywhere in a composed FilterCondition tree. */
function mentionsOrgColumn(filter: unknown): boolean {
  if (Array.isArray(filter)) return filter.some(mentionsOrgColumn);
  if (!filter || typeof filter !== 'object') return false;
  return Object.entries(filter as Record<string, unknown>).some(
    ([k, v]) => k === 'organization_id' || mentionsOrgColumn(v),
  );
}

describe('[#7835] federated objects and the plugin-security tenant wall', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let security: any;

  beforeAll(async () => {
    // Stand up the "remote" database (the showcase's fixture provisioner), then
    // boot with a real, NON-degraded `isolated` posture — the only posture in
    // which Layer 0 emits anything at all. `posture-only` performs no isolation
    // of its own, which is precisely right here: what is under test is the
    // PREDICATE plugin-security composes, not whether an org wall holds.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kernel = stack.kernel as any;
    ql = kernel.getService('objectql');
    security = kernel.getService('security');
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('PREMISE: the registry injects a phantom `organization_id` into the federated object', () => {
    // Not an aspiration — the state of the tree this fix was written against.
    // `Engine.syncObjectSchema` returns early for `external != null` and issues
    // no DDL, so this column exists in the registry and in no table.
    const schema = ql.getSchema(FEDERATED);
    expect(schema?.external, `${FEDERATED} must be a federated object`).toBeTruthy();
    expect(fieldNames(schema)).toContain('organization_id');
    // The remote table's real columns, for contrast.
    expect(fieldNames(schema)).toEqual(expect.arrayContaining(['name', 'email', 'region']));
  });

  it('a walled posture composes NO organization_id predicate for the federated object', async () => {
    const ctx = { userId: 'usr_dogfood_member', tenantId: 'org_alpha', positions: [] as string[] };
    const filter = await security.getReadFilter(FEDERATED, ctx);
    expect(
      mentionsOrgColumn(filter),
      `read filter for the federated ${FEDERATED} must not name organization_id, got ${JSON.stringify(filter)}`,
    ).toBe(false);
  });

  it('CONTROL: the same caller on a LOCAL object still gets the tenant wall', async () => {
    // Without this, the case above would pass just as well if the wall had been
    // switched off everywhere — which is the failure mode the fix must not have.
    const ctx = { userId: 'usr_dogfood_member', tenantId: 'org_alpha', positions: [] as string[] };
    const filter = await security.getReadFilter(LOCAL, ctx);
    expect(
      mentionsOrgColumn(filter),
      `read filter for the local ${LOCAL} must still name organization_id, got ${JSON.stringify(filter)}`,
    ).toBe(true);
  });

  it('end-to-end (SQLite): the federated object still answers with rows under a walled posture', async () => {
    // The user-visible half. Before the fix this returned HTTP 200 with ZERO
    // rows: Layer 0 treated the object as tenant-scoped, and with no active
    // organization on the context that resolves to the deny sentinel — a
    // federated catalog that silently stops existing the moment a deployment
    // turns the organization wall on.
    const admin = await stack.signIn();
    const res = await stack.apiAs(admin, 'GET', `/data/${FEDERATED}`);
    expect(res.status).toBe(200);
    const rows = listOf(await res.json());
    expect(rows.length, 'federated rows must survive a walled posture').toBeGreaterThanOrEqual(3);
  }, 120_000);
});
