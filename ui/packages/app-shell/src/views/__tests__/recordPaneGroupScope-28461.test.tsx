// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28461 — on a grouped list or a board, the record pane's counter
 * and ↓ ↑ step within the opened record's group or lane, and the counter's
 * tooltip names it (#27524 Target 7: 「Acme Corporation 中第 1 条，共 3 条」).
 *
 * The object page holds what `ListView` reports through `onRowsChange` — the
 * rows, and on a grouped grid or a board the groups they sit in — and hands
 * the pane's root the opened record's own group as its sibling set, named by
 * the group. The last row of a group has no ↓, whatever the list shows after
 * it. Control: an ungrouped list keeps the whole list as the set, named by
 * the list's view.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, type Location } from 'react-router-dom';
import '@testing-library/jest-dom';

import { RecordStackDrawer, useRecordDrawerStack, useRecordPageReturn, type RecordDrawerLevel } from '../recordDrawerStack';
import { listShownRowsOf, listSiblingSetOf, useObjectViewRecordNavigation } from '../objectViewRecordNavigation';

afterEach(() => cleanup());

const OBJECTS = [{ name: 'crm_contact', label: 'Contact' }];
const ROWS = [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }, { id: 'c-4' }, { id: 'c-5' }];
/** HotCRM's contact list grouped by account: the rows in display order, by group. */
const GROUPS = [
  { label: 'Acme Corporation', rows: [{ id: 'c-1' }, { id: 'c-2' }, { id: 'c-3' }] },
  { label: 'Globex', rows: [{ id: 'c-4' }, { id: 'c-5' }] },
];
/** A board's report: its open lanes and their cards. */
const LANES = [
  { label: 'New', rows: [{ id: 'd-1' }, { id: 'd-3' }] },
  { label: 'Won', rows: [{ id: 'd-2' }] },
];

/** The object page's shape: the root is host state, stepped by `onRootStep`. */
function ListHost({ rows, groups, start }: {
  rows: ReadonlyArray<Record<string, unknown>>;
  groups?: typeof GROUPS;
  start: string;
}) {
  const [recordId, setRecordId] = React.useState(start);
  const shown = React.useMemo(() => listShownRowsOf(rows, groups), [rows, groups]);
  const root = React.useMemo<RecordDrawerLevel>(
    () => ({ objectName: 'crm_contact', recordId, ...(listSiblingSetOf(shown, recordId) ?? {}) }),
    [recordId, shown],
  );
  const stack = useRecordDrawerStack({ root, onRootStep: setRecordId });
  return (
    <RecordStackDrawer
      stack={stack}
      open
      objects={OBJECTS}
      stepScope="All contacts"
      onClose={() => {}}
      renderRecord={(level) => <div data-testid="record-body">{level.recordId}</div>}
    />
  );
}

function mountPane(start: string, rows: ReadonlyArray<Record<string, unknown>>, groups?: typeof GROUPS) {
  render(
    <MemoryRouter>
      <ListHost rows={rows} groups={groups} start={start} />
    </MemoryRouter>,
  );
}

const body = () => screen.getByTestId('record-body').textContent;
const counter = () => document.querySelector('[data-record-top-bar-position]') as HTMLElement | null;
const next = () => screen.queryByRole('button', { name: 'Next record' }) as HTMLButtonElement | null;
const previous = () => screen.queryByRole('button', { name: 'Previous record' }) as HTMLButtonElement | null;

describe('the record pane steps within the opened row\'s group (objectstack#28461)', () => {
  it('grouped grid: the counter counts the group, and its tooltip names it', () => {
    mountPane('c-1', ROWS, GROUPS);
    expect(counter()!.textContent).toBe('1 / 3');
    expect(counter()!.getAttribute('title')).toBe('1 of 3 in Acme Corporation');
  });

  it('grouped grid: ↓ goes to the next row of the same group; the last row of a group has no ↓', () => {
    mountPane('c-2', ROWS, GROUPS);
    fireEvent.click(next()!);
    expect(body()).toBe('c-3');
    expect(counter()!.textContent).toBe('3 / 3');
    // c-4 follows in the list, but in another group.
    expect(next()!.disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(body()).toBe('c-3');
  });

  it('grouped grid: the first row of a later group has no ↑ and counts that group', () => {
    mountPane('c-4', ROWS, GROUPS);
    expect(previous()!.disabled).toBe(true);
    expect(counter()!.getAttribute('title')).toBe('1 of 2 in Globex');
  });

  it('board: the same within a lane', () => {
    mountPane('d-1', [{ id: 'd-1' }, { id: 'd-3' }, { id: 'd-2' }], LANES);
    expect(counter()!.getAttribute('title')).toBe('1 of 2 in New');
    fireEvent.click(next()!);
    expect(body()).toBe('d-3');
    expect(next()!.disabled).toBe(true);
  });

  it('control: an ungrouped list steps through every row, named by the list\'s view', () => {
    mountPane('c-3', ROWS);
    expect(counter()!.textContent).toBe('3 / 5');
    expect(counter()!.getAttribute('title')).toBe('3 of 5 in All contacts');
    fireEvent.click(next()!);
    expect(body()).toBe('c-4');
  });

  it('a record no shown group holds gets no counter', () => {
    mountPane('c-9', ROWS, GROUPS);
    expect(counter()).toBeNull();
    expect(next()).toBeNull();
  });
});

describe('the object page hands the opened row\'s group along (objectstack#28461)', () => {
  const LIST = { pathname: '/apps/crm/crm_contact', search: '?view=all', state: null, hash: '', key: 'k' } as Location;

  function mountNavigation(search: string) {
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useObjectViewRecordNavigation({
        activeView: { id: 'all', name: 'all', label: 'All contacts' } as never,
        objectDef: { name: 'crm_contact', label: 'Contact', fields: {} } as never,
        objects: OBJECTS as never,
        appName: 'crm',
        viewId: undefined,
        searchParams: new URLSearchParams(search),
        setSearchParams: vi.fn(),
        location: LIST,
        navigate,
        routerRootHref: '/',
        servedViews: { views: [], objects: [] } as never,
        viewLabel: (_object: string, _view: string, fallback: string) => fallback,
        unlabelledViewText: 'Untitled view',
        language: 'en',
        recordOpenPreference: 'object' as never,
        // A desktop console: on a phone every record opens as a page.
        phone: false,
      }),
      { wrapper: ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[`/apps/crm/crm_contact?${search}`]}>{children}</MemoryRouter> },
    );
    return { result, navigate };
  }

  it('the pane\'s root: the group\'s rows, named by the group', () => {
    const { result } = mountNavigation('view=all&recordId=c-5');
    act(() => result.current.handleListRowsChange(ROWS, GROUPS));
    expect(result.current.drawerRoot).toEqual({
      objectName: 'crm_contact',
      recordId: 'c-5',
      siblings: ['c-4', 'c-5'],
      scope: 'Globex',
    });
  });

  it('control: an ungrouped list hands every row and no name of its own', () => {
    const { result } = mountNavigation('view=all&recordId=c-5');
    act(() => result.current.handleListRowsChange(ROWS));
    expect(result.current.drawerRoot).toEqual({
      objectName: 'crm_contact',
      recordId: 'c-5',
      siblings: ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'],
    });
  });

  it('the row\'s ↗: the page steps within the group and its counter names it', () => {
    const { result, navigate } = mountNavigation('view=all');
    act(() => result.current.handleListRowsChange(ROWS, GROUPS));
    act(() => result.current.handleOpenRowAsPage('c-2'));
    const state = navigate.mock.calls.at(-1)![1].state;
    expect(state.recordDrawerReturn.path).toEqual([
      { objectName: 'crm_contact', recordId: 'c-2', siblings: ['c-1', 'c-2', 'c-3'], scope: 'Acme Corporation' },
    ]);
    const page = renderHook(() => useRecordPageReturn('c-2'), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <MemoryRouter initialEntries={[{ pathname: '/apps/crm/crm_contact/record/c-2', state }]}>{children}</MemoryRouter>
      ),
    });
    expect(page.result.current.stepper?.position).toEqual({ index: 1, total: 3 });
    expect(page.result.current.stepper?.scope).toBe('Acme Corporation');
  });
});
