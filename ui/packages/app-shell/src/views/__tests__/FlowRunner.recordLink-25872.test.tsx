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
import { useEffect, useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
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
    fireEvent.click(await screen.findByRole('checkbox'));
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

/**
 * objectstack#36849 — following a record link on a screen flow's result
 * screen ends the dialog.
 *
 * The record page that launched the run is the dialog's host, and it holds
 * only the run's LAUNCH state: the step the run first paused on. A link to
 * another record is a route change under the same page component, which
 * draws its loading skeleton for a moment (`RecordDetailView` resets its
 * loading flag on every object or record change), so the dialog unmounted
 * and came back from that launch state: step one, inputs and a live Next,
 * whose press posted step one's values to a run already on its last screen.
 *
 * `RecordPageHost` below is that host's shape, reduced: launch state held by
 * the page, a loading flash on every route change, the runner drawn only
 * after it. The run is HotCRM's quote wizard: step one declares `quoteName`,
 * the result screen only the `quoteLink` record link.
 */
describe('objectstack#36849 — following a result screen\'s record link ends the dialog', () => {
  const QUOTE_RECORDS: Record<string, Record<string, unknown>> = { q_1: { id: 'q_1', quote_name: 'Q-0001' } };
  const quoteDataSource = () => ({
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (_object: string, id: string) => QUOTE_RECORDS[id] ?? null),
    getObjectSchema: vi.fn(async () => ({ name: 'crm_quote', nameField: 'quote_name', fields: { quote_name: { type: 'text', label: 'Quote' } } })),
  });

  const STEP_ONE: ScreenFlowState = {
    flowName: 'quote_generation',
    runId: 'run-q',
    screen: {
      nodeId: 'quote_details',
      title: 'Quote details',
      fields: [{ name: 'quoteName', label: 'Quote name', type: 'text' }],
      progress: { nextScreen: 'certain', step: 1, stepCount: 2 },
    },
  };
  const QUOTE_LINK = { name: 'quoteLink', label: 'Quote', type: 'record_link', reference: 'crm_quote', defaultValue: 'q_1' };
  const resultScreen = (fields: ScreenSpec['fields']): ScreenSpec => ({
    nodeId: 'quote_result',
    title: 'Quote created',
    fields,
    progress: { nextScreen: 'none', step: 2, stepCount: 2 },
  });
  const RESUME_URL = '/api/v1/automation/quote_generation/runs/run-q/resume';

  /** Step one's resume pauses on `next`; every later resume completes the run. */
  function wizardRun(next: ScreenSpec) {
    let resumed = 0;
    return vi.fn(async (url: string, _init?: RequestInit) => {
      if (url !== RESUME_URL) return jsonResponse({ success: false, error: { code: 'NOT_FOUND', message: 'no screen' } }, 404);
      resumed += 1;
      return resumed === 1
        ? jsonResponse({ success: true, data: { status: 'paused', runId: 'run-q', screen: next } })
        : jsonResponse({ success: true, data: { success: true } });
    });
  }

  function RecordPageHost({ authFetch, onClose, onComplete }: {
    authFetch: ReturnType<typeof wizardRun>;
    onClose: () => void;
    onComplete: () => void;
  }) {
    const { objectName, recordId } = useParams();
    const [flow, setFlow] = useState<ScreenFlowState | null>(STEP_ONE);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
      setLoading(true);
      queueMicrotask(() => setLoading(false));
    }, [objectName, recordId]);
    if (loading) return <div data-testid="page-skeleton" />;
    return (
      <div data-testid={`page-${objectName}-${recordId}`}>
        <FlowRunner
          state={flow}
          authFetch={authFetch}
          baseUrl=""
          onClose={() => { onClose(); setFlow(null); }}
          onComplete={() => { onComplete(); setFlow(null); }}
          dataSource={quoteDataSource()}
          objects={[{ name: 'crm_opportunity' }, { name: 'crm_quote' }]}
        />
      </div>
    );
  }

  function mountPage(next: ScreenSpec) {
    const authFetch = wizardRun(next);
    const onClose = vi.fn();
    const onComplete = vi.fn();
    render(
      <MemoryRouter initialEntries={['/apps/crm/crm_opportunity/record/opp_1']}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordPageHost authFetch={authFetch} onClose={onClose} onComplete={onComplete} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const resumes = () =>
      authFetch.mock.calls
        .filter(([url]) => url === RESUME_URL)
        .map(([, init]) => JSON.parse(String(init?.body)).inputs);
    return { authFetch, onClose, onComplete, resumes };
  }

  /** Fill step one and press Next; answers the result screen's link to the quote. */
  async function reachResultScreen(): Promise<HTMLElement> {
    fireEvent.change(await screen.findByRole('textbox', { name: 'Quote name' }), { target: { value: 'Spring deal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Quote created');
    return waitFor(() => within(linkCell('quoteLink')).getByRole('link', { name: 'Q-0001' }));
  }

  /** The record page the link leads to, settled past its loading flash. */
  async function landOnQuote(): Promise<void> {
    await screen.findByTestId('page-crm_quote-q_1');
    // One more turn, so a dialog the page would draw again has been drawn.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('lands on the record with nothing on top, never on step one again', async () => {
    const { onComplete, resumes } = mountPage(resultScreen([QUOTE_LINK]));
    fireEvent.click(await reachResultScreen());
    await landOnQuote();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Quote name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    // The run has nothing left to ask: it is completed, as Done completes it.
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(resumes()).toEqual([{ quoteName: 'Spring deal' }, {}]);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('a link on a step that still takes input closes the dialog as Cancel does, resuming nothing', async () => {
    const { onClose, onComplete, resumes } = mountPage(
      resultScreen([QUOTE_LINK, { name: 'note', label: 'Note', type: 'text' }]),
    );
    fireEvent.click(await reachResultScreen());
    await landOnQuote();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(resumes()).toEqual([{ quoteName: 'Spring deal' }]);
  });

  it('a link opened in a new tab leaves the dialog where it is', async () => {
    const { onClose, onComplete, resumes } = mountPage(resultScreen([QUOTE_LINK]));
    fireEvent.click(await reachResultScreen(), { ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(resumes()).toEqual([{ quoteName: 'Spring deal' }]);
  });
});
