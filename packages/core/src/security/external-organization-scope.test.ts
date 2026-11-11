// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under a walled tenancy posture every external object states its organization
 * scope (ADR-0015 §10) — the one reading of the declaration. The boot refusal,
 * the Layer 0 door and the write wall that read it are pinned in
 * `@objectstack/plugin-security`'s `external-organization-scope.test.ts`, which
 * also pins that the plugin re-exports these bindings rather than restating them.
 */

import { describe, it, expect } from 'vitest';
import { TENANT_SCOPE_FIELD_DEF } from '@objectstack/metadata-core';
import {
  externalOrganizationScopeOf,
  externalOrganizationScopeIsUndeclared,
} from './external-organization-scope.js';

const REMOTE_COLUMNS = { name: { type: 'text', label: 'Name' }, email: { type: 'text', label: 'Email' } };

/** The registry's view of an external object the author left silent: the remote columns plus the injected anchor. */
const undeclared = (extra: Record<string, unknown> = {}) => ({
  name: 'ext_customer',
  external: { remoteName: 'customers' },
  fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS },
  ...extra,
});

describe('externalOrganizationScopeOf — the one reading of the declaration', () => {
  it('a local object is not asked: `null`', () => {
    expect(externalOrganizationScopeOf({ name: 'task', fields: { organization_id: { ...TENANT_SCOPE_FIELD_DEF } } })).toBeNull();
  });

  it('an external object carrying only the injected anchor states nothing', () => {
    expect(externalOrganizationScopeOf(undeclared())).toBe('undeclared');
    expect(externalOrganizationScopeIsUndeclared(undeclared())).toBe(true);
  });

  it('an external object with no `organization_id` at all states nothing either', () => {
    expect(externalOrganizationScopeOf({ name: 'ext', external: { remoteName: 'x' }, fields: REMOTE_COLUMNS })).toBe('undeclared');
  });

  it("the author's own `organization_id` field walls the object", () => {
    const schema = { name: 'ext', external: { remoteName: 'x' }, fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS } };
    expect(externalOrganizationScopeOf(schema)).toBe('walled');
    expect(externalOrganizationScopeIsUndeclared(schema)).toBe(false);
  });

  it('the array `fields` shape reaches the same verdicts', () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' },
      fields: [{ name: 'organization_id', ...TENANT_SCOPE_FIELD_DEF }, { name: 'name', type: 'text' }],
    })).toBe('undeclared');
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' },
      fields: [{ name: 'organization_id', type: 'text', label: 'Org' }, { name: 'name', type: 'text' }],
    })).toBe('walled');
  });

  it('`tenancy: { enabled: false }` declares the object shared', () => {
    expect(externalOrganizationScopeOf({ name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: false }, fields: REMOTE_COLUMNS })).toBe('shared');
  });

  it('`systemFields.tenant: false` declares the object shared', () => {
    expect(externalOrganizationScopeOf({ name: 'ext', external: { remoteName: 'x' }, systemFields: { tenant: false }, fields: REMOTE_COLUMNS })).toBe('shared');
  });

  it("the whole-block `systemFields: false` is not one of the wall's opt-out clauses: alone it states nothing", () => {
    // The registry's recorded reading: the wall's `tenancyDisabled` has exactly
    // two clauses, and `systemFields: false` is in neither.
    const schema = { name: 'ext', external: { remoteName: 'x' }, systemFields: false, fields: REMOTE_COLUMNS };
    expect(externalOrganizationScopeOf(schema)).toBe('undeclared');
    expect(externalOrganizationScopeIsUndeclared(schema)).toBe(true);
  });

  it('an object with its own `organization_id` beside `systemFields: false` is walled — never answered shared', () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' }, systemFields: false,
      fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS },
    })).toBe('walled');
  });

  it("an opt-out clause beside an own `organization_id` is shared, as the wall reads it (it composes nothing on an opted-out object)", () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: false },
      fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS },
    })).toBe('shared');
  });

  it('`tenancy.tenantField` naming another column is a declaration the wall cannot enforce', () => {
    const schema = {
      name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: true, tenantField: 'remote_org' },
      fields: { remote_org: { type: 'text', label: 'Remote org' }, organization_id: { ...TENANT_SCOPE_FIELD_DEF }, ...REMOTE_COLUMNS },
    };
    expect(externalOrganizationScopeOf(schema)).toBe('tenant-field-unenforceable');
    expect(externalOrganizationScopeIsUndeclared(schema)).toBe(true);
  });

  it("`tenancy.tenantField: 'organization_id'` beside a declared `organization_id` is the walled declaration", () => {
    expect(externalOrganizationScopeOf({
      name: 'ext', external: { remoteName: 'x' }, tenancy: { enabled: true, tenantField: 'organization_id' },
      fields: { organization_id: { type: 'text', label: 'Org' }, ...REMOTE_COLUMNS },
    })).toBe('walled');
  });

  it('`tenancy: { enabled: true }` alone declares nothing', () => {
    expect(externalOrganizationScopeOf(undeclared({ tenancy: { enabled: true } }))).toBe('undeclared');
  });
});
