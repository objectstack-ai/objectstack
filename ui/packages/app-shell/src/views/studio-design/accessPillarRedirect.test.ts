// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36905 — every Access pillar address lands on the page that
 * replaced it: a set on its metadata address, the sharing overview on its own
 * route, anything else on the list of sets; other parameters ride along.
 */

import { describe, expect, it } from 'vitest';
import { accessPillarRedirect, accessPillarSetHolder, accessPillarSetName } from './accessPillarRedirect.js';

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

/**
 * A set a read-only base's `.custom` pair adds (ADR-0146 D3) was listed on the
 * base's pillar and opened at the pair: its old address opens at the pair's.
 */
describe('a set the base’s pair adds (objectstack#36905)', () => {
  it('opens at the package holding it, bound to that package', () => {
    expect(accessPillarRedirect('crm', '?surface=permission%3Acopy&changes=review', { setHeldIn: 'crm.custom' })).toBe(
      '/studio/crm.custom/metadata/permission/copy?changes=review&package=crm.custom',
    );
    // Only a set moves: the overview and the list stay on the base.
    expect(accessPillarRedirect('crm', '?surface=owd%3Aoverview', { setHeldIn: 'crm.custom' })).toBe('/studio/crm/owd');
    expect(accessPillarRedirect('crm', '', { setHeldIn: 'crm.custom' })).toBe('/studio/crm/metadata/permission?package=crm');
  });

  it('names the set the address opens', () => {
    expect(accessPillarSetName('?surface=permission%3Acopy')).toBe('copy');
    expect(accessPillarSetName('?surface=owd%3Aoverview')).toBeNull();
    expect(accessPillarSetName('?surface=permission%3A')).toBeNull();
    expect(accessPillarSetName('')).toBeNull();
  });

  it('the holder: the base when it holds the name, else the pair when it does, else the base', () => {
    const pair = (names: string[] | null) => ({ id: 'crm.custom', sets: names && new Set(names) });
    expect(accessPillarSetHolder('crm', 'copy', new Set(['rep']), pair(['copy']))).toBe('crm.custom');
    // CONTROL: the base's own set stays on the base, even when the pair holds the name too.
    expect(accessPillarSetHolder('crm', 'rep', new Set(['rep']), pair(['rep']))).toBe('crm');
    // Neither holds it: the base, whose page says so.
    expect(accessPillarSetHolder('crm', 'gone', new Set(['rep']), pair(['copy']))).toBe('crm');
    // A failed read: a failed pair read lists none of its sets; a failed base read stays on the base.
    expect(accessPillarSetHolder('crm', 'copy', new Set(['rep']), pair(null))).toBe('crm');
    expect(accessPillarSetHolder('crm', 'copy', null, pair(['copy']))).toBe('crm');
    expect(accessPillarSetHolder('crm', 'copy', new Set(), null)).toBe('crm');
  });
});
