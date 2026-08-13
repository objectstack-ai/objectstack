// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7865] Injected-column provenance — the machine-readable marker for anchors
 * the platform registers without provisioning storage (maintainer ruling
 * 2026-08-12, direction B).
 *
 * The fixture matrix mirrors the shipped showcase measurement the card was
 * filed from: `showcase_ext_customer` (external → remote table `customers`)
 * registers 7 platform anchors against a remote table that has none of them.
 * The REAL registered schema is pinned by the dogfood twin of this file
 * (`packages/qa/dogfood/test/federated-anchor-provenance.dogfood.test.ts`);
 * these fixtures pin the DECISION over every branch, including the ones a
 * single showcase boot cannot reach.
 */

import { describe, it, expect } from 'vitest';
import {
  AUDIT_FIELD_DEFS,
  TENANT_SCOPE_FIELD_DEF,
  OWNER_FIELD_DEF,
  OWNING_BUSINESS_UNIT_FIELD_DEF,
  injectedSystemColumnDefs,
  platformProvisionsStorage,
  resolveInjectedColumnProvenance,
  unprovisionedInjectedColumns,
} from '../src/index.js';

/** The seven anchors the card's measurement counted on the showcase object. */
const SEVEN_ANCHORS = [
  'organization_id',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'owner_id',
  'owning_business_unit_id',
] as const;

const remoteFields = () => ({
  name: { type: 'text', label: 'Name' },
  email: { type: 'text', label: 'Email' },
  region: { type: 'text', label: 'Region' },
  lifetime_value: { type: 'currency', label: 'Lifetime Value', scale: 2 },
});

/** Showcase-shaped federated object (pre-injection, as authored). */
const external = () => ({
  name: 'showcase_ext_customer',
  datasource: 'showcase_external',
  external: { remoteName: 'customers' },
  fields: remoteFields(),
});

/** The same object with the platform's storage — the local control twin. */
const local = () => ({ name: 'showcase_customer', fields: remoteFields() });

/** Post-injection shape: the anchors present, byte-identical to the tables. */
const withInjectedAnchors = (def: Record<string, unknown>) => ({
  ...def,
  fields: {
    organization_id: { ...TENANT_SCOPE_FIELD_DEF },
    ...AUDIT_FIELD_DEFS,
    owner_id: { ...OWNER_FIELD_DEF },
    owning_business_unit_id: { ...OWNING_BUSINESS_UNIT_FIELD_DEF },
    ...(def.fields as Record<string, unknown>),
  },
});

describe('[#7865] platformProvisionsStorage', () => {
  it('is false exactly for ADR-0015 external objects', () => {
    expect(platformProvisionsStorage(local())).toBe(true);
    expect(platformProvisionsStorage(external())).toBe(false);
    // The routing predicate is `external != null`, not truthiness of contents.
    expect(platformProvisionsStorage({ name: 'x', external: {} })).toBe(false);
    expect(platformProvisionsStorage({ name: 'x', external: null })).toBe(true);
  });

  it('is tolerant of bare input (total, like the rest of the module)', () => {
    expect(platformProvisionsStorage(undefined)).toBe(true);
    expect(platformProvisionsStorage('nonsense')).toBe(true);
    expect(platformProvisionsStorage([])).toBe(true);
  });
});

describe('[#7865] resolveInjectedColumnProvenance — the marker', () => {
  it('marks all seven showcase anchors unprovisioned on the federated object (pre-injection input)', () => {
    for (const anchor of SEVEN_ANCHORS) {
      expect(resolveInjectedColumnProvenance(external(), anchor), anchor).toBe(
        'injected-unprovisioned',
      );
    }
  });

  it('marks the same seven anchors unprovisioned on the POST-injection registered shape', () => {
    const registered = withInjectedAnchors(external());
    for (const anchor of SEVEN_ANCHORS) {
      expect(resolveInjectedColumnProvenance(registered, anchor), anchor).toBe(
        'injected-unprovisioned',
      );
    }
  });

  it('answers injected-provisioned for the local control twin — storage is real there', () => {
    for (const shape of [local(), withInjectedAnchors(local())]) {
      for (const anchor of SEVEN_ANCHORS) {
        expect(resolveInjectedColumnProvenance(shape, anchor), anchor).toBe('injected-provisioned');
      }
    }
  });

  it("answers 'author' for the object's own declared columns, both storage modes", () => {
    for (const shape of [external(), local()]) {
      for (const declared of ['name', 'email', 'region', 'lifetime_value']) {
        expect(resolveInjectedColumnProvenance(shape, declared), declared).toBe('author');
      }
    }
  });

  it("SECURITY DIRECTION: an author-declared organization_id on a federated object is 'author', never the marker", () => {
    // #7859's recorded reasoning: a federated object may expose a REAL remote
    // organization_id by declaring it — and then the tenant wall must keep
    // working. If this case ever answers 'injected-unprovisioned', a consumer
    // converged on the marker would suppress a wall that was doing its job.
    const declaredReal = {
      ...external(),
      fields: {
        ...remoteFields(),
        organization_id: { type: 'text', label: 'Remote Org Key' },
      },
    };
    expect(resolveInjectedColumnProvenance(declaredReal, 'organization_id')).toBe('author');
    expect(unprovisionedInjectedColumns(declaredReal)).not.toContain('organization_id');
  });

  it("fail direction: ANY mismatch with the shipped definition answers 'author' (toward enforcement)", () => {
    const base = external();
    // Extra key on an otherwise-identical anchor.
    const extraKey = {
      ...base,
      fields: {
        ...remoteFields(),
        organization_id: { ...TENANT_SCOPE_FIELD_DEF, extra: true },
      },
    };
    expect(resolveInjectedColumnProvenance(extraKey, 'organization_id')).toBe('author');
    // Changed value.
    const changed = {
      ...base,
      fields: {
        ...remoteFields(),
        organization_id: { ...TENANT_SCOPE_FIELD_DEF, readonly: false },
      },
    };
    expect(resolveInjectedColumnProvenance(changed, 'organization_id')).toBe('author');
    // Present but unrecognisable — NOT the same as absent.
    const degenerate = {
      ...base,
      fields: { ...remoteFields(), organization_id: true },
    };
    expect(resolveInjectedColumnProvenance(degenerate, 'organization_id')).toBe('author');
  });

  it('reaches the same verdicts through the ARRAY fields shape (name key excluded)', () => {
    const arrayShape = {
      name: 'showcase_ext_customer',
      external: { remoteName: 'customers' },
      fields: [
        { name: 'organization_id', ...TENANT_SCOPE_FIELD_DEF },
        { name: 'email', type: 'text', label: 'Email' },
      ],
    };
    expect(resolveInjectedColumnProvenance(arrayShape, 'organization_id')).toBe(
      'injected-unprovisioned',
    );
    expect(resolveInjectedColumnProvenance(arrayShape, 'email')).toBe('author');
    // An authored array-shape organization_id stays the author's.
    const arrayAuthored = {
      ...arrayShape,
      fields: [{ name: 'organization_id', type: 'text', label: 'Remote Org Key' }],
    };
    expect(resolveInjectedColumnProvenance(arrayAuthored, 'organization_id')).toBe('author');
  });

  it('respects every injection opt-out — an anchor the plan withholds is absent even on external objects', () => {
    const cases: Array<[string, Record<string, unknown>, readonly string[]]> = [
      ['systemFields: false', { ...external(), systemFields: false }, SEVEN_ANCHORS],
      ["managedBy: 'better-auth'", { ...external(), managedBy: 'better-auth' }, SEVEN_ANCHORS],
      [
        'tenancy.enabled: false',
        { ...external(), tenancy: { enabled: false } },
        ['organization_id'],
      ],
      [
        "ownership: 'org'",
        { ...external(), ownership: 'org' },
        ['owner_id', 'owning_business_unit_id'],
      ],
      [
        "ownership: 'business_unit'",
        { ...external(), ownership: 'business_unit' },
        ['owner_id'],
      ],
    ];
    for (const [label, def, withheld] of cases) {
      for (const anchor of withheld) {
        expect(resolveInjectedColumnProvenance(def, anchor), `${label}: ${anchor}`).toBe('absent');
        expect(unprovisionedInjectedColumns(def), label).not.toContain(anchor);
      }
    }
  });

  it("'id' is the driver's column, not the injection's — always 'absent' here", () => {
    // `resolveInjectedSystemColumns` reports `id` as addressable, but no
    // injected DEFINITION exists for it, and on a federated object the
    // remote's own primary key backs it through the binding — so the marker
    // deliberately makes no claim about it.
    expect(resolveInjectedColumnProvenance(external(), 'id')).toBe('absent');
    expect(unprovisionedInjectedColumns(external())).not.toContain('id');
  });
});

describe('[#7865] unprovisionedInjectedColumns — the enumerable marker', () => {
  it('lists exactly the seven measured anchors for the showcase-shaped federated object', () => {
    expect(unprovisionedInjectedColumns(external()).sort()).toEqual([...SEVEN_ANCHORS].sort());
    expect(unprovisionedInjectedColumns(withInjectedAnchors(external())).sort()).toEqual(
      [...SEVEN_ANCHORS].sort(),
    );
  });

  it('is empty for every platform-provisioned object', () => {
    expect(unprovisionedInjectedColumns(local())).toEqual([]);
    expect(unprovisionedInjectedColumns(withInjectedAnchors(local()))).toEqual([]);
    expect(unprovisionedInjectedColumns(undefined)).toEqual([]);
  });
});

describe('[#7865] the fence: the marker lives in the API, never in the data', () => {
  it('no shipped definition table carries a provisioned key', () => {
    // The #7865 ruling's fence: the marker must not change what any consumer
    // accepts. Three consumers read these definitions by EXACT identity —
    // plugin-security's Layer-0 guard (#7859, key-count strict), the #4326
    // round-trip strip in this package, and FieldSchema's strictObject parse
    // of every served document. A `provisioned` key added to any of these
    // tables flips all three: the guard re-emits the phantom tenant predicate
    // (the measured zero-rows defect), the strip stops recognising its own
    // injection, and `/meta` stamps `_diagnostics: { valid: false }` on every
    // object (#6810's shape). If this pin is red, read
    // `resolveInjectedColumnProvenance`'s doc before proceeding.
    const tables: Array<[string, Readonly<Record<string, unknown>>]> = [
      ['TENANT_SCOPE_FIELD_DEF', TENANT_SCOPE_FIELD_DEF],
      ['OWNER_FIELD_DEF', OWNER_FIELD_DEF],
      ['OWNING_BUSINESS_UNIT_FIELD_DEF', OWNING_BUSINESS_UNIT_FIELD_DEF],
      ...Object.entries(AUDIT_FIELD_DEFS).map(
        ([k, v]) => [`AUDIT_FIELD_DEFS.${k}`, v] as [string, Readonly<Record<string, unknown>>],
      ),
    ];
    for (const [label, table] of tables) {
      expect('provisioned' in table, label).toBe(false);
    }
    // And the per-object defs derived from them — external or not — stay
    // byte-identical to the tables (the marker adds NOTHING to the data).
    const defs = injectedSystemColumnDefs(external());
    expect(defs.organization_id).toEqual(TENANT_SCOPE_FIELD_DEF);
    expect(defs.owner_id).toEqual(OWNER_FIELD_DEF);
  });
});
