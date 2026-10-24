// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11847 — Setup's app editor offers a separator entry only what the
 * spec's separator member declares.
 *
 * The member is `type` / `id` / `order` and nothing else, and it is strict: a
 * `label` or an `icon` on a separator is refused at save (`unrecognized_keys`).
 * `AppNavInspector` drew its Label and Icon fields for every entry, so a label
 * typed on a separator wrote `{ type: 'separator', label }` and the save
 * refused a field the editor had offered. Which describing fields an entry
 * takes is now answered by `navEntryOffersField` (`nav-target.ts`), the rule
 * the Studio's nav inspector reads too, so the two editors cannot disagree.
 *
 *  - a separator shows no Label and no Icon field, and no text field at all;
 *  - no edit made on a separator writes an entry `NavigationItemSchema` refuses;
 *  - opening a separator writes nothing, even one carrying a stray label;
 *  - CONTROL: a page and an object entry keep both fields, and what they write
 *    still parses.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { NavigationItemSchema } from '@objectstack/spec/ui';

// ONE client for the whole file, as the real hook hands out (see
// `AppNavInspector.labelInherits-11196.test.tsx`: a client minted per call is a
// render loop that never settles).
const client = vi.hoisted(() => ({ list: async () => [] }));

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { AppNavInspector } from './AppNavInspector';
import { t } from '../i18n';

afterEach(cleanup);

const METADATA = {
  apps: [],
  objects: [{ name: 'lead', label: 'Leads' }],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

type Entry = Record<string, unknown>;
type NavPatch = { navigation: Entry[] };

/** Showcase's own separator (`nav_sep_reports`), as the spec takes it. */
const SEPARATOR: Entry = { id: 'nav_sep_reports', type: 'separator' };
const PAGE_ENTRY: Entry = { id: 'nav_home', type: 'page', pageName: 'home' };
const OBJECT_ENTRY: Entry = { id: 'nav_leads', type: 'object', objectName: 'lead' };

function inspect(navigation: Entry[], index: number) {
  const onPatch = vi.fn<(patch: NavPatch) => void>();
  render(
    <MetadataCtx.Provider value={METADATA as never}>
      <AppNavInspector
        type="app"
        name="crm"
        selection={{ kind: 'nav', id: `navigation[${index}]` }}
        draft={{ name: 'crm', navigation }}
        onPatch={onPatch as never}
        onClearSelection={() => {}}
        locale="en-US"
        readOnly={false}
      />
    </MetadataCtx.Provider>,
  );
  return onPatch;
}

/** What the save meets: `undefined`-valued keys erased, as JSON does. */
const wire = (entry: Entry) => JSON.parse(JSON.stringify(entry)) as Entry;

/** The issues `NavigationItemSchema` raises on `entry` as saved; `[]` when it parses. */
function issuesOf(entry: Entry): unknown[] {
  const r = NavigationItemSchema.safeParse(wire(entry));
  return r.success ? [] : r.error.issues;
}

describe('objectui#11847 — AppNavInspector offers a separator only what its spec member declares', () => {
  it('reads a separator the spec takes, and a page / object control the spec takes (non-vacuity)', () => {
    expect(issuesOf(SEPARATOR)).toEqual([]);
    expect(issuesOf(PAGE_ENTRY)).toEqual([]);
    expect(issuesOf(OBJECT_ENTRY)).toEqual([]);
    // The member refuses the very keys the old fields wrote.
    expect(issuesOf({ ...SEPARATOR, label: 'Reports' })).not.toEqual([]);
    expect(issuesOf({ ...SEPARATOR, icon: 'minus' })).not.toEqual([]);
  });

  it('a separator entry shows no Label and no Icon field, and no text field at all', () => {
    inspect([PAGE_ENTRY, SEPARATOR], 1);
    expect(screen.queryByLabelText(t('engine.inspector.appNav.label', 'en-US'))).toBeNull();
    expect(screen.queryByLabelText(t('engine.inspector.appNav.icon', 'en-US'))).toBeNull();
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    // It says why, as the Studio's nav inspector does for a separator.
    expect(screen.getByText(t('engine.inspector.appNav.separatorHint', 'en-US'))).toBeInTheDocument();
  });

  it('no edit made on a separator writes an entry NavigationItemSchema refuses', () => {
    const onPatch = inspect([PAGE_ENTRY, SEPARATOR], 1);
    // Every text field the inspector offers on the separator, typed into.
    for (const box of screen.queryAllByRole('textbox')) {
      fireEvent.change(box, { target: { value: 'Reports' } });
    }
    // And the reorder the inspector always offers, so at least one write happens.
    fireEvent.click(screen.getByRole('button', { name: t('engine.inspector.reorder.up', 'en-US') }));
    expect(onPatch.mock.calls.length).toBeGreaterThan(0);
    for (const [written] of onPatch.mock.calls) {
      const separator = written.navigation.find((e) => e.id === SEPARATOR.id);
      expect(separator).toBeDefined();
      expect({ entry: separator, issues: issuesOf(separator as Entry) }).toEqual({ entry: separator, issues: [] });
    }
  });

  it('opening a separator writes nothing, even one carrying a stray label', () => {
    const onPatch = inspect([{ ...SEPARATOR, label: 'Reports' }], 0);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it.each([
    ['page', PAGE_ENTRY],
    ['object', OBJECT_ENTRY],
  ])('CONTROL: a %s entry keeps its Label and Icon fields, and what they write parses', (_type, entry) => {
    const onPatch = inspect([entry], 0);
    fireEvent.change(screen.getByLabelText(t('engine.inspector.appNav.label', 'en-US')), {
      target: { value: 'Reports' },
    });
    // The Icon field is the icon picker (objectui#12531): pick, don't type.
    fireEvent.click(screen.getByLabelText(t('engine.inspector.appNav.icon', 'en-US')));
    fireEvent.change(screen.getByLabelText(t('engine.form.searchIcons', 'en-US')), {
      target: { value: 'chart-bar' },
    });
    fireEvent.click(screen.getAllByRole('option').find((o) => o.getAttribute('title') === 'chart-bar')!);
    expect(onPatch).toHaveBeenCalledTimes(2);
    const [labelled, iconed] = onPatch.mock.calls.map(([written]) => written.navigation[0]);
    expect(labelled).toEqual({ ...entry, label: 'Reports' });
    expect(iconed).toEqual({ ...entry, icon: 'chart-bar' });
    expect(issuesOf(labelled)).toEqual([]);
    expect(issuesOf(iconed)).toEqual([]);
    expect(screen.queryByText(t('engine.inspector.appNav.separatorHint', 'en-US'))).toBeNull();
  });
});
