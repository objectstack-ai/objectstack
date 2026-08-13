// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema } from '@objectstack/spec/data';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { SysEmailTemplate } from './sys-email-template.object';

/**
 * #8554 — `sys_email_template`'s declared uniqueness is organization-scoped.
 *
 * ## What the bare spelling cost
 *
 * A DECLARED index's `unique: true` is the positional spelling of `'global'`
 * (the listed columns verbatim), so the composite `(name, locale)` was an installation-wide key on a
 * tenant-scoped object. Measured live on a real engine BEFORE the fix, driving
 * this shipped declaration through `SqlDriver` under
 * `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_email_template_name_locale
 *   on sys_email_template (name, locale)
 *
 * org_jia POST (welcome, en-US)  → 201
 * org_yi  POST the SAME    → 409 UNIQUE_VIOLATION
 * org_yi  POST an unused   → 201            ← the control that makes it an ORACLE
 * org_yi  GET  the key     → total 0        ← refused by a row it cannot see
 * ```
 *
 * ## Why per-organization is the CORRECT boundary, not merely the safe one
 *
 * The object's own header says administrators author and edit templates in
 * Studio and that tenants may overlay specific rows. Two organizations both
 * holding a `welcome` template in `en-US` is the normal case.
 *
 * ⚠️ This is one of the two COMPOSITE cases in #8554 — the shapes the
 * `replace_unique_index` arm had not been exercised on before this card, and
 * where a single-column assumption would have hidden. The probe therefore ran a
 * second control varying only `locale` (accepted, before and after), which is
 * what proves the installation-wide key was the composite rather than `name`
 * alone.
 *
 * The materialized shape, the anti-vacuity twin (a SAME-organization duplicate
 * must still be refused), and the migration of an installation that already
 * carries the old index are pinned driver-side in
 * `driver-sql/src/sql-driver-tenant-scoped-declared-unique.test.ts`. This test
 * pins the declaration that suite's fixture copies.
 */
describe('sys_email_template — declared uniqueness is organization-scoped (#8554)', () => {
  const uniqueIndexes = (SysEmailTemplate.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (name, locale)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect((uniqueIndexes[0] as any).fields).toEqual(['name', 'locale']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Bare `true` here is `'global'` — the installation-wide key that made
    // the 409 an oracle over other tenants' rows. Asserted by EQUALITY, never
    // by truthiness: a truthy check accepts the very spelling that was the bug,
    // which is how #8556's equivalent pin stayed green under its own ablation.
    expect((uniqueIndexes[0] as any).unique).toBe('organization');
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['name', 'locale'],
      unique: 'organization',
    });
  });

  it('matches the fixture the driver suite copies, entry for entry', () => {
    // The driver suite hand-copies this declaration to keep the package
    // boundary (the shape #8461 and #8556 used). This assertion catches ONE
    // direction of drift:
    //
    //   caught     — the shipped declaration changes and the driver fixture
    //                does not. This test goes red.
    //   NOT caught — the DRIVER fixture is edited and this declaration is not.
    //                Nothing compares the two copies directly; they are only
    //                ever checked against this third spelling.
    //
    // Asserted on the BUILT value, which is what a driver is handed:
    // `ObjectSchema.create` normalizes an authored `{ fields: [...] }` into
    // `{ fields: [...], unique: false }`. A fixture copied from the source
    // text alone would be subtly wrong about what the driver sees.
    expect(SysEmailTemplate.indexes).toEqual([
      { fields: ['name', 'locale'], unique: 'organization' },
      { fields: ['category'], unique: false },
      { fields: ['active'], unique: false },
    ]);
  });

  it('takes no tenancy opt-out, so organization_id is injected (the scope has a column)', () => {
    // Derived from the BUILT value, not a regex over source. If this ever goes
    // false the `'organization'` spelling has no column to key on and the whole
    // fix is silently inert — a failure the index assertions above cannot see.
    const plan = resolveInjectedSystemColumns(SysEmailTemplate);
    expect(SysEmailTemplate.tenancy).toBeUndefined();
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });
});
