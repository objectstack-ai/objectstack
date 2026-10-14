// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `stackDeclaresOrganizationRecordPage` — the one yes/no both `AuthPlugin`
 * composition roots (`os serve`, `DevPlugin`) ask before they construct it:
 * does the served app declare its own default record page for
 * `sys_organization` (ruling A on objectstack#23015, record 6134056653)?
 *
 * Each YES case has a NO control that differs in exactly one declared fact,
 * so no case passes by reading nothing.
 */

import { describe, expect, it } from 'vitest';
import { stackDeclaresOrganizationRecordPage } from './stack-organization-record-page.js';

const page = (extra: Record<string, unknown> = {}) => ({
  name: 'host_organization_detail',
  label: 'Organization',
  type: 'record',
  object: 'sys_organization',
  isDefault: true,
  regions: [],
  ...extra,
});

describe('the stack\'s own pages', () => {
  it('yes: a default record page for sys_organization', () => {
    expect(stackDeclaresOrganizationRecordPage({ pages: [page()] })).toBe(true);
  });

  it('yes: a page that declares no `type` is a record page', () => {
    const { type: _omitted, ...untyped } = page();
    expect(stackDeclaresOrganizationRecordPage({ pages: [untyped] })).toBe(true);
  });

  it.each([
    ['isDefault: false', page({ isDefault: false })],
    ['no isDefault', page({ isDefault: undefined })],
    ['another object', page({ object: 'crm_account' })],
    ['not a record page', page({ type: 'home' })],
  ])('no: %s', (_label, candidate) => {
    expect(stackDeclaresOrganizationRecordPage({ pages: [candidate] })).toBe(false);
  });

  it('no: no pages, no stack', () => {
    expect(stackDeclaresOrganizationRecordPage({})).toBe(false);
    expect(stackDeclaresOrganizationRecordPage({ pages: [] })).toBe(false);
    expect(stackDeclaresOrganizationRecordPage(undefined)).toBe(false);
  });
});

describe('the packages a multi-package stack carries (ADR-0130 D4)', () => {
  const body = (pages: unknown[]) => ({ id: 'com.example.tenant', name: 'tenant', version: '1.0.0', type: 'app', pages });

  it('yes: a package body declares it and the top level carries no `pages`', () => {
    expect(stackDeclaresOrganizationRecordPage({ packages: [{ manifest: body([page()]) }] })).toBe(true);
  });

  it('no (control): the same package body without the default', () => {
    expect(stackDeclaresOrganizationRecordPage({ packages: [{ manifest: body([page({ isDefault: false })]) }] })).toBe(false);
  });
});

describe('the app bundles the root\'s plugins already carry', () => {
  it('yes: an app plugin\'s bundle declares it', () => {
    expect(stackDeclaresOrganizationRecordPage({}, [{ name: 'plugin.app.tenant', bundle: { pages: [page()] } }])).toBe(true);
  });

  it('no (control): the same bundle without the default, and plugins with no bundle', () => {
    expect(stackDeclaresOrganizationRecordPage({}, [{ bundle: { pages: [page({ isDefault: false })] } }])).toBe(false);
    expect(stackDeclaresOrganizationRecordPage({}, [{ name: 'x' }, null, 'str'])).toBe(false);
  });
});
