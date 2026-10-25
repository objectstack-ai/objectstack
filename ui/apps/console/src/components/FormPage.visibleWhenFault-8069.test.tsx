// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8069 — `FormPage` refuses a submit whose object-level `visibleWhen`
 * could not be evaluated, naming the field and the rule (ADR-0137 D2, ruled as
 * Q1 = B: one judge per rule).
 *
 * ## Why only `visibleWhen`
 *
 * No server evaluates a field's `visibleWhen`, so its fail-open render
 * direction (ADR-0137 D3: a faulting rule SHOWS the field) is the only verdict
 * there is — without a submit refusal it is a silent grant. `requiredWhen` and
 * `readonlyWhen` are evaluated and refused by the server itself (D2), so the
 * client keeps their render direction and warning unchanged; the pin below
 * shows a faulted `requiredWhen` still reaching the write.
 *
 * ## What each case measures
 *
 * The WRITE, read off the stubbed transport — a refused submit issues none, an
 * accepted one issues exactly one — and the message the page shows. Every
 * refusal has a control that differs from it in one respect only.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BASE_FIELDS: Record<string, Record<string, unknown>> = {
  title: { type: 'text', label: 'Title' },
  priority: { type: 'text', label: 'Priority', defaultValue: 'low' },
  notes: { type: 'text', label: 'Notes' },
  status: { type: 'text', label: 'Status' },
};

/** The object with extra keys merged onto named object FIELDS. */
function objectWith(rules: Record<string, Record<string, unknown>>) {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [name, def] of Object.entries(BASE_FIELDS)) fields[name] = { ...def, ...(rules[name] ?? {}) };
  return { name: 'showcase_task', label: 'Task', fields };
}

interface Call {
  method: string;
  url: string;
}
let calls: Call[] = [];

const EDIT_RECORD = { id: 'task-42', title: 'T', priority: 'low', notes: 'n', status: 'open' };

function renderForm(
  objectSchema: unknown,
  opts: { sections?: unknown[]; edit?: boolean } = {},
) {
  const sections = opts.sections ?? [{ label: 'Basics', fields: ['title', 'priority', 'notes', 'status'] }];
  const routes: Array<{ method: string; match: string; body: unknown }> = [
    {
      method: 'GET',
      match: '/meta/view/',
      body: {
        name: 'showcase_task.edit',
        object: 'showcase_task',
        viewKind: 'form',
        label: 'Task',
        config: { type: 'simple', sections },
      },
    },
    { method: 'GET', match: '/meta/object/', body: objectSchema },
    {
      method: 'GET',
      match: '/data/showcase_task/task-42',
      body: { object: 'showcase_task', id: 'task-42', record: EDIT_RECORD },
    },
    { method: 'POST', match: '/data/showcase_task', body: { object: 'showcase_task', id: 'new-1' } },
    {
      method: 'PATCH',
      match: '/data/showcase_task/task-42',
      body: { object: 'showcase_task', id: 'task-42' },
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, url: String(url) });
      const route = routes.find((r) => r.method === method && String(url).includes(r.match));
      if (!route) throw new Error(`unstubbed fetch: ${method} ${url}`);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => route.body,
        text: async () => JSON.stringify(route.body),
      } as unknown as Response;
    }),
  );
  return render(
    <MemoryRouter initialEntries={[`/forms/showcase_task.edit${opts.edit ? '?recordId=task-42' : ''}`]}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const writes = () => calls.filter((c) => c.method === 'POST' || c.method === 'PATCH');

async function submit() {
  await waitFor(() => expect(screen.getByLabelText('Priority')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  calls = [];
  vi.mocked(toast.error).mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe('objectui#8069 — FormPage refuses a faulted visibleWhen at submit', () => {
  it('refuses, writes nothing, and names the field and the rule', async () => {
    renderForm(objectWith({ notes: { visibleWhen: 'record.priority ==' } }));
    await submit();

    const message = await screen.findByText(/visibleWhen rule of Notes could not be evaluated/);
    expect(message).toBeInTheDocument();
    const toasts = vi.mocked(toast.error).mock.calls;
    expect(String(toasts[toasts.length - 1]?.[0])).toMatch(/visibleWhen rule of Notes/);
    expect(writes()).toHaveLength(0);
    // Fail-open at RENDER is unchanged (ADR-0137 D3): the field is on screen.
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  });

  it('CONTROL — the same field with a rule that evaluates submits', async () => {
    renderForm(objectWith({ notes: { visibleWhen: "record.priority == 'low'" } }));
    await submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe('POST');
  });

  it('a STORED blank visibleWhen is refused too — ADR-0137 D2', async () => {
    renderForm(objectWith({ notes: { visibleWhen: '' } }));
    await submit();
    await screen.findByText(/visibleWhen rule of Notes could not be evaluated/);
    expect(writes()).toHaveLength(0);
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('[blank]'))).toBe(true);
  });

  it('control — a blank VIEW-level visibleWhen is a layout gate, not a field rule: it submits, and the blank is said', async () => {
    // This page carries the view's predicate onto its row verbatim and judges
    // it at render (`isFieldVisible`, through `evalFieldPredicate`), so a blank
    // one reads as "no gate" there — the field is drawn and nothing on this
    // path refuses it — and it is REPORTED there, on the `[blank]` channel,
    // naming the field (ADR-0137 D4; restated with the diagnostic by
    // objectui#11262). It does not pass through `sectionFields`.
    //
    // On `status`, not `notes`: the stored-blank row above already printed the
    // one line for `''` under the locator both of a field's `visibleWhen`
    // slots share on this page ("visibleWhen of field 'notes'"), and the
    // one-time dedupe is module state for the whole file.
    renderForm(objectWith({}), {
      sections: [{ label: 'Basics', fields: ['title', 'priority', 'notes', { field: 'status', visibleWhen: '' }] }],
    });
    await waitFor(() => expect(screen.getByLabelText('Status')).toBeInTheDocument());
    await submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(
      warn.mock.calls.some((c: unknown[]) => String(c[0]).includes('[blank]') && String(c[0]).includes("'status'")),
    ).toBe(true);
  });

  it('a faulted requiredWhen is NOT refused on the client — it is the server’s to refuse (D2)', async () => {
    renderForm(objectWith({ notes: { requiredWhen: 'record.priority ==' } }));
    await submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
  });

  it('a faulted readonlyWhen is NOT refused on the client either', async () => {
    renderForm(objectWith({ notes: { readonlyWhen: 'record.priority ==' } }), { edit: true });
    await submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe('PATCH');
  });

  it('ACCEPTED RESIDUAL — a visibleWhen reading previous is refused on a CREATE form', async () => {
    renderForm(objectWith({ notes: { visibleWhen: "previous.status == 'open'" } }));
    await submit();
    await screen.findByText(/visibleWhen rule of Notes could not be evaluated/);
    expect(writes()).toHaveLength(0);
  });

  it('CONTROL — the same previous-reading visibleWhen submits on an EDIT form', async () => {
    renderForm(objectWith({ notes: { visibleWhen: "previous.status == 'open'" } }), { edit: true });
    await submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].method).toBe('PATCH');
  });

  it('a row inside a HIDDEN section is not judged: its own rule cannot put it on screen', async () => {
    renderForm(objectWith({ notes: { visibleWhen: 'record.priority ==' } }), {
      sections: [
        { label: 'Basics', fields: ['title', 'priority'] },
        { label: 'Escalation', visibleWhen: "record.priority == 'urgent'", fields: ['notes'] },
      ],
    });
    await submit();
    await waitFor(() => expect(writes()).toHaveLength(1));
  });
});
