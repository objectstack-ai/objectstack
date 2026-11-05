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
 * This file supplies the independent witness. The showcase's
 * `showcase_ext_customer` is registered by `applySystemFields` exactly as a
 * deployed app's would be, and the assertions read what that produced.
 *
 * ## [ADR-0015 §10] Under a walled posture every external object states its scope
 *
 * The shipped object declares `tenancy: { enabled: false }` — its remote table
 * carries no organization column — so the registry injects no `organization_id`
 * into it at all, Layer 0 composes no predicate, and every organization reads
 * it. An external object that states NOTHING is the other case, and it is not
 * read as shared: one registered at boot is refused by name, and one registered
 * after the boot (the fixture below, registered against the live registry so
 * the phantom anchor is injected exactly as it would be) is DENIED — the read
 * filter is the deny sentinel, zero rows for every organization.
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
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';
import type { IObjectQLEngine, ISecurityService } from '@objectstack/spec/contracts';
import type { ServiceObject } from '@objectstack/spec/data';
import { RLS_DENY_FILTER } from '@objectstack/plugin-security';

/** The federated object the showcase ships, bound to remote table `customers`. */
const FEDERATED = 'showcase_ext_customer';
/** A LOCAL showcase object — the control: its `organization_id` IS provisioned. */
const LOCAL = 'showcase_project';
/** An external object registered AFTER the boot that states no organization scope. */
const UNDECLARED = 'dogfood_ext_undeclared';

/** The registry seam the fixture registers through (`IObjectQLEngine` does not declare it). */
interface RegistrarEngine {
  registry: { registerObject(def: Record<string, unknown>): unknown };
  syncObjectSchema(object: string): Promise<unknown>;
}

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
  let ql: IObjectQLEngine;
  let security: ISecurityService;

  beforeAll(async () => {
    // Stand up the "remote" database (the showcase's fixture provisioner), then
    // boot with a real, NON-degraded `isolated` posture — the only posture in
    // which Layer 0 emits anything at all. `posture-only` performs no isolation
    // of its own, which is precisely right here: what is under test is the
    // PREDICATE plugin-security composes, not whether an org wall holds.
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    // `ObjectKernel.getService` is already generic over the slot's contract, so
    // neither the kernel handle nor either result needs erasing: `objectql` is
    // `IObjectQLEngine` and `security` is `ISecurityService`, both declared in
    // `packages/spec/src/contracts/core-service-contracts.ts`.
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    security = stack.kernel.getService<ISecurityService>('security');
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('PREMISE: the shipped federated object declares its organization scope, so the registry injects no `organization_id` into it', () => {
    // [ADR-0015 §10] `tenancy: { enabled: false }` is the declaration; a declared
    // opt-out is not injected over, so the column is absent — neither a remote
    // column nor a phantom anchor.
    // `IObjectQLEngine.getSchema` declares `unknown` on purpose — the engine's
    // own return type (`ServiceObject | undefined`) is a spec type, but the
    // contract keeps its edges loose so `spec` never depends on the engine
    // package, and tells consumers to narrow at the call site.
    const schema = ql.getSchema(FEDERATED) as ServiceObject | undefined;
    expect(schema?.external, `${FEDERATED} must be a federated object`).toBeTruthy();
    expect((schema as { tenancy?: { enabled?: boolean } } | undefined)?.tenancy?.enabled).toBe(false);
    expect(fieldNames(schema)).not.toContain('organization_id');
    // The remote table's real columns, for contrast.
    expect(fieldNames(schema)).toEqual(expect.arrayContaining(['name', 'email', 'region']));
  });

  it('an external object registered after the boot that states no scope carries the injected anchor, and the wall DENIES it', async () => {
    // Registered against the LIVE registry, so `applySystemFields` injects the
    // anchors exactly as it would for an authored object that said nothing.
    const registrar = ql as unknown as RegistrarEngine;
    registrar.registry.registerObject({
      name: UNDECLARED,
      label: 'Undeclared federated customer',
      datasource: 'showcase_external',
      external: { remoteName: 'customers' },
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        email: { type: 'text', label: 'Email' },
        region: { type: 'text', label: 'Region' },
      },
    });
    await registrar.syncObjectSchema(UNDECLARED);
    expect(fieldNames(ql.getSchema(UNDECLARED))).toContain('organization_id');
    // The verdict, by identity with the spec's frozen deny sentinel — for a
    // member of either organization. Not "no predicate": an unstated scope is
    // a configuration defect and fails toward isolation.
    for (const org of ['org_alpha', 'org_beta']) {
      const filter = await security.getReadFilter(UNDECLARED, { userId: 'usr_dogfood_member', tenantId: org, positions: [] as string[] });
      expect(filter, `the wall denies ${UNDECLARED} for ${org}`).toBe(RLS_DENY_FILTER);
    }
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
