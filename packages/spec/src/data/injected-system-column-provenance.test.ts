// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8116] The injected-column definition tables + #7865 provenance derivation,
 * at their post-move home. The full decision matrix (every opt-out row, both
 * `fields` shapes, the fail directions) is pinned by the producer test that
 * moved WITH the metadata-core re-export —
 * `packages/metadata-core/test/injected-column-provenance.test.ts` — which now
 * doubles as the "nothing downstream breaks" proof: it imports every one of
 * these names from `@objectstack/metadata-core`'s index and must keep passing
 * against the shim unchanged. This file pins what is NEW here: the spec is the
 * declaration site (author-time consumers import from `@objectstack/spec/data`
 * with no runtime package on the path), and the newly-exported identity
 * predicate keeps the strip/provenance verdicts in one spelling.
 */

import { describe, it, expect } from 'vitest';

import {
  AUDIT_FIELD_DEFS,
  TENANT_SCOPE_FIELD_DEF,
  OWNER_FIELD_DEF,
  OWNING_BUSINESS_UNIT_FIELD_DEF,
  injectedSystemColumnDefs,
  isInjectedColumnDefinition,
  platformProvisionsStorage,
  resolveInjectedColumnProvenance,
  unprovisionedInjectedColumns,
} from './injected-system-column-provenance';

/** The seven anchors #7865's showcase measurement counted on a federated object. */
const SEVEN_ANCHORS = [
  'organization_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'owner_id',
  'owning_business_unit_id',
] as const;

const external = () => ({
  name: 'showcase_ext_customer',
  external: { remoteName: 'customers' },
  fields: { email: { type: 'text', label: 'Email' } },
});

const local = () => ({
  name: 'showcase_customer',
  fields: { email: { type: 'text', label: 'Email' } },
});

describe('[#8116] provenance derivation at its spec home', () => {
  it('marks all seven anchors unprovisioned on an external object, none on the local twin', () => {
    expect(unprovisionedInjectedColumns(external()).sort()).toEqual([...SEVEN_ANCHORS].sort());
    expect(unprovisionedInjectedColumns(local())).toEqual([]);
    for (const anchor of SEVEN_ANCHORS) {
      expect(resolveInjectedColumnProvenance(external(), anchor), anchor).toBe(
        'injected-unprovisioned',
      );
      expect(resolveInjectedColumnProvenance(local(), anchor), anchor).toBe(
        'injected-provisioned',
      );
    }
  });

  it("SECURITY DIRECTION: an author-declared organization_id on a federated object stays 'author'", () => {
    // #7859's recorded reasoning — a federated object may expose a REAL remote
    // organization_id, and its tenant wall must keep working. The lint warning
    // built on this derivation (#8116) must therefore stay silent here.
    const declaredReal = {
      ...external(),
      fields: {
        email: { type: 'text', label: 'Email' },
        organization_id: { type: 'text', label: 'Remote Org Key' },
      },
    };
    expect(resolveInjectedColumnProvenance(declaredReal, 'organization_id')).toBe('author');
    expect(unprovisionedInjectedColumns(declaredReal)).not.toContain('organization_id');
  });

  it('respects the injection opt-outs — a withheld anchor is absent even on external objects', () => {
    expect(resolveInjectedColumnProvenance({ ...external(), ownership: 'none' }, 'owner_id')).toBe(
      'absent',
    );
    expect(unprovisionedInjectedColumns({ ...external(), systemFields: false })).toEqual([]);
  });

  it('platformProvisionsStorage is the ADR-0015 external != null predicate, total over bare input', () => {
    expect(platformProvisionsStorage(local())).toBe(true);
    expect(platformProvisionsStorage(external())).toBe(false);
    expect(platformProvisionsStorage({ name: 'x', external: null })).toBe(true);
    expect(platformProvisionsStorage(undefined)).toBe(true);
  });

  it('isInjectedColumnDefinition (newly public, #8116) reproduces the strip/provenance identity verdict', () => {
    // Byte-identical copy of a table ⇒ the platform's anchor.
    expect(isInjectedColumnDefinition({ ...OWNER_FIELD_DEF }, OWNER_FIELD_DEF)).toBe(true);
    // Any mismatch — extra key, changed value, unrecognisable shape ⇒ the
    // author's field (the conservative direction the strip and #7859 rely on).
    expect(
      isInjectedColumnDefinition({ ...TENANT_SCOPE_FIELD_DEF, extra: true }, TENANT_SCOPE_FIELD_DEF),
    ).toBe(false);
    expect(
      isInjectedColumnDefinition(
        { ...TENANT_SCOPE_FIELD_DEF, readonly: false },
        TENANT_SCOPE_FIELD_DEF,
      ),
    ).toBe(false);
    expect(isInjectedColumnDefinition(true, TENANT_SCOPE_FIELD_DEF)).toBe(false);
  });

  it('injectedSystemColumnDefs serves the tables verbatim (the marker adds NOTHING to the data)', () => {
    const defs = injectedSystemColumnDefs(external());
    expect(defs.organization_id).toEqual(TENANT_SCOPE_FIELD_DEF);
    expect(defs.owner_id).toEqual(OWNER_FIELD_DEF);
    expect(defs.owning_business_unit_id).toEqual(OWNING_BUSINESS_UNIT_FIELD_DEF);
    expect(defs.created_at).toEqual(AUDIT_FIELD_DEFS.created_at);
    // `id` is the driver's column — never in the defs, never in the marker.
    expect(defs.id).toBeUndefined();
    expect(resolveInjectedColumnProvenance(external(), 'id')).toBe('absent');
  });
});
