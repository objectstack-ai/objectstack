// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#25872 — a screen flow ends on a screen that links the records it
 * created.
 *
 * A `type: 'record_link'` screen field shows the `reference` record whose id
 * its `defaultValue` was served with: by the record's display name (ADR-0079
 * `nameField`, resolved by the object form's own `LookupField` in its
 * `readonly` branch from the referenced object's schema), as a link to the
 * record's page. It takes no input, so it is never posted on resume.
 *
 * The name leg uses an object whose name field is NOT `name` (`company_name`),
 * so a label that fell back to the raw id or to a `name` column would fail it.
 * Each "no link" leg sits beside a leg that does draw one.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// Module scope, per AGENTS.md 测试纪律: the link reaches `LookupField` through
// a `React.lazy` factory inside `@object-ui/fields`.
import '@object-ui/fields';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';
import { initialScreenValues, screenResumeValues, type ScreenSpec } from '../ScreenView';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const RECORDS: Record<string, Record<string, Record<string, unknown>>> = {
  crm_account: { acc_1: { id: 'acc_1', company_name: 'Acme Corp' } },
  crm_contact: { con_2: { id: 'con_2', full_name: 'Ada Lovelace' } },
};
const SCHEMAS: Record<string, unknown> = {
  crm_account: { name: 'crm_account', nameField: 'company_name', fields: { company_name: { type: 'text', label: 'Company' } } },
  crm_contact: { name: 'crm_contact', nameField: 'full_name', fields: { full_name: { type: 'text', label: 'Full name' } } },
};

function fakeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (object: string, id: string) => RECORDS[object]?.[id] ?? null),
    getObjectSchema: vi.fn(async (object: string) => SCHEMAS[object]),
  };
}

const OBJECTS = [{ name: 'crm_account' }, { name: 'crm_contact' }, { name: 'crm_lead' }];

const ACCOUNT = { name: 'account', label: 'Account', type: 'record_link', reference: 'crm_account', defaultValue: 'acc_1' };
const CONTACT = { name: 'contact', label: 'Contact', type: 'record_link', reference: 'crm_contact', defaultValue: 'con_2' };

function state(fields: ScreenSpec['fields']): ScreenFlowState {
  return { flowName: 'convert_lead', runId: 'run-1', screen: { nodeId: 'result', title: 'Created', fields } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const okResume = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, data: { success: true } }));

function setup(
  flow: ScreenFlowState,
  { authFetch = okResume(), objects = OBJECTS, routed = true }: { authFetch?: ReturnType<typeof okResume>; objects?: unknown[]; routed?: boolean } = {},
) {
  const runner = (
    <FlowRunner
      state={flow}
      authFetch={authFetch}
      baseUrl=""
      onClose={vi.fn()}
      onComplete={vi.fn()}
      dataSource={fakeDataSource()}
      objects={objects as any[]}
    />
  );
  render(
    routed ? (
      <MemoryRouter initialEntries={['/apps/crm/crm_lead/record/lead_9']}>
        <Routes>
          <Route path="/apps/:appName/*" element={runner} />
        </Routes>
      </MemoryRouter>
    ) : (
      runner
    ),
  );
  return { authFetch };
}

/** The record-link container a field renders into (the dialog renders in a portal). */
function linkCell(name: string): HTMLElement {
  const el = document.querySelector(`[data-screen-record-link="${name}"]`);
  expect(el, `record link "${name}" rendered`).not.toBeNull();
  return el as HTMLElement;
}

beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
});
afterEach(() => {
  cleanup();
});

describe('objectstack#25872 — a `type: \'record_link\'` screen field links the record it shows', () => {
  it('shows two created records by their display names, each a link to its record page', async () => {
    setup(state([ACCOUNT, CONTACT]));
    const account = await waitFor(() => within(linkCell('account')).getByRole('link', { name: 'Acme Corp' }));
    expect(account.getAttribute('href')).toBe('/apps/crm/crm_account/record/acc_1');
    const contact = await waitFor(() => within(linkCell('contact')).getByRole('link', { name: 'Ada Lovelace' }));
    expect(contact.getAttribute('href')).toBe('/apps/crm/crm_contact/record/con_2');
    // No input is drawn for either field.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows "—" and no link for an empty id', async () => {
    setup(state([{ ...ACCOUNT, defaultValue: null }, CONTACT]));
    await waitFor(() => within(linkCell('contact')).getByRole('link', { name: 'Ada Lovelace' }));
    const empty = linkCell('account');
    expect(empty.textContent).toContain('—');
    expect(within(empty).queryByRole('link')).toBeNull();
  });

  it('keeps the name readable, unlinked, for an object this console cannot route to — and with no router at all', async () => {
    setup(state([ACCOUNT, CONTACT]), { objects: [{ name: 'crm_contact' }] });
    await waitFor(() => expect(linkCell('account').textContent).toContain('Acme Corp'));
    expect(within(linkCell('account')).queryByRole('link')).toBeNull();
    await waitFor(() => within(linkCell('contact')).getByRole('link', { name: 'Ada Lovelace' }));
    cleanup();

    setup(state([ACCOUNT]), { routed: false });
    await waitFor(() => expect(linkCell('account').textContent).toContain('Acme Corp'));
    expect(within(linkCell('account')).queryByRole('link')).toBeNull();
  });

  it('honours `visibleWhen` like any other field', async () => {
    setup(state([
      { name: 'make_opportunity', label: 'Opportunity created', type: 'boolean' },
      { ...ACCOUNT, visibleWhen: 'make_opportunity == true' },
    ]));
    await screen.findByText('Opportunity created');
    expect(document.querySelector('[data-screen-record-link="account"]')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => within(linkCell('account')).getByRole('link', { name: 'Acme Corp' }));
  });

  it('posts nothing for the links on Submit — the resume carries only the inputs', async () => {
    const authFetch = okResume();
    setup(state([ACCOUNT, CONTACT, { name: 'note', label: 'Note', type: 'text' }]), { authFetch });
    await waitFor(() => within(linkCell('account')).getByRole('link', { name: 'Acme Corp' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'all set' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(authFetch.mock.calls[0][1]?.body)).inputs).toEqual({ note: 'all set' });
  });

  it('never seeds a link into the collected values, and strips one handed to the resume', () => {
    const spec: ScreenSpec = { nodeId: 'result', title: 'Created', fields: [ACCOUNT, { name: 'note', type: 'text', defaultValue: 'x' }] };
    expect(initialScreenValues(spec)).toEqual({ note: 'x' });
    expect(screenResumeValues(spec, { account: 'acc_1', note: 'y' })).toEqual({ note: 'y' });
    const untouched = { note: 'y' };
    expect(screenResumeValues(spec, untouched)).toBe(untouched);
  });
});
