// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26679 — the record drawer opens a related row or a lookup in
 * place, one level down, and goes back one level at a time; the record
 * header's 「Open as full page」 carries the path into the page and
 * 「Collapse to drawer」 brings the stack back. objectstack#27545: the bar's ⤢
 * maximizes in place and routes nowhere; the page is opened from the header
 * `⋯` (`useRecordPane`, below) and from the row's ↗, and 「Collapse to
 * drawer」 is drawn only on a page the ↗ opened.
 *
 * Every case mounts the real `RelatedRecordActionsBridge` the record body
 * mounts, under the real drawer stack, with a probe standing in for the
 * related list and the lookup (both reach the bridge through the published
 * `RelatedRecordActionsContext`, which is the door the real renderers take).
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import '@testing-library/jest-dom';
import { useRelatedRecordActions } from '@object-ui/react';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import {
  RecordDrawerReturnLink,
  RecordPageDrawerHost,
  RecordStackDrawer,
  expandedRecordPath,
  recordDrawerReturnState,
  useRecordDrawerStack,
  useRecordPane,
  useTakenRestore,
  type RecordDrawerLevel,
} from '../recordDrawerStack';

afterEach(() => cleanup());

const APP = 'hotcrm';
const OBJECTS = [
  { name: 'crm_lead', label: 'Lead' },
  { name: 'crm_task', label: 'Task' },
  { name: 'sys_user', label: 'User' },
  { name: 'crm_contract', label: 'Contract', navigation: { mode: 'page' } },
];
const TITLES: Record<string, string> = { 'L-1': 'Mira Costa', 'T-1': 'Send quote', 'T-2': 'Call back', 'T-3': 'Demo' };
const TASKS = ['T-1', 'T-2', 'T-3'];

/** Where the router is: path, search and the history state's keys. */
function RouterLocation() {
  const location = useLocation();
  return (
    <>
      <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="router-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

/** A record body: its bridge, a related list of tasks, two lookups, a tab strip. */
function RecordBody({ level }: { level: { objectName: string; recordId: string } }) {
  return (
    <RelatedRecordActionsBridge
      appName={APP}
      objects={OBJECTS}
      dataSource={null}
      parentObjectName={level.objectName}
      parentRecordId={level.recordId}
      parentTitle={TITLES[level.recordId]}
    >
      <div data-testid="record-body">{`${level.objectName}/${level.recordId}`}</div>
      <Probe />
    </RelatedRecordActionsBridge>
  );
}

function Probe() {
  const actions = useRelatedRecordActions();
  const pane = useRecordPane();
  const [, setSearchParams] = useSearchParams();
  const tasks = actions?.resolve({ objectName: 'crm_task', relationshipField: 'lead', parentId: 'L-1' });
  return (
    <>
      <button type="button" onClick={() => tasks?.onView?.('T-1', { id: 'T-1' }, TASKS)}>
        open task row
      </button>
      <button type="button" onClick={() => actions?.openRecord?.('sys_user', 'U-1')}>
        open owner lookup
      </button>
      <button type="button" onClick={() => actions?.openRecord?.('crm_contract', 'K-1')}>
        open contract lookup
      </button>
      {/* The record header `⋯`'s last host item (objectstack#27545). */}
      {pane && (
        <button type="button" onClick={() => pane.openAsPage()}>
          menu open as full page
        </button>
      )}
      <button
        type="button"
        onClick={() =>
          setSearchParams(
            (prev) => {
              const sp = new URLSearchParams(prev);
              sp.set('tab', 'related');
              return sp;
            },
            { replace: true },
          )
        }
      >
        show related tab
      </button>
    </>
  );
}

/**
 * The object list's host shape: a root the URL controls, closed by the host,
 * and a ↗ return's stack taken out of the history state.
 */
function ListHost({ onClose, onOpenAsPage }: { onClose: () => void; onOpenAsPage: (path: RecordDrawerLevel[]) => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rootId = searchParams.get('recordId') ?? 'L-1';
  const root = React.useMemo(() => ({ objectName: 'crm_lead', recordId: rootId }), [rootId]);
  const [restoredPath] = useTakenRestore();
  const stack = useRecordDrawerStack({ root, restoredPath });
  return (
    <RecordStackDrawer
      stack={stack}
      open
      objects={OBJECTS}
      onClose={onClose}
      onOpenAsPage={onOpenAsPage}
      // The list the drawer opens over: another of its rows (objectstack#27545).
      mainContent={
        <button type="button" onClick={() => setSearchParams({ recordId: 'L-2' })}>
          list row L-2
        </button>
      }
      renderRecord={(level) => <RecordBody level={level} />}
    />
  );
}

function mountList(initial = `/apps/${APP}/crm_lead?recordId=L-1`) {
  const onClose = vi.fn();
  const onOpenAsPage = vi.fn();
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/apps/:appName/:objectName" element={<ListHost onClose={onClose} onOpenAsPage={onOpenAsPage} />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
      <RouterLocation />
    </MemoryRouter>,
  );
  return { onClose, onOpenAsPage };
}

const body = () => screen.getByTestId('record-body').textContent;
const trail = () => screen.queryByTestId('record-drawer-trail')?.textContent ?? null;
const where = () => screen.getByTestId('router-location').textContent ?? '';
const button = (name: string) => screen.getByRole('button', { name });

describe('a related row opens in the same drawer, one level down (ruling 5)', () => {
  it('pushes the task, shows ← and the path, and ← returns to the lead', () => {
    mountList();
    expect(body()).toBe('crm_lead/L-1');
    expect(screen.getByTestId('record-drawer-leading').textContent).toBe('');

    fireEvent.click(button('open task row'));
    expect(body()).toBe('crm_task/T-1');
    // Still one drawer, and the router did not move.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(where()).toBe(`/apps/${APP}/crm_lead?recordId=L-1`);
    expect(trail()).toBe('Lead Mira CostaTask');

    fireEvent.click(button('Go back'));
    expect(body()).toBe('crm_lead/L-1');
    expect(trail()).toBeNull();
  });

  it('a lookup value takes the same door; each ancestor in the path returns to its level', () => {
    mountList();
    fireEvent.click(button('open task row'));
    fireEvent.click(button('open owner lookup'));
    expect(body()).toBe('sys_user/U-1');
    expect(trail()).toBe('Lead Mira CostaTask Send quoteUser');
    fireEvent.click(screen.getByRole('button', { name: /Lead Mira Costa/ }));
    expect(body()).toBe('crm_lead/L-1');
  });

  it('Esc goes back one level; Esc at the root closes', () => {
    const { onClose } = mountList();
    fireEvent.click(button('open task row'));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(body()).toBe('crm_lead/L-1');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('objectstack#27545 — a click on another list row swaps the root and drops the levels below it', () => {
    mountList();
    fireEvent.click(button('open task row'));
    fireEvent.click(button('open owner lookup'));
    expect(trail()).toBe('Lead Mira CostaTask Send quoteUser');
    fireEvent.click(button('list row L-2'));
    expect(body()).toBe('crm_lead/L-2');
    expect(trail()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();
  });

  it('control: an object that declares `page` still navigates, and the drawer stays put', () => {
    mountList();
    fireEvent.click(button('open contract lookup'));
    expect(where().split('?')[0]).toBe(`/apps/${APP}/crm_contract/record/K-1`);
  });
});

describe('↑ ↓ move through the level\'s sibling set, never across levels', () => {
  it('steps through the related rows the list showed, disabled at the ends', () => {
    mountList();
    fireEvent.click(button('open task row'));
    expect((button('Previous record') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(body()).toBe('crm_task/T-2');
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(body()).toBe('crm_task/T-3');
    expect((button('Next record') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('Previous record'));
    expect(body()).toBe('crm_task/T-2');
    // Still one level down: ← returns to the lead, not to T-1.
    fireEvent.click(button('Go back'));
    expect(body()).toBe('crm_lead/L-1');
  });

  it('a lookup has no sibling set: no ↑ ↓ are drawn for it', () => {
    mountList();
    fireEvent.click(button('open owner lookup'));
    expect(screen.queryByRole('button', { name: 'Next record' })).toBeNull();
  });
});

describe('each level keeps its own ?tab=', () => {
  it('a new level opens on its default tab, and ← brings the left tab back', () => {
    mountList();
    fireEvent.click(button('show related tab'));
    expect(where()).toContain('tab=related');
    fireEvent.click(button('open task row'));
    expect(where()).not.toContain('tab=');
    fireEvent.click(button('Go back'));
    expect(where()).toContain('tab=related');
  });
});

describe('「Open as full page」 carries the path into the page; ⤢ maximizes in place', () => {
  it('hands the host the path from the root to the record shown', () => {
    const { onOpenAsPage } = mountList();
    fireEvent.click(button('open task row'));
    fireEvent.click(button('menu open as full page'));
    const [path] = onOpenAsPage.mock.calls[0];
    expect(path.map((l: RecordDrawerLevel) => `${l.objectName}/${l.recordId}`)).toEqual([
      'crm_lead/L-1',
      'crm_task/T-1',
    ]);
    expect(path[0].title).toBe('Mira Costa');
  });

  it('objectstack#27545 — the bar draws ⤢ and no page hop; ⤢ keeps the URL and the stack', () => {
    const { onOpenAsPage } = mountList();
    fireEvent.click(button('open task row'));
    expect(screen.queryByRole('button', { name: 'Open as full page' })).toBeNull();
    fireEvent.click(button('Maximize'));
    expect(onOpenAsPage).not.toHaveBeenCalled();
    expect(where()).toBe(`/apps/${APP}/crm_lead?recordId=L-1`);
    expect(body()).toBe('crm_task/T-1');
    expect(trail()).toBe('Lead Mira CostaTask');
    expect(screen.getByRole('dialog').hasAttribute('data-maximized')).toBe(true);
    // Every level shares the maximize: ← keeps it.
    fireEvent.click(button('Go back'));
    expect(screen.getByRole('dialog').hasAttribute('data-maximized')).toBe(true);
    fireEvent.click(button('Restore size'));
    expect(screen.getByRole('dialog').hasAttribute('data-maximized')).toBe(false);
  });

  it('the page route names the ancestors as its ?from= trail', () => {
    const to = expandedRecordPath(APP, OBJECTS, [
      { objectName: 'crm_lead', recordId: 'L-1', title: 'Mira Costa' },
      { objectName: 'crm_task', recordId: 'T-1' },
    ]);
    const [path, query] = (to ?? '').split('?');
    expect(path).toBe(`/apps/${APP}/crm_task/record/T-1`);
    expect(JSON.parse(new URLSearchParams(query).get('from') ?? '[]')).toEqual([
      { o: 'crm_lead', i: 'L-1', t: 'Mira Costa' },
    ]);
    // The root has no ancestors in the drawer: no trail.
    expect(expandedRecordPath(APP, OBJECTS, [{ objectName: 'crm_lead', recordId: 'L-1' }])).toBe(
      `/apps/${APP}/crm_lead/record/L-1`,
    );
  });
});

/** A record page: the page host, its body, and the 「Collapse to drawer」 link. */
function RecordPage() {
  const location = useLocation();
  const [, objectName, , recordId] = location.pathname.split('/').slice(2);
  const level = { objectName, recordId };
  return (
    <RecordPageDrawerHost
      appName={APP}
      objects={OBJECTS}
      pageObjectName={objectName}
      pageRecordId={recordId}
      pageTitle={TITLES[recordId]}
      renderRecord={(l) => <RecordBody level={l} />}
    >
      <div data-testid="page">
        <RecordDrawerReturnLink />
        <RecordBody level={level} />
      </div>
    </RecordPageDrawerHost>
  );
}

function mountPage(initial: string) {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordPage />} />
      </Routes>
      <RouterLocation />
    </MemoryRouter>,
  );
}

const dialogBody = () => screen.getByRole('dialog').querySelector('[data-testid="record-body"]')?.textContent;

describe('on the record page, a related row opens a drawer over the page (target 4)', () => {
  it('opens the task over the lead page, steps its siblings at the root, and ✕ closes it', () => {
    mountPage(`/apps/${APP}/crm_lead/record/L-1`);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'open task row' })[0]);
    expect(dialogBody()).toBe('crm_task/T-1');
    expect(where()).toBe(`/apps/${APP}/crm_lead/record/L-1`);
    // The drawer's root is the task: nothing on the left, ↑ ↓ over the rows.
    expect(screen.getByTestId('record-drawer-leading').textContent).toBe('');
    fireEvent.click(button('Next record'));
    expect(dialogBody()).toBe('crm_task/T-2');
    fireEvent.click(screen.getByTitle('Close'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the page keeps its ?tab= while the drawer is open', () => {
    mountPage(`/apps/${APP}/crm_lead/record/L-1?tab=related`);
    fireEvent.click(screen.getAllByRole('button', { name: 'open task row' })[0]);
    expect(where()).not.toContain('tab=');
    fireEvent.click(screen.getByTitle('Close'));
    expect(where()).toContain('tab=related');
  });

  it('「Open as full page」 opens the page with the path, and that page offers no 「Collapse to drawer」', () => {
    mountPage(`/apps/${APP}/crm_lead/record/L-1`);
    fireEvent.click(screen.getAllByRole('button', { name: 'open task row' })[0]);
    // One more level: the task's owner — the drawer's own lookup.
    const inDrawer = (name: string) =>
      screen.getAllByRole('button', { name, hidden: true }).find((el) => screen.getByRole('dialog').contains(el))!;
    fireEvent.click(inDrawer('open owner lookup'));
    expect(dialogBody()).toBe('sys_user/U-1');
    fireEvent.click(inDrawer('menu open as full page'));

    const [path, query] = where().split('?');
    expect(path).toBe(`/apps/${APP}/sys_user/record/U-1`);
    expect(JSON.parse(new URLSearchParams(query).get('from') ?? '[]')).toEqual([
      { o: 'crm_lead', i: 'L-1', t: 'Mira Costa' },
      { o: 'crm_task', i: 'T-1', t: 'Send quote' },
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    // objectstack#27545 — 「Collapse to drawer」 is drawn only for a ↗ arrival.
    expect(screen.queryByTestId('record-drawer-return')).toBeNull();
  });
});

describe('「Collapse to drawer」 on a page the row ↗ opened (objectstack#27545)', () => {
  it('returns to the list with the record open', async () => {
    const back = recordDrawerReturnState(
      { pathname: `/apps/${APP}/crm_lead`, search: '?recordId=L-1', state: null },
      [{ objectName: 'crm_lead', recordId: 'L-1' }],
    );
    render(
      <MemoryRouter initialEntries={[{ pathname: `/apps/${APP}/crm_lead/record/L-1`, state: back }]}>
        <Routes>
          <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordPage />} />
          <Route path="/apps/:appName/:objectName" element={<ListHost onClose={() => {}} onOpenAsPage={() => {}} />} />
        </Routes>
        <RouterLocation />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('page')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('record-drawer-return'));
    });
    expect(where()).toBe(`/apps/${APP}/crm_lead?recordId=L-1`);
    expect(body()).toBe('crm_lead/L-1');
    // The restore is consumed: the history entry no longer carries it.
    expect(screen.getByTestId('router-state').textContent).not.toContain('recordDrawerRestore');
  });
});
