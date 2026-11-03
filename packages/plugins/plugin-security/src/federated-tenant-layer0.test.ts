// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7835] Layer 0 must not wall a FEDERATED object with a column it does not have.
 *
 * ## The defect these pins hold down
 *
 * The ObjectQL registry injects `organization_id` into every object that has not
 * opted out, federated ones included — but issues no DDL for a federated object,
 * because its remote schema is owned externally. `computeLayeredRlsFilter` then
 * reads the registered field set, answers `objectHasOrgIdField: true`, and Layer 0
 * AND-composes `organization_id = <active org>` onto a read whose backing table has
 * no such column.
 *
 * The symptom is dialect-dependent and the defect is not: SQLite reinterprets the
 * unresolvable identifier as a string literal, so the predicate is constant-false —
 * **0 rows, no error, HTTP 200**; Postgres/MySQL raise `column "organization_id"
 * does not exist`. Both are the same wall isolating nothing.
 *
 * These cases are **dialect-free by construction**: they assert the composed
 * `FilterCondition`, which is what plugin-security produces before any driver sees
 * it. The end-to-end half — a real boot, the real registry's field set, a real
 * federated object, on SQLite — is
 * `packages/qa/dogfood/test/federated-rls-injectors.dogfood.test.ts`.
 *
 * ## Why the fixtures below are not circular
 *
 * The injected-anchor fixture spreads {@link TENANT_SCOPE_FIELD_DEF} exactly as
 * `applySystemFields` does, and the provenance test compares against the same
 * constant — so this file proves the DECISION, not that the registry still spreads
 * it verbatim. That second fact has an independent witness: the dogfood pin reads
 * what the real registry produced. If the registry ever stops spreading the
 * constant, that pin goes red here while these stay green, which is the correct
 * division of labour rather than a gap.
 */

import { describe, it, expect, vi } from 'vitest';
import { TENANT_SCOPE_FIELD_DEF } from '@objectstack/metadata-core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

/** A member with plain read/write CRUD and NO row-level policies, so the only
 *  thing `getReadFilter` can return is Layer 0 — the layer under test. */
const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/** The caller: an ordinary member of `org-1`, no superuser bit, no positions. */
const MEMBER_CTX = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };

/**
 * Boot a SecurityPlugin over a fake ObjectQL that serves exactly `schema`.
 * `orgScoping` mounts the sentinel service the plugin probes for the `isolated`
 * posture (the same lever `security-plugin.test.ts` uses); `tenancy` overrides it
 * with an explicit posture where a case needs `group`.
 */
async function bootWithSchema(schema: Record<string, unknown>, opts: { tenancy?: { posture: string } } = {}) {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: vi.fn(), getSchema: () => schema, findOne: vi.fn(async () => null) },
    metadata: { get: async () => schema, list: async () => [PLAIN_MEMBER] },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
  };
  if (opts.tenancy) services['tenancy'] = opts.tenancy;
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  return plugin;
}

/** The remote table's real columns — the only ones a federated query can name. */
const REMOTE_COLUMNS = {
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
};

/** What the registry hands plugin-security for a federated object today: the
 *  remote columns PLUS the platform anchors it provisions no storage for. */
const federatedSchema = (extra: Record<string, unknown> = {}) => ({
  name: 'ext_customer',
  external: { remoteName: 'customers' },
  fields: {
    // `applySystemFields`: `additions.organization_id = { ...TENANT_SCOPE_FIELD_DEF }`
    organization_id: { ...TENANT_SCOPE_FIELD_DEF },
    ...REMOTE_COLUMNS,
  },
  ...extra,
});

describe('[#7835] Layer 0 vs federated (external) objects', () => {
  it('federated object with the INJECTED anchor and no declared scope: no organization_id predicate — the wall DENIES under `isolated`', async () => {
    // [ADR-0015 §10] The anchor is the registry's, so no `organization_id = <org>`
    // predicate is composed (it would name a column the remote lacks). But an
    // external object that states no organization scope is not read as shared
    // under a wall: Layer 0 answers the deny sentinel. The boot refuses such an
    // object by name; this is the verdict for one registered after the boot
    // (`external-organization-scope.test.ts` pins both doors).
    const plugin = await bootWithSchema(federatedSchema());
    const filter = await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX);
    expect(filter).toBe(RLS_DENY_FILTER);
  });

  it('federated object with the INJECTED anchor and no declared scope: the wall DENIES under `group` too', async () => {
    // `group` is the other walled posture (ADR-0105 D2). Its predicate widens to a
    // membership union; the column it names is just as absent, and the scope is
    // just as unstated — so the same verdict must hold, or the rule would cover
    // one posture and leave the other emitting `organization_id IN (…)` against a
    // table without it, or reading the object as shared.
    const plugin = await bootWithSchema(federatedSchema(), { tenancy: { posture: 'group' } });
    const filter = await (plugin as any).getReadFilter('ext_customer', {
      ...MEMBER_CTX,
      accessible_org_ids: ['org-1', 'org-2'],
    });
    expect(filter).toBe(RLS_DENY_FILTER);
  });

  it('federated object that DECLARES `tenancy: { enabled: false }`: shared — no predicate at all', async () => {
    // The declaration the wall reads as "every organization": Layer 0 contributes
    // nothing, and with no Layer 1 policies there is nothing to AND.
    const plugin = await bootWithSchema({
      name: 'ext_customer',
      external: { remoteName: 'customers' },
      tenancy: { enabled: false },
      fields: { ...REMOTE_COLUMNS },
    });
    const filter = await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX);
    expect(filter).toBeUndefined();
  });

  it('federated object whose AUTHOR DECLARED a real remote `organization_id`: the wall STAYS', async () => {
    // The provenance half. A remote table may genuinely carry a tenant column, and
    // then Layer 0 is doing real work — suppressing it for every `external` object
    // would delete a working wall. This is the case that goes red if
    // `hasPhantomTenantAnchor` is ever simplified to `external != null`.
    const plugin = await bootWithSchema({
      name: 'ext_customer',
      external: { remoteName: 'customers' },
      fields: {
        organization_id: { type: 'text', label: 'Org (real remote column)' },
        ...REMOTE_COLUMNS,
      },
    });
    const filter = await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX);
    expect(filter).toEqual({ organization_id: 'org-1' });
  });

  it('LOCAL object carrying the same injected anchor: the wall STAYS', async () => {
    // The platform DID provision this column, so the anchor is real. Nothing about
    // the fix may reach a non-federated object.
    const plugin = await bootWithSchema({
      name: 'task',
      fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS },
    });
    const filter = await (plugin as any).getReadFilter('task', MEMBER_CTX);
    expect(filter).toEqual({ organization_id: 'org-1' });
  });

  it('federated object with no declared scope and NO active org: fails closed', async () => {
    // Two reasons to deny, one verdict: the object states no scope the wall can
    // enforce, and the caller carries none either.
    const plugin = await bootWithSchema(federatedSchema());
    const filter = await (plugin as any).getReadFilter('ext_customer', { ...MEMBER_CTX, tenantId: undefined });
    expect(filter).toBe(RLS_DENY_FILTER);
  });

  it('federated object declared shared, with NO active org: contributes nothing — there is no tenant column to compare', async () => {
    // Object-level CRUD is still the gate, and a caller without read permission
    // is refused before this point.
    const plugin = await bootWithSchema({
      name: 'ext_customer',
      external: { remoteName: 'customers' },
      tenancy: { enabled: false },
      fields: { ...REMOTE_COLUMNS },
    });
    const filter = await (plugin as any).getReadFilter('ext_customer', { ...MEMBER_CTX, tenantId: undefined });
    expect(filter).toBeUndefined();
  });

  it('an APP-AUTHORED wildcard tenant policy still reaches the compiler on a federated object', async () => {
    // ADR-0049 / ADR-0105 finding F1: a declared security policy must never be
    // silently dropped. The fix touches Layer 0 only — Layer 1 keeps compiling
    // authored predicates exactly as before, so an author who scopes a federated
    // object by a real remote column keeps their scoping, and one who names a
    // column that isn't there still gets the field-existence net's fail-closed
    // answer instead of silence.
    const authored: PermissionSet = {
      name: 'member_default',
      label: 'Member',
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
      rowLevelSecurity: [
        { name: 'app_region_scope', object: '*', operation: 'all', using: 'region == current_user.organization_id' },
      ],
    } as unknown as PermissionSet;
    const schema = federatedSchema();
    (schema.fields as Record<string, unknown>).region = { type: 'text', label: 'Region' };
    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: { registerMiddleware: vi.fn(), getSchema: () => schema, findOne: vi.fn(async () => null) },
      metadata: { get: async () => schema, list: async () => [authored] },
      'org-scoping': { name: 'com.objectstack.org-scoping' },
    };
    const ctx: Record<string, unknown> = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as any); await plugin.start(ctx as any);
    const filter = await (plugin as any).getReadFilter('ext_customer', MEMBER_CTX);
    // Layer 0 gone, Layer 1's authored predicate intact — no `$and`, no org column.
    expect(filter).toEqual({ region: 'org-1' });
  });
});
