/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A ⌘K record hit opens under the app that lists its object
 * (objectstack#28890).
 *
 * An app whose navigation names no object (a component-only app, as cloud's
 * Account app is) searches every object, so its hits name objects it does not
 * list. Each opened under that app all the same, `/apps/<palette app>/OBJECT/
 * record/ID`, and the record page drew a sidebar and a switcher that reach
 * nothing of the object. The hit now opens under the palette's own app when
 * that app lists the object, else under the first app the user can open that
 * lists it, else under the palette's own app.
 *
 * Pinned against the real `CommandPaletteProvider` (opened through its
 * `?palette=1` deep link) over the per-object `find` fanout; the address is
 * read off the router after the hit is chosen.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

const OBJECT = 'sys_environment_28890';
const REC = 'E1';
const RECORD = { id: REC, name: 'Release Check 1001' };
const OBJECTS = [{ name: OBJECT, label: 'Environment', fields: { name: { label: 'Name', type: 'text' } } }];

/** A component-only app: its navigation names no object. */
const ACCOUNT = {
  name: 'account',
  label: 'Account',
  navigation: [{ id: 'n_profile', type: 'component', componentName: 'account/profile_card', label: 'Profile' }],
};
/** An app that does not list the object either, ahead of the one that does. */
const DOCS = { name: 'docs', label: 'Docs', navigation: [{ id: 'n_docs', type: 'page', pageName: 'docs_home', label: 'Docs' }] };
/** The app that lists the object, inside a group, addressed by its package id. */
const CLOUD = {
  name: 'cloud',
  _packageId: 'com.objectstack.cloud',
  label: 'Cloud',
  navigation: [
    {
      id: 'g_infra',
      type: 'group',
      label: 'Infrastructure',
      children: [{ id: 'n_env', type: 'object', objectName: OBJECT, label: 'Environments' }],
    },
  ],
};
/** Lists the object in an area's navigation, not in its own. */
const OPS = {
  name: 'ops',
  label: 'Ops',
  navigation: [],
  areas: [{ id: 'a_main', label: 'Main', navigation: [{ id: 'n_env', type: 'object', objectName: OBJECT, label: 'Environments' }] }],
};
/** Lists the object but is hidden from the launcher: no place to send anyone. */
const HIDDEN = { ...CLOUD, name: 'hidden_cloud', _packageId: undefined, hidden: true };

function Probe() {
  const location = useLocation();
  return <span data-testid="location" data-path={location.pathname} />;
}

function mount(apps: Array<Record<string, unknown>>, activeApp: Record<string, unknown>) {
  const ds = { find: vi.fn(async (name: string) => ({ data: name === OBJECT ? [{ ...RECORD }] : [] })) };
  const segment = (activeApp._packageId as string | undefined) ?? (activeApp.name as string);
  render(
    <MemoryRouter initialEntries={[`/apps/${segment}?palette=1`]}>
      <CommandPaletteProvider>
        <Probe />
        <CommandPalette apps={apps} activeApp={activeApp} objects={OBJECTS} onAppChange={() => {}} dataSource={ds} />
      </CommandPaletteProvider>
    </MemoryRouter>,
  );
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette did not open');
  fireEvent.change(input, { target: { value: 'release' } });
}

/** Choose the record hit once it is on screen (the hook debounces 250ms); answer the address it opened. */
async function openHit(): Promise<string | null> {
  const item = await waitFor(
    () => {
      const found = document.querySelector('[cmdk-item][data-value^="record "]');
      if (!found) throw new Error('the record hit is not on screen yet');
      return found;
    },
    { timeout: 4000 },
  );
  fireEvent.click(item);
  return screen.getByTestId('location').getAttribute('data-path');
}

afterEach(() => cleanup());

describe('objectstack#28890 — a ⌘K record hit opens under the app that lists its object', () => {
  it('from an app that does not list the object, the hit opens under the first app that does', async () => {
    mount([ACCOUNT, DOCS, HIDDEN, CLOUD, OPS], ACCOUNT);
    expect(await openHit()).toBe(`/apps/com.objectstack.cloud/${OBJECT}/record/${REC}`);
  });

  it('an app that lists the object only in an area counts as listing it', async () => {
    mount([ACCOUNT, OPS, CLOUD], ACCOUNT);
    expect(await openHit()).toBe(`/apps/ops/${OBJECT}/record/${REC}`);
  });

  it('CONTROL: from an app that lists the object, the hit stays under that app', async () => {
    mount([ACCOUNT, OPS, CLOUD], CLOUD);
    expect(await openHit()).toBe(`/apps/com.objectstack.cloud/${OBJECT}/record/${REC}`);
  });

  it('CONTROL: when no app the user can open lists the object, the hit stays under the palette app', async () => {
    mount([ACCOUNT, DOCS, HIDDEN], ACCOUNT);
    expect(await openHit()).toBe(`/apps/account/${OBJECT}/record/${REC}`);
  });
});
