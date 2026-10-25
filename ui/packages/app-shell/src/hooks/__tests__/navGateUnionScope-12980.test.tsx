// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980 — the sidebar's runtime-capability gate (`useNavMemberGates`)
 * in an app whose served item names NO package (an app created in the console).
 *
 * While the object type is idle the gate reads the names-only scope over every
 * `requiresObject` the app list carries, in each app's `navigation` and
 * `areas[].navigation`, instead of the whole registry (`GET meta/object`).
 * Every name a consumer gates is asked by name, so each consumer answers
 * exactly as the whole registry answers: the sidebar (the app's navigation and
 * its areas), the app root's landing (the navigation, as `AppRootLanding` reads
 * it) and the bell's cross-app activity roster (`activityObjectRoster`, over
 * every app's navigation and areas).
 *
 * A by-name read that fails is left unanswered (objectui#13009), and the gate
 * shows its entry, as it shows every entry when the whole registry's read
 * fails.
 *
 * In a package app, `readAppObjectScope` now asks the `requiresObject` names of
 * the app's `areas` too, so an area entry requiring an object outside the
 * package that the deployment lacks is hidden, as the whole registry hides it.
 *
 * CONTROL: a package app whose entries live in `navigation` asks exactly what
 * it asked before; outside an app the gate reads the whole registry.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';
import { MetadataProvider, useMetadata } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { useAppObjectScopePrefetch } from '../../console/appObjectScope';
import { navEntriesShownToMember, useNavMemberGates, type NavMemberGates } from '../useNavMemberGates';
import { activityObjectRoster } from '../sharedUserFeeds';

const CRM = 'app.crm';
const OBJECTS = [
  { name: 'crm_account', _packageId: CRM },
  { name: 'note' },
  { name: 'sys_user', _packageId: 'plugin.auth' },
];

/** An object entry gated on the object it opens. */
const entry = (name: string): NavigationItem =>
  ({ id: `nav_${name}`, type: 'object', label: name, objectName: name, requiresObject: name }) as NavigationItem;

/** The console-created app: no `_packageId`. Its area requires an object the deployment lacks. */
const NOTES_APP = {
  name: 'notes',
  navigation: [entry('note'), entry('notes_gone')],
  areas: [{ id: 'area_more', label: 'More', navigation: [entry('crm_account'), entry('area_gone')] }],
};

/** Another app the chrome holds: one of its entries requires an object the deployment lacks. */
const CRM_APP = {
  name: 'crm',
  _packageId: CRM,
  navigation: [entry('crm_account'), entry('legacy_gone')],
};

type Behaviour = { failName?: string; failWholeList?: boolean };

function makeAdapter(calls: string[], apps: unknown[], behaviour: Behaviour = {}) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    // objectui#13044 — the provider's by-name OBJECT read goes through the
    // adapter's `getObjectSchema`. This double answers it from the same
    // by-name door, unwrapped the way the adapter unwraps it.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          if (type === 'object' && !options?.packageId && behaviour.failWholeList) {
            return Promise.reject(Object.assign(new Error('unavailable'), { httpStatus: 503 }));
          }
          const all = (type === 'object' ? OBJECTS : type === 'app' ? apps : []) as Array<{ _packageId?: string }>;
          const items = options?.packageId ? all.filter((o) => o._packageId === options.packageId) : all;
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          if (name === behaviour.failName) {
            return Promise.reject(Object.assign(new Error('upstream'), { httpStatus: 502 }));
          }
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          return item
            ? Promise.resolve({ item: structuredClone(item) })
            : Promise.reject(Object.assign(new Error('not found'), { httpStatus: 404, code: 'RESOURCE_NOT_FOUND' }));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** What each consumer of the gate is shown, by entry id / object name. */
interface Answers {
  sidebar: string[];
  sidebarAreas: string[];
  landing: string[];
  roster: string[];
}

type Reading = { gates: NavMemberGates; ctx: ReturnType<typeof useMetadata> };

const ids = (items: NavigationItem[]) => items.map((item) => item.id as string);

type GatedApp = { navigation: NavigationItem[]; areas?: Array<{ navigation: NavigationItem[] }> };

function answers(read: Reading, app: GatedApp, apps: unknown[]): Answers {
  const { gates } = read;
  const areas = app.areas ?? [];
  return {
    sidebar: ids(navEntriesShownToMember(app.navigation, gates)),
    sidebarAreas: areas.flatMap((area) => ids(navEntriesShownToMember(area.navigation, gates))),
    // `AppRootLanding` reads the app's navigation through the same gates.
    landing: ids(navEntriesShownToMember(app.navigation, gates)),
    roster: activityObjectRoster(apps as Parameters<typeof activityObjectRoster>[0], gates),
  };
}

function mount(
  app: Record<string, unknown>,
  apps: unknown[],
  calls: string[],
  options: { url?: string; behaviour?: Behaviour } = {},
): () => Reading {
  // Each mount reads its own app list, not the one a previous mount cached.
  sessionStorage.clear();
  let latest: Reading | null = null;
  function Probe() {
    useAppObjectScopePrefetch();
    latest = { gates: useNavMemberGates(), ctx: useMetadata() };
    return null;
  }
  render(
    <MetadataProvider adapter={makeAdapter(calls, apps, options.behaviour)}>
      <MemoryRouter initialEntries={[options.url ?? '/home']}>
        <ExpressionProvider app={app}>
          <Probe />
        </ExpressionProvider>
      </MemoryRouter>
    </MetadataProvider>,
  );
  return () => latest as unknown as Reading;
}

const objectCalls = (calls: string[]) =>
  calls.filter((c) => c === 'object' || c.startsWith('object?') || c.startsWith('object/'));

/** Read the whole registry in the mounted tree, as a record route would. */
async function loadWholeRegistry(read: () => Reading, settled: 'ready' | 'error' = 'ready') {
  act(() => {
    void read().ctx.objects;
  });
  await waitFor(() => expect(read().ctx.getTypeStatus!('object')).toBe(settled));
}

const APPS = [NOTES_APP, CRM_APP];

afterEach(() => cleanup());

describe('package-less app: the nav gate reads the union of required objects by name (objectui#12980)', () => {
  it('(a) no whole-registry read, and every consumer answers exactly as the whole registry does', async () => {
    const calls: string[] = [];
    const read = mount(NOTES_APP, APPS, calls);
    const expected: Answers = {
      sidebar: ['nav_note'],
      sidebarAreas: ['nav_crm_account'],
      landing: ['nav_note'],
      roster: ['crm_account', 'note'],
    };
    await waitFor(() => expect(answers(read(), NOTES_APP, APPS)).toEqual(expected));
    const scoped = answers(read(), NOTES_APP, APPS);

    expect(objectCalls(calls)).not.toContain('object');
    expect([...objectCalls(calls)].sort()).toEqual(
      ['object/area_gone', 'object/crm_account', 'object/legacy_gone', 'object/note', 'object/notes_gone'].sort(),
    );

    // The same tree, once the whole registry is loaded: the gate reads it.
    await loadWholeRegistry(read);
    expect(objectCalls(calls)).toContain('object');
    const whole = answers(read(), NOTES_APP, APPS);
    expect(whole).toEqual(expected);
    expect(scoped).toEqual(whole);
  });

  it('(b) a by-name read that fails leaves its entry shown, as a failed whole-registry read does', async () => {
    const calls: string[] = [];
    const read = mount(NOTES_APP, APPS, calls, { behaviour: { failName: 'notes_gone' } });
    await waitFor(() => expect(objectCalls(calls)).toContain('object/notes_gone'));
    await waitFor(() => expect(answers(read(), NOTES_APP, APPS).sidebarAreas).toEqual(['nav_crm_account']));

    expect(answers(read(), NOTES_APP, APPS).sidebar).toEqual(['nav_note', 'nav_notes_gone']);
    expect(read().gates.checkCapability('object', 'notes_gone')).toBe(true);
    expect(objectCalls(calls)).not.toContain('object');

    // The whole registry's own failure reads every entry as shown.
    cleanup();
    const failedCalls: string[] = [];
    const failed = mount(NOTES_APP, APPS, failedCalls, { behaviour: { failWholeList: true } });
    await loadWholeRegistry(failed, 'error');
    expect(answers(failed(), NOTES_APP, APPS).sidebar).toEqual(['nav_note', 'nav_notes_gone']);
  });

  it('CONTROL: outside an app (no app name), the gate reads the whole registry, as before', async () => {
    const calls: string[] = [];
    const read = mount({}, APPS, calls);
    await waitFor(() => expect(read().ctx.getTypeStatus!('object')).toBe('ready'));

    expect(objectCalls(calls)).toEqual(['object']);
    expect(read().gates.checkCapability('object', 'legacy_gone')).toBe(false);
  });
});

describe('package app: an area entry requiring an object outside the package is gated exactly (objectui#12980)', () => {
  const AREA_APP = {
    ...CRM_APP,
    navigation: [entry('crm_account')],
    areas: [{ id: 'area_admin', label: 'Admin', navigation: [entry('sys_user'), entry('area_gone')] }],
  };

  it('(c) the area entry whose object the deployment lacks is hidden; the present one is shown', async () => {
    const calls: string[] = [];
    const read = mount(AREA_APP, [AREA_APP], calls, { url: '/apps/crm/crm_account' });
    await waitFor(() => expect(objectCalls(calls)).toContain('object/area_gone'));
    await waitFor(() => expect(read().gates.checkCapability('object', 'area_gone')).toBe(false));

    expect(answers(read(), AREA_APP, [AREA_APP]).sidebarAreas).toEqual(['nav_sys_user']);
    expect(objectCalls(calls)).not.toContain('object');
  });

  it('CONTROL (d): a package app whose entries live in `navigation` asks what it asked before, and gates them the same', async () => {
    const calls: string[] = [];
    const read = mount(CRM_APP, [CRM_APP], calls, { url: '/apps/crm/crm_account' });
    await waitFor(() => expect(read().gates.checkCapability('object', 'legacy_gone')).toBe(false));

    expect(objectCalls(calls)).toEqual([`object?package=${CRM}`, 'object/legacy_gone']);
    expect(answers(read(), CRM_APP, [CRM_APP]).sidebar).toEqual(['nav_crm_account']);
    // A name nobody asked reads as registered inside a package app, as objectui#12811 left it.
    expect(read().gates.checkCapability('object', 'never_asked')).toBe(true);
  });
});
