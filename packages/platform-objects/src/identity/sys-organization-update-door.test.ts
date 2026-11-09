// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15873 — `sys_organization`'s data door admits `update`, and nothing else on
 * the declaration moved (maintainer ruling 2026-09-07, decision batch #64,
 * option (a), verbatim 「同意」).
 *
 * The card: four platform-owned columns (`require_mfa`,
 * `parent_organization_id`, `sort_order`, `timezone`) were declared generically
 * editable in plugin-auth's `MANAGED_EXTENSION_EDITABLE_FIELDS` — the ADR-0092
 * D2 identity write guard's per-object update whitelist — while this object's
 * `enable.apiMethods: ['get', 'list']` answered 405 to every PATCH before the
 * engine, and the guard, were ever reached. Declared editable, reachable from
 * nowhere. The ruling widens the METHOD gate and leaves the COLUMN gate to the
 * whitelist that already exists for exactly this.
 *
 * This file pins the DECLARATION, from source. Three things about it are each
 * a way the widening could silently fail to be what was ruled:
 *
 *  1. the verb set is `update` and only `update` — `create` / `delete` stay
 *     405 (organizations are minted and destroyed through better-auth's own
 *     endpoints), and `bulk` is not granted (the ruling widened one verb; the
 *     single-record-only choice is recorded in `SINGLE_RECORD_WRITE_ONLY`,
 *     `@objectstack/spec`'s `api-methods-batch-conformance.test.ts`);
 *  2. the verb SURVIVES registration. A `managedBy` object runs through
 *     `reconcileManagedApiMethods` (objectql registry, ADR-0092 / ADR-0103 D3),
 *     which strips any write verb the resolved affordances do not grant and
 *     only warns — so `update` in `apiMethods` with no `userActions.edit` is a
 *     declaration that serves 405 anyway (the second silent gate #7727 measured
 *     on `sys_api_key`). The predicate the registry calls is asked here
 *     directly, with a positive control proving it can still refuse;
 *  3. better-auth's own door for its own columns is untouched: the row actions
 *     still target `organization/update` with `name` / `slug` / `logo`.
 *
 * The RUNTIME half — that the real door answers 200 for a whitelisted column
 * and 403 `PERMISSION_DENIED` (not 405, not 200) for a better-auth column — is
 * `organization-update-door.dogfood.test.ts` in `packages/qa/dogfood`; the
 * form-facing D4 partition (whitelisted columns writable, everything else
 * `readonly`) is `sys-organization-update-door.test.ts` in plugin-auth, which
 * derives it from the shipped whitelist rather than re-spelling it.
 */

import { describe, it, expect } from 'vitest';
import { checkManagedApiMethodAffordances } from '@objectstack/spec/data';
import { SysOrganization } from './sys-organization.object';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';

describe('#15873 — sys_organization.enable.apiMethods admits `update`, and only `update`', () => {
  it('declares exactly get / list / update — no create, no delete, no bulk', () => {
    expect(SysOrganization.enable?.apiMethods).toEqual(['get', 'list', 'update']);
  });

  it('opens the generic EDIT affordance alone, so the verb survives `reconcileManagedApiMethods`', () => {
    // `managedBy: 'better-auth'` defaults every write affordance to off; the
    // one override is `edit`. `create` / `delete` / `import` stay bucket-default.
    expect(SysOrganization.managedBy).toBe('better-auth');
    expect(SysOrganization.userActions).toEqual({ edit: true });
  });

  it('the registry predicate keeps every declared verb — `update` is not stripped at registration', () => {
    // The SAME predicate objectql's registry calls before it strips a verb
    // (`checkManagedApiMethodAffordances` → `reconcileManagedApiMethods`). An
    // empty conflict list is "the declaration and the runtime agree".
    expect(checkManagedApiMethodAffordances(SysOrganization)).toEqual([]);
  });

  it('positive control: without `userActions.edit` the same predicate names `update` as stripped', () => {
    // A zero-conflict answer above is only a reading if the predicate can
    // still refuse this object. Remove the affordance and it must.
    const { userActions: _dropped, ...withoutAffordance } = SysOrganization as any;
    const conflicts = checkManagedApiMethodAffordances(withoutAffordance);
    expect(conflicts.map((c) => c.verb)).toEqual(['update']);
  });
});

describe('#15873 — better-auth keeps its own door for its own columns', () => {
  const action = (name: string) => (SysOrganization.actions ?? []).find((a: any) => a?.name === name) as any;

  it('`update_organization` still targets better-auth `organization/update` with name / slug / logo', () => {
    const update = action('update_organization');
    expect(update, 'update_organization must stay declared').toBeTruthy();
    expect(update.target).toBe('/api/v1/auth/organization/update');
    expect(update.bodyShape).toEqual({ wrap: 'data' });
    expect((update.params ?? []).map((p: any) => p.field)).toEqual(['name', 'slug', 'logo']);
  });

  it('`create_organization` still targets better-auth `organization/create` — the data door does not create', () => {
    const create = action('create_organization');
    expect(create, 'create_organization must stay declared').toBeTruthy();
    expect(create.target).toBe('/api/v1/auth/organization/create');
  });
});

describe('require_mfa is retired: its help sends the reader to the access policy, in the source and in every locale', () => {
  const bundles = { en: enObjects, 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects };

  it('the column is readonly, and its description names where the requirement lives now', () => {
    expect(SysOrganization.fields.require_mfa?.readonly).toBe(true);
    expect(SysOrganization.fields.require_mfa?.description).toMatch(/Access policy/);
  });

  it.each(Object.entries(bundles))('%s: the generated help is present', (_locale, bundle) => {
    expect((bundle as any).sys_organization?.fields?.require_mfa?.help).toEqual(expect.any(String));
  });

  it('the en bundle is the source, verbatim (the generator writes it)', () => {
    expect((enObjects as any).sys_organization.fields.require_mfa.help).toBe(SysOrganization.fields.require_mfa?.description);
  });
});
