// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7450] Unit half of the denial-envelope allowlist. The wire-level proof —
 * a real `/data` denial dispatched end-to-end, including the cascade child —
 * lives in `../domains/data-permission-denied-envelope.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import {
  routeObjectFromPath,
  permissionDeniedErrorDetails,
  describeDeniedDiagnostics,
} from './permission-denied-envelope.js';

describe('routeObjectFromPath', () => {
  it('reads the object segment off the /data family', () => {
    expect(routeObjectFromPath('/data/contacts')).toBe('contacts');
    expect(routeObjectFromPath('/data/contacts/123')).toBe('contacts');
    expect(routeObjectFromPath('/data/contacts/query')).toBe('contacts');
  });

  it('decodes a percent-encoded segment, as the router does', () => {
    expect(routeObjectFromPath('/data/my%20object/1')).toBe('my object');
  });

  it('names no object for a path that carries none', () => {
    expect(routeObjectFromPath('/data')).toBeUndefined();
    expect(routeObjectFromPath('/data/')).toBeUndefined();
    expect(routeObjectFromPath('/meta/objects/contacts')).toBeUndefined();
    expect(routeObjectFromPath('/automation/flow_a/runs/r1/resume')).toBeUndefined();
    expect(routeObjectFromPath('')).toBeUndefined();
  });

  it('is anchored at the prefix — `/data/` further along the path is not a match', () => {
    expect(routeObjectFromPath('/database/contacts')).toBeUndefined();
    // An unanchored match would read `contacts` out of this and attach an
    // object to a denial raised on a metadata route.
    expect(routeObjectFromPath('/meta/objects/data/contacts')).toBeUndefined();
  });
});

describe('permissionDeniedErrorDetails', () => {
  it('carries the code and the route-derived object, and nothing else', () => {
    expect(permissionDeniedErrorDetails('/data/contacts/123')).toEqual({
      code: 'PERMISSION_DENIED',
      object: 'contacts',
    });
  });

  it('omits `object` entirely when the route names none (REST parity)', () => {
    expect(permissionDeniedErrorDetails('/automation/flow_a')).toEqual({ code: 'PERMISSION_DENIED' });
  });

  /**
   * The signature is the guarantee: this builder cannot see the error at all,
   * so no field of `error.details` can reach it — including `details.object`,
   * which on a cascade delete names a child the caller never addressed.
   */
  it('takes only the path — the error is not an input', () => {
    expect(permissionDeniedErrorDetails.length).toBe(1);
  });
});

describe('describeDeniedDiagnostics', () => {
  it('renders the whole withheld payload for the server log', () => {
    const line = describeDeniedDiagnostics({
      operation: 'delete',
      object: 'app_child_object',
      positions: ['org_member', 'everyone'],
      permissionSets: ['app_reader'],
    });

    expect(line).toBe(
      'operation=delete object=app_child_object positions=[org_member, everyone] permissionSets=[app_reader]',
    );
  });

  it('is undefined when there is nothing to say, so no empty line is logged', () => {
    expect(describeDeniedDiagnostics(undefined)).toBeUndefined();
    expect(describeDeniedDiagnostics({})).toBeUndefined();
    expect(describeDeniedDiagnostics('nope')).toBeUndefined();
    expect(describeDeniedDiagnostics(['a'])).toBeUndefined();
  });
});
