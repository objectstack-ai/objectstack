/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29750 — where a route the native shell hands the Console lands,
 * at the unit level. The wiring into the real router is pinned in
 * `App.nativeShellMode-29039.test.tsx`; this file holds the two answers that
 * no listener input can reach (the resolver's `null` and `external`), because
 * `isInAppRoute` refuses a blank route and any scheme or `//host` before the
 * Console ever sees it, and the unmatched-path predicate's table.
 */

import { describe, expect, it } from 'vitest';
import { isAppRelativeUnmatchedPath, nativeShellRouteTarget } from '../nativeShellRoute';

describe('nativeShellRouteTarget', () => {
  it('hosts an app-relative route under the hinted app', () => {
    expect(nativeShellRouteTarget('/opportunity/123', 'crm', [])).toBe('/apps/crm/opportunity/123');
  });

  it('passes a Console route under /apps through', () => {
    expect(nativeShellRouteTarget('/apps/x/y/1', 'crm', [])).toBe('/apps/x/y/1');
  });

  it('re-checks the hint against an app list in reach, as the inbox does', () => {
    const apps = [{ name: 'crm', active: true }, { name: 'old', active: false }];
    expect(nativeShellRouteTarget('/opportunity/123', 'old', apps)).toBe('/apps/crm/opportunity/123');
  });

  it('with no hint, hands the route to the router unchanged', () => {
    expect(nativeShellRouteTarget('/opportunity/123', undefined, [])).toBe('/opportunity/123');
  });

  it('a blank route resolves to nothing: no navigation', () => {
    expect(nativeShellRouteTarget('', 'crm', [])).toBeNull();
    expect(nativeShellRouteTarget('   ', 'crm', [])).toBeNull();
  });

  it('an off-console route resolves to nothing for the router: no navigation', () => {
    expect(nativeShellRouteTarget('https://evil.example/x', 'crm', [])).toBeNull();
    expect(nativeShellRouteTarget('//evil.example/x', 'crm', [])).toBeNull();
  });
});

describe('isAppRelativeUnmatchedPath', () => {
  it('a path whose first segment names no Console route is app-relative', () => {
    expect(isAppRelativeUnmatchedPath('/opportunity/123')).toBe(true);
    expect(isAppRelativeUnmatchedPath('/showcase_task')).toBe(true);
  });

  it('a Console route served outside an app, the landing and /apps are not', () => {
    for (const path of ['/', '/home/x', '/dev/nope', '/studio/x/y', '/forms/x/y', '/apps', '/apps/']) {
      expect(isAppRelativeUnmatchedPath(path), path).toBe(false);
    }
  });
});
