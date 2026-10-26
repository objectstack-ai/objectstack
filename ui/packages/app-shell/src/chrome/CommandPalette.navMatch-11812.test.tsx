/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette shows a navigation entry only when the query is a word
 * prefix, or a contiguous substring, of its label or machine name
 * (objectui#11812).
 *
 * The navigation groups used to go through cmdk's default subsequence scorer,
 * so on the showcase app `zzzz` listed "Field Zoo" and "New Project (Wizard)",
 * `ingest` listed four entries made of scattered letters next to the real
 * record hit, and a nonsense query never reached "No results". The palette now
 * matches those entries itself (`matchesPaletteQuery`) and renders only the
 * matches; the theme and full-search commands follow the same rule over their
 * values. Record hits are unchanged: the server search finds them.
 *
 * Pinned through the real `CommandPaletteProvider` (opened by its `?palette=1`
 * deep link) under a real `I18nProvider` in `en`, over the showcase's own
 * labels, with a `searchAll` stub standing in for the server search. What is pinned is what the DOM holds, since cmdk
 * leaves an item it filters out unrendered:
 *
 *  - `zzzz` shows no entry and "No results", once the record search settles;
 *  - `ingest` and `wayne` show their record hit and no unrelated entry;
 *    `ingest` shows the one entry whose machine name contains it;
 *  - a word prefix (`field`), a mid-word substring (`view`) and a Han
 *    substring (`大屏`) each show their entry, and cmdk filters nothing the
 *    palette renders (its own filter is off, objectui#13387);
 *  - CONTROLS: the record hit's item is the one the palette always rendered,
 *    and an empty query shows every entry and command.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

// The showcase app's entries the QA pass read, in its own nesting, plus one
// entry whose machine name (not its label) contains `ingest`.
const SHOWCASE = {
  name: 'showcase_app',
  label: 'Showcase',
  navigation: [
    { id: 'nav_start_here', type: 'page', pageName: 'showcase_start_here', label: 'Page Authoring' },
    {
      id: 'grp_workspace',
      type: 'group',
      label: 'Workspace',
      children: [
        { id: 'nav_new_project_wizard', type: 'page', pageName: 'showcase_new_project_wizard', label: 'New Project (Wizard)' },
      ],
    },
    {
      id: 'grp_data',
      type: 'group',
      label: 'Data Model',
      children: [
        { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' },
        { id: 'nav_accounts', type: 'object', objectName: 'showcase_account', label: 'Accounts' },
        { id: 'nav_field_zoo', type: 'object', objectName: 'showcase_field_zoo', label: 'Field Zoo' },
        { id: 'nav_cascade', type: 'object', objectName: 'showcase_cascade', label: 'Cascading Select' },
        { id: 'nav_slice_in_progress', type: 'object', objectName: 'showcase_task', label: 'In-Progress Tasks' },
      ],
    },
    {
      id: 'grp_analytics',
      type: 'group',
      label: 'Analytics',
      children: [
        { id: 'nav_command_center', type: 'page', pageName: 'showcase_command_center', label: 'Command Center (大屏)' },
        { id: 'nav_ops', type: 'dashboard', dashboardName: 'showcase_ops_dashboard', label: 'Delivery Operations' },
        { id: 'nav_report_joined', type: 'report', reportName: 'showcase_task_overview', label: 'Task Overview' },
      ],
    },
    { id: 'nav_styling_gallery', type: 'page', pageName: 'showcase_styling_gallery', label: 'Styling (ADR-0065)' },
    { id: 'nav_replay', type: 'page', pageName: 'ops_reingest_queue', label: 'Replay Queue' },
  ],
};
const CRM = { name: 'crm_app', label: 'CRM', navigation: [] };

const OBJECTS = [
  { name: 'showcase_task', label: 'Task' },
  { name: 'showcase_account', label: 'Account' },
  { name: 'showcase_field_zoo', label: 'Field Zoo' },
  { name: 'showcase_cascade', label: 'Cascading Select' },
];

/** The records the server search knows, found by a plain substring of their title. */
const RECORDS = [
  { object: 'showcase_task', id: 't1', title: 'Ingest pipeline' },
  { object: 'showcase_account', id: 'a1', title: 'Wayne Enterprises' },
];

function mount(query: string) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    searchAll: vi.fn(async (q: string) => ({
      hits: RECORDS.filter((r) => r.title.toLowerCase().includes(q.toLowerCase())),
    })),
  };
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/showcase_app?palette=1']}>
        <CommandPaletteProvider>
          <CommandPalette
            apps={[SHOWCASE, CRM]}
            activeApp={SHOWCASE}
            objects={OBJECTS}
            onAppChange={() => {}}
            dataSource={dataSource}
          />
        </CommandPaletteProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette did not open');
  if (query) fireEvent.change(input, { target: { value: query } });
  return dataSource;
}

/** The visible text of every item cmdk rendered whose value starts with `kind `. */
function shown(kind: string): string[] {
  return Array.from(document.querySelectorAll(`[cmdk-item][data-value^="${kind} "]`)).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

/** Every navigation entry, app and command cmdk rendered: everything but record hits. */
function entries(): string[] {
  return ['object', 'dashboard', 'page', 'report', 'app', 'theme', 'search'].flatMap(shown);
}

/** Waits for the debounced record search to answer, then returns the hits' text. */
async function settledRecordHits(dataSource: { searchAll: ReturnType<typeof vi.fn> }): Promise<string[]> {
  await waitFor(() => expect(dataSource.searchAll).toHaveBeenCalled(), { timeout: 4000 });
  await waitFor(() => expect(document.body.textContent).not.toContain('Searching…'), { timeout: 4000 });
  return shown('record');
}

afterEach(() => cleanup());

describe('objectui#11812 — the ⌘K palette matches navigation entries on word prefixes and substrings', () => {
  it('`zzzz` shows no entry and, once the record search finds nothing, "No results"', async () => {
    const ds = mount('zzzz');
    expect(await settledRecordHits(ds)).toEqual([]);
    expect(entries()).toEqual([]);
    const empty = document.querySelector('[cmdk-empty]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe('No results found.');
  });

  it('`ingest` shows its record hit and only the entry whose machine name contains it', async () => {
    const ds = mount('ingest');
    expect(await settledRecordHits(ds)).toEqual(['Ingest pipeline']);
    expect(entries()).toEqual(['Replay Queue']);
    expect(document.querySelector('[cmdk-empty]')).toBeNull();
  });

  it('`wayne` shows Wayne Enterprises and no page', async () => {
    const ds = mount('wayne');
    expect(await settledRecordHits(ds)).toEqual(['Wayne Enterprises']);
    expect(entries()).toEqual([]);
  });

  it('a word prefix, a mid-word substring and a Han substring each show their entry', () => {
    mount('field');
    expect(entries()).toEqual(['Field Zoo']);
    cleanup();

    mount('view');
    expect(entries()).toEqual(['Task Overview']);
    cleanup();

    mount('大屏');
    expect(entries()).toEqual(['Command Center (大屏)']);
    cleanup();

    mount('屏');
    expect(entries()).toEqual(['Command Center (大屏)']);
  });

  it('apps, the theme commands and the full-search command follow the same rule', () => {
    mount('crm');
    expect(shown('app')).toEqual(['CRM']);
    expect(shown('theme')).toEqual([]);
    cleanup();

    mount('dark');
    expect(entries()).toEqual(['Dark Theme']);
    cleanup();

    mount('theme');
    expect(shown('theme')).toEqual(['Light Theme', 'Dark Theme', 'System Theme']);
    cleanup();

    mount('search');
    expect(entries()).toEqual(['Open Full Search Page']);
  });

  it('CONTROL: the record hit is the item the palette always rendered, its value stable across queries (objectui#13387)', async () => {
    const ds = mount('wayne');
    await settledRecordHits(ds);
    const hit = document.querySelector('[cmdk-item][data-value^="record "]');
    expect(hit?.getAttribute('data-value')).toBe('record Wayne Enterprises Account showcase_account a1');
  });

  it('CONTROL: an empty query shows every entry, app and command', () => {
    mount('');
    expect(shown('object')).toEqual(['Tasks', 'Accounts', 'Field Zoo', 'Cascading Select', 'In-Progress Tasks']);
    expect(shown('page')).toEqual([
      'Page Authoring',
      'New Project (Wizard)',
      'Command Center (大屏)',
      'Styling (ADR-0065)',
      'Replay Queue',
    ]);
    expect(shown('dashboard')).toEqual(['Delivery Operations']);
    expect(shown('report')).toEqual(['Task Overview']);
    expect(shown('app')).toEqual(['ShowcaseCurrent', 'CRM']);
    expect(shown('theme')).toEqual(['Light Theme', 'Dark Theme', 'System Theme']);
    expect(shown('search')).toEqual(['Open Full Search Page']);
    expect(screen.getByTestId('overlay:command-palette')).toBeTruthy();
  });
});
