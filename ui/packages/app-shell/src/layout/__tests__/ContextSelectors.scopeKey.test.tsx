// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Context selectors own ONE URL scope key EACH (objectui#3500).
 *
 * `AppContextSelectorSchema` is an array and its `id` is documented as the
 * nav template var the selected value is published under — so declaring two
 * selectors must yield two independent scopes. The shell used to hardcode the
 * literal `package` query key on both the read and the write side, so a second
 * selector mirrored the first: switching either wrote the same key, and every
 * `contextValues[id]` read it back. Parse-clean metadata, two rendered
 * dropdowns, one silently shared value.
 *
 * No fixture in this repo had ever declared a second selector, which is why
 * the hole was invisible to the suite — hence the ≥2-selector cases below.
 *
 * The legacy-compat case is a REGRESSION PIN, not a behaviour change: Studio's
 * `active_package` selector deliberately keeps `?package=`, because that key
 * is also spelled by ~15 Studio nav items in `@objectstack/platform-objects`
 * (`params: { package: '{active_package}' }`) and read directly by six Studio
 * pages. It was green before this change and must stay green after it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

// Radix's Select is not driveable in happy-dom (pointer capture), and the
// choreography is not what is under test — the query key the selection lands
// on is. Swap the primitives for a flat list of buttons that call
// `onValueChange` directly. `getLazyIcon` is kept because NavigationRenderer
// (imported below for the template assertion) names it.
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const R = await import('react');
  const PickCtx = R.createContext<(value: string) => void>(() => {});
  return {
    ...actual,
    getLazyIcon: () => () => null,
    Select: ({ value, onValueChange, children }: any) => (
      <PickCtx.Provider value={onValueChange}>
        <div data-current={value ?? ''}>{children}</div>
      </PickCtx.Provider>
    ),
    SelectTrigger: ({ children, 'aria-label': label }: any) => (
      <div role="combobox" aria-label={label}>{children}</div>
    ),
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children }: any) => {
      const pick = R.useContext(PickCtx);
      return (
        <button type="button" data-testid={`opt-${value}`} onClick={() => pick(value)}>
          {children}
        </button>
      );
    },
    SelectValue: () => null,
  };
});

// The package root, not the deep `@object-ui/layout/NavigationRenderer` path:
// `@object-ui/layout` declares a single `.` export, so that subpath resolves
// through no `exports` entry and had no types at all (TS2307). `resolveHref` is
// re-exported from the barrel (`export * from './NavigationRenderer'`), so this
// is the same symbol by its public name (objectui#4040).
import { resolveHref } from '@object-ui/layout';
import {
  useAppContextSelectors,
  contextSelectorQueryKey,
  STUDIO_PACKAGE_SELECTOR_ID,
  type ContextSelectorDef,
} from '../ContextSelectors';

const PACKAGES_ENDPOINT = '/api/v1/packages';
const ENVS_ENDPOINT = '/api/v1/environments';

/** Option rows per endpoint; labels sort so `options[0]` is predictable. */
const ROWS: Record<string, Array<{ id: string; name: string }>> = {
  [PACKAGES_ENDPOINT]: [
    { id: 'billing', name: 'Billing' },
    { id: 'crm_core', name: 'CRM Core' },
  ],
  [ENVS_ENDPOINT]: [
    { id: 'prod', name: 'Production' },
    { id: 'staging', name: 'Staging' },
  ],
};

// Stable module-level refs: `useAppContextSelectors` keys effects off the
// selector array, so a fresh array per render would re-run them needlessly.
const STUDIO_ONLY: ContextSelectorDef[] = [
  { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT } },
];

const TWO_SELECTORS: ContextSelectorDef[] = [
  { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT } },
  { id: 'active_env', label: 'Environment', optionsSource: { endpoint: ENVS_ENDPOINT } },
];

// Same pair on the storage medium — the per-selector scope key has a
// sessionStorage half too, and `persist: 'session'` is what selects it now
// (objectstack#5994). Values are read back per `objectui-ctx-<app>-<id>`.
const TWO_SESSION_SELECTORS: ContextSelectorDef[] = [
  { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT }, persist: 'session' },
  { id: 'active_env', label: 'Environment', optionsSource: { endpoint: ENVS_ENDPOINT }, persist: 'session' },
];

/** Latest render's hook output plus the router's query string. */
let snapshot: { contextValues: Record<string, string>; search: string };

function Probe({ selectors }: { selectors: ContextSelectorDef[] }) {
  const location = useLocation();
  const { contextValues, element } = useAppContextSelectors('studio', selectors);
  // Published from an effect, not during render: the hook re-navigates from
  // its own effects, so only a committed render is a meaningful sample.
  React.useEffect(() => {
    snapshot = { contextValues, search: location.search };
  });
  return <>{element}</>;
}

function mount(selectors: ContextSelectorDef[], url: string) {
  snapshot = { contextValues: {}, search: '' };
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Probe selectors={selectors} />
    </MemoryRouter>,
  );
}

/** The options for every declared selector have resolved and rendered. */
async function optionsReady(...testIds: string[]) {
  await waitFor(() => {
    for (const id of testIds) expect(screen.getByTestId(id)).toBeInTheDocument();
  });
}

function query() {
  return new URLSearchParams(snapshot.search);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ROWS[String(url)] ?? [],
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contextSelectorQueryKey', () => {
  it('derives the scope key from the selector id', () => {
    expect(contextSelectorQueryKey('active_env')).toBe('active_env');
    expect(contextSelectorQueryKey('tenant')).toBe('tenant');
    // Snake_case ids that collide with Object.prototype must not resolve to a
    // prototype member — the legacy table is a Map for exactly this reason.
    expect(contextSelectorQueryKey('constructor')).toBe('constructor');
    expect(contextSelectorQueryKey('value_of')).toBe('value_of');
  });

  it('grandfathers the shipped `?package=` key for `active_package`', () => {
    expect(contextSelectorQueryKey(STUDIO_PACKAGE_SELECTOR_ID)).toBe('package');
  });
});

describe('useAppContextSelectors — one URL scope key per selector', () => {
  it('reads every selector value from its own query key', async () => {
    mount(TWO_SELECTORS, '/apps/studio?package=crm_core&active_env=prod');
    await optionsReady('opt-crm_core', 'opt-prod');

    expect(snapshot.contextValues).toEqual({
      active_package: 'crm_core',
      active_env: 'prod',
    });
  });

  it('switching one selector leaves the other scope untouched', async () => {
    mount(TWO_SELECTORS, '/apps/studio?package=crm_core&active_env=prod');
    await optionsReady('opt-crm_core', 'opt-staging');

    fireEvent.click(screen.getByTestId('opt-staging'));

    await waitFor(() => expect(snapshot.contextValues.active_env).toBe('staging'));
    // The package scope is the one that used to get clobbered.
    expect(snapshot.contextValues.active_package).toBe('crm_core');
    expect(query().get('package')).toBe('crm_core');
    expect(query().get('active_env')).toBe('staging');
    // Neither selector declares `persist`, so both are on the spec's `'query'`
    // default and sessionStorage is not their medium (objectstack#5994). This
    // assertion used to read `…-active_env` back as `'staging'`, from the
    // unconditional storage mirror that made `'query'` and `'session'`
    // indistinguishable; the mirror is gone, so both keys stay empty. The
    // three-value matrix lives in `ContextSelectors.persist.test.tsx`.
    expect(sessionStorage.getItem('objectui-ctx-studio-active_env')).toBeNull();
    expect(sessionStorage.getItem('objectui-ctx-studio-active_package')).toBeNull();
  });

  it('restores each `session`-persisted scope from its own storage key', async () => {
    // Replaces a case that pinned the deleted storage → URL bridge: it seeded
    // both storage keys, mounted a param-less URL and expected the query string
    // to gain both params (objectstack#5994 removed that bridge — storage is
    // only `persist: 'session'`'s medium now, and it never writes the URL).
    // The old case could not have reported that honestly either: `active_env`'s
    // stored `'prod'` is ALSO its auto-selected first option, so that half would
    // have stayed green while nothing was restored at all. Both values below are
    // deliberately not the first option (`billing` / `prod`), and the surviving
    // per-selector fact — two selectors, two independent scopes — is asserted on
    // the storage keys instead.
    sessionStorage.setItem('objectui-ctx-studio-active_package', 'crm_core');
    sessionStorage.setItem('objectui-ctx-studio-active_env', 'staging');

    mount(TWO_SESSION_SELECTORS, '/apps/studio');
    await optionsReady('opt-crm_core', 'opt-staging');

    expect(snapshot.contextValues).toEqual({
      active_package: 'crm_core',
      active_env: 'staging',
    });
    // Restored into the values, never into the address bar.
    expect(query().has('package')).toBe(false);
    expect(query().has('active_env')).toBe(false);
  });

  it('publishes distinct nav template vars per selector id', async () => {
    mount(TWO_SELECTORS, '/apps/studio?package=crm_core&active_env=prod');
    await optionsReady('opt-crm_core', 'opt-prod');

    const ctx = { contextValues: snapshot.contextValues };
    const item = (params: Record<string, string>): NavigationItem => ({
      id: 'nav_comp',
      type: 'component',
      label: 'Comp',
      componentRef: 'metadata:resource',
      params,
    } as NavigationItem);

    expect(
      resolveHref(item({ type: 'object', package: '{active_package}' }), '/apps/studio', ctx).href,
    ).toBe('/apps/studio/metadata/object?package=crm_core');
    expect(
      resolveHref(item({ type: 'object', env: '{active_env}' }), '/apps/studio', ctx).href,
    ).toBe('/apps/studio/metadata/object?env=prod');
  });

  it('warns when two selectors collide on one scope key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `package` and `active_package` both resolve to `?package=` — the one
    // collision the legacy table can still produce. Silent mirroring is what
    // this whole fix removes, so say it out loud instead.
    const colliding: ContextSelectorDef[] = [
      { id: 'active_package', label: 'Package', optionsSource: { endpoint: PACKAGES_ENDPOINT } },
      { id: 'package', label: 'Package (again)', optionsSource: { endpoint: PACKAGES_ENDPOINT } },
    ];
    mount(colliding, '/apps/studio?package=crm_core');

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('both map to the URL scope key "?package="')),
    );
    warn.mockRestore();
  });
});

describe('useAppContextSelectors — legacy `?package=` compat (regression pin)', () => {
  it('reads and writes the shipped `?package=` key, never `?active_package=`', async () => {
    mount(STUDIO_ONLY, '/apps/studio?package=crm_core');
    await optionsReady('opt-billing', 'opt-crm_core');

    // Read side: an existing bookmark keeps resolving the template var.
    expect(snapshot.contextValues.active_package).toBe('crm_core');

    // Write side: switching still lands on `?package=`, which is what the six
    // Studio reader surfaces and the app's own nav metadata spell.
    fireEvent.click(screen.getByTestId('opt-billing'));

    await waitFor(() => expect(query().get('package')).toBe('billing'));
    expect(query().has('active_package')).toBe(false);
    expect(snapshot.contextValues.active_package).toBe('billing');
  });
});
