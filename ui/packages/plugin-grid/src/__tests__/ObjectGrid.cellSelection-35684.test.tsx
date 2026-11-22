/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectGrid`'s `cellSelection` host prop (objectstack#35684): the grid
 * mounts `data-table`'s select-first cell model and tells it, per cell, why the
 * cell opens no editor. The table's behaviour is pinned in
 * `@object-ui/components` (`data-table-select-first-35684.test.tsx`,
 * `data-table-keys-35687.test.tsx`); this file pins the relay and the reasons:
 *
 *   1. With the prop a click selects; without it the same click edits.
 *   2. The field's reason (read-only, calculated), the reader's grant, the
 *      view's opt-out, and the record's approval lock, each in its words.
 *   3. The lock is read from the approvals service's answer for the page when
 *      a cell is first selected, in one request (objectstack#35795); with no
 *      answer the row's `approval_status` stands in (`resolveApprovalLock`).
 *      While the lock or the record verdict is on its way, an edit waits for it
 *      and says the record is being checked.
 *   4. A single click on a cell's email link or referenced record's chip only
 *      selects it, the title link still opens the record, and the email cell
 *      draws its copy button as the one the table hides (objectstack#36015).
 *   5. objectstack#36023: a select cell's editor opens under the cell, which
 *      keeps its value drawn; a required cell refuses Backspace in the form's
 *      words; a value over the field's declared length stays in the editor.
 *   6. With the host's `openReferencedRecord`, a lookup chip opens the record
 *      it names through it on a single click and its cell draws an edit
 *      button; a person's chip (`sys_user`) only selects (objectstack#36015).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';

// The viewer's update grant, switchable per test. Stable stub identity:
// `ObjectGrid` keeps `perms` in memo dependency arrays.
const { permsStub, grant } = vi.hoisted(() => {
  const grant = { update: true };
  return {
    grant,
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: (_obj: string, action: string) => (action === 'update' ? grant.update : true),
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

// Registers `object-grid`, the block under test.
import { ObjectGridRenderer } from '../index';
import { RelatedRecordActionsProvider, type RelatedRecordActionsValue } from '@object-ui/react';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { __resetApprovalsServiceLatch } from '../hooks/useRowApprovalLocks';

const ROWS = [
  { id: '1', name: 'Alpha', total: 5, approval_status: null },
  { id: '2', name: 'Beta', total: 7, approval_status: 'pending' },
  { id: '3', name: 'Gamma', total: 9, approval_status: null },
];
const FIELDS = {
  name: { type: 'text', label: 'Name' },
  code: { type: 'text', label: 'Code', readonly: true },
  total: { type: 'formula', label: 'Total' },
};

let lockedIds = new Set<string>();
let lockStatus = 200;
/** The ids of each lock read, one entry per request. */
let lockReads: string[][] = [];
/** How long the lock read and the explain read take, in ms; 0 answers at once. */
let lockDelay = 0;
/** While set, a lock read answers only once it settles (objectstack#35689). */
let lockGate: Promise<void> | null = null;
let explainDelay = 0;
let explainReads = 0;
/** The rows the explain engine refuses `update` on. */
let refusedIds = new Set<string>();

const LOCKS_URL = '/api/v1/approvals/records/probe/locks';
const after = <T,>(ms: number, value: T): Promise<T> =>
  ms > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), ms)) : Promise.resolve(value);

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  __resetApprovalsServiceLatch();
  lockedIds = new Set();
  lockStatus = 200;
  lockReads = [];
  lockDelay = 0;
  lockGate = null;
  explainDelay = 0;
  explainReads = 0;
  refusedIds = new Set();
  // The explain engine permits every row; the approvals service answers the locks of a page.
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const ids: string[] = Array.isArray(body.recordIds) ? body.recordIds : [];
    if (href.endsWith(LOCKS_URL)) {
      lockReads.push(ids);
      if (lockGate) await lockGate;
      return after(lockDelay, {
        ok: lockStatus < 300,
        status: lockStatus,
        json: async () => ({ success: true, data: { records: ids.map((id) => ({ recordId: id, locked: lockedIds.has(id) })) } }),
      });
    }
    explainReads += 1;
    return after(explainDelay, { ok: true, status: 200, json: async () => ({ allowed: true, records: ids.map((id) => ({ recordId: id, visible: !refusedIds.has(id) })) }) });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  grant.update = true;
});

async function renderGrid(extra: Record<string, unknown> = {}, cellSelection = true) {
  const utils = render(
    <ObjectGridRenderer
      schema={{
        type: 'object-grid',
        objectName: 'probe',
        columns: ['name', 'code', 'total'],
        data: { provider: 'value', items: ROWS.map((r) => ({ ...r, code: `C-${r.id}` })) },
        editable: true,
        ...extra,
      }}
      objectFields={FIELDS}
      cellSelection={cellSelection || undefined}
    />,
  );
  await screen.findByText('Gamma', {}, { timeout: 5000 });
  const cell = (row: number, col: number) =>
    utils.container.querySelectorAll('tbody tr')[row].querySelectorAll<HTMLElement>('td[data-grid-cell]')[col];
  return { ...utils, cell };
}

const reasonOn = async (cell: HTMLElement) => {
  fireEvent.click(cell);
  fireEvent.doubleClick(cell);
  return (await screen.findByTestId('cell-readonly-reason')).textContent;
};

describe('ObjectGrid cellSelection — the relay (objectstack#35684)', () => {
  it('with the prop a click selects the cell and opens no editor', async () => {
    const g = await renderGrid();
    fireEvent.click(g.cell(0, 0));
    expect(g.cell(0, 0)).toHaveAttribute('data-selected-cell');
    expect(g.cell(0, 0).querySelector('td[data-editing-cell], input:not([data-slot])')).toBeNull();
    fireEvent.doubleClick(g.cell(0, 0));
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
  });

  it('control: without it the grid keeps its click-to-edit', async () => {
    const { container } = render(
      <ObjectGridRenderer
        schema={{ type: 'object-grid', objectName: 'probe', columns: ['name'], data: { provider: 'value', items: ROWS }, editable: true }}
        objectFields={FIELDS}
      />,
    );
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    const first = container.querySelector<HTMLElement>('tbody tr td[data-grid-cell]')!;
    fireEvent.click(first);
    await waitFor(() => expect(container.querySelector('td[data-editing-cell]')).not.toBeNull());
    expect(first).not.toHaveAttribute('data-selected-cell');
  });
});

describe('ObjectGrid cellSelection — why a cell opens no editor', () => {
  it('a read-only field, and a calculated one', async () => {
    const g = await renderGrid();
    expect(await reasonOn(g.cell(0, 1))).toBe('This field is read-only.');
    expect(await reasonOn(g.cell(0, 2))).toBe("This value is calculated, so it can't be edited.");
  });

  it('a reader with no update grant', async () => {
    grant.update = false;
    const g = await renderGrid();
    expect(await reasonOn(g.cell(0, 0))).toBe("You don't have permission to edit these records.");
  });

  it('a view that turned editing off', async () => {
    const g = await renderGrid({ editable: false });
    expect(await reasonOn(g.cell(0, 0))).toBe('Editing in the list is turned off for this view.');
  });

  it("a record in approval, read off its approval_status while the lock read has not answered", async () => {
    lockStatus = 501;
    const g = await renderGrid();
    expect(await reasonOn(g.cell(1, 0))).toBe("This record is locked while it's in approval.");
    // Its neighbour edits.
    fireEvent.click(g.cell(2, 0));
    fireEvent.doubleClick(g.cell(2, 0));
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
  });

  it("a record the approvals service says is locked, asked for the page when a cell is first selected", async () => {
    lockedIds = new Set(['3']);
    const g = await renderGrid();
    expect(lockReads).toEqual([]);
    fireEvent.click(g.cell(2, 0));
    await waitFor(() => expect(lockReads).toEqual([['3', '1', '2']]));
    // Let the answer land before the edit is asked for.
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.doubleClick(g.cell(2, 0));
    expect((await screen.findByTestId('cell-readonly-reason')).textContent).toBe("This record is locked while it's in approval.");
    expect(g.container.querySelector('td[data-editing-cell]')).toBeNull();
    // An answer that says unlocked wins over the column: the pending row edits,
    // and selecting it asks nothing again.
    fireEvent.click(g.cell(1, 0));
    fireEvent.doubleClick(g.cell(1, 0));
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
    expect(lockReads).toEqual([['3', '1', '2']]);
  });
});

describe('ObjectGrid cellSelection — the selected cell says a lock that answers after it was selected (objectstack#35689)', () => {
  const catcher = (g: { container: HTMLElement }) => g.container.querySelector('[data-slot="cell-type-catcher"]');
  function holdLockRead(): () => void {
    let answer!: () => void;
    lockGate = new Promise<void>((resolve) => { answer = resolve; });
    return answer;
  }

  it('a row the service says is locked turns aria-readonly on where the selection is', async () => {
    lockedIds = new Set(['3']);
    const answer = holdLockRead();
    const g = await renderGrid();
    // Gamma has no approval_status: editable until the service answers.
    fireEvent.click(g.cell(2, 0));
    await waitFor(() => expect(lockReads).toEqual([['3', '1', '2']]));
    expect(g.cell(2, 0)).not.toHaveAttribute('aria-readonly');
    answer();
    await waitFor(() => expect(g.cell(2, 0)).toHaveAttribute('aria-readonly', 'true'));
    expect(catcher(g)).toHaveAttribute('aria-readonly', 'true');
    expect(g.cell(2, 0)).toHaveAttribute('data-selected-cell');
  });

  it("a row whose approval_status stands in as locked turns it off when the service says it is not", async () => {
    const answer = holdLockRead();
    const g = await renderGrid();
    fireEvent.click(g.cell(1, 0));
    await waitFor(() => expect(lockReads).toEqual([['2', '1', '3']]));
    expect(g.cell(1, 0)).toHaveAttribute('aria-readonly', 'true');
    answer();
    await waitFor(() => expect(g.cell(1, 0)).not.toHaveAttribute('aria-readonly'));
    expect(catcher(g)).not.toHaveAttribute('aria-readonly');
    expect(g.cell(1, 0)).toHaveAttribute('data-selected-cell');
  });
});

describe('ObjectGrid cellSelection — an edit waits for the row\'s lock and verdict (objectstack#35795)', () => {
  const CHECKING = 'Checking whether this record can be edited…';
  const LOCKED = "This record is locked while it's in approval.";
  const NO_PERMISSION = "You don't have permission to edit this record.";
  const editor = (g: { container: HTMLElement }) => g.container.querySelector('td[data-editing-cell]');
  const catcher = (g: { container: HTMLElement }) => g.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;

  // Real timers until the grid has drawn, then fake ones: the reads are slow
  // and the test says how much time passes.
  async function renderSlow() {
    const g = await renderGrid();
    vi.useFakeTimers();
    return g;
  }
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a slow lock read opens no editor on a locked row: the cell says it is checking, then that it is locked', async () => {
    lockDelay = 2000;
    lockedIds = new Set(['3']);
    const g = await renderSlow();
    fireEvent.click(g.cell(2, 0));
    fireEvent.doubleClick(g.cell(2, 0));
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(CHECKING);
    expect(editor(g)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(editor(g)).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(LOCKED);
    expect(editor(g)).toBeNull();
  });

  it('a slow lock read on an unlocked row opens the editor once it answers, with no second double-click', async () => {
    lockDelay = 2000;
    const g = await renderSlow();
    fireEvent.click(g.cell(0, 0));
    fireEvent.doubleClick(g.cell(0, 0));
    expect(editor(g)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(editor(g)).not.toBeNull();
    expect(screen.queryByTestId('cell-readonly-reason')).toBeNull();
  });

  it('a key typed while checking is the value the editor opens with', async () => {
    lockDelay = 2000;
    const g = await renderSlow();
    fireEvent.click(g.cell(0, 0));
    fireEvent.change(catcher(g), { target: { value: 'Z' } });
    expect(editor(g)).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(g.cell(0, 0).querySelector<HTMLInputElement>('[data-slot="cell-editor-overlay"] input')).toHaveValue('Z');
  });

  it('a slow record verdict holds the editor the same way', async () => {
    explainDelay = 2000;
    const g = await renderSlow();
    fireEvent.click(g.cell(0, 0));
    fireEvent.doubleClick(g.cell(0, 0));
    expect(editor(g)).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(editor(g)).not.toBeNull();
  });

  // The answer that settles the wait is the one the re-asked edit reads, not
  // the verdict of the render the wait began in.
  it('a slow record verdict that refuses the row opens no editor: the cell says the reader may not edit it', async () => {
    explainDelay = 2000;
    refusedIds = new Set(['1']);
    const g = await renderSlow();
    fireEvent.click(g.cell(0, 0));
    fireEvent.doubleClick(g.cell(0, 0));
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(editor(g)).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(NO_PERMISSION);
  });

  it('a key typed while a refusing verdict is read opens nothing and writes nothing', async () => {
    explainDelay = 2000;
    refusedIds = new Set(['1']);
    const g = await renderSlow();
    fireEvent.click(g.cell(0, 0));
    fireEvent.change(catcher(g), { target: { value: 'Z' } });
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(CHECKING);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(editor(g)).toBeNull();
    expect(screen.getByTestId('cell-readonly-reason')).toHaveTextContent(NO_PERMISSION);
    expect(g.cell(0, 0)).toHaveTextContent('Alpha');
  });

  it('selecting another cell while checking drops the wait: the answer opens nothing', async () => {
    lockDelay = 2000;
    const g = await renderSlow();
    fireEvent.click(g.cell(0, 0));
    fireEvent.doubleClick(g.cell(0, 0));
    fireEvent.click(g.cell(2, 0));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(editor(g)).toBeNull();
  });

  it('a page of rows sends one lock read, and moving the selection with the arrow keys sends none', async () => {
    const g = await renderGrid();
    fireEvent.click(g.cell(0, 0));
    await waitFor(() => expect(lockReads).toEqual([['1', '2', '3']]));
    await waitFor(() => expect(explainReads).toBeGreaterThan(0));
    const explainedOnce = explainReads;
    fireEvent.keyDown(catcher(g), { key: 'ArrowDown' });
    fireEvent.keyDown(catcher(g), { key: 'ArrowDown' });
    fireEvent.keyDown(catcher(g), { key: 'ArrowUp' });
    await new Promise((r) => setTimeout(r, 0));
    expect(g.cell(1, 0)).toHaveAttribute('data-selected-cell');
    expect(lockReads).toEqual([['1', '2', '3']]);
    expect(explainReads).toBe(explainedOnce);
  });

  it('a deployment with no approvals service is asked once, and its rows edit', async () => {
    lockStatus = 501;
    const g = await renderGrid();
    fireEvent.click(g.cell(0, 0));
    fireEvent.doubleClick(g.cell(0, 0));
    await waitFor(() => expect(editor(g)).not.toBeNull());
    expect(lockReads).toHaveLength(1);
  });
});

describe('ObjectGrid cellSelection — a click on a link a cell draws only selects (objectstack#36015)', () => {
  const opened: Array<[string, string | number]> = [];
  const host: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: (objectName, recordId) => { opened.push([objectName, recordId]); },
  };
  const onRowClick = vi.fn();

  async function renderLinked() {
    opened.length = 0;
    onRowClick.mockReset();
    const utils = render(
      <RelatedRecordActionsProvider value={host}>
        <ObjectGridRenderer
          schema={{
            type: 'object-grid',
            objectName: 'probe',
            columns: ['name', 'contact', 'parent_id'],
            data: {
              provider: 'value',
              items: [{ id: '1', name: 'Alpha', contact: 'ada@example.com', parent_id: { id: '9', name: 'Grace' } }],
            },
            editable: true,
          }}
          objectFields={{
            name: { type: 'text', label: 'Name' },
            contact: { type: 'email', label: 'Contact' },
            parent_id: { type: 'lookup', reference: 'probe', label: 'Parent' },
          }}
          cellSelection
          onRowClick={onRowClick}
        />
      </RelatedRecordActionsProvider>,
    );
    await waitFor(() => expect(utils.container.querySelector('a[href="/apps/demo/probe/record/9"]')).not.toBeNull());
    const cell = (col: number) =>
      utils.container.querySelectorAll('tbody tr')[0].querySelectorAll<HTMLElement>('td[data-grid-cell]')[col];
    return { ...utils, cell };
  }

  it('the email link and the referenced record chip select their cell and open nothing', async () => {
    const g = await renderLinked();
    const mail = g.container.querySelector<HTMLElement>('a[href="mailto:ada@example.com"]')!;
    expect(fireEvent.click(mail)).toBe(false);
    expect(g.cell(1)).toHaveAttribute('data-selected-cell');
    const chip = g.container.querySelector<HTMLElement>('a[href="/apps/demo/probe/record/9"]')!;
    expect(fireEvent.click(chip)).toBe(false);
    expect(g.cell(2)).toHaveAttribute('data-selected-cell');
    expect(opened).toEqual([]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter on the selected chip cell opens the referenced record; the open button does too', async () => {
    const g = await renderLinked();
    fireEvent.click(g.container.querySelector<HTMLElement>('a[href="/apps/demo/probe/record/9"]')!);
    const catcher = g.container.querySelector<HTMLElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.keyDown(catcher, { key: 'Enter', ctrlKey: true });
    expect(opened).toEqual([['probe', '9']]);
    const open = g.cell(2).querySelector<HTMLElement>('[data-testid="cell-open-button"]')!;
    await waitFor(() => expect(open.className).toMatch(/(^|\s)flex(\s|$)/));
    fireEvent.click(open);
    expect(opened).toEqual([['probe', '9'], ['probe', '9']]);
  });

  it('the title link keeps its click and is the one link marked so', async () => {
    const g = await renderLinked();
    const title = screen.getByText('Alpha').closest('a')!;
    expect(title).toHaveAttribute('data-opens-on-click');
    expect(g.container.querySelectorAll('[data-opens-on-click]')).toHaveLength(1);
    fireEvent.click(title);
    expect(g.cell(0)).not.toHaveAttribute('data-selected-cell');
  });

  it('the email cell draws its copy button as the one the select-first table hides', async () => {
    const g = await renderLinked();
    expect(g.cell(1).querySelector('button[data-cell-copy]')).not.toBeNull();
    expect(g.cell(1).className).toContain('[&_[data-cell-copy]]:hidden');
  });
});

describe('ObjectGrid cellSelection — the panel, Backspace and the rules (objectstack#36023)', () => {
  const RULES = {
    name: { type: 'text', label: 'Name', required: true, maxLength: 5 },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }] },
    notes: { type: 'text', label: 'Notes' },
  };
  async function renderRules() {
    const utils = render(
      <ObjectGridRenderer
        schema={{
          type: 'object-grid',
          objectName: 'probe',
          columns: ['name', 'stage', 'notes'],
          data: { provider: 'value', items: [{ id: '1', name: 'Alpha', stage: 'open', notes: 'n' }] },
          editable: true,
        }}
        objectFields={RULES}
        cellSelection
      />,
    );
    await screen.findByText('Alpha', {}, { timeout: 5000 });
    const cell = (col: number) => utils.container.querySelectorAll<HTMLElement>('tbody tr td[data-grid-cell]')[col];
    const catcher = () => utils.container.querySelector<HTMLInputElement>('[data-slot="cell-type-catcher"]')!;
    return { ...utils, cell, catcher };
  }

  it('a select cell opens its list under the cell, and the cell keeps showing its value', async () => {
    const g = await renderRules();
    fireEvent.click(g.cell(1));
    fireEvent.keyDown(g.catcher(), { key: 'Enter' });
    const overlay = await waitFor(() => {
      const el = g.cell(1).querySelector('[data-slot="cell-editor-overlay"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(overlay).toHaveAttribute('data-placement', 'below');
    expect(g.cell(1).querySelector('[data-slot="cell-display"]')).toHaveTextContent('Open');
    // CONTROL: a text cell's editor covers its cell.
    fireEvent.keyDown(overlay.querySelector('input')!, { key: 'Escape' });
    fireEvent.click(g.cell(2));
    fireEvent.keyDown(g.catcher(), { key: 'Enter' });
    await waitFor(() => expect(g.cell(2).querySelector('[data-slot="cell-editor-overlay"]')).toHaveAttribute('data-placement', 'cover'));
  });

  it('Backspace on a required cell keeps its value and says it is required', async () => {
    const g = await renderRules();
    fireEvent.click(g.cell(0));
    fireEvent.keyDown(g.catcher(), { key: 'Backspace' });
    expect(await screen.findByTestId('cell-readonly-reason')).toHaveTextContent('Name is required');
    expect(g.cell(0)).toHaveTextContent('Alpha');
  });

  it('a name longer than the field allows stays in the editor with the reason', async () => {
    const g = await renderRules();
    fireEvent.click(g.cell(0));
    fireEvent.change(g.catcher(), { target: { value: 'Alphabet' } });
    const input = await waitFor(() => {
      const el = g.cell(0).querySelector<HTMLInputElement>('[data-slot="cell-editor-overlay"] input');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByTestId('cell-edit-refusal')).toHaveTextContent('Name must be at most 5 characters');
    expect(g.cell(0).querySelector('[data-slot="cell-editor-overlay"] input')).toHaveValue('Alphabet');
  });
});

describe('ObjectGrid cellSelection — a lookup chip opens its record in the host\'s place (objectstack#36015)', () => {
  const followed: Array<[string, string | number]> = [];
  const host: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: (objectName, recordId) => { followed.push([objectName, recordId]); },
  };

  async function renderReferences(openReferencedRecord?: (objectName: string, recordId: string) => void) {
    followed.length = 0;
    const utils = render(
      <RelatedRecordActionsProvider value={host}>
        <ObjectGridRenderer
          schema={{
            type: 'object-grid',
            objectName: 'probe',
            columns: ['name', 'account_id', 'owner_id'],
            data: {
              provider: 'value',
              items: [{ id: '1', name: 'Alpha', account_id: { id: 'a7', name: 'Acme' }, owner_id: { id: 'u3', name: 'Ada' } }],
            },
            editable: true,
          }}
          objectFields={{
            name: { type: 'text', label: 'Name' },
            account_id: { type: 'lookup', reference: 'crm_account', label: 'Account' },
            owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
          }}
          cellSelection
          openReferencedRecord={openReferencedRecord}
        />
      </RelatedRecordActionsProvider>,
    );
    await waitFor(() => expect(utils.container.querySelector('a[href="/apps/demo/crm_account/record/a7"]')).not.toBeNull());
    const cell = (col: number) =>
      utils.container.querySelectorAll('tbody tr')[0].querySelectorAll<HTMLElement>('td[data-grid-cell]')[col];
    return { ...utils, cell };
  }

  it('a single click on the account chip opens it through the host; the chip names its record', async () => {
    const open = vi.fn();
    const g = await renderReferences(open);
    const chip = g.container.querySelector<HTMLElement>('a[href="/apps/demo/crm_account/record/a7"]')!;
    expect(chip).toHaveAttribute('data-record-object', 'crm_account');
    expect(chip).toHaveAttribute('data-record-id', 'a7');
    expect(fireEvent.click(chip)).toBe(false);
    expect(open).toHaveBeenCalledWith('crm_account', 'a7');
    expect(followed).toEqual([]);
    expect(g.cell(1)).toHaveAttribute('data-selected-cell');
  });

  it('the lookup cell draws the edit button, which opens its editor; the owner cell draws none', async () => {
    const g = await renderReferences(vi.fn());
    const edit = g.cell(1).querySelector<HTMLElement>('[data-testid="cell-edit-button"]')!;
    fireEvent.pointerEnter(g.cell(1));
    await waitFor(() => expect(edit.className).toMatch(/(^|\s)flex(\s|$)/));
    expect(g.cell(2).querySelector('[data-testid="cell-edit-button"]')).toBeNull();
    fireEvent.click(edit);
    await waitFor(() => expect(g.container.querySelector('td[data-editing-cell]')).not.toBeNull());
  });

  it('a person chip only selects its cell, whatever the host passes', async () => {
    const open = vi.fn();
    const g = await renderReferences(open);
    const person = g.container.querySelector<HTMLElement>('a[href="/apps/demo/sys_user/record/u3"]')!;
    expect(fireEvent.click(person)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(followed).toEqual([]);
    expect(g.cell(2)).toHaveAttribute('data-selected-cell');
  });

  it('control: without the host prop the account chip only selects and no edit button is drawn', async () => {
    const g = await renderReferences(undefined);
    const chip = g.container.querySelector<HTMLElement>('a[href="/apps/demo/crm_account/record/a7"]')!;
    expect(fireEvent.click(chip)).toBe(false);
    expect(followed).toEqual([]);
    expect(g.cell(1)).toHaveAttribute('data-selected-cell');
    expect(g.cell(1).querySelector('[data-testid="cell-edit-button"]')).toBeNull();
  });
});
