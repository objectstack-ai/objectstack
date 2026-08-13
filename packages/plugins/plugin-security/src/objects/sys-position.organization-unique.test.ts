// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema } from '@objectstack/spec/data';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { SysPosition } from './sys-position.object';

/**
 * #8468 — `sys_position.name` is unique per ORGANIZATION, not per installation.
 *
 * ## What the bare spelling cost
 *
 * A DECLARED index's `unique: true` is the positional spelling of `'global'`
 * (the listed columns verbatim), so `name` was an installation-wide key on a
 * tenant-scoped object. Measured live on a real engine before the fix, two
 * organizations and the same name:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_position_name on sys_position (name)
 *
 * org_jia POST name=sales_manager  → 201
 * org_yi  POST the SAME name       → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused name      → 201
 * org_yi  GET  that name           → total 0
 * ```
 *
 * A per-value refusal on a row the caller cannot read is a cross-tenant
 * existence oracle; it was also a plain dead end, since the second organization
 * could never name a position `sales_manager` and the 409 does not say why.
 *
 * ## Why per-organization is the CORRECT boundary, not merely the safe one
 *
 * Positions are admin-authored — `managed_by` defaults to `'admin'`, admins
 * create them in Setup and via the `clone_position` action — so two
 * organizations naming a position `sales_manager` are not in conflict. The
 * maintainer ruling of 2026-08-13 settles the family this way.
 *
 * The hierarchy counter-argument weighed during triage does not apply to this
 * object at all: positions are deliberately FLAT (ADR-0090 D3, finalizing
 * ADR-0057 D5). `noPositionHierarchy` below pins that, because the argument for
 * an installation-wide namespace would have to come from somewhere, and a
 * `parent_id` appearing here later is exactly when someone would revisit it.
 *
 * Platform-seeded rows (`bootstrapBuiltinRoles`) carry no organization and the
 * organization key part is NULL-safe (`COALESCE(organization_id,'__global__')`,
 * ADR-0120 D3), so they stay unique among themselves. That behaviour, the
 * materialized shape, and the migration of an installation that already carries
 * the old index are pinned driver-side in
 * `driver-sql/src/sql-driver-sys-position-organization-unique.test.ts`; this
 * test pins the declaration that suite's fixture copies.
 */
describe('sys_position — declared uniqueness is organization-scoped (#8468)', () => {
  const uniqueIndexes = (SysPosition.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (name)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect((uniqueIndexes[0] as any).fields).toEqual(['name']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Bare `true` here is `'global'` — the installation-wide key that made
    // the 409 an oracle over other tenants' rows. Asserted by equality, never
    // by truthiness: a truthy check accepts the very spelling that was the bug.
    expect((uniqueIndexes[0] as any).unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['name'],
      unique: 'organization',
    });
  });

  it('leaves the non-unique indexes alone', () => {
    // Scope discipline: #8468 changes uniqueness scope, nothing else.
    expect((SysPosition.indexes ?? []).map((i: any) => [i.fields, i.unique ?? false])).toEqual([
      [['name'], 'organization'],
      [['active'], false],
    ]);
  });

  it('matches the fixture the driver suite copies, entry for entry', () => {
    // The driver suite hand-copies this declaration to keep the package
    // boundary; without this assertion the two could drift apart silently and
    // the driver suite would go on proving something about a fixture nobody
    // ships. Keep both sides in step.
    //
    // Asserted on the BUILT value, which is what a driver is handed:
    // `ObjectSchema.create` normalizes the authored `{ fields: ['active'] }`
    // into `{ fields: ['active'], unique: false }`. The source spelling and the
    // runtime spelling are not the same object, and a fixture copied from the
    // source text alone would be subtly wrong about what the driver sees.
    expect(SysPosition.indexes).toEqual([
      { fields: ['name'], unique: 'organization' },
      { fields: ['active'], unique: false },
    ]);
  });

  it('takes no tenancy opt-out, so organization_id is injected (the scope has a column)', () => {
    // Derived from the built value, not a regex over source. If this ever goes
    // false the `'organization'` spelling has no column to key on and the whole
    // fix is inert — a silent failure the index assertions above cannot see.
    const plan = resolveInjectedSystemColumns(SysPosition);
    expect(SysPosition.tenancy).toBeUndefined();
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });

  it('noPositionHierarchy: there is no parent_id, so no shared-namespace argument', () => {
    // ADR-0090 D3 / ADR-0057 D5. The triage that produced the ruling treated a
    // position hierarchy as the one candidate reason to want an
    // installation-wide namespace; this object has none.
    expect(Object.keys(SysPosition.fields)).not.toContain('parent_id');
    expect(Object.keys(SysPosition.fields)).not.toContain('parent');
  });
});
