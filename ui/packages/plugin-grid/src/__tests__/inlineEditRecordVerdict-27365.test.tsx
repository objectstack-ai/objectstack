/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27365 — the inline cells vs the RECORD-level write verdict.
 *
 * #5143 gated inline editing on the OBJECT-level answer (`inlineEditable`), and
 * #4296 taught the row kebab the record-grained one (`useRecordCrudVerdicts`).
 * The cells never read the second, so one grid gave two answers for one row: a
 * row the server refuses (sharing, ownership, RLS) lost Edit from its kebab
 * while its cells still opened an editor whose save the server refuses whole.
 *
 * The repro is the card's: object grant TRUE, every row on screen readable,
 * one row's `update` verdict refused by the explain engine. The cells must read
 * the SAME verdict the kebab reads — one batched probe, no second evaluator
 * (ruling 6457467702 B) — and fail OPEN on every uncertainty, exactly as the
 * hook's docblock requires.
 *
 * The fake explain service is `rowRecordCrudVerdict.test.tsx`'s shape: one
 * verdict table answering the batch form the grid asks.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

// Stable stub identity: ObjectGrid carries `perms` in `useMemo` dependency
// arrays (same hoisted-state pattern as `rowRecordCrudVerdict.test.tsx`).
const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: false,
    checkField: () => true,
    getObjectApiOperations: () => ['get', 'list', 'create', 'update', 'delete'],
    can: () => true,
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'opportunity';
const OWN_ROW = { id: 'r_own', name: 'My Deal' };
/** Shared to the agent read-only: the server refuses every write to it. */
const OTHER_ROW = { id: 'r_other', name: 'Their Deal' };

type Operation = 'update' | 'delete';

const server = {
  calls: [] as Array<{ operation?: Operation; recordIds?: string[] }>,
  responses: [] as Promise<unknown>[],
  verdicts: new Map<string, Record<Operation, boolean>>(),
  ok: true,
  network: true,
  answersBatch: true,
  gate: null as Promise<void> | null,
  release: () => {},
  hold() {
    server.gate = new Promise<void>((resolve) => {
      server.release = () => resolve();
    });
  },
  reset() {
    server.calls = [];
    server.responses = [];
    server.verdicts = new Map();
    server.ok = true;
    server.network = true;
    server.answersBatch = true;
    server.gate = null;
    server.release = () => {};
  },
};

const apiFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { object?: string; operation?: Operation; recordIds?: string[] };
  server.calls.push(body);
  if (!server.network) throw new TypeError('Failed to fetch');
  const operation = (body.operation ?? 'update') as Operation;
  const base = { allowed: true, object: body.object, operation, principal: { userId: 'u_agent' }, layers: [] };
  const payload = server.answersBatch && Array.isArray(body.recordIds)
    ? {
        ...base,
        records: body.recordIds.map((id) => ({ recordId: id, visible: server.verdicts.get(id)?.[operation] ?? false })),
      }
    : base;
  const res = { ok: server.ok, status: server.ok ? 200 : 500, json: async () => payload } as unknown as Response;
  const settled = (async () => {
    if (server.gate) await server.gate;
    return res;
  })();
  server.responses.push(settled);
  return settled;
};

interface Case {
  /** Wire the row kebab's Edit (`onEdit`); off = an editable grid with no kebab Edit. */
  kebab?: boolean;
}

function renderGrid(c: Case = {}) {
  const kebab = c.kebab ?? true;
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [{ field: 'name', label: 'Name', type: 'text' }],
    data: { provider: 'value', items: [OWN_ROW, OTHER_ROW] },
    pageSize: 50,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource} apiFetch={apiFetch}>
        <ObjectGrid
          schema={schema}
          dataSource={dataSource}
          {...(kebab ? { onEdit: () => {}, onDelete: () => {} } : {})}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Wait for the rows, then for every explain answer to land. */
async function settle() {
  await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
  await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
  await act(async () => {
    await Promise.allSettled(server.responses);
  });
}

const cellOf = (label: string) =>
  Array.from(screen.getByText(label).closest('tr')!.querySelectorAll('td')).find(
    (td) => td.textContent?.trim() === label,
  ) as HTMLElement;

/** Click the row's Name cell and report whether an in-cell editor opened. */
async function clickOpensEditor(label: string): Promise<boolean> {
  const td = cellOf(label);
  fireEvent.click(td);
  await new Promise((r) => setTimeout(r, 50));
  const opened = td.querySelector('input') != null;
  if (opened) fireEvent.keyDown(td.querySelector('input')!, { key: 'Escape' });
  return opened;
}

/** Press Enter on the row's Name cell and report whether an editor opened. */
async function enterOpensEditor(label: string): Promise<boolean> {
  const td = cellOf(label);
  fireEvent.keyDown(td, { key: 'Enter' });
  await new Promise((r) => setTimeout(r, 50));
  return td.querySelector('input') != null;
}

/** Whether the row's kebab offers the built-in Edit entry. */
async function kebabOffersEdit(label: string): Promise<boolean> {
  const trigger = screen.getByText(label).closest('tr')?.querySelector('[data-testid="row-action-trigger"]');
  if (!trigger) return false;
  await userEvent.click(trigger);
  const offered = screen.queryAllByTestId('row-action-builtin-edit').length > 0;
  await userEvent.keyboard('{Escape}');
  return offered;
}

beforeEach(() => {
  server.reset();
  __clearRecordCrudVerdictCache();
  server.verdicts.set(OWN_ROW.id, { update: true, delete: true });
  server.verdicts.set(OTHER_ROW.id, { update: false, delete: false });
});
afterEach(() => {
  cleanup();
});

describe('ObjectGrid inline cells read the record-grained `update` verdict (objectstack#27365)', () => {
  it('the card repro: a row whose `update` verdict is refused opens no cell editor', async () => {
    renderGrid();
    await settle();
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(false);
    expect(await enterOpensEditor(OTHER_ROW.name)).toBe(false);
    // …and reads as read-only: no edit cursor on its cells.
    expect(cellOf(OTHER_ROW.name)).not.toHaveClass('cursor-text');
  });

  it('CONTROL: an allowed row of the same grid stays editable', async () => {
    renderGrid();
    await settle();
    expect(cellOf(OWN_ROW.name)).toHaveClass('cursor-text');
    expect(await clickOpensEditor(OWN_ROW.name)).toBe(true);
  });

  it('the kebab and the cells agree on the same row, from ONE batched probe', async () => {
    renderGrid();
    await settle();
    expect(await kebabOffersEdit(OTHER_ROW.name)).toBe(false);
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(false);
    expect(await kebabOffersEdit(OWN_ROW.name)).toBe(true);
    expect(await clickOpensEditor(OWN_ROW.name)).toBe(true);
    // One `update` question for the page, read by both affordances.
    const updateCalls = server.calls.filter((call) => call.operation === 'update');
    expect(updateCalls).toHaveLength(1);
    expect([...(updateCalls[0].recordIds ?? [])].sort()).toEqual([OTHER_ROW.id, OWN_ROW.id].sort());
  });

  it('an editable grid whose kebab offers no Edit still asks, and still narrows', async () => {
    renderGrid({ kebab: false });
    await settle();
    expect(server.calls.some((call) => call.operation === 'update')).toBe(true);
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(false);
    expect(await clickOpensEditor(OWN_ROW.name)).toBe(true);
  });
});

describe('fail OPEN — no answer keeps the object-level behaviour (objectstack#27365)', () => {
  it('CONTROL: a non-OK explain response leaves every row editable', async () => {
    server.ok = false;
    renderGrid();
    await settle();
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(true);
  });

  it('CONTROL: a network failure leaves every row editable', async () => {
    server.network = false;
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(true);
  });

  it('CONTROL: a service that answers no records[] (no verdict) leaves every row editable', async () => {
    server.answersBatch = false;
    renderGrid();
    await settle();
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(true);
  });

  it('CONTROL: before the answer lands, the row is editable — never over-hidden', async () => {
    server.hold();
    renderGrid();
    await waitFor(() => expect(screen.getByText(OTHER_ROW.name)).toBeInTheDocument());
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(true);
    server.release();
    await act(async () => {
      await Promise.allSettled(server.responses);
    });
    expect(await clickOpensEditor(OTHER_ROW.name)).toBe(false);
  });
});
