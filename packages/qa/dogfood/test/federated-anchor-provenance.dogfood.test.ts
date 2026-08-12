// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7865] The injected-anchor provenance marker, measured on a REAL boot of the
 * shipped showcase — the card's own measurement, reproduced as a pin.
 *
 * The card (decision, ruled 2026-08-12, direction B): `applySystemFields`
 * injects platform anchors into `external` objects the platform provisions no
 * storage for; three consumers independently re-derived "that column is not
 * really there" (#7833 engine, #7859 plugin-security, #7858 plugin-sharing).
 * The ruling keeps the injection and adds a machine-readable provenance marker
 * — `resolveInjectedColumnProvenance` / `unprovisionedInjectedColumns`
 * (`@objectstack/metadata-core`, re-exported by `@objectstack/objectql`) — so
 * consumers ask ONE authoritative question instead of each hand-rolling it.
 *
 * What this file proves, against the registry a deployed app would really run:
 *
 *  1. BEFORE-PICTURE PRESERVED — direction B keeps injecting: the federated
 *     `showcase_ext_customer` still registers all 7 platform anchors over the
 *     4-column remote table, byte-identical to the shipped definition tables
 *     (no `provisioned` key in any served or registered field definition —
 *     the #7865 fence: the marker changes what no consumer accepts).
 *  2. THE MARKER — the 7 anchors, and only they, answer
 *     `'injected-unprovisioned'`; the local control answers
 *     `'injected-provisioned'`; declared columns answer `'author'`.
 *  3. GUARD PARITY — the marker agrees with the #7859 Layer-0 guard's live
 *     behaviour on the same boot (no predicate for the federated object, wall
 *     intact on the local control), through plugin-security's public surface —
 *     the guard itself is deliberately untouched (opportunistic convergence,
 *     per the ruling).
 *  4. `/meta` NO-REGRESSION — the served document (the post-injection document,
 *     #6562) reports the same field set as the registry and carries no new
 *     keys and no `_diagnostics` invalidity.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack, { onEnable } from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import type { IObjectQLEngine, ISecurityService } from '@objectstack/spec/contracts';
import type { ServiceObject } from '@objectstack/spec/data';
import {
  AUDIT_FIELD_DEFS,
  TENANT_SCOPE_FIELD_DEF,
  OWNER_FIELD_DEF,
  OWNING_BUSINESS_UNIT_FIELD_DEF,
  platformProvisionsStorage,
  resolveInjectedColumnProvenance,
  unprovisionedInjectedColumns,
} from '@objectstack/metadata-core';

/** The federated object the showcase ships, bound to remote table `customers`. */
const FEDERATED = 'showcase_ext_customer';
/** A LOCAL showcase object — the control: its anchors ARE provisioned. */
const LOCAL = 'showcase_project';

/** The 7 anchors the #7865 card measured on this exact object. */
const SEVEN_ANCHORS = [
  'organization_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'owner_id',
  'owning_business_unit_id',
] as const;

/** The remote table's real columns, as the showcase declares them. */
const DECLARED = ['name', 'email', 'region', 'lifetime_value'] as const;

const SHIPPED_DEFS: Record<string, Readonly<Record<string, unknown>>> = {
  organization_id: TENANT_SCOPE_FIELD_DEF,
  owner_id: OWNER_FIELD_DEF,
  owning_business_unit_id: OWNING_BUSINESS_UNIT_FIELD_DEF,
  ...AUDIT_FIELD_DEFS,
};

function fieldMap(schema: unknown): Record<string, Record<string, unknown>> {
  const fields = (schema as { fields?: unknown } | null)?.fields;
  if (Array.isArray(fields)) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const f of fields) {
      const { name, ...rest } = (f ?? {}) as Record<string, unknown>;
      if (typeof name === 'string') out[name] = rest;
    }
    return out;
  }
  return { ...((fields ?? {}) as Record<string, Record<string, unknown>>) };
}

/** Every `organization_id` key anywhere in a composed FilterCondition tree. */
function mentionsOrgColumn(filter: unknown): boolean {
  if (Array.isArray(filter)) return filter.some(mentionsOrgColumn);
  if (!filter || typeof filter !== 'object') return false;
  return Object.entries(filter as Record<string, unknown>).some(
    ([k, v]) => k === 'organization_id' || mentionsOrgColumn(v),
  );
}

describe('[#7865] injected-anchor provenance on a real showcase boot', () => {
  let stack: VerifyStack;
  let ql: IObjectQLEngine;
  let security: ISecurityService;
  let federated: ServiceObject;
  let localControl: ServiceObject;

  beforeAll(async () => {
    await onEnable({ logger: { info() {}, warn() {} } } as never);
    stack = await bootStack(showcaseStack, { multiTenant: 'posture-only' });
    ql = stack.kernel.getService<IObjectQLEngine>('objectql');
    security = stack.kernel.getService<ISecurityService>('security');
    federated = ql.getSchema(FEDERATED) as ServiceObject;
    localControl = ql.getSchema(LOCAL) as ServiceObject;
    expect(federated?.external, `${FEDERATED} must be federated`).toBeTruthy();
    expect(localControl, `${LOCAL} must exist`).toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('BEFORE-PICTURE: the registry still injects all 7 anchors into the federated object (direction B keeps injecting)', () => {
    const names = Object.keys(fieldMap(federated));
    for (const anchor of SEVEN_ANCHORS) expect(names, 'anchors').toContain(anchor);
    for (const declared of DECLARED) expect(names, 'declared').toContain(declared);
  });

  it('FENCE: every registered anchor definition is byte-identical to the shipped table — the marker adds nothing to the data', () => {
    const fields = fieldMap(federated);
    for (const anchor of SEVEN_ANCHORS) {
      expect(fields[anchor], anchor).toEqual({ ...SHIPPED_DEFS[anchor] });
      expect('provisioned' in (fields[anchor] ?? {}), `${anchor} must not carry a provisioned key`).toBe(false);
    }
  });

  it('THE MARKER: the 7 anchors — and only they — are unprovisioned on the federated object', () => {
    expect(platformProvisionsStorage(federated)).toBe(false);
    expect(unprovisionedInjectedColumns(federated).sort()).toEqual([...SEVEN_ANCHORS].sort());
    for (const anchor of SEVEN_ANCHORS) {
      expect(resolveInjectedColumnProvenance(federated, anchor), anchor).toBe(
        'injected-unprovisioned',
      );
    }
    for (const declared of DECLARED) {
      expect(resolveInjectedColumnProvenance(federated, declared), declared).toBe('author');
    }
  });

  it('CONTROL: the local object answers injected-provisioned and lists nothing unprovisioned', () => {
    expect(platformProvisionsStorage(localControl)).toBe(true);
    expect(unprovisionedInjectedColumns(localControl)).toEqual([]);
    expect(resolveInjectedColumnProvenance(localControl, 'organization_id')).toBe(
      'injected-provisioned',
    );
    expect(resolveInjectedColumnProvenance(localControl, 'owner_id')).toBe('injected-provisioned');
  });

  it('GUARD PARITY (#7859, behavioural): the marker and the live Layer-0 verdict agree on both objects', async () => {
    // The guard is NOT rewritten by #7865 (opportunistic convergence, per the
    // ruling) — so its live behaviour is the reference the marker must match:
    // marker says unprovisioned ⇒ Layer 0 composes no organization_id
    // predicate; marker says provisioned ⇒ the wall stands.
    const ctx = { userId: 'usr_dogfood_member', tenantId: 'org_alpha', positions: [] as string[] };
    const federatedFilter = await security.getReadFilter(FEDERATED, ctx);
    expect(
      mentionsOrgColumn(federatedFilter),
      `marker says unprovisioned ⇒ no tenant predicate, got ${JSON.stringify(federatedFilter)}`,
    ).toBe(false);
    const localFilter = await security.getReadFilter(LOCAL, ctx);
    expect(
      mentionsOrgColumn(localFilter),
      `marker says provisioned ⇒ wall intact, got ${JSON.stringify(localFilter)}`,
    ).toBe(true);
  });

  it('/meta NO-REGRESSION: the served post-injection document reports the registry field set, unchanged and valid', async () => {
    const token = await stack.signIn();
    const res = await stack.apiAs(token, 'GET', `/meta/object/${FEDERATED}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const served = fieldMap(body?.item);
    // Same field-name set as the registered schema — the #6562 invariant.
    expect(Object.keys(served).sort()).toEqual(Object.keys(fieldMap(federated)).sort());
    // The served anchors carry the shipped bytes and no marker key.
    for (const anchor of SEVEN_ANCHORS) {
      expect(served[anchor], anchor).toEqual({ ...SHIPPED_DEFS[anchor] });
    }
    // And the platform files no defect report about its own document (#6810's
    // failure shape: `_diagnostics: { valid: false, unrecognized_keys }`).
    const diagnostics = (body?.item as Record<string, unknown> | undefined)?.['_diagnostics'] as
      | { valid?: boolean }
      | undefined;
    expect(diagnostics?.valid, JSON.stringify(diagnostics)).not.toBe(false);
  }, 120_000);
});
