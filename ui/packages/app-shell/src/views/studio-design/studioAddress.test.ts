// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36895 — the Studio address builder returns TODAY's addresses,
 * byte for byte, and the mapping table agrees with it.
 *
 * Every expected value below is a literal: the address as its producer spelled
 * it before the builder existed. A builder that drifts by one byte (an encoded
 * colon, a `+` for a space) fails here, not in a user's bookmark.
 */

import { describe, expect, it } from 'vitest';
import {
  STUDIO_ITEM_PILLAR,
  studioChangesReviewPath,
  studioHomePath,
  studioItemPath,
  studioItemReviewPath,
  studioLandingPath,
  studioMetadataAreaAddress,
  studioMetadataAreaRoot,
  studioMetadataItemAddress,
  studioMetadataTypePath,
  studioPackagePath,
  studioPath,
  studioPillarItemAddress,
  studioPillarPath,
  studioSurfaceQuery,
} from './studioAddress.js';
import {
  STUDIO_ADDRESS_FAMILIES,
  STUDIO_ITEM_TYPES,
  STUDIO_QUERY_PARAMS,
  STUDIO_RETIRED_INTERFACES_KEPT_PARAMS,
} from './studioAddressTable.js';
import { DESIGNER_SURFACE_PARAM } from '../metadata-admin/nav-selection.js';
import { CATALOG_SCOPE_PARAM, ENVIRONMENT_SCOPE } from '../metadata-admin/catalog-scope.js';
import {
  DESIGNER_SURFACE_ACTION_PARAM,
  DESIGNER_SURFACE_NAV_PARAM,
  DESIGNER_SURFACE_VIEW_PARAM,
} from './useSurfaceDeepLink.js';
import { STUDIO_CHANGES_PARAM, STUDIO_CHANGES_REVIEW } from './studioChangesLink.js';
import { STUDIO_NEW_PACKAGE_PATH } from './studioNewPackage.js';
import { retiredInterfacesTarget } from './studioInterfacesRetired.js';
import { studioOrgScopePath } from './studioScope.js';
import { AREA_PILLAR_FOR_TYPE, areaItemPillarPath, studioMetadataItemPath, studioPillarItemPath } from './metadataArea.js';

describe('studioPath — the one path builder (objectstack#36895)', () => {
  it('builds from the left, encoding the scope segment', () => {
    expect(studioPath()).toBe('/studio');
    expect(studioPath('com.acme.crm')).toBe('/studio/com.acme.crm');
    expect(studioPath('a b/c')).toBe('/studio/a%20b%2Fc');
    expect(studioPath('crm', 'data')).toBe('/studio/crm/data');
    expect(studioPath('crm', 'metadata', 'object/account')).toBe('/studio/crm/metadata/object/account');
    // A part after an absent one names nothing.
    expect(studioPath(null, 'data')).toBe('/studio');
    expect(studioPath('crm', null, 'x')).toBe('/studio/crm');
  });

  it('writes a verbatim segment as given', () => {
    expect(studioPath('a b', 'access', null, { segmentEncoding: 'verbatim' })).toBe('/studio/a b/access');
  });

  it('appends a query, a verbatim search and a fragment, and nothing for empty ones', () => {
    expect(studioPath('crm', 'data', null, { query: 'changes=review' })).toBe('/studio/crm/data?changes=review');
    expect(studioPath('crm', 'data', null, { query: new URLSearchParams({ a: 'x y' }) })).toBe('/studio/crm/data?a=x+y');
    expect(studioPath('crm', 'data', null, { query: '' })).toBe('/studio/crm/data');
    expect(studioPath('crm', 'data', null, { query: new URLSearchParams() })).toBe('/studio/crm/data');
    expect(studioPath('crm', 'data', null, { search: '?surface=object%3Aa' })).toBe('/studio/crm/data?surface=object%3Aa');
    expect(studioPath('crm', 'data', null, { search: '' })).toBe('/studio/crm/data');
    expect(studioPath(null, null, null, { query: 'new=package', hash: '#x' })).toBe('/studio?new=package#x');
  });
});

describe("today's addresses, byte for byte", () => {
  it('landing, package, pillar, home', () => {
    expect(studioLandingPath()).toBe('/studio');
    expect(STUDIO_NEW_PACKAGE_PATH).toBe('/studio?new=package');
    expect(studioPackagePath('com.acme.crm')).toBe('/studio/com.acme.crm');
    expect(studioPillarPath('com.acme.crm', 'automations')).toBe('/studio/com.acme.crm/automations');
    expect(studioHomePath('com.acme.crm')).toBe('/studio/com.acme.crm/data');
  });

  it('the three `?surface=` spellings stay distinct', () => {
    const item = { type: 'object', name: "o'k (x)" };
    expect(studioSurfaceQuery(item)).toBe("surface=object%3Ao'k%20(x)");
    expect(studioSurfaceQuery(item, 'name')).toBe("surface=object:o'k%20(x)");
    expect(studioSurfaceQuery(item, 'form')).toBe('surface=object%3Ao%27k+%28x%29');
    expect(studioSurfaceQuery({ type: 'object', name: 'a' }, 'form', { action: 'approve' })).toBe(
      'surface=object%3Aa&action=approve',
    );
    expect(studioSurfaceQuery({ type: 'object', name: 'a' }, 'component', { view: 'a.all' })).toBe(
      'surface=object%3Aa&view=a.all',
    );
  });

  it('an item opens its pillar today when the table names one, else its "All metadata" page', () => {
    // objectstack#36904 — an object opens its designer on its metadata address.
    expect(studioItemPath('crm', 'object', 'account')).toBe('/studio/crm/metadata/object/account');
    expect(studioItemPath('crm', 'flow', 'notify')).toBe('/studio/crm/automations?surface=flow%3Anotify');
    expect(studioItemPath('crm', 'permission', 'admin')).toBe('/studio/crm/access?surface=permission%3Aadmin');
    expect(studioItemPath('crm', 'dashboard', 'sales')).toBe('/studio/crm/metadata/dashboard/sales');
    expect(studioItemPath('crm', 'action', 'approve')).toBe('/studio/crm/metadata/action/approve');
    // On the metadata address a qualifier is its query (the switched-off action's `?action=`).
    expect(studioItemPath('crm', 'object', 'account', { qualifiers: { action: 'approve' } })).toBe(
      '/studio/crm/metadata/object/account?action=approve',
    );
    // A name that is an Object.prototype member is not a pillar type.
    expect(studioItemPath('crm', 'constructor', 'x')).toBe('/studio/crm/metadata/constructor/x');
  });

  it('a pillar item at a verbatim segment', () => {
    expect(studioPillarItemAddress('~org', 'automations', { type: 'flow', name: 'f' }, { segmentEncoding: 'verbatim' })).toBe(
      '/studio/~org/automations?surface=flow%3Af',
    );
  });

  it('the "All metadata" area', () => {
    expect(studioMetadataAreaRoot('~all')).toBe('/studio/~all/metadata');
    expect(studioMetadataAreaRoot('com.acme.crm')).toBe('/studio/com.acme.crm/metadata');
    expect(studioMetadataTypePath('crm', 'action')).toBe('/studio/crm/metadata/action');
    expect(studioMetadataItemAddress('crm', 'page', 'a b')).toBe('/studio/crm/metadata/page/a%20b');
    expect(studioMetadataAreaAddress('~all', '', { query: 'scope=environment' })).toBe('/studio/~all/metadata?scope=environment');
  });

  it("the draft review links equal the server's, and the skill evals' literals", () => {
    // `studioChangesReviewLink` / `studioItemReviewLink` in @objectstack/types
    // are pinned to these same literals, as are the objectstack-mcp-build evals.
    expect(studioChangesReviewPath('com.acme.crm')).toBe('/studio/com.acme.crm/data?changes=review');
    expect(studioItemReviewPath('com.acme.crm', 'flow', 'crm_lead_created_notify')).toBe(
      '/studio/com.acme.crm/metadata/flow/crm_lead_created_notify?review=1',
    );
    expect(studioItemReviewPath('com.acme.crm', 'dataset', 'crm_sales_metrics')).toBe(
      '/studio/com.acme.crm/metadata/dataset/crm_sales_metrics?review=1',
    );
  });

  it('the repointed module builders keep their addresses', () => {
    expect(studioOrgScopePath()).toBe('/studio/~org/automations');
    expect(studioOrgScopePath({ type: 'flow', name: 'a:b' })).toBe('/studio/~org/automations?surface=flow%3Aa%3Ab');
    expect(studioPillarItemPath('crm', 'access', { type: 'permission', name: 'p' })).toBe('/studio/crm/access?surface=permission%3Ap');
    expect(studioMetadataItemPath('crm', { type: 'object', name: 'account' })).toBe('/studio/crm/metadata/object/account');
    expect(
      areaItemPillarPath({ packageId: 'crm', type: 'flow', name: 'notify', search: new URLSearchParams() }),
    ).toBe('/studio/crm/automations?surface=flow%3Anotify');
    expect(
      areaItemPillarPath({ packageId: 'crm', type: 'flow', name: 'notify', search: new URLSearchParams('review=1') }),
    ).toBeNull();
  });
});

describe('the mapping table agrees with the code (objectstack#36895)', () => {
  it("the area's pillar redirect and the item address read ONE type map", () => {
    expect(AREA_PILLAR_FOR_TYPE).toBe(STUDIO_ITEM_PILLAR);
  });

  it('every item type the map names has its row, on the same pillar', () => {
    for (const [type, pillar] of Object.entries(STUDIO_ITEM_PILLAR)) {
      const row = STUDIO_ITEM_TYPES.find((r) => r.type === type);
      expect(row, type).toBeDefined();
      expect(row?.pillar).toBe(pillar);
      expect(row?.onMetadataAddress).toBe(`/studio/<package>/metadata/${type}/<name>`);
    }
  });

  it('every `?surface=` row instantiates to what the builder writes', () => {
    for (const row of STUDIO_ITEM_TYPES) {
      const [type, name] = row.surface.split(':');
      const value = name === '<name>' ? 'n' : name;
      expect(studioPillarItemAddress('p', row.pillar, { type, name: value })).toBe(
        `/studio/p/${row.pillar}?surface=${encodeURIComponent(`${type}:${value}`)}`,
      );
    }
  });

  it('the parameter rows name the keys the readers use', () => {
    const keys = STUDIO_QUERY_PARAMS.map((row) => row.key);
    expect(keys).toEqual([
      DESIGNER_SURFACE_PARAM,
      DESIGNER_SURFACE_VIEW_PARAM,
      DESIGNER_SURFACE_ACTION_PARAM,
      DESIGNER_SURFACE_NAV_PARAM,
      STUDIO_CHANGES_PARAM,
      'review',
      'package',
      CATALOG_SCOPE_PARAM,
      'new',
    ]);
    expect(STUDIO_QUERY_PARAMS.find((row) => row.key === CATALOG_SCOPE_PARAM)?.values).toBe(ENVIRONMENT_SCOPE);
    expect(STUDIO_QUERY_PARAMS.find((row) => row.key === STUDIO_CHANGES_PARAM)?.values).toBe(STUDIO_CHANGES_REVIEW);
  });

  it('the families are unique and name builders that exist', () => {
    const ids = STUDIO_ADDRESS_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const builders = new Set([
      'studioLandingPath', 'studioPackagePath', 'studioPillarPath', 'studioItemPath', 'studioOrgScopePath',
      'studioMetadataAreaRoot', 'studioMetadataTypePath', 'studioMetadataItemAddress', 'studioChangesReviewPath',
      'studioItemReviewPath', 'retiredInterfacesTarget',
    ]);
    for (const family of STUDIO_ADDRESS_FAMILIES) expect(builders.has(family.builder), family.id).toBe(true);
  });

  it('the retired `/interfaces` redirect keeps exactly what the table marks', () => {
    expect(STUDIO_RETIRED_INTERFACES_KEPT_PARAMS).toEqual([STUDIO_CHANGES_PARAM]);
    expect(retiredInterfacesTarget('crm', '?surface=page%3Ahome&changes=review&nav=n1')).toBe('/studio/crm/data?changes=review');
    expect(retiredInterfacesTarget('crm', '?surface=page%3Ahome')).toBe('/studio/crm/data');
  });
});
