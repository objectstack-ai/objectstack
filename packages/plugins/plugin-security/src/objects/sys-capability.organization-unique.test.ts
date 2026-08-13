// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema } from '@objectstack/spec/data';
import { SysCapability } from './sys-capability.object';

/**
 * #8323 — `sys_capability.name` is unique per ORGANIZATION, not per
 * installation.
 *
 * ## What the bare spelling cost
 *
 * A DECLARED index's `unique: true` is the positional spelling of `'global'`
 * (the listed columns verbatim), so `name` was an installation-wide key on a
 * tenant-scoped object. Measured on an `isolated` deployment: an organization
 * could POST a capability name and read `409` vs `201` to learn whether ANY
 * other organization — or the platform seed — already held it, while its own
 * `GET` on that name returned `total 0`. A refusal on a row you are not
 * permitted to see is an existence oracle, and under the posture sold as
 * "legal-entity / sovereignty isolation" it crosses the wall it advertises.
 *
 * ADR-0066 D1 is the reason per-organization is the CORRECT boundary and not
 * merely the safe one: the platform DEFINES capabilities and admins EXTEND them
 * in Setup (`managed_by: 'admin'`, `scope: 'org'`), so two organizations
 * naming a capability the same way are not in conflict.
 *
 * Platform-seeded rows carry no organization and the organization key part is
 * NULL-safe (`COALESCE(organization_id,'__global__')`, ADR-0120 D3), so they
 * remain unique among themselves — which is what
 * `bootstrapSystemCapabilities`' upsert-by-name relies on. That behaviour is
 * pinned driver-side in
 * `driver-sql/src/sql-driver-declared-index-organization-respelling.test.ts`;
 * this test pins the declaration its fixture copies.
 */
describe('sys_capability — declared uniqueness is organization-scoped (#8323)', () => {
  const uniqueIndexes = (SysCapability.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (name)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect(uniqueIndexes[0].fields).toEqual(['name']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Bare `true` here is `'global'` — the installation-wide key that made
    // the 409 an oracle over other tenants' rows.
    expect(uniqueIndexes[0].unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['name'],
      unique: 'organization',
    });
  });

  it('leaves the non-unique indexes alone', () => {
    // Scope discipline: #8323 changes uniqueness scope, nothing else. The
    // `package_id` index is ADR-0086 D3's uninstall/upgrade query.
    expect((SysCapability.indexes ?? []).map((i: any) => [i.fields, i.unique ?? false])).toEqual([
      [['name'], 'organization'],
      [['scope'], false],
      [['active'], false],
      [['package_id'], false],
    ]);
  });
});
