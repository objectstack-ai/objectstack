// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { artifactStudioPath } from '../artifactStudioPath';

/**
 * objectui#2623 — every AI-built artifact deep-links to its direct-edit home
 * (the Studio pillar where it can be changed by hand, no AI needed).
 */
describe('artifactStudioPath', () => {
  const pkg = 'app.rmpe';

  it('object → Data pillar with an object surface', () => {
    expect(artifactStudioPath(pkg, { type: 'object', name: 'rmpe_customer' })).toBe(
      '/studio/app.rmpe/data?surface=object%3Armpe_customer',
    );
  });

  it('flow → Automations pillar (the reserved ?surface=flow: consumer gets its first producer)', () => {
    expect(artifactStudioPath(pkg, { type: 'flow', name: 'customer_lost_follow_up' })).toBe(
      '/studio/app.rmpe/automations?surface=flow%3Acustomer_lost_follow_up',
    );
  });

  it('dashboard / page → Interfaces pillar with their own surface', () => {
    expect(artifactStudioPath(pkg, { type: 'dashboard', name: 'home_dashboard' })).toBe(
      '/studio/app.rmpe/interfaces?surface=dashboard%3Ahome_dashboard',
    );
    expect(artifactStudioPath(pkg, { type: 'page', name: 'welcome' })).toBe(
      '/studio/app.rmpe/interfaces?surface=page%3Awelcome',
    );
  });

  it('view → the OWNING OBJECT leaf on Interfaces (views are not nav leaves)', () => {
    expect(artifactStudioPath(pkg, { type: 'view', name: 'rmpe_customer.customer_list' })).toBe(
      '/studio/app.rmpe/interfaces?surface=object%3Armpe_customer',
    );
  });

  it('app → Interfaces pillar home (no surface)', () => {
    expect(artifactStudioPath(pkg, { type: 'app', name: 'customer_management' })).toBe(
      '/studio/app.rmpe/interfaces',
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
