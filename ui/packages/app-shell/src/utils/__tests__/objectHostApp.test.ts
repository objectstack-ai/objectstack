/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `objectHostAppSegment` (objectstack#32667): the app a record of an object
 * opens under. Each step of its order is pinned with the step before it
 * failing, and each fallback with the step it falls back from.
 */

import { describe, it, expect } from 'vitest';
import { appListsObject, objectHostAppSegment } from '../objectHostApp';

const LEAVE = { name: 'leave', _packageId: 'com.example.leave', navigation: [{ type: 'object', objectName: 'leave_request' }] };
const FINANCE = {
  name: 'finance',
  _packageId: 'com.example.finance',
  navigation: [{ type: 'group', label: 'Billing', children: [{ type: 'object', objectName: 'invoice' }] }],
};
const AREAS = {
  name: 'ops',
  _packageId: 'com.example.ops',
  areas: [{ name: 'claims', navigation: [{ type: 'object', objectName: 'expense_claim' }] }],
};
const SETUP = { name: 'setup', _packageId: 'com.objectstack.setup', navigation: [{ type: 'object', objectName: 'sys_user' }] };

describe('appListsObject', () => {
  it('reads object entries at any group depth, and in areas', () => {
    expect(appListsObject(FINANCE, 'invoice')).toBe(true);
    expect(appListsObject(AREAS, 'expense_claim')).toBe(true);
  });

  it('an entry of another type naming the object does not list it', () => {
    const viaPage = { name: 'p', navigation: [{ type: 'page', objectName: 'invoice', pageName: 'x' }] };
    expect(appListsObject(viaPage, 'invoice')).toBe(false);
    expect(appListsObject(LEAVE, 'invoice')).toBe(false);
  });
});

describe('objectHostAppSegment', () => {
  it('the app the link is built in, when it lists the object (CONTROL: the caller stays)', () => {
    const leaveListingIt = { ...LEAVE, navigation: [...LEAVE.navigation, { type: 'object', objectName: 'invoice' }] };
    expect(objectHostAppSegment([leaveListingIt, FINANCE], 'invoice', 'com.example.leave')).toBe('com.example.leave');
    // Asked by the app's name alias, it keeps the spelling it was asked with.
    expect(objectHostAppSegment([leaveListingIt, FINANCE], 'invoice', 'leave')).toBe('leave');
  });

  it('otherwise the first app the user can open that lists it, over the app it was asked from', () => {
    expect(objectHostAppSegment([LEAVE, FINANCE, SETUP], 'invoice', 'com.example.leave')).toBe('com.example.finance');
    expect(objectHostAppSegment([LEAVE, AREAS, SETUP], 'expense_claim', 'com.example.leave')).toBe('com.example.ops');
  });

  it('a deactivated or hidden app is no owner', () => {
    expect(objectHostAppSegment([LEAVE, { ...FINANCE, active: false }, SETUP], 'invoice', 'com.example.leave')).toBe(
      'com.objectstack.setup',
    );
    expect(objectHostAppSegment([LEAVE, { ...FINANCE, hidden: true }, SETUP], 'invoice', 'com.example.leave')).toBe(
      'com.objectstack.setup',
    );
  });

  it('no app lists it: Setup, the neutral context, never the unrelated app it was asked from', () => {
    expect(objectHostAppSegment([LEAVE, SETUP], 'invoice', 'com.example.leave')).toBe('com.objectstack.setup');
    expect(objectHostAppSegment([LEAVE, { name: 'setup' }], 'invoice', 'com.example.leave')).toBe('setup');
  });

  it('no owner and no Setup the user can open: no answer, so the caller keeps its own app', () => {
    expect(objectHostAppSegment([LEAVE], 'invoice', 'com.example.leave')).toBeUndefined();
  });

  it('an unloaded catalog, or no object, answers nothing', () => {
    expect(objectHostAppSegment([], 'invoice', 'com.example.leave')).toBeUndefined();
    expect(objectHostAppSegment(undefined, 'invoice', 'com.example.leave')).toBeUndefined();
    expect(objectHostAppSegment([LEAVE, FINANCE], null, 'com.example.leave')).toBeUndefined();
  });
});
