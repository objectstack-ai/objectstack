// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26902 — a result screen is acknowledged, never cancelled.
 *
 * A screen flow that ends on a screen of read-only `type: 'record_link'`
 * fields (a lead conversion's last screen, linking the account, contact and
 * opportunity it created) used to draw Cancel + Submit, and Cancel and the
 * dialog close only dismissed the dialog: the run stayed suspended and the
 * host was never told to refresh, so the converted lead kept reading as it did
 * before. On such a screen the footer is now one Done, and Done and every way
 * of closing resume the run with no inputs and complete it as Submit does.
 *
 * Each leg that changes is held beside one that must not: a screen with an
 * input keeps Cancel + Submit, a message-only screen keeps its Cancel, and a
 * display-only step with another screen after it keeps Cancel + Next.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
// Module scope, per ui/AGENTS.md 测试纪律: a record link reaches `LookupField`
// through a `React.lazy` factory inside `@object-ui/fields`.
import '@object-ui/fields';
import { subscribeDataChanges, type DataChange } from '@object-ui/react';
import { FlowRunner, type ScreenFlowState } from '../FlowRunner';
import { isDisplayOnlyScreen, type ScreenSpec } from '../ScreenView';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

function fakeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async (_object: string, id: string) => ({ id, name: id })),
    getObjectSchema: vi.fn(async (object: string) => ({ name: object, nameField: 'name', fields: { name: { type: 'text' } } })),
  };
}

/** The HotCRM `lead_conversion` result screen: three links to the records the conversion created. */
const LINKS: ScreenSpec['fields'] = [
  { name: 'created_account', label: 'Account', type: 'record_link', reference: 'crm_account', defaultValue: 'acc_1' },
  { name: 'created_contact', label: 'Contact', type: 'record_link', reference: 'crm_contact', defaultValue: 'con_2' },
  { name: 'created_opportunity', label: 'Opportunity', type: 'record_link', reference: 'crm_opportunity', defaultValue: 'opp_3' },
];

function state(screenSpec: Partial<ScreenSpec> & { fields?: ScreenSpec['fields'] }): ScreenFlowState {
  return {
    flowName: 'lead_conversion',
    runId: 'run-7',
    screen: { nodeId: 'conversion_result', title: 'Lead converted', ...screenSpec },
  };
}

const RESULT = state({ fields: LINKS, progress: { nextScreen: 'none', step: 2, stepCount: 2 } });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const completedResume = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ success: true, data: { success: true } }));

function setup(flow: ScreenFlowState, authFetch = completedResume()) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  render(
    <FlowRunner
      state={flow}
      authFetch={authFetch}
      baseUrl=""
      onClose={onClose}
      onComplete={onComplete}
      dataSource={fakeDataSource()}
      objects={[{ name: 'crm_account' }, { name: 'crm_contact' }, { name: 'crm_opportunity' }]}
    />,
  );
  return { authFetch, onClose, onComplete };
}

/** Radix's own dismiss `X` — its accessible name is an `sr-only` "Close". */
function dismissX(): HTMLElement {
  const x = screen.getAllByRole('button', { name: 'Close' }).find((b) => b.querySelector('.sr-only') !== null);
  expect(x, 'the dialog draws its dismiss X').toBeDefined();
  return x as HTMLElement;
}

/** The resume POSTs `authFetch` received, each as `{ url, inputs }`. */
function resumes(authFetch: ReturnType<typeof completedResume>) {
  return authFetch.mock.calls.map(([url, init]) => ({ url, inputs: JSON.parse(String(init?.body)).inputs }));
}

const RESUME_URL = '/api/v1/automation/lead_conversion/runs/run-7/resume';

let changes: DataChange[] = [];
let unsubscribe: () => void = () => {};
beforeEach(() => {
  toasts.error.mockReset();
  toasts.success.mockReset();
  changes = [];
  unsubscribe = subscribeDataChanges((change) => changes.push(change));
});
afterEach(() => {
  unsubscribe();
  cleanup();
});

describe('objectstack#26902 — a result screen is acknowledged, never cancelled', () => {
  it('draws one Done on the lead_conversion result screen, and no Cancel or Submit', async () => {
    setup(RESULT);
    expect(await screen.findByRole('button', { name: 'Done' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });

  it('Done resumes the run with no inputs and completes it once, as Submit does', async () => {
    const { authFetch, onClose, onComplete } = setup(RESULT);
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(resumes(authFetch)).toEqual([{ url: RESUME_URL, inputs: {} }]);
    expect(onClose).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([expect.objectContaining({ objectName: '*' })]);
  });

  it('the dialog close resumes and completes the run too — the X, and Escape', async () => {
    const x = setup(RESULT);
    fireEvent.click(dismissX());
    await waitFor(() => expect(x.onComplete).toHaveBeenCalledTimes(1));
    expect(resumes(x.authFetch)).toEqual([{ url: RESUME_URL, inputs: {} }]);
    expect(x.onClose).not.toHaveBeenCalled();
    cleanup();

    const esc = setup(RESULT);
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(esc.onComplete).toHaveBeenCalledTimes(1));
    expect(resumes(esc.authFetch)).toEqual([{ url: RESUME_URL, inputs: {} }]);
    expect(esc.onClose).not.toHaveBeenCalled();
  });

  it('a close while the resume is in flight posts nothing more', async () => {
    let answer: (r: Response) => void = () => {};
    const authFetch = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const { onComplete } = setup(RESULT, authFetch as unknown as ReturnType<typeof completedResume>);
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(dismissX());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    answer(jsonResponse({ success: true, data: { success: true } }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('a resume that pauses again draws the next screen, as Submit does', async () => {
    const authFetch = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { status: 'paused', runId: 'run-7', screen: { nodeId: 'follow_up', title: 'Schedule a follow-up', fields: [{ name: 'when', label: 'When', type: 'text' }] } },
      }),
    );
    const { onClose, onComplete } = setup(state({ fields: LINKS }), authFetch as unknown as ReturnType<typeof completedResume>);
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Schedule a follow-up')).toBeInTheDocument();
    // The next screen takes input, so it is back to Cancel + Submit.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a failed resume keeps the screen and its banner, and a retryable one keeps Done', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ success: false, error: 'gateway timeout' }, 502));
    const { onClose, onComplete } = setup(RESULT, authFetch as unknown as ReturnType<typeof completedResume>);
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('after a failed resume the close only closes: an outage never traps the user in the dialog', async () => {
    const authFetch = vi.fn(async () => jsonResponse({ success: false, error: 'gateway timeout' }, 502));
    const { onClose, onComplete } = setup(RESULT, authFetch as unknown as ReturnType<typeof completedResume>);
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(authFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(dismissX());
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    // Neither close resumed again; Done is still the retry.
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a screen with any input field keeps Cancel + Submit, and its Cancel only closes', async () => {
    const { authFetch, onClose, onComplete } = setup(
      state({ fields: [...LINKS!, { name: 'note', label: 'Note', type: 'text' }], progress: { nextScreen: 'none' } }),
    );
    expect(await screen.findByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(dismissX());
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(authFetch).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a message-only screen keeps its Cancel: it may be the go-ahead for what follows', async () => {
    const { authFetch, onClose } = setup(state({ description: 'Delete these records?' }));
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(dismissX());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('a display-only step with another screen after it keeps Cancel + Next', async () => {
    const { authFetch, onClose } = setup(state({ fields: LINKS, progress: { nextScreen: 'certain', step: 2, stepCount: 3 } }));
    expect(await screen.findByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe('isDisplayOnlyScreen', () => {
  it('holds only for a flat screen of one or more record links', () => {
    expect(isDisplayOnlyScreen({ nodeId: 'r', fields: LINKS })).toBe(true);
    expect(isDisplayOnlyScreen({ nodeId: 'r', fields: [LINKS![0]] })).toBe(true);
    expect(isDisplayOnlyScreen({ nodeId: 'r', fields: [...LINKS!, { name: 'n', type: 'text' }] })).toBe(false);
    // Matched exactly, as the engine's resume rule matches the member.
    expect(isDisplayOnlyScreen({ nodeId: 'r', fields: [{ ...LINKS![0], type: 'Record_Link' }] })).toBe(false);
    expect(isDisplayOnlyScreen({ nodeId: 'r', fields: [] })).toBe(false);
    expect(isDisplayOnlyScreen({ nodeId: 'r' })).toBe(false);
    expect(isDisplayOnlyScreen({ nodeId: 'r', kind: 'object-form', objectName: 'crm_account', fields: LINKS })).toBe(false);
  });
});
