// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where a Setup metadata URL lands (objectstack ADR-0146 D1, N-28): Studio's
 * "All metadata" area, on the leg its query names, in one computation; the
 * datasource stays in Setup. The route-level table, through the real
 * `AppContent`, is `console/__tests__/AppContent.setupMetadataStudio-28578.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  SETUP_KEPT_METADATA_TYPE,
  packagedActionsStudioPath,
  packagedAutomationStudioPath,
  setupMetadataRest,
  setupMetadataStudioPath,
} from './setupMetadataRedirect.js';
import { areaLocationRedirect } from './metadataArea.js';
import {
  ACCESS_DIRECTORY_PATH,
  accessDirectoryLocation,
  studioAllLegSetupRedirect,
} from '../setup/accessDirectory.js';

describe('setupMetadataStudioPath', () => {
  it.each([
    // [rest, search, expected]
    // objectstack#37565 — the leg's root is the environment directory, Setup's page now.
    ['', '', '/apps/setup/component/security/access-directory'],
    ['_diagnostics', '', '/studio/~all/metadata/_diagnostics'],
    ['object', '', '/studio/~all/metadata/object'],
    ['object/account', '', '/studio/~all/metadata/object/account'],
    ['object/new', '', '/studio/~all/metadata/object/new'],
    ['permission/admin/history', '', '/studio/~all/metadata/permission/admin/history'],
    // `?package=` names the leg, and is kept.
    ['object/account', '?package=crm', '/studio/crm/metadata/object/account?package=crm'],
    ['object', 'package=crm', '/studio/crm/metadata/object?package=crm'],
    ['object', '?package=all', '/studio/~all/metadata/object?package=all'],
    // `?scope=environment` is the cross-package leg; it binds no package. objectstack#37565 —
    // a directory type's list there is Setup's page now; its item still opens in Studio.
    ['position', '?scope=environment', '/apps/setup/component/security/access-directory/position?scope=environment'],
    ['position', '?scope=environment&package=crm', '/apps/setup/component/security/access-directory/position?scope=environment'],
    ['position/manager', '?scope=environment', '/studio/~all/metadata/position/manager?scope=environment'],
    // `?review=1` is kept, alone or beside a package.
    ['object/account', '?review=1', '/studio/~all/metadata/object/account?review=1'],
    ['object/account', '?package=crm&review=1', '/studio/crm/metadata/object/account?package=crm&review=1'],
    // A trailing or doubled slash does not leak into the target.
    ['object/', '', '/studio/~all/metadata/object'],
  ])('%s %s → %s', (rest, search, expected) => {
    // A principal who may open Setup (objectstack#37565).
    expect(setupMetadataStudioPath(rest, search, '', true)).toBe(expected);
  });

  // objectstack#37565 — for a principal who may not open Setup (and by default), the
  // environment directory's addresses stay on the cross-package leg, where they landed before.
  it.each([
    ['', '', '/studio/~all/metadata'],
    ['position', '?scope=environment', '/studio/~all/metadata/position?scope=environment'],
    ['position', '?scope=environment&package=crm', '/studio/~all/metadata/position?scope=environment'],
    ['position/manager', '?scope=environment', '/studio/~all/metadata/position/manager?scope=environment'],
  ])('without Setup: %s %s → %s', (rest, search, expected) => {
    expect(setupMetadataStudioPath(rest, search, '', false)).toBe(expected);
    expect(setupMetadataStudioPath(rest, search)).toBe(expected);
  });

  it('keeps the hash', () => {
    expect(setupMetadataStudioPath('object/account', '?package=crm', '#fields')).toBe(
      '/studio/crm/metadata/object/account?package=crm#fields',
    );
    expect(setupMetadataStudioPath('object', '', '#x')).toBe('/studio/~all/metadata/object#x');
  });

  it.each([
    ['datasource'],
    ['datasource/main'],
    ['datasource/new'],
    ['datasource/main/history'],
  ])('a datasource URL stays in Setup: %s', (rest) => {
    expect(SETUP_KEPT_METADATA_TYPE).toBe('datasource');
    expect(setupMetadataStudioPath(rest, '?package=crm')).toBeNull();
  });

  it('a type that merely starts with "datasource" is not the datasource', () => {
    expect(setupMetadataStudioPath('datasource_mapping', '')).toBe('/studio/~all/metadata/datasource_mapping');
  });

  it('lands where the area keeps it: one hop, never a second', () => {
    // The area re-roots a URL whose query names another leg. Every target
    // above is already on its leg, so the area adds no second redirect.
    for (const [rest, search] of [
      ['object/account', ''],
      ['object/account', '?package=crm'],
      ['position/manager', '?scope=environment&package=crm'],
      ['object', '?package=all&review=1'],
    ] as const) {
      const target = new URL(setupMetadataStudioPath(rest, search)!, 'http://x');
      const [, , leg, , ...tail] = target.pathname.split('/');
      expect(areaLocationRedirect(decodeURIComponent(leg), tail.join('/'), target.search)).toBeNull();
      expect(studioAllLegSetupRedirect(tail.join('/'), target.search)).toBeNull();
    }
    // objectstack#37565 — a directory address lands on Setup's page, which serves it without a further hop.
    for (const [rest, search] of [
      ['', ''],
      ['position', '?scope=environment&package=crm'],
    ] as const) {
      const target = new URL(setupMetadataStudioPath(rest, search, '', true)!, 'http://x');
      expect(target.pathname.startsWith(ACCESS_DIRECTORY_PATH)).toBe(true);
      expect(accessDirectoryLocation(target.pathname.slice(ACCESS_DIRECTORY_PATH.length), target.search)).toBeNull();
    }
  });
});

describe('setupMetadataRest', () => {
  it.each([
    ['/apps/setup/metadata', ''],
    ['/apps/setup/metadata/', ''],
    ['/apps/setup/metadata/object', 'object'],
    ['/apps/crm/metadata/object/account', 'object/account'],
    ['/apps/setup/metadata/permission/admin/history', 'permission/admin/history'],
    ['/apps/metadata/metadata/object', 'object'],
  ])('%s → %s', (pathname, rest) => {
    expect(setupMetadataRest(pathname)).toBe(rest);
  });

  it.each([['/apps/setup/system'], ['/apps/setup/metadata_import'], ['/studio/~all/metadata/object']])(
    '%s is not a metadata route',
    (pathname) => {
      expect(setupMetadataRest(pathname)).toBeNull();
    },
  );
});

describe('packagedAutomationStudioPath (ADR-0146 D11)', () => {
  it.each([
    // [search, hash, expected]
    ['?package=crm', '', '/studio/crm/automations?package=crm'],
    ['package=com.example.showcase&q=alert', '', '/studio/com.example.showcase/automations?package=com.example.showcase&q=alert'],
    ['?package=crm', '#flows', '/studio/crm/automations?package=crm#flows'],
    // No package named: the page listed every package's flows.
    ['', '', '/studio/~all/metadata/flow'],
    ['?q=alert', '', '/studio/~all/metadata/flow?q=alert'],
    ['?package=all', '', '/studio/~all/metadata/flow?package=all'],
  ])('%s %s → %s', (search, hash, expected) => {
    expect(packagedAutomationStudioPath(search, hash)).toBe(expected);
  });

  it('the cross-package landing is already on its leg: the area adds no second hop', () => {
    const target = new URL(packagedAutomationStudioPath('?package=all'), 'http://x');
    expect(areaLocationRedirect('~all', 'flow', target.search)).toBeNull();
  });
});

describe('packagedActionsStudioPath (objectstack#34724)', () => {
  // objectstack#36908 — a URL naming no package lands on Setup → Packages,
  // the package list, since the Studio home was removed; that page reads its
  // own query, so the retired page's query and fragment are not carried.
  it.each([
    // [search, hash, expected]
    ['?package=crm', '', '/studio/crm/data?package=crm'],
    ['?package=com.acme.app&x=1', '#top', '/studio/com.acme.app/data?package=com.acme.app&x=1#top'],
    ['', '', '/apps/setup/component/developer/packages?face=admin'],
    ['?package=all', '#top', '/apps/setup/component/developer/packages?face=admin'],
  ])('%s%s → %s', (search, hash, expected) => {
    expect(packagedActionsStudioPath(search, hash)).toBe(expected);
  });
});
