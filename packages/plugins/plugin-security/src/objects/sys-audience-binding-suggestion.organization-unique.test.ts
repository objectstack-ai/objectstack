// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema } from '@objectstack/spec/data';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { SysAudienceBindingSuggestion } from './sys-audience-binding-suggestion.object.js';

/**
 * #8577 — `sys_audience_binding_suggestion`'s declared uniqueness is
 * organization-scoped.
 *
 * ## This one is not a naming oracle — it is a functional dead end
 *
 * The rest of the #8323 class is about two tenants wanting the same *name*.
 * Here the key is `(package_id, permission_set_name, anchor)`, and all three
 * come from the PACKAGE'S OWN manifest — so it is **the same triple for every
 * tenant that installs the same package**, while the row is per-tenant by
 * construction (produced when the declaration is observed, resolved when a
 * TENANT ADMIN confirms). Under the installation-wide key, the second and every
 * later organization to install a package never got its suggestion row: its
 * admins were never prompted, and its users never received the package's
 * default permission set. ADR-0090 D5/D9 exists so an install never
 * auto-binds; the effect was that for every tenant after the first it was never
 * bound at all, and nothing said so — `syncAudienceBindingSuggestions` swallows
 * the insert failure in a bare `catch` it reads as a benign concurrent-sync
 * race.
 *
 * Measured live BEFORE the fix, driving this shipped declaration through
 * `SqlDriver` under `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_audience_binding_suggestion_79a05fef
 *   on sys_audience_binding_suggestion (package_id, permission_set_name, anchor)
 *
 * org_jia POST (com.acme.crm, sales_readonly, everyone) → 201
 * org_yi  POST the SAME       → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused set  → 201          ← the control that makes it an ORACLE
 * org_yi  GET  the key        → total 0      ← refused by a row it cannot see
 * ```
 *
 * ⚠️ `managedBy: 'engine-owned'` is not a reason to exempt it. The management
 * mode says who WRITES the rows; the ruling's question is whose CONTENT they
 * are, and these rows are one tenant's pending admin decision.
 *
 * ⚠️ BOTH index names are hash-suffixed here (74 and 90 characters before
 * truncation, past `INDEX_NAME_MAX = 60`) and they share the same 37-character
 * head — only the sha1 prefix separates
 * `uniq_sys_audience_binding_suggestion_79a05fef` from
 * `uniq_sys_audience_binding_suggestion_a736dc5a`. Had they collapsed to one
 * string, `legacyName === replacement.name` would have read the respelling as
 * "nothing was superseded" and emitted no migration at all. Pinned driver-side.
 *
 * The materialized shape, the anti-vacuity twin (a SAME-organization duplicate
 * must still be refused), and the migration of an installation that already
 * carries the old index are pinned in
 * `driver-sql/src/sql-driver-8577-tenant-scoped-declared-unique.test.ts`; the
 * install path — two organizations installing the same package, each ending up
 * with its own row — is pinned through the REAL sync in
 * `../suggested-audience-bindings-install-path.test.ts`. This test pins the
 * declaration both of those rest on.
 */
describe('sys_audience_binding_suggestion — declared uniqueness is organization-scoped (#8577)', () => {
  const uniqueIndexes = (SysAudienceBindingSuggestion.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (package_id, permission_set_name, anchor)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect((uniqueIndexes[0] as any).fields).toEqual([
      'package_id',
      'permission_set_name',
      'anchor',
    ]);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Asserted by EQUALITY, never by truthiness: `true` is truthy and the
    // `.filter((i) => i.unique)` above still matches it, so a truthiness check
    // here accepts the exact spelling that was the defect.
    expect((uniqueIndexes[0] as any).unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['package_id', 'permission_set_name', 'anchor'],
      unique: 'organization',
    });
  });

  it('matches the fixture the driver suite copies, entry for entry', () => {
    // One direction of drift only: a change HERE that is not mirrored in the
    // driver fixture goes red; a change to the driver fixture alone does not.
    // Asserted on the BUILT value — `ObjectSchema.create` normalizes an
    // authored `{ fields: ['status'] }` into `{ fields: ['status'], unique: false }`,
    // which is what the driver is actually handed.
    expect(SysAudienceBindingSuggestion.indexes).toEqual([
      { fields: ['package_id', 'permission_set_name', 'anchor'], unique: 'organization' },
      { fields: ['status'], unique: false },
      { fields: ['package_id'], unique: false },
    ]);
  });

  it('takes no tenancy opt-out, so organization_id is injected (the scope has a column)', () => {
    // Derived from the BUILT value, not a regex over source. If this ever goes
    // false the `'organization'` spelling has no column to key on and the whole
    // fix is silently inert.
    const plan = resolveInjectedSystemColumns(SysAudienceBindingSuggestion);
    expect(SysAudienceBindingSuggestion.tenancy).toBeUndefined();
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });
});
