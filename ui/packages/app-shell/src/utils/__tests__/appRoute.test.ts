import { describe, it, expect } from 'vitest';
import { appRouteSegment, matchAppBySegment, filterActiveApps, resolveHostAppSegment, appStudioDesignPath, appStudioSurfacePath, appStudioObjectPath, appStudioRoutePath } from '../appRoute';

/**
 * ADR-0048 (option A) — package-id route segment.
 */
describe('appRouteSegment', () => {
  it('returns the package id when present', () => {
    expect(appRouteSegment({ name: 'crm', _packageId: 'com.acme.crm' })).toBe('com.acme.crm');
  });
  it('falls back to the app name when no package id', () => {
    expect(appRouteSegment({ name: 'crm' })).toBe('crm');
  });
  it('returns undefined for nullish input', () => {
    expect(appRouteSegment(undefined)).toBeUndefined();
    expect(appRouteSegment(null)).toBeUndefined();
  });
});

describe('matchAppBySegment', () => {
  const crm = { name: 'crm', _packageId: 'com.acme.crm' };
  const hr = { name: 'crm', _packageId: 'com.beta.crm' }; // same display name, different vendor
  const apps = [crm, hr];

  it('matches by package id (disambiguates same-named apps)', () => {
    expect(matchAppBySegment(apps, 'com.acme.crm')).toBe(crm);
    expect(matchAppBySegment(apps, 'com.beta.crm')).toBe(hr);
  });
  it('falls back to matching by name (legacy/alias URL)', () => {
    expect(matchAppBySegment([{ name: 'sales' }], 'sales')).toEqual({ name: 'sales' });
  });
  it('prefers a package-id match over a name match', () => {
    const byName = { name: 'com.acme.crm' }; // pathological: an app literally named like a pkg id
    expect(matchAppBySegment([byName, crm], 'com.acme.crm')).toBe(crm);
  });
  it('returns undefined for missing inputs', () => {
    expect(matchAppBySegment(apps, undefined)).toBeUndefined();
    expect(matchAppBySegment(null, 'com.acme.crm')).toBeUndefined();
  });
});

/**
 * objectstack#7231 / objectui#4074 — which app hosts an app-INDEPENDENT page
 * (the Approvals Inbox, `sys_inbox_message`, `sys_activity`). The producers that
 * consume this are pinned end-to-end in `HomePage.inboxLinksTarget.test.tsx` and
 * `InboxPopover.viewAllTarget.test.tsx`; these cases pin the resolution itself.
 */
describe('filterActiveApps', () => {
  it('keeps apps that declare neither flag (the common case)', () => {
    expect(filterActiveApps([{ name: 'crm' }])).toEqual([{ name: 'crm' }]);
  });
  it('drops deactivated and hidden apps', () => {
    const apps = [
      { name: 'crm' },
      { name: 'old', active: false },
      { name: 'account', hidden: true },
    ];
    expect(filterActiveApps(apps).map((a) => a.name)).toEqual(['crm']);
  });
  it('⛔ keeps an UNPUBLISHED app — `_unpublished` is a server-side gate, not a launcher filter', () => {
    // objectstack#6955 (#4829 A1). `_unpublished` is the ADR-0045 publish gate
    // and the REST metadata gate already withholds those apps from non-builders,
    // so one that reaches this predicate belongs to a builder entitled to open
    // it. Adding an `_unpublished !== true` clause would hide a builder's own
    // in-progress app from the builder and break every link the module builds
    // into it. `hidden` is the opposite: no other enforcement point exists, so
    // the clause above is its whole implementation.
    const apps = [
      { name: 'crm' },
      { name: 'draft_app', _unpublished: true },
      { name: 'account', hidden: true, _unpublished: true },
    ];
    expect(filterActiveApps(apps).map((a) => a.name)).toEqual(['crm', 'draft_app']);
  });
  it('is idempotent, so a caller that already filtered can pass its list through', () => {
    const apps = [{ name: 'crm' }, { name: 'old', active: false }];
    expect(filterActiveApps(filterActiveApps(apps))).toEqual(filterActiveApps(apps));
  });
  it('returns an empty list for nullish input', () => {
    expect(filterActiveApps(null)).toEqual([]);
    expect(filterActiveApps(undefined)).toEqual([]);
  });
});

describe('resolveHostAppSegment', () => {
  const setup = { name: 'setup' };
  const crm = { name: 'crm', _packageId: 'com.acme.crm' };
  const hr = { name: 'hr' };

  it('1. prefers the app the user is in / last had open', () => {
    expect(resolveHostAppSegment([setup, crm], 'com.acme.crm')).toBe('com.acme.crm');
  });

  it('1. addresses that app by its package segment, whichever spelling was remembered', () => {
    // `matchAppBySegment` accepts the name as a legacy alias; the segment we
    // emit is always the canonical one, so the link cannot disagree with the
    // app tiles about how the same app is spelled.
    expect(resolveHostAppSegment([crm], 'crm')).toBe('com.acme.crm');
  });

  it('1. re-checks the preferred name against the LIVE list and does not resurrect a dead app', () => {
    // `currentAppName` is plain React state — it outlives the app it names.
    expect(resolveHostAppSegment([hr], 'crm')).toBe('hr');
    expect(resolveHostAppSegment([hr, { name: 'crm', active: false }], 'crm')).toBe('hr');
    expect(resolveHostAppSegment([hr, { name: 'crm', hidden: true }], 'crm')).toBe('hr');
  });

  it('2. falls back to the first ACTIVE app when nothing names the current one', () => {
    expect(resolveHostAppSegment([{ name: 'old', active: false }, hr], undefined)).toBe('hr');
  });

  it('3. keeps an unchecked preferred segment when the list names no app at all', () => {
    // An empty list is "not loaded yet" as often as "no apps" — a caller
    // rendering inside `/apps/crm/…` must not be demoted to `setup`.
    expect(resolveHostAppSegment([], 'crm')).toBe('crm');
    expect(resolveHostAppSegment(undefined, 'crm')).toBe('crm');
  });

  it('4. falls back to setup only when nothing addressable is left', () => {
    expect(resolveHostAppSegment([], undefined)).toBe('setup');
    expect(resolveHostAppSegment(null, null)).toBe('setup');
    // A degenerate app carrying neither `_packageId` nor `name`: present, so
    // step 3 does not apply, but nothing to build a URL from either.
    expect(resolveHostAppSegment([{ label: 'nameless' }], 'crm')).toBe('setup');
  });

  it('CONTROL: a user whose current app IS setup resolves to setup', () => {
    // The fallback order's tail is not "never setup" — it is "an app this user
    // can actually open", and for an admin sitting in Setup that is `setup`.
    expect(resolveHostAppSegment([setup, crm], 'setup')).toBe('setup');
  });
});

/**
 * ADR-0080 — app → Studio reverse bridge.
 */
describe('appStudioDesignPath', () => {
  const crm = { name: 'crm', _packageId: 'com.acme.crm' };

  it('resolves an admin viewing a packaged app to its design surface', () => {
    expect(appStudioDesignPath(crm, true)).toBe('/studio/com.acme.crm/data');
  });
  it('URL-encodes the package id', () => {
    expect(appStudioDesignPath({ _packageId: 'com.acme/crm' }, true)).toBe(
      '/studio/com.acme%2Fcrm/data',
    );
  });
  it('returns null for non-admins', () => {
    expect(appStudioDesignPath(crm, false)).toBeNull();
  });
  it('returns null for apps with no owning package (runtime/DB apps)', () => {
    expect(appStudioDesignPath({ name: 'crm' }, true)).toBeNull();
    expect(appStudioDesignPath(undefined, true)).toBeNull();
    expect(appStudioDesignPath(null, true)).toBeNull();
  });
  it('returns null for the DB-authored sys_metadata pseudo-package', () => {
    expect(appStudioDesignPath({ name: 'crm', _packageId: 'sys_metadata' }, true)).toBeNull();
  });
});

/**
 * App → Studio interface deep-link (dashboard design page).
 */
describe('appStudioSurfacePath', () => {
  const crm = { name: 'crm', _packageId: 'com.acme.crm' };

  it('deep-links to the interface surface in the Interfaces pillar', () => {
    expect(appStudioSurfacePath(crm, true, { type: 'dashboard', name: 'executive_dashboard' })).toBe(
      '/studio/com.acme.crm/interfaces?surface=dashboard:executive_dashboard',
    );
  });
  it('URL-encodes the package id and the surface name', () => {
    expect(
      appStudioSurfacePath({ _packageId: 'com.acme/crm' }, true, { type: 'dashboard', name: 'sales dash' }),
    ).toBe('/studio/com.acme%2Fcrm/interfaces?surface=dashboard:sales%20dash');
  });
  it('returns null for non-admins', () => {
    expect(appStudioSurfacePath(crm, false, { type: 'dashboard', name: 'd' })).toBeNull();
  });
  it('returns null when the surface identity is incomplete', () => {
    expect(appStudioSurfacePath(crm, true, { type: 'dashboard', name: '' })).toBeNull();
    expect(appStudioSurfacePath(crm, true, { type: '', name: 'd' })).toBeNull();
    expect(appStudioSurfacePath(crm, true, null)).toBeNull();
  });
  it('returns null for apps with no owning package or the sys_metadata pseudo-package', () => {
    expect(appStudioSurfacePath({ name: 'crm' }, true, { type: 'dashboard', name: 'd' })).toBeNull();
    expect(appStudioSurfacePath({ _packageId: 'sys_metadata' }, true, { type: 'dashboard', name: 'd' })).toBeNull();
  });
});

/**
 * App → Studio object deep-link (Data pillar).
 */
describe('appStudioObjectPath', () => {
  const crm = { name: 'crm', _packageId: 'com.acme.crm' };

  it('deep-links to the object surface in the Data pillar', () => {
    expect(appStudioObjectPath(crm, true, 'showcase_task')).toBe(
      '/studio/com.acme.crm/data?surface=object:showcase_task',
    );
  });
  it('URL-encodes the package id and the object name', () => {
    expect(appStudioObjectPath({ _packageId: 'com.acme/crm' }, true, 'my object')).toBe(
      '/studio/com.acme%2Fcrm/data?surface=object:my%20object',
    );
  });
  it('returns null for non-admins', () => {
    expect(appStudioObjectPath(crm, false, 'account')).toBeNull();
  });
  it('returns null when the object name is missing', () => {
    expect(appStudioObjectPath(crm, true, undefined)).toBeNull();
    expect(appStudioObjectPath(crm, true, '')).toBeNull();
  });
  it('returns null for apps with no owning package or the sys_metadata pseudo-package', () => {
    expect(appStudioObjectPath({ name: 'crm' }, true, 'account')).toBeNull();
    expect(appStudioObjectPath({ _packageId: 'sys_metadata' }, true, 'account')).toBeNull();
  });
});

/**
 * App → Studio route bridge — maps a running-app route to its Studio target:
 * an interface surface (dashboard / page / report) deep-links into the
 * Interfaces pillar; an object record page deep-links that object in the Data
 * pillar; everything else opens the package's Data tab.
 */
describe('appStudioRoutePath', () => {
  const crm = { name: 'crm', _packageId: 'com.acme.crm' };

  it('deep-links a dashboard route to its Interfaces surface', () => {
    expect(appStudioRoutePath(crm, true, { type: 'dashboard', name: 'executive_dashboard' })).toBe(
      '/studio/com.acme.crm/interfaces?surface=dashboard:executive_dashboard',
    );
  });

  it('deep-links a page route to its Interfaces surface (the fix — was the Data tab)', () => {
    expect(appStudioRoutePath(crm, true, { type: 'page', name: 'showcase_crm_workbench' })).toBe(
      '/studio/com.acme.crm/interfaces?surface=page:showcase_crm_workbench',
    );
  });

  it('deep-links a report route to its Interfaces surface', () => {
    expect(appStudioRoutePath(crm, true, { type: 'report', name: 'pipeline_report' })).toBe(
      '/studio/com.acme.crm/interfaces?surface=report:pipeline_report',
    );
  });

  it('deep-links an object route (routeType is the object name) to its Data-pillar surface', () => {
    // The fix: an object records page now opens THAT object, not the generic Data tab.
    expect(appStudioRoutePath(crm, true, { type: 'showcase_task', name: undefined })).toBe(
      '/studio/com.acme.crm/data?surface=object:showcase_task',
    );
    // A record-detail route (name='record') still keys off the object route type.
    expect(appStudioRoutePath(crm, true, { type: 'account', name: 'record' })).toBe(
      '/studio/com.acme.crm/data?surface=object:account',
    );
  });

  it('falls back to the plain Data tab for the app root and the system area', () => {
    // No route type at all (bare /apps/:pkg) → Data tab.
    expect(appStudioRoutePath(crm, true, { type: undefined, name: undefined })).toBe('/studio/com.acme.crm/data');
    // The system settings area is not an object.
    expect(appStudioRoutePath(crm, true, { type: 'system', name: 'members' })).toBe('/studio/com.acme.crm/data');
  });

  it('falls back to the Data tab for an interface list route (no surface name)', () => {
    // e.g. /apps/:pkg/page with no specific page selected.
    expect(appStudioRoutePath(crm, true, { type: 'page', name: undefined })).toBe('/studio/com.acme.crm/data');
  });

  it('returns null for non-admins (bridge hidden), for both surface and Data targets', () => {
    expect(appStudioRoutePath(crm, false, { type: 'page', name: 'showcase_crm_workbench' })).toBeNull();
    expect(appStudioRoutePath(crm, false, { type: 'account', name: undefined })).toBeNull();
  });

  it('returns null when the app has no owning package (runtime/DB apps)', () => {
    expect(appStudioRoutePath({ name: 'crm' }, true, { type: 'page', name: 'p' })).toBeNull();
    expect(appStudioRoutePath({ _packageId: 'sys_metadata' }, true, { type: 'page', name: 'p' })).toBeNull();
  });
});
