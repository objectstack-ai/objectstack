// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37565 — the environment directory's addresses after it moved
 * from Studio's cross-package leg to Setup → Access control (ADR-0084, amended
 * 2026-11-26, question 5): which `~all` address lands on the Setup page, which
 * stays in Studio, and what the Setup page serves itself.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_AREA_TYPES } from '../metadata-admin/metadataAreaHost.js';
import {
  ACCESS_DIRECTORY_CAPABILITY,
  ACCESS_DIRECTORY_PATH,
  ACCESS_DIRECTORY_REF,
  accessDirectoryLocation,
  accessDirectoryPath,
  studioAddressAfterSetupMove,
  studioAllLegSetupRedirect,
} from './accessDirectory.js';

const SETUP = '/apps/setup/component/security/access-directory';

describe('the Setup page (objectstack#37565)', () => {
  it('is a component page of the Setup app, behind Studio\'s entry capability', () => {
    expect(ACCESS_DIRECTORY_REF).toBe('security:access-directory');
    expect(ACCESS_DIRECTORY_PATH).toBe(SETUP);
    expect(ACCESS_DIRECTORY_CAPABILITY).toBe('studio.access');
  });

  it('addresses the directory, and a type\'s list in the environment scope', () => {
    expect(accessDirectoryPath()).toBe(SETUP);
    expect(accessDirectoryPath('permission')).toBe(`${SETUP}/permission?scope=environment`);
    expect(accessDirectoryPath('sharing_rule')).toBe(`${SETUP}/sharing_rule?scope=environment`);
  });
});

describe("a Studio cross-package address (studioAllLegSetupRedirect)", () => {
  it.each([
    // [rest, search, expected]
    ['', '', SETUP],
    ['', '?q=admin', `${SETUP}?q=admin`],
    ['position', '?scope=environment', `${SETUP}/position?scope=environment`],
    ['permission', '?scope=environment&q=sales', `${SETUP}/permission?scope=environment&q=sales`],
    ['sharing_rule', '?scope=environment', `${SETUP}/sharing_rule?scope=environment`],
    ['capability', '?scope=environment', `${SETUP}/capability?scope=environment`],
  ])('the directory lands on Setup: %s %s', (rest, search, expected) => {
    expect(studioAllLegSetupRedirect(rest, search)).toBe(expected);
  });

  it('every type the directory lists lands on Setup in the environment scope', () => {
    for (const type of ENVIRONMENT_AREA_TYPES) {
      expect(studioAllLegSetupRedirect(encodeURIComponent(type), '?scope=environment'), type).toBe(
        accessDirectoryPath(type),
      );
    }
  });

  it.each([
    // An item, a create and a history open in Studio (ADR-0146 D1).
    ['permission/admin', '?scope=environment'],
    ['permission/new', '?scope=environment'],
    ['position/manager/history', '?scope=environment'],
    // The cross-package list outside the environment scope is another read: it stays.
    ['permission', ''],
    ['permission', '?package=all'],
    ['flow', ''],
    ['object', '?scope=environment'],
    // Diagnostics is Studio's.
    ['_diagnostics', ''],
    // A path no decoding reads stays where it is.
    ['%E0%A4%A', '?scope=environment'],
  ])('stays in Studio: %s %s', (rest, search) => {
    expect(studioAllLegSetupRedirect(rest, search)).toBeNull();
  });

  it('maps a whole built address, hash included, and leaves any other address alone', () => {
    expect(studioAddressAfterSetupMove('/studio/~all/metadata')).toBe(SETUP);
    expect(studioAddressAfterSetupMove('/studio/~all/metadata/position?scope=environment#top')).toBe(
      `${SETUP}/position?scope=environment#top`,
    );
    for (const address of [
      '/studio/~all/metadata/position/manager?scope=environment',
      '/studio/~all/metadata/flow?package=all',
      '/studio/crm/metadata',
      '/studio/~allx/metadata',
      '/studio/~org/metadata/flow?source=runtime',
    ]) {
      expect(studioAddressAfterSetupMove(address), address).toBe(address);
    }
  });
});

describe('an address below the Setup page (accessDirectoryLocation)', () => {
  it.each([
    ['', ''],
    ['', '?q=admin'],
    ['position', '?scope=environment'],
    ['permission', '?scope=environment&q=sales'],
  ])('the page serves it: %s %s', (rest, search) => {
    expect(accessDirectoryLocation(rest, search)).toBeNull();
  });

  it('a directory type\'s list gets the environment scope, and no package', () => {
    expect(accessDirectoryLocation('position', '')).toBe(`${SETUP}/position?scope=environment`);
    expect(accessDirectoryLocation('permission', '?package=crm&q=x')).toBe(`${SETUP}/permission?q=x&scope=environment`);
  });

  it.each([
    // [rest, search, Studio target] — an item, a create, a history: the editor the environment scope uses.
    ['permission/admin', '?scope=environment', '/studio/~all/metadata/permission/admin?scope=environment'],
    ['permission/new', '?scope=environment', '/studio/~all/metadata/permission/new?scope=environment'],
    ['position/manager/history', '?scope=environment', '/studio/~all/metadata/position/manager/history?scope=environment'],
    ['permission/sales%20rep', '?scope=environment', '/studio/~all/metadata/permission/sales%20rep?scope=environment'],
    // Another type's list is the cross-package list, which stays in Studio.
    ['flow', '', '/studio/~all/metadata/flow'],
  ])('opens in Studio: %s %s', (rest, search, expected) => {
    expect(accessDirectoryLocation(rest, search)).toBe(expected);
  });

  it('never sends Studio\'s target back to Setup: one hop', () => {
    for (const [rest, search] of [
      ['permission/admin', '?scope=environment'],
      ['flow', ''],
    ] as const) {
      const target = accessDirectoryLocation(rest, search)!;
      expect(studioAddressAfterSetupMove(target)).toBe(target);
    }
  });
});
