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
import { RESERVED_URL_PARAMS } from '../../urlParams.js';
import {
  STUDIO_RETURN_PARAM,
  readStudioReturn,
  withStudioReturn,
  studioChangesReviewPath,
  studioHomePath,
  studioItemPath,
  studioItemReviewPath,
  studioLandingPath,
  studioMetadataAreaAddress,
  studioMetadataAreaRoot,
  studioMetadataItemAddress,
  studioMetadataTypePath,
  studioOwdOverviewPath,
  studioPackagePath,
  studioPath,
  studioPillarPath,
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
import { STUDIO_NEW_PACKAGE_VALUE, STUDIO_NEW_PARAM } from './studioNewPackage.js';
import { retiredInterfacesTarget } from './studioInterfacesRetired.js';
import { studioOrgScopePath } from './studioScope.js';
import { studioMetadataItemPath } from './metadataArea.js';
import { accessPillarRedirect } from './accessPillarRedirect.js';
import { studioPillarRedirect } from './studioPillarRedirectModel.js';

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
    // objectstack#36908 — the retired new-package bookmark Studio's entry forwards.
    expect(studioLandingPath({ query: `${STUDIO_NEW_PARAM}=${STUDIO_NEW_PACKAGE_VALUE}` })).toBe('/studio?new=package');
    expect(studioPackagePath('com.acme.crm')).toBe('/studio/com.acme.crm');
    expect(studioPillarPath('com.acme.crm', 'automations')).toBe('/studio/com.acme.crm/automations');
    expect(studioHomePath('com.acme.crm')).toBe('/studio/com.acme.crm/data');
  });

  it('an item opens its "All metadata" page, where its designer is (objectstack#36909: no item opens a pillar)', () => {
    // objectstack#36904, objectstack#36903 — an object and a flow open their designer on their metadata address.
    expect(studioItemPath('crm', 'object', 'account')).toBe('/studio/crm/metadata/object/account');
    expect(studioItemPath('crm', 'flow', 'notify')).toBe('/studio/crm/metadata/flow/notify');
    // objectstack#36905 — a permission set opens its metadata address.
    expect(studioItemPath('crm', 'permission', 'admin')).toBe('/studio/crm/metadata/permission/admin');
    expect(studioItemPath('crm', 'dashboard', 'sales')).toBe('/studio/crm/metadata/dashboard/sales');
    expect(studioItemPath('crm', 'action', 'approve')).toBe('/studio/crm/metadata/action/approve');
    // On the metadata address a qualifier is its query (the switched-off action's `?action=`).
    expect(studioItemPath('crm', 'object', 'account', { qualifiers: { action: 'approve' } })).toBe(
      '/studio/crm/metadata/object/account?action=approve',
    );
    expect(studioItemPath('crm', 'constructor', 'x')).toBe('/studio/crm/metadata/constructor/x');
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
    // objectstack#36903 — the package-less scope's flows, on its leg of the area.
    expect(studioOrgScopePath()).toBe('/studio/~org/metadata/flow?source=runtime');
    expect(studioOrgScopePath({ type: 'flow', name: 'a:b' })).toBe('/studio/~org/metadata/flow/a%3Ab?source=runtime');
    expect(studioMetadataItemPath('crm', { type: 'object', name: 'account' })).toBe('/studio/crm/metadata/object/account');
  });
});

describe('studioOwdOverviewPath — the sharing overview\'s own route (objectstack#36905)', () => {
  it('is the package\'s `owd` section, optionally on one object', () => {
    expect(studioOwdOverviewPath('crm')).toBe('/studio/crm/owd');
    expect(studioOwdOverviewPath('crm', { object: 'sales order' })).toBe('/studio/crm/owd?object=sales+order');
    expect(studioOwdOverviewPath('crm', { object: null, query: 'changes=review' })).toBe('/studio/crm/owd?changes=review');
  });
});

describe('the mapping table agrees with the code (objectstack#36895)', () => {
  it('every `?surface=` row redirects from its pillar address to where the row says, in one hop (objectstack#36909)', () => {
    // Every type has moved: each row names its redirect, and the ONE redirect
    // table lands every spelling of the row's pillar address there.
    expect(STUDIO_ITEM_TYPES.map((row) => row.type)).toEqual(['object', 'flow', 'permission', 'owd']);
    for (const row of STUDIO_ITEM_TYPES) {
      expect(row.redirectsTo, row.type).toBeDefined();
      const [type, name] = row.surface.split(':');
      const value = name === '<name>' ? 'n' : name;
      const want = row.redirectsTo!.split('<package>').join('p').replace('<name>', value);
      const surface = `${type}:${value}`;
      const spellings = [`surface=${encodeURIComponent(surface)}`, `surface=${type}:${value}`, new URLSearchParams({ surface }).toString()];
      for (const query of spellings) {
        const target = studioPillarRedirect('p', row.pillar, `?${query}`);
        // The Access pillar's target waits on a read for a base's pair; `p` has none, so its mapping is the answer.
        const to = target?.kind === 'access' ? accessPillarRedirect(target.packageId, query) : target?.to;
        expect(to, `${row.type} ${query}`).toBe(want);
      }
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
      'studioLandingPath', 'studioPackagePath', 'studioPillarPath', 'studioOrgScopePath',
      'studioMetadataAreaRoot', 'studioMetadataTypePath', 'studioMetadataItemAddress', 'studioChangesReviewPath',
      'studioItemReviewPath', 'retiredInterfacesTarget', 'studioOwdOverviewPath',
    ]);
    for (const family of STUDIO_ADDRESS_FAMILIES) expect(builders.has(family.builder), family.id).toBe(true);
  });

  it('a moved type\'s row names where its pillar address redirects, as the redirect does (objectstack#36905)', () => {
    const moved = STUDIO_ITEM_TYPES.filter((row) => row.redirectsTo !== undefined);
    const access = moved.filter((row) => row.pillar === 'access');
    expect(access.map((row) => row.type)).toEqual(['permission', 'owd']);
    for (const row of access) {
      const [type, name] = row.surface.split(':');
      const value = name === '<name>' ? 'n' : name;
      expect(accessPillarRedirect('p', `?surface=${encodeURIComponent(`${type}:${value}`)}`), row.type).toBe(
        row.redirectsTo!.split('<package>').join('p').replace('<name>', value),
      );
    }
  });

  it('the retired `/interfaces` redirect keeps exactly what the table marks', () => {
    expect(STUDIO_RETIRED_INTERFACES_KEPT_PARAMS).toEqual([STUDIO_CHANGES_PARAM]);
    // objectstack#36909 — on the package's object list, its settled address: no hop through `/data`.
    expect(retiredInterfacesTarget('crm', '?surface=page%3Ahome&changes=review&nav=n1')).toBe(
      '/studio/crm/metadata/object?changes=review&package=crm',
    );
    expect(retiredInterfacesTarget('crm', '?surface=page%3Ahome')).toBe('/studio/crm/metadata/object?package=crm');
  });
});

describe('the "came from Studio" param (objectstack#36906, decision 15)', () => {
  it('carries a Studio list address on an app path, keeping its own query and fragment', () => {
    expect(STUDIO_RETURN_PARAM).toBe('studio');
    const list = '/studio/crm/metadata/dashboard?q=ops&sort=-changed';
    expect(withStudioReturn('/apps/crm/dashboard/ops_board', list)).toBe(
      '/apps/crm/dashboard/ops_board?studio=%2Fstudio%2Fcrm%2Fmetadata%2Fdashboard%3Fq%3Dops%26sort%3D-changed',
    );
    expect(withStudioReturn('/apps/crm/report/r1?x=1#top', '/studio/crm/metadata/report')).toBe(
      '/apps/crm/report/r1?x=1&studio=%2Fstudio%2Fcrm%2Fmetadata%2Freport#top',
    );
  });

  it('reads back exactly what it carried', () => {
    const list = '/studio/crm/metadata/dashboard?q=a%20b&package=crm';
    const path = withStudioReturn('/apps/crm/dashboard/d', list);
    expect(readStudioReturn(path.slice(path.indexOf('?')))).toBe(list);
    expect(readStudioReturn(new URLSearchParams({ studio: '/studio' }))).toBe('/studio');
  });

  it('refuses anything that is not a Studio address on this origin, both ways', () => {
    for (const value of [
      'https://evil.example/studio/crm',
      '//evil.example/studio',
      '/studiox/crm',
      '/apps/crm',
      'studio/crm',
      '/studio\\..\\apps',
      'javascript:alert(1)',
      '',
    ]) {
      expect(readStudioReturn(new URLSearchParams({ studio: value }))).toBeNull();
      expect(withStudioReturn('/apps/crm/dashboard/d', value)).toBe('/apps/crm/dashboard/d');
    }
    expect(readStudioReturn('')).toBeNull();
    expect(readStudioReturn('?other=1')).toBeNull();
  });

  it('is one of the console reserved URL params', () => {
    expect(RESERVED_URL_PARAMS).toContain(STUDIO_RETURN_PARAM);
  });
});
