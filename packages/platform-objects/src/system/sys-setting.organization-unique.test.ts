// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema, resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { SpecifierScopeSchema } from '@objectstack/spec/system';
import { SysSetting } from './sys-setting.object.js';

/**
 * #8555 — `sys_setting`'s declared uniqueness is organization-scoped.
 *
 * ## The fork this card was filed on, and how it was decided
 *
 * The card deliberately asserted no defect. A DECLARED index's `unique: true`
 * is the positional spelling of `'global'` (the listed columns verbatim), so
 * `(namespace, key, scope, user_id)` was an installation-wide key on a
 * tenant-scoped object — but `sys_setting` had an argument the other five
 * #8554 objects did not: if `scope` ITSELF encoded tenancy, the installation-
 * wide key was correct and the right end state was an explicit `'global'`.
 *
 * It does not. `scope` is the cascade LAYER, not the tenant:
 *
 *   - Its value domain is `global | tenant | user` — a priority ladder walked
 *     env > global > tenant > user > default, ranked by `scopeRank`. Pinned
 *     against the spec enum in `sys-setting.scope-options.test.ts`.
 *   - `SettingsService.loadRows` says the organization dimension lives
 *     elsewhere outright: "per-tenant isolation for `tenant`-scope rows is
 *     still enforced by the engine". The column is `organization_id`.
 *   - `upsertRow` keys on `(namespace, key, scope, user_id)` and bypasses the
 *     tenant audit ONLY for `scope='global'` rows, "because global rows are
 *     platform-wide" — i.e. `tenant`/`user` rows do carry an organization.
 *   - The `lifecycle` manifest is built on it: `retention_overrides` is
 *     `scope: 'tenant'` precisely so "regulated tenants set years; dev sets
 *     days ... one deployment can carry both" (ADR-0057 §3.2).
 *
 * So `scope='tenant'` means "the organization layer" — one row per
 * organization — and the card's second branch applies: this is the sixth
 * instance of the #8323 class and inherits the 2026-08-13 ruling.
 *
 * ## What was measured live, before the fix
 *
 * Real `SqlDriver`, the real shipped declaration, `OS_TENANCY_POSTURE=isolated`:
 *
 * ```
 * CREATE UNIQUE INDEX uniq_sys_setting_namespace_key_scope_user_id
 *   on sys_setting (namespace, key, scope, user_id)
 *
 * scope='user'    org_jia POST (mail, smtp_host, user, usr_1) → 201
 *                 org_yi  POST the SAME                       → 409 UNIQUE_VIOLATION
 *                 org_yi  POST an unused key                  → 201   ← the ORACLE control
 *                 org_yi  GET  the colliding key              → 0 rows
 * scope='tenant'  org_jia 201 / org_yi the SAME → 201
 * scope='global'  platform 201 / platform the SAME → 201
 * ```
 *
 * The 409 is the class defect, and it is the limb that carries real user
 * preferences. The two 201s are a SECOND, independent defect that this card
 * does not close and this test does not claim: `user_id` is NULL on every
 * `tenant`/`global` row, SQL UNIQUE is NULL-distinct, so the declared row
 * identity is unenforced there — even inside one organization. See the driver
 * suite's section 4, which pins that hole as a live fact rather than leaving
 * the respelling to imply a fix it does not deliver.
 *
 * The materialized shape, the anti-vacuity twin, and the migration of an
 * installation that already carries the old index are pinned driver-side in
 * `driver-sql/src/sql-driver-sys-setting-organization-unique.test.ts`. This
 * test pins the declaration that suite's fixture copies.
 */
describe('sys_setting — declared uniqueness is organization-scoped (#8555)', () => {
  const uniqueIndexes = (SysSetting.indexes ?? []).filter((i: any) => i.unique);

  it('declares exactly one unique index, on (namespace, key, scope, user_id)', () => {
    expect(uniqueIndexes).toHaveLength(1);
    expect((uniqueIndexes[0] as any).fields).toEqual(['namespace', 'key', 'scope', 'user_id']);
  });

  it("spells the scope 'organization' — NOT bare `true`", () => {
    // ⛔ Asserted by EQUALITY, never by truthiness. Bare `true` here IS the bug
    // (it is the positional spelling of `'global'`), so a truthy check passes
    // on the exact value this card removed — the way #8556's equivalent pin
    // stayed green under its own ablation.
    expect((uniqueIndexes[0] as any).unique).toBe('organization');
  });

  it('is not left as a positional default in EITHER direction (ADR-0120 D1)', () => {
    // The card's own closing condition: whichever branch the reading landed on,
    // the end state must state its scope. This is the assertion that would also
    // have held had the measurement gone the other way (to `'global'`), so it
    // survives a future re-reading of `SettingsService` without being rewritten.
    expect(['organization', 'global']).toContain((uniqueIndexes[0] as any).unique);
    expect((uniqueIndexes[0] as any).unique).not.toBe(true);
  });

  it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
    expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
      fields: ['namespace', 'key', 'scope', 'user_id'],
      unique: 'organization',
    });
  });

  it('matches the fixture the driver suite copies, entry for entry', () => {
    // The driver suite hand-copies this declaration to keep the package
    // boundary (the shape #8461, #8556 and #8554 used). This catches ONE
    // direction of drift: the shipped declaration changing while the driver
    // fixture does not. The reverse is unguarded — nothing compares the two
    // copies directly.
    //
    // Asserted on the BUILT value: `ObjectSchema.create` normalizes an authored
    // `{ fields: [...] }` into `{ fields: [...], unique: false }`, so a fixture
    // copied from the source text alone would be subtly wrong about what the
    // driver is handed.
    expect(SysSetting.indexes).toEqual([
      { fields: ['namespace', 'key', 'scope', 'user_id'], unique: 'organization' },
      { fields: ['namespace', 'scope'], unique: false },
      { fields: ['user_id', 'namespace'], unique: false },
    ]);
  });

  it('takes no tenancy opt-out, so organization_id is injected (the scope has a column)', () => {
    // Derived from the BUILT value, not a regex over source. If this ever goes
    // false the `'organization'` spelling has no column to key on and the whole
    // fix is silently inert — a failure the index assertions above cannot see.
    const plan = resolveInjectedSystemColumns(SysSetting);
    expect(SysSetting.tenancy).toBeUndefined();
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });

  it('`scope` is the cascade layer, not a tenant identity — the fact that decided the fork', () => {
    // The load-bearing reading, pinned so a future sweep re-raising "shouldn't
    // sys_setting be global?" is answered by a test rather than by re-reading
    // the resolver. `scope`'s domain is the spec's cascade enum; none of its
    // members names an organization, and `organization_id` is not among them.
    const layers = SpecifierScopeSchema.options as readonly string[];
    expect([...layers].sort()).toEqual(['global', 'tenant', 'user']);
    expect(layers).not.toContain('organization_id');

    const scopeField = (SysSetting.fields as any).scope;
    expect(scopeField.options.map((o: any) => o.value)).toEqual([...layers]);
    // …and the unique key lists `scope` as an ordinary key column, so it
    // partitions the ladder, not the tenants.
    expect((uniqueIndexes[0] as any).fields).toContain('scope');
  });
});
