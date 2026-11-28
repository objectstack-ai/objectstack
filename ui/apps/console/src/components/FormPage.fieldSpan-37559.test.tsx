// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#37559 — the named-form page (`/forms/:name`)
 * honours a form field's relative `span`.
 *
 * `FormFieldSchema.span` (`packages/spec/src/ui/view.zod.ts`): `'full'`
 * resolves to the form grid's full column count; `'auto'` (the default) sizes
 * from the widget type, so a textarea / markdown / html / richtext field and a
 * multiple file or image field take the whole row; an authored `colSpan` still
 * wins over that default. This page built each row's width from `colSpan`
 * alone, so `span: 'full'` and the wide-type default rendered one cell wide.
 *
 * The width now comes from the record form's own resolver (`resolveColSpan`,
 * `@object-ui/plugin-form/core`), so these pins read the RENDERED class on the
 * row, the one place the two renderers could still disagree.
 *
 * This page's grid has a single multi-column tier (`sm:grid-cols-N`), so one
 * `sm:col-span-N` class is the whole row at every multi-column tier.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const OBJECT_SCHEMA = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { type: 'text', label: 'Title' },
    summary: { type: 'text', label: 'Summary' },
    notes: { type: 'textarea', label: 'Notes' },
    owner: { type: 'text', label: 'Owner' },
    attachments: { type: 'file', label: 'Attachments', multiple: true },
    receipt: { type: 'file', label: 'Receipt' },
    lines: { type: 'repeater', label: 'Lines' },
    payload: { type: 'json', label: 'Payload' },
  },
};

function viewEnvelope(fields: unknown[], columns: number) {
  return {
    name: 'showcase_task.intake',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Task intake',
    config: { type: 'simple', sections: [{ label: 'Task', columns, fields }] },
  };
}

function stubFetch(routes: Array<{ match: string; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const route = routes.find((r) => String(url).includes(r.match));
    if (!route) throw new Error(`unstubbed fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    } as unknown as Response;
  });
}

const recordPath = (objectName: string, recordId: string) =>
  `/apps/ai.objectstack.showcase/${objectName}/record/${recordId}`;

function renderForm(fields: unknown[], columns = 2) {
  vi.stubGlobal(
    'fetch',
    stubFetch([
      { match: '/meta/view/', body: viewEnvelope(fields, columns) },
      { match: '/meta/object/', body: OBJECT_SCHEMA },
    ]),
  );
  return render(
    <MemoryRouter initialEntries={['/forms/showcase_task.intake']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" recordPath={recordPath} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The grid cell of one row: the element that carries the row's span class. */
async function rowOf(label: string): Promise<HTMLElement> {
  // The label, not the control: an upload widget is named by the label's id
  // (a `group` widget), so a `for`-based lookup cannot be the wait.
  await waitFor(() => expect(screen.getByText(label, { selector: 'label, label *' })).toBeInTheDocument());
  const labelEl = screen.getByText(label, { selector: 'label, label *' }).closest('label');
  expect(labelEl).not.toBeNull();
  return labelEl!.parentElement as HTMLElement;
}

/** The `sm:col-span-N` count on a row; 1 when it carries none. */
function cellsOf(row: HTMLElement): number {
  const m = /(?:^|\s)sm:col-span-(\d)(?:\s|$)/.exec(row.className);
  return m ? Number(m[1]) : 1;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('objectstack#37559 — /forms/:name honours a form field span', () => {
  it("a `span: 'full'` field and a textarea each take the whole row of a 2-column section", async () => {
    renderForm(['title', { field: 'summary', span: 'full' }, 'notes']);
    expect(cellsOf(await rowOf('Summary'))).toBe(2);
    expect(cellsOf(await rowOf('Notes'))).toBe(2);
  });

  it("`span: 'full'` resolves to the section's column count, not a fixed 2", async () => {
    renderForm(['title', { field: 'summary', span: 'full' }, 'notes', 'owner'], 3);
    expect(cellsOf(await rowOf('Summary'))).toBe(3);
    expect(cellsOf(await rowOf('Notes'))).toBe(3);
  });

  it('CONTROL — a plain text field stays one cell', async () => {
    renderForm(['title', { field: 'summary', span: 'full' }, 'notes']);
    expect(cellsOf(await rowOf('Title'))).toBe(1);
  });

  it('CONTROL — an authored colSpan wins over the wide-type default, and is honoured as written', async () => {
    renderForm([{ field: 'notes', colSpan: 1 }, { field: 'owner', colSpan: 2 }, 'title'], 4);
    expect(cellsOf(await rowOf('Notes'))).toBe(1);
    expect(cellsOf(await rowOf('Owner'))).toBe(2);
  });

  it("an authored colSpan wider than the section clamps to the section's column count", async () => {
    renderForm([{ field: 'owner', colSpan: 4 }, 'title']);
    expect(cellsOf(await rowOf('Owner'))).toBe(2);
  });

  it("a file field whose OBJECT field declares `multiple: true` takes the whole row on `span: 'auto'`", async () => {
    renderForm(['title', 'attachments']);
    expect(cellsOf(await rowOf('Attachments'))).toBe(2);
  });

  it('CONTROL — a form-level `multiple: true` over a single-file object field does not widen it', async () => {
    renderForm(['title', { field: 'receipt', multiple: true }]);
    expect(cellsOf(await rowOf('Receipt'))).toBe(1);
  });

  // objectstack#37677: the spec lists repeater as wide; the widget id it maps to
  // (`field:object`) is shared with json, so the width is read off the OBJECT
  // field's type. The record form's twin is plugin-form `repeaterAutoSpan-37677`.
  it("a repeater field takes the whole row on `span: 'auto'`", async () => {
    renderForm(['title', 'lines']);
    expect(cellsOf(await rowOf('Lines'))).toBe(2);
  });

  it('CONTROL — a json field, on the same JSON editor, stays one cell', async () => {
    renderForm(['title', 'payload']);
    expect(cellsOf(await rowOf('Payload'))).toBe(1);
  });

  it('CONTROL — an authored colSpan wins over the repeater default', async () => {
    renderForm([{ field: 'lines', colSpan: 1 }, 'title']);
    expect(cellsOf(await rowOf('Lines'))).toBe(1);
  });
});
