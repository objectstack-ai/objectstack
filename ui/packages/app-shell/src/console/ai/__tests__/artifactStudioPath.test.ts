// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { artifactStudioPath } from '../artifactStudioPath';

/**
 * objectui#2623 — every AI-built artifact deep-links to its direct-edit home
 * (the Studio pillar where it can be changed by hand, no AI needed).
 */
describe('artifactStudioPath', () => {
  const pkg = 'app.rmpe';

  it("object → the object designer's address (objectstack#36904)", () => {
    expect(artifactStudioPath(pkg, { type: 'object', name: 'rmpe_customer' })).toBe(
      '/studio/app.rmpe/metadata/object/rmpe_customer',
    );
  });

  it('flow → Automations pillar (the reserved ?surface=flow: consumer gets its first producer)', () => {
    expect(artifactStudioPath(pkg, { type: 'flow', name: 'customer_lost_follow_up' })).toBe(
      '/studio/app.rmpe/automations?surface=flow%3Acustomer_lost_follow_up',
    );
  });

  // objectstack#36502 — the Interfaces pillar is retired: these open their All-metadata item page.
  it('dashboard / page → their All-metadata item page', () => {
    expect(artifactStudioPath(pkg, { type: 'dashboard', name: 'home_dashboard' })).toBe(
      '/studio/app.rmpe/metadata/dashboard/home_dashboard',
    );
    expect(artifactStudioPath(pkg, { type: 'page', name: 'welcome' })).toBe('/studio/app.rmpe/metadata/page/welcome');
  });

  it('view → its own All-metadata item page, by its qualified name', () => {
    expect(artifactStudioPath(pkg, { type: 'view', name: 'rmpe_customer.customer_list' })).toBe(
      '/studio/app.rmpe/metadata/view/rmpe_customer.customer_list',
    );
  });

  it('app → its All-metadata item page', () => {
    expect(artifactStudioPath(pkg, { type: 'app', name: 'customer_management' })).toBe(
      '/studio/app.rmpe/metadata/app/customer_management',
    );
  });

  it('artifacts with no direct-edit home return null (seed / dataset / unknown)', () => {
    expect(artifactStudioPath(pkg, { type: 'seed', name: 'rmpe_customer_sample' })).toBeNull();
    expect(artifactStudioPath(pkg, { type: 'dataset', name: 'rmpe_customer_ds' })).toBeNull();
    expect(artifactStudioPath(pkg, { type: 'mystery', name: 'x' })).toBeNull();
  });

  it('no package id or blank name → null (never a half-built link)', () => {
    expect(artifactStudioPath(undefined, { type: 'object', name: 'x' })).toBeNull();
    expect(artifactStudioPath(pkg, { type: 'object', name: '  ' })).toBeNull();
  });
});
