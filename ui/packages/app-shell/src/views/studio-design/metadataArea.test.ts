// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — the addresses of Studio's "All metadata" area
 * (ADR-0146 D1): which leg a URL belongs on, and which pillar an item opens in.
 *
 * The query keeps its Setup meaning (`?package=`, `?scope=environment`,
 * `?review=1`) so that N-28's redirects from Setup's metadata routes lose no
 * deep link; each rule below is pinned with the case that would break it.
 */

import { describe, it, expect } from 'vitest';
import {
  AREA_PILLAR_FOR_TYPE,
  STUDIO_ALL_PACKAGES_SEGMENT,
  areaItemPillarPath,
  areaLocationRedirect,
  isStudioAllPackagesScope,
  studioMetadataAreaPath,
} from './metadataArea';
import { STUDIO_ORG_SCOPE_SEGMENT } from './studioScope';
import { parseSurfaceParam } from '../metadata-admin/nav-selection';

const PKG = 'com.example.crm';

describe('the area legs (objectstack#28561)', () => {
  it('names a package leg and a reserved cross-package leg that no package id can spell', () => {
    expect(studioMetadataAreaPath(PKG)).toBe(`/studio/${PKG}/metadata`);
    expect(studioMetadataAreaPath(STUDIO_ALL_PACKAGES_SEGMENT)).toBe('/studio/~all/metadata');
    expect(isStudioAllPackagesScope('~all')).toBe(true);
    // A package may be called `metadata`; the leg is not `/studio/metadata`.
    expect(isStudioAllPackagesScope('metadata')).toBe(false);
    // And it is not the package-less flows scope.
    expect(STUDIO_ALL_PACKAGES_SEGMENT).not.toBe(STUDIO_ORG_SCOPE_SEGMENT);
  });
});

describe('areaLocationRedirect — the query names the leg', () => {
  it('a package leg without `?package=` gets its own, so the item page binds its saves to it', () => {
    expect(areaLocationRedirect(PKG, '', '')).toBe(`/studio/${PKG}/metadata?package=${encodeURIComponent(PKG)}`);
    expect(areaLocationRedirect(PKG, 'translation/ui_en', '?review=1')).toBe(
      `/studio/${PKG}/metadata/translation/ui_en?review=1&package=${encodeURIComponent(PKG)}`,
    );
  });

  it('a package leg whose `?package=` is its own stays where it is', () => {
    expect(areaLocationRedirect(PKG, 'flow', `?package=${PKG}`)).toBeNull();
    expect(areaLocationRedirect(PKG, 'flow/f1/history', `?package=${PKG}&tab=x`)).toBeNull();
  });

  it('a `?package=` naming another package re-roots onto that package, keeping the rest', () => {
    expect(areaLocationRedirect(PKG, 'view/v1', '?package=com.example.hr&review=1')).toBe(
      '/studio/com.example.hr/metadata/view/v1?package=com.example.hr&review=1',
    );
    // From the cross-package leg too: a Setup URL that names a package lands in that package.
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, 'flow', '?package=com.example.hr')).toBe(
      '/studio/com.example.hr/metadata/flow?package=com.example.hr',
    );
  });

  it('`?scope=environment` is the cross-package leg, and the scope binds no package', () => {
    expect(areaLocationRedirect(PKG, 'permission', `?scope=environment&package=${PKG}`)).toBe(
      '/studio/~all/metadata/permission?scope=environment',
    );
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, 'position/p1', '?scope=environment')).toBeNull();
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, 'permission', '?scope=environment&package=x')).toBe(
      '/studio/~all/metadata/permission?scope=environment',
    );
  });

  it('`?package=all` (the list\'s every-package scope) is the cross-package leg, kept', () => {
    expect(areaLocationRedirect(PKG, 'flow', '?package=all')).toBe('/studio/~all/metadata/flow?package=all');
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, 'flow', '?package=all')).toBeNull();
  });

  it('the cross-package leg with no package keeps the URL as it is', () => {
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, '', '')).toBeNull();
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, 'flow/f1', '?review=1')).toBeNull();
  });
});

describe('areaItemPillarPath — a pillar type opens its pillar', () => {
  const search = (q = '') => new URLSearchParams(q);
  const open = (type: string, q = '', packageId: string | null = PKG) =>
    areaItemPillarPath({ packageId, type, name: 'n_1', search: search(q) });

  it('object, flow, the four Interfaces types and permission open their pillar with `?surface=`', () => {
    const expected: Record<string, string> = {
      object: 'data',
      flow: 'automations',
      page: 'interfaces',
      dashboard: 'interfaces',
      report: 'interfaces',
      view: 'interfaces',
      permission: 'access',
    };
    expect(AREA_PILLAR_FOR_TYPE).toEqual(expected);
    for (const [type, pillar] of Object.entries(expected)) {
      const path = open(type);
      expect(path, type).not.toBeNull();
      const url = new URL(path!, 'http://x');
      expect(url.pathname).toBe(`/studio/${PKG}/${pillar}`);
      expect(parseSurfaceParam(url.searchParams.get('surface'))).toEqual({ type, name: 'n_1' });
    }
  });

  it('every other type opens the generic item page', () => {
    for (const type of ['translation', 'email_template', 'agent', 'position', 'sharing_rule', 'app']) {
      expect(open(type), type).toBeNull();
    }
  });

  it('the cross-package leg, the environment scope and `?review=1` open the generic page', () => {
    expect(open('flow', '', null)).toBeNull();
    expect(open('permission', '?scope=environment')).toBeNull();
    expect(open('flow', '?review=1')).toBeNull();
    // Control: the same item without them opens the pillar.
    expect(open('flow', '?review=0')).not.toBeNull();
  });
});
