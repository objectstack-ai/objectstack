// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36905 — every Access pillar address lands on the page that
 * replaced it: a set on its metadata address, the sharing overview on its own
 * route, anything else on the list of sets; other parameters ride along.
 */

import { describe, expect, it } from 'vitest';
import { accessPillarRedirect } from './accessPillarRedirect.js';

describe('accessPillarRedirect (objectstack#36905)', () => {
  it('a set opens its metadata address, bound to the package', () => {
    expect(accessPillarRedirect('crm', '?surface=permission%3Asales_rep')).toBe(
      '/studio/crm/metadata/permission/sales_rep?package=crm',
    );
    // The `name` spelling of the deep link (colon as written) reads the same.
    expect(accessPillarRedirect('crm', 'surface=permission:sales%20rep')).toBe(
      '/studio/crm/metadata/permission/sales%20rep?package=crm',
    );
  });

  it('the sharing overview opens its own route', () => {
    expect(accessPillarRedirect('crm', '?surface=owd%3Aoverview')).toBe('/studio/crm/owd');
  });

  it('a bare pillar, or a surface it never opened, lands on the list of sets', () => {
    expect(accessPillarRedirect('crm', '')).toBe('/studio/crm/metadata/permission?package=crm');
    expect(accessPillarRedirect('crm', '?surface=object%3Aaccount')).toBe('/studio/crm/metadata/permission?package=crm');
    expect(accessPillarRedirect('crm', '?surface=permission%3A')).toBe('/studio/crm/metadata/permission?package=crm');
  });

  it('carries every other parameter, and drops `?surface=`', () => {
    expect(accessPillarRedirect('crm', '?surface=owd%3Aoverview&changes=review')).toBe('/studio/crm/owd?changes=review');
    expect(accessPillarRedirect('crm', '?changes=review&surface=permission%3Aa')).toBe(
      '/studio/crm/metadata/permission/a?changes=review&package=crm',
    );
    // A `?package=` naming another package is overwritten: the route's package is the set's.
    expect(accessPillarRedirect('crm', '?package=other&surface=permission%3Aa')).toBe(
      '/studio/crm/metadata/permission/a?package=crm',
    );
  });
});
