// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ⌘K palette's `studio` scope (objectui#11863, Q2): the palette the
 * `/studio` landing mounts, a frame outside every app.
 *
 * Before it, the palette was mounted only inside an app, and every link it
 * built started with `/apps/APP`: mounted with no active app, its full-search
 * command went to `/apps/undefined/search`. In the `studio` scope it has no
 * app-scoped group and no full-search command, and it lists the Studio's
 * packages, objects and flows, each opening its Studio page. Pinned here:
 *
 *  - the three groups, under their pack headings, and what each one leaves
 *    out: a kernel package (the package list drops it), an object or flow
 *    whose package is not in that list, and an object with no package;
 *  - each entry's target: a package's Data pillar, an object in its package's
 *    Data pillar and a flow in its package's Automations pillar (both through
 *    the pillar's `?surface=` deep link), and a package-less flow in the
 *    package-less scope (objectui#11553);
 *  - the query matches an entry's label or machine name, as elsewhere in the
 *    palette (objectui#11812);
 *  - no rendered entry is app-scoped and none leads under `/apps/`: what the
 *    scope renders is its Studio entries and the theme commands. CONTROL: the
 *    app scope, on the same query, renders its full-search command;
 *  - nothing is read until the palette opens. CONTROL: opened, it reads.
 *
 * Real subjects: `CommandPalette`, the real `CommandPaletteProvider` (opened by
 * its `?palette=1` deep link), the real `fetchPackages` over a stubbed `fetch`,
 * and a real `I18nProvider` in `en`, so a heading is the pack's row. The
 * metadata cache is a hand-rolled `MetadataCtx` value that counts its reads.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

/** `GET /api/v1/packages`: two app packages and a kernel one, in both served shapes. */
const PACKAGES_PAYLOAD = {
  data: [
    { manifest: { id: 'com.acme.crm', name: 'Acme CRM' }, writable: true },
    { id: 'com.acme.hr', name: 'People', writable: false },
    { manifest: { id: 'com.objectstack.platform', name: 'Platform', scope: 'system' }, writable: false },
  ],
};

/** The cached `object` list: one per package, one in the kernel package, one in none. */
const OBJECTS = [
  { name: 'crm_account', label: 'Account', _packageId: 'com.acme.crm' },
  { name: 'hr_employee', label: { key: 'hr.employee', defaultValue: 'Employee' }, _packageId: 'com.acme.hr' },
  { name: 'sys_user', label: 'User', _packageId: 'com.objectstack.platform' },
  { name: 'loose_thing', label: 'Loose Thing' },
];

/** The cached `flow` list, read unscoped: a packaged flow, a package-less one, a kernel one. */
const FLOWS = [
  { name: 'crm_onboard', label: 'Onboard Account', _packageId: 'com.acme.crm' },
  { name: 'org_cleanup', label: 'Nightly Cleanup' },
  { name: 'sys_audit_sweep', label: 'Audit Sweep', _packageId: 'com.objectstack.platform' },
];

/** A metadata cache that answers the lists above and counts what was read. */
function metadataCache() {
  const reads: string[] = [];
  const value: MetadataContextValue = {
    apps: [],
    get objects() {
      reads.push('object');
      return OBJECTS;
    },
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => {
      reads.push(type);
      return type === 'flow' ? FLOWS : [];
    },
    getTypeStatus: () => 'ready',
  };
  return { value, reads };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" data-path={`${location.pathname}${location.search}`} />;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/api/v1/packages')) {
      return { ok: true, status: 200, json: async () => PACKAGES_PAYLOAD };
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(palette: React.ReactNode, at: string) {
  const cache = metadataCache();
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MetadataCtx.Provider value={cache.value}>
        <MemoryRouter initialEntries={[at]}>
          <CommandPaletteProvider>
            {palette}
            <LocationProbe />
          </CommandPaletteProvider>
        </MemoryRouter>
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
  return cache;
}

function mountStudio(at = '/studio?palette=1') {
  return mount(<CommandPalette scope="studio" />, at);
}

function type(query: string) {
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette did not open');
  fireEvent.change(input, { target: { value: query } });
}

/** The visible text of every rendered item whose cmdk value starts with `kind `. */
function shown(kind: string): string[] {
  return Array.from(document.querySelectorAll(`[cmdk-item][data-value^="${kind} "]`)).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

/** The cmdk value of every rendered item. */
function renderedValues(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item]')).map((el) => el.getAttribute('data-value') ?? '');
}

/** The rendered group headings, in order. */
function headings(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((el) => (el.textContent ?? '').trim());
}

function locationNow(): string {
  return screen.getByTestId('location').getAttribute('data-path') ?? '';
}

async function studioListed() {
  await waitFor(() => expect(shown('studio-package').length).toBeGreaterThan(0));
}

/** Pick the rendered item whose cmdk value starts with `prefix`. */
function pick(prefix: string) {
  const item = document.querySelector(`[cmdk-item][data-value^="${prefix}"]`);
  if (!item) throw new Error(`no rendered item starts with "${prefix}"`);
  fireEvent.click(item);
}

describe('the palette in the `studio` scope lists the Studio, not an app (objectui#11863)', () => {
  it('lists packages, objects and flows under the pack headings, leaving out what Studio cannot open', async () => {
    mountStudio();
    await studioListed();

    expect(headings()).toEqual(['Packages', 'Objects', 'Flows', 'Preferences']);
    expect(shown('studio-package')).toEqual(['Acme CRM', 'People']);
    // Each object and packaged flow names its package on the right.
    expect(shown('studio-object')).toEqual(['AccountAcme CRM', 'EmployeePeople']);
    expect(shown('studio-flow')).toEqual(['Onboard AccountAcme CRM', 'Nightly Cleanup']);
  });

  it('opens a package on its Data pillar', async () => {
    mountStudio();
    await studioListed();
    pick('studio-package People ');
    await waitFor(() => expect(locationNow()).toBe('/studio/com.acme.hr/data'));
  });

  it("opens an object in its package's Data pillar, on that object", async () => {
    mountStudio();
    await studioListed();
    pick('studio-object Account ');
    await waitFor(() => expect(locationNow()).toBe('/studio/com.acme.crm/data?surface=object%3Acrm_account'));
  });

  it("opens a packaged flow in its package's Automations pillar, on that flow", async () => {
    mountStudio();
    await studioListed();
    pick('studio-flow Onboard Account ');
    await waitFor(() =>
      expect(locationNow()).toBe('/studio/com.acme.crm/automations?surface=flow%3Acrm_onboard'),
    );
  });

  it('opens a package-less flow in the package-less scope (objectui#11553)', async () => {
    mountStudio();
    await studioListed();
    pick('studio-flow Nightly Cleanup ');
    await waitFor(() => expect(locationNow()).toBe('/studio/~org/automations?surface=flow%3Aorg_cleanup'));
  });

  it('matches an entry by its label or its machine name', async () => {
    mountStudio();
    await studioListed();

    type('employee');
    expect(shown('studio-object')).toEqual(['EmployeePeople']);
    expect(shown('studio-package')).toEqual([]);
    expect(shown('studio-flow')).toEqual([]);

    type('com.acme.hr');
    expect(shown('studio-package')).toEqual(['People']);
    expect(shown('studio-object')).toEqual([]);
  });

  it('renders no app-scoped entry and nothing that leads under /apps/, on an empty query and on a search query', async () => {
    mountStudio();
    await studioListed();

    const studioOrTheme = (value: string) => /^(studio-(package|object|flow)|theme) /.test(value);
    expect(renderedValues().filter((value) => !studioOrTheme(value))).toEqual([]);

    type('search');
    await waitFor(() => expect(document.querySelector('[cmdk-empty]')).not.toBeNull());
    expect(renderedValues()).toEqual([]);
    expect(locationNow()).toBe('/studio?palette=1');
  });

  it('CONTROL — the app scope renders its full-search command for the same query', async () => {
    mount(
      <CommandPalette
        apps={[]}
        activeApp={{ name: 'crm_app', label: 'CRM', navigation: [] }}
        objects={[]}
        onAppChange={() => {}}
      />,
      '/apps/crm_app?palette=1',
    );
    type('search');
    expect(renderedValues()).toEqual(['search all results full page']);
    pick('search all results full page');
    await waitFor(() => expect(locationNow()).toBe('/apps/crm_app/search'));
    // The app scope reads no Studio list.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads nothing until the palette opens', async () => {
    const cache = mountStudio('/studio');
    // The palette is mounted and closed; let any effect run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[cmdk-input]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.reads).toEqual([]);
  });

  it('CONTROL — opened, it reads the package list and the object and flow lists', async () => {
    const cache = mountStudio();
    await studioListed();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/packages', expect.anything());
    expect(cache.reads).toContain('object');
    expect(cache.reads).toContain('flow');
  });
});

/**
 * The scope is declared, not inferred: the `studio` palette takes no app prop,
 * so a palette cannot be half in an app. Checked by `tsc -p tsconfig.test.json`
 * (the package's `type-check`), never run.
 */
export function studioScopeTakesNoAppProps() {
  return (
    <>
      {/* @ts-expect-error — the `studio` scope has no active app to take */}
      <CommandPalette scope="studio" activeApp={{ name: 'crm_app' }} />
      {/* @ts-expect-error — an app palette needs its app props */}
      <CommandPalette />
    </>
  );
}
