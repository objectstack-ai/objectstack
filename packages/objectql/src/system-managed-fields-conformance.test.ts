// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PUBLIC_FORM_SERVER_MANAGED_FIELDS } from '@objectstack/spec/security';
import { SystemFieldName } from '@objectstack/spec/system';
import { applySystemFields, SEARCH_COMPANION_FIELD } from './index.js';

// ---------------------------------------------------------------------------
// [#3058] Single-source conformance for the server-managed field set.
//
// `PUBLIC_FORM_SERVER_MANAGED_FIELDS` (@objectstack/spec/security) is the shared
// denylist that BOTH the anonymous public-form enforcement points read — the
// REST form-route allow-list (@objectstack/rest) and the data-layer grant strip
// (@objectstack/plugin-security). It has to name every column the server manages
// on its own, because on the anonymous surface nothing else guards them.
//
// The risk it carries is DRIFT: the actual server-managed columns are assembled
// from three unrelated injection sites (the registry's `applySystemFields`, the
// search-companion, the driver primary key) plus a few defense-in-depth reserved
// names — none of which imports the denylist. When #3022 first shipped this set,
// the fields were hand-copied; a new injected system field added later would
// silently leak through the public-form surface with no test to catch it.
//
// This test pins the denylist to an EXACT partition of two documented groups, so
// adding an injected system field (or a stray denylist entry) fails loudly here
// with a message pointing at what to reconcile — rather than becoming a live
// anonymous-write hole. It deliberately does NOT re-hardcode the 11 names; it
// derives the injected group from the real injection code.
// ---------------------------------------------------------------------------
describe('[#3058] PUBLIC_FORM_SERVER_MANAGED_FIELDS conformance', () => {
  // Group A — columns OPEN-CORE actively injects onto a plain author-defined
  // business object. Enumerated from the real injection code, not re-listed, so
  // a new injected field is caught automatically.
  const injectedByRegistry = (): string[] => {
    const base: any = { name: 'proj', fields: { title: { type: 'text' } } };
    // multiTenant:true exercises the widest injection (organization_id included).
    const withSys = applySystemFields(base, { multiTenant: true });
    return Object.keys(withSys.fields ?? {}).filter((k) => !(k in base.fields));
  };

  const activelyInjected = (): Set<string> =>
    new Set<string>([
      ...injectedByRegistry(), // organization_id, created_at, created_by, updated_at, updated_by, owner_id
      SEARCH_COMPANION_FIELD, // '__search' — hidden search-normalization companion (search-companion.ts)
      SystemFieldName.ID, // 'id' — driver-provisioned primary key
    ]);

  // Group B — names in the denylist that open-core does NOT inject as a schema
  // field, kept as defense-in-depth so a forged value can never be admitted on
  // the anonymous surface even where the column is contributed elsewhere:
  //   • tenant_id  — legacy/enterprise tenant key (not injected by open-core).
  //   • is_deleted / deleted_at — soft-delete state, written by the lifecycle/
  //     trash layer at runtime, never client-suppliable on a public form.
  const reservedDefenseInDepth = new Set<string>([
    SystemFieldName.TENANT_ID, // 'tenant_id'
    'is_deleted',
    SystemFieldName.DELETED_AT, // 'deleted_at'
  ]);

  it('registry injection actually produces the fields this test reasons about', () => {
    // Guards the test itself: if applySystemFields stops injecting these, the
    // conformance assertions below would pass vacuously.
    const injected = new Set(injectedByRegistry());
    for (const f of ['organization_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'owner_id']) {
      expect(injected.has(f)).toBe(true);
    }
  });

  it('every server-injected system field is on the public-form denylist (no anonymous-write leak)', () => {
    // The load-bearing direction: a new injected system field MUST be added to
    // PUBLIC_FORM_SERVER_MANAGED_FIELDS, or it becomes client-suppliable on the
    // anonymous public-form surface.
    for (const field of activelyInjected()) {
      expect(
        PUBLIC_FORM_SERVER_MANAGED_FIELDS.has(field),
        `server-injected field '${field}' is missing from PUBLIC_FORM_SERVER_MANAGED_FIELDS ` +
          `(packages/spec/src/security/public-form.ts) — add it or it leaks through the public-form surface`,
      ).toBe(true);
    }
  });

  it('the denylist is exactly (actively-injected ∪ documented-reserved) — no stray or missing entries', () => {
    const accountedFor = new Set<string>([...activelyInjected(), ...reservedDefenseInDepth]);
    const denylist = new Set<string>(PUBLIC_FORM_SERVER_MANAGED_FIELDS);

    // No denylist entry is unexplained (a name nothing injects and not documented
    // as reserved → either dead weight or a mis-categorized new field).
    for (const field of denylist) {
      expect(
        accountedFor.has(field),
        `'${field}' is on PUBLIC_FORM_SERVER_MANAGED_FIELDS but is neither injected by open-core ` +
          `nor listed as defense-in-depth reserved in this test — classify it`,
      ).toBe(true);
    }
    // And every accounted-for name is on the denylist (covered field-by-field for
    // the injected group above; this closes the reserved group too).
    for (const field of accountedFor) {
      expect(denylist.has(field), `'${field}' should be on PUBLIC_FORM_SERVER_MANAGED_FIELDS`).toBe(true);
    }
    // Exact partition ⇒ identical cardinality (catches a duplicate/renamed entry).
    expect(denylist.size).toBe(accountedFor.size);
  });
});
