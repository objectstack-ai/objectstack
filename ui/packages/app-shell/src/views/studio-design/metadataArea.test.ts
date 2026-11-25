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
  AREA_DESIGNER_PAGE_TYPES,
  areaDesignerItemOf,
  areaItemAsksGenericPage,
  areaItemOpensDesignerPage,
  orgScopeFlowOf,
  areaItemOpensFormEditor,
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

  it('the package-less scope is never written into `?package=`: it lands on its flows (objectstack#36899)', () => {
    // objectstack#36903 — on its own leg of the area, with the scope's source filter.
    const LIST = '/studio/~org/metadata/flow?source=runtime';
    expect(areaLocationRedirect('~org', '', '')).toBe(LIST);
    expect(areaLocationRedirect('~org', 'flow', '')).toBe(LIST);
    expect(areaLocationRedirect('~org', 'object', '?source=runtime')).toBe(LIST);
    expect(areaLocationRedirect('~org', 'flow/new', '?source=runtime')).toBe(LIST);
    expect(areaLocationRedirect(STUDIO_ALL_PACKAGES_SEGMENT, 'flow', '?package=~org')).toBe(LIST);
    expect(areaLocationRedirect(PKG, 'flow', '?package=~org')).toBe(LIST);
    expect(areaLocationRedirect(PKG, 'flow/f1', '?package=~org&tab=history')).toBe('/studio/~org/metadata/flow/f1?tab=history&source=runtime');
  });

  it('objectstack#36903 — the scope\'s leg settles on its flows, and re-roots a link naming a package', () => {
    expect(areaLocationRedirect('~org', 'flow', '?source=runtime')).toBeNull();
    expect(areaLocationRedirect('~org', 'flow/f1', '?source=runtime&tab=source')).toBeNull();
    expect(areaLocationRedirect('~org', 'flow/f1/history', '?source=runtime')).toBeNull();
    // The filter is the scope's meaning: a URL without it gets it.
    expect(areaLocationRedirect('~org', 'flow/f1', '')).toBe('/studio/~org/metadata/flow/f1?source=runtime');
    // A packaged row reached by clearing the filter opens in its package.
    expect(areaLocationRedirect('~org', 'flow/f1', `?package=${PKG}`)).toBe(`/studio/${PKG}/metadata/flow/f1?package=${PKG}`);
    expect(areaLocationRedirect('~org', 'flow', '?package=all')).toBe('/studio/~all/metadata/flow?package=all');
  });
});

describe('areaItemPillarPath — a pillar type opens its pillar', () => {
  const search = (q = '') => new URLSearchParams(q);
  const open = (type: string, q = '', packageId: string | null = PKG) =>
    areaItemPillarPath({ packageId, type, name: 'n_1', search: search(q) });

  it('object and permission open their pillar with `?surface=`', () => {
    // objectstack#36903 — a flow opens its designer on its own address.
    const expected: Record<string, string> = {
      object: 'data',
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
    // objectstack#36502 — page, dashboard, report and view lost their pillar with Interfaces.
    for (const type of ['flow', 'translation', 'email_template', 'agent', 'position', 'sharing_rule', 'app', 'page', 'dashboard', 'report', 'view']) {
      expect(open(type), type).toBeNull();
    }
  });

  it('the cross-package leg, the environment scope and `?review=1` open the generic page', () => {
    expect(open('object', '', null)).toBeNull();
    expect(open('permission', '?scope=environment')).toBeNull();
    expect(open('object', '?review=1')).toBeNull();
    // Control: the same item without them opens the pillar.
    expect(open('object', '?review=0')).not.toBeNull();
  });
});

describe('areaItemOpensFormEditor — a read-only package’s dataset opens its Customize door (objectstack#30064)', () => {
  const at = (type: string, readOnly: boolean, search = '') => ({
    packageId: PKG,
    type,
    search: new URLSearchParams(search),
    readOnly,
  });

  it('a dataset opens the form editor on a read-only package, and the generic page on a writable one', () => {
    expect(areaItemOpensFormEditor(at('dataset', true))).toBe(true);
    expect(areaItemOpensFormEditor(at('dataset', false))).toBe(false);
    expect(areaItemOpensFormEditor({ packageId: PKG, type: 'dataset', search: new URLSearchParams() })).toBe(false);
  });

  it('keeps the form editor’s exceptions: the cross-package leg, the environment scope and the draft review', () => {
    expect(areaItemOpensFormEditor({ ...at('dataset', true), packageId: null })).toBe(false);
    expect(areaItemOpensFormEditor(at('dataset', true, 'scope=environment'))).toBe(false);
    expect(areaItemOpensFormEditor(at('dataset', true, 'review=1'))).toBe(false);
  });

  it('leaves an email template and a translation where they were, on either kind of package', () => {
    for (const type of ['email_template', 'translation']) {
      expect(areaItemOpensFormEditor(at(type, true))).toBe(true);
      expect(areaItemOpensFormEditor(at(type, false))).toBe(true);
    }
  });
  // objectstack#36502 — the Interfaces pillar was their Customize door; retired, it is this editor.
  it('a view, dashboard, report and page open the form editor on a read-only package, and the generic page on a writable one', () => {
    for (const type of ['view', 'dashboard', 'report', 'page']) {
      expect(areaItemOpensFormEditor(at(type, true)), type).toBe(true);
      expect(areaItemOpensFormEditor(at(type, false)), type).toBe(false);
      expect(areaItemOpensFormEditor(at(type, true, 'review=1')), type).toBe(false);
    }
    // CONTROL: a type no editor customizes stays on the generic page.
    expect(areaItemOpensFormEditor(at('flow', true))).toBe(false);
    expect(areaItemOpensFormEditor(at('object', true))).toBe(false);
  });
});

describe('areaItemOpensDesignerPage — a flow opens its designer full-screen (objectstack#36903)', () => {
  it('the designer list names the flow; a flow on a package\'s leg opens it', () => {
    expect(AREA_DESIGNER_PAGE_TYPES).toContain('flow');
    expect(areaItemOpensDesignerPage({ packageId: PKG, type: 'flow' })).toBe(true);
  });

  it('not the cross-package leg; not a type outside the list', () => {
    expect(areaItemOpensDesignerPage({ packageId: null, type: 'flow' })).toBe(false);
    expect(areaItemOpensDesignerPage({ packageId: PKG, type: 'dashboard' })).toBe(false);
  });

  it('the environment scope and a draft review keep the generic page, as they keep a pillar type\'s', () => {
    const asks = (q: string) => areaItemAsksGenericPage(new URLSearchParams(q));
    expect(asks('?scope=environment')).toBe(true);
    expect(asks('?review=1')).toBe(true);
    // Control: a review value other than the one the item page acts on, and no query.
    expect(asks('?review=0')).toBe(false);
    expect(asks('')).toBe(false);
  });
});

describe('areaDesignerItemOf — the copilot reads the open flow off its address (objectstack#36903)', () => {
  it('names the flow of a package\'s designer address, its `/history` too', () => {
    expect(areaDesignerItemOf(`/studio/${PKG}/metadata/flow/f_1`, PKG)).toEqual({ type: 'flow', name: 'f_1' });
    expect(areaDesignerItemOf(`/studio/${PKG}/metadata/flow/f_1/history`, PKG)).toEqual({ type: 'flow', name: 'f_1' });
  });

  it('names nothing for a list, a create, another type, the cross-package leg or a pillar', () => {
    expect(areaDesignerItemOf(`/studio/${PKG}/metadata/flow`, PKG)).toBeNull();
    expect(areaDesignerItemOf(`/studio/${PKG}/metadata/flow/new`, PKG)).toBeNull();
    expect(areaDesignerItemOf(`/studio/${PKG}/metadata/dashboard/d`, PKG)).toBeNull();
    expect(areaDesignerItemOf('/studio/~all/metadata/flow/f_1', '~all')).toBeNull();
    expect(areaDesignerItemOf(`/studio/${PKG}/data`, PKG)).toBeNull();
    expect(areaDesignerItemOf(`/studio/${PKG}/metadata/flow/f_1`, undefined)).toBeNull();
    // The package-less scope is not a package's leg: orgScopeFlowOf answers for it.
    expect(areaDesignerItemOf('/studio/~org/metadata/flow/f_1', '~org')).toBeNull();
  });

  it('orgScopeFlowOf names the package-less scope\'s flow, and nothing on any other leg', () => {
    expect(orgScopeFlowOf('/studio/~org/metadata/flow/a%3Ab', '~org')).toEqual({ type: 'flow', name: 'a:b' });
    expect(orgScopeFlowOf('/studio/~org/metadata/flow/a/history', '~org')).toEqual({ type: 'flow', name: 'a' });
    expect(orgScopeFlowOf('/studio/~org/metadata/flow', '~org')).toBeNull();
    expect(orgScopeFlowOf('/studio/~org/metadata/flow/new', '~org')).toBeNull();
    expect(orgScopeFlowOf('/studio/~org/metadata/object/o', '~org')).toBeNull();
    expect(orgScopeFlowOf(`/studio/${PKG}/metadata/flow/f_1`, PKG)).toBeNull();
  });
});
});
