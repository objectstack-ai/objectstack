// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11294 — a related list's row menu and its toolbar give one answer
 * to "is a `visible` gate declared?", so one action shows in both or neither.
 *
 * The toolbar asks `hasDeclaredVisibilityGate`, the action family's one
 * definition (objectui#3812, objectui#11244): a blank `visible` (`''`, or a
 * whitespace-only string) is no gate, so the action shows, and the blank is
 * reported (ADR-0137 D4). The row menu used to ask a test of its own,
 * `pred == null || pred === ''`, so a whitespace-only `visible` counted as
 * declared there, was evaluated, and failed closed: the action showed in the
 * related list's header and was missing from its rows. That held for an
 * action placed on the rows by `record_related` and by `list_item` alike.
 *
 * Every case mounts what a record page mounts, as the objectui#11270 suite
 * beside this file does: the real `RelatedRecordActionsBridge` around the
 * `{ type, properties }` node through the real `SchemaRenderer`,
 * `@object-ui/plugin-detail`'s registration, the real `RelatedList` and the
 * real data table. It reads the header buttons and an opened row menu from
 * the DOM.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import {
  ActionProvider,
  MetadataCtx,
  RecordContextProvider,
  SchemaRenderer,
  type MetadataContextValue,
} from '@object-ui/react';
// Registers `record:related_list`. Module scope on purpose (AGENTS.md, test
// discipline).
import '@object-ui/plugin-detail';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';

/**
 * Desktop, pinned (objectui#8399): under the 768 breakpoint a table-type
 * related list renders a card gallery, and the row menu read here is the data
 * table's.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
});

const CHILD_NAME = 'task';

/** Each action is on the header (`list_toolbar`) and on the rows by one row location. */
const both = (row: 'record_related' | 'list_item') => ['list_toolbar', row];

/**
 * The card's measured table, plus the controls that keep the verdict honest.
 * `send_reminder` is ungated, so the row menu is alive whatever the gated ones
 * do. `never_li` (`visible: false`) is a declared gate that excludes every row,
 * and the two CEL rows are evaluated against the row record: a fix that read
 * every `visible` as no gate would pass the blank rows and fail these.
 *
 * `blank_row_only` is on the rows alone, with a blank spelling (five spaces)
 * no other action here uses, so its `[blank]` report can only come from the
 * row path. The report is deduplicated per blank spelling, so two rows and
 * every re-render give one line.
 */
const ROW_ONLY_BLANK = '     ';
const CHILD_ACTIONS = [
  { name: 'send_reminder', label: 'Send Reminder', type: 'api', target: '/api/remind', locations: ['list_item'] },
  { name: 'blank_rr', label: 'Blank RR', type: 'api', target: '/api/b1', locations: both('record_related'), visible: '   ' },
  { name: 'blank_li', label: 'Blank LI', type: 'api', target: '/api/b2', locations: both('list_item'), visible: '   ' },
  { name: 'empty_rr', label: 'Empty RR', type: 'api', target: '/api/e1', locations: both('record_related'), visible: '' },
  { name: 'empty_li', label: 'Empty LI', type: 'api', target: '/api/e2', locations: both('list_item'), visible: '' },
  { name: 'never_li', label: 'Never LI', type: 'api', target: '/api/n', locations: both('list_item'), visible: false },
  { name: 'cel_yes_rr', label: 'CEL Yes', type: 'api', target: '/api/c1', locations: ['record_related'], visible: "record.name == 'Write spec'" },
  { name: 'cel_no_rr', label: 'CEL No', type: 'api', target: '/api/c2', locations: ['record_related'], visible: "record.name == 'Other'" },
  { name: 'blank_row_only', label: 'Blank Row Only', type: 'api', target: '/api/r', locations: ['record_related'], visible: ROW_ONLY_BLANK },
];

const CHILD = {
  name: CHILD_NAME,
  label: 'Task',
  managedBy: 'platform',
  fields: { name: { type: 'text', label: 'Name' } },
  actions: CHILD_ACTIONS,
};

const ROWS = [
  { id: 't1', name: 'Write spec' },
  { id: 't2', name: 'Review spec' },
];

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === CHILD_NAME ? CHILD : null,
);

/** Module-level: `getItem` is an effect dependency of `useMetadataItem`. */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [CHILD],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const makeDataSource = () => ({
  find: vi.fn(async () => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: CHILD.fields })),
  delete: vi.fn(async () => ({})),
});

function mount() {
  const dataSource = makeDataSource();
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <ActionProvider handlers={{}}>
        <MemoryRouter initialEntries={['/apps/demo/project/record/P-1']}>
          <RelatedRecordActionsBridge
            appName="demo"
            objects={[CHILD]}
            dataSource={dataSource}
            parentObjectName="project"
            parentRecordId="P-1"
            parentTitle="Launch"
            parentRecord={{ id: 'P-1', name: 'Launch' }}
          >
            <RecordContextProvider objectName="project" recordId="P-1" dataSource={dataSource as never}>
              <SchemaRenderer
                schema={{
                  type: 'record:related_list',
                  properties: { objectName: CHILD_NAME, relationshipField: 'project', columns: ['name'] },
                } as never}
              />
            </RecordContextProvider>
          </RelatedRecordActionsBridge>
        </MemoryRouter>
      </ActionProvider>
    </MetadataCtx.Provider>,
  );
}

/** The header buttons, by action name, in DOM order. */
function toolbarNames(): string[] {
  return screen
    .queryAllByTestId(/^related-toolbar-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('related-toolbar-action-', ''));
}

/**
 * Open the first row's menu (Radix opens on `pointerdown`) and read the child
 * object's actions in it, in order. The built-in Edit / Delete items are the
 * host's CRUD affordances, not action ids, and are left out.
 */
async function firstRowMenuNames(): Promise<string[]> {
  const triggers = () => screen.queryAllByLabelText('Row actions');
  await waitFor(() => expect(triggers().length).toBe(ROWS.length));
  fireEvent.pointerDown(triggers()[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const menu = await screen.findByRole('menu');
  return within(menu)
    .queryAllByTestId(/^row-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('row-action-', ''))
    .filter((name) => !name.startsWith('builtin-'));
}

describe('objectui#11294 — one blank `visible` gives one answer on a related list’s toolbar and rows', () => {
  it('a whitespace-only `visible` shows on the toolbar AND the rows, by `record_related` and by `list_item`; `\'\'` is the control', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mount();
      await screen.findByText('Write spec');

      // The toolbar: every `list_toolbar` action whose gate is blank or empty
      // shows, and the declared `false` does not.
      await waitFor(() => expect(toolbarNames()).toContain('blank_rr'));
      expect(toolbarNames()).toEqual(['blank_rr', 'blank_li', 'empty_rr', 'empty_li']);

      // The rows: the same four show, beside the ungated control, in the child
      // object's declared order. `never_li` stays hidden, and the CEL gates are
      // evaluated against the row (`Write spec`).
      expect(await firstRowMenuNames()).toEqual([
        'send_reminder',
        'blank_rr',
        'blank_li',
        'empty_rr',
        'empty_li',
        'cel_yes_rr',
        'blank_row_only',
      ]);

      // The row-only blank is reported (ADR-0137 D4), and once: not once per
      // row, and not once per render of the menu and its "⋮" guard.
      const rowOnlyBlankReports = warn.mock.calls.filter(([message]) => {
        const text = String(message);
        return text.includes('[blank]') && text.includes(JSON.stringify(ROW_ONLY_BLANK));
      });
      expect(rowOnlyBlankReports).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
