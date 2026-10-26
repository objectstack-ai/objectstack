// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SuggestedBindingsPanel` after objectstack#22854 (#22801 → A): an accept by a
 * `manage_metadata` holder takes effect for the whole deployment, a dismiss on
 * an accepted row revokes it, a `guest` row cannot be accepted, and a caller
 * without the authority is refused the list (objectui#7611, C9 part 2).
 *
 * Pinned here, one test per state and per action:
 *
 *  - the states a row is drawn in — pending, accepted, accepted but not yet
 *    in force (a `200` answered `bindingCreated: false`), dismissed or
 *    revoked — and the one it is not drawn in (a baseline row, `confirmed`
 *    without a deployment decision, which this surface does not decide);
 *  - a `guest` row offers no Accept and says why, and keeps Dismiss;
 *  - Accept, Dismiss and Revoke each call their route, and the row takes the
 *    state the server answered;
 *  - a `403` or `409` on an action shows the server's own message, never a
 *    silent no-op, and the panel then re-reads the list;
 *  - a `403` on the list renders nothing.
 *
 * Real subjects: the panel and the real `suggestedBindingsApi` client over a
 * stubbed `fetch` answering the server's envelopes (`{ data: { suggestions,
 * synced } }`, `{ data: { suggestion, bindingCreated } }`, `{ data: {
 * suggestion } }`, and ADR-0112's `{ error: { code, message } }`). Row shapes
 * are the ones the list route answers at objectstack `main` (measured on the
 * PR). `sonner` is mocked so the toasts can be read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
// Imported at module scope: `@object-ui/components` is a heavy barrel, and
// resolving it mid-assertion races the RTL timeouts (AGENTS.md § 测试纪律).
import '@object-ui/components';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(),
  }),
}));

import { toast } from 'sonner';
import { SuggestedBindingsPanel, type SuggestedBindingsStrings } from './SuggestedBindingsPanel';
import type { SuggestedBinding } from '../services/suggestedBindingsApi';

const PKG = 'com.acme.crm';

function row(overrides: Partial<SuggestedBinding> & { permission_set_name: string }): SuggestedBinding {
  return {
    id: `sug_${overrides.permission_set_name}`,
    package_id: PKG,
    anchor: 'everyone',
    status: 'pending',
    deployment_decision: false,
    resolved_by: null,
    resolved_at: null,
    ...overrides,
  };
}

const STRINGS: SuggestedBindingsStrings = {
  describe: (s) => `PROMPT ${s.anchor} ${s.permission_set_name}`,
  confirm: 'Accept',
  confirming: 'Accepting',
  dismiss: 'Dismiss',
  confirmedToast: (s) => `GRANTED ${s.permission_set_name}`,
  dismissedToast: (s) => `DISMISSED ${s.permission_set_name}`,
  guestUnsupported: 'GUEST CANNOT BE ACCEPTED',
  acceptedState: (s) => `ACCEPTED ${s.permission_set_name}`,
  notInForceState: (s) => `NOT IN FORCE ${s.permission_set_name}`,
  dismissedState: (s) => `NOT GRANTED ${s.permission_set_name}`,
  revoke: 'Revoke',
  revoking: 'Revoking',
  revokedToast: (s) => `REVOKED ${s.permission_set_name}`,
};

type Answer = { status: number; body: unknown };
const ok = (data: unknown): Answer => ({ status: 200, body: { data } });
const refused = (status: number, code: string, message: string): Answer => ({
  status, body: { error: { code, message } },
});
const listed = (suggestions: SuggestedBinding[]): Answer =>
  ok({ suggestions, synced: { created: 0, confirmedObserved: 0, pruned: 0, reopened: 0, refused: 0 } });

/**
 * A `fetch` that answers each route from a queue (the last answer repeats),
 * and records every call as `METHOD path`.
 */
function serve(routes: { list: Answer[]; confirm?: Answer[]; dismiss?: Answer[] }) {
  const calls: string[] = [];
  const next = (q: Answer[] | undefined): Answer => {
    if (!q || q.length === 0) throw new Error('unexpected route');
    return q.length > 1 ? q.shift()! : q[0];
  };
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname}${url.search}`);
    const answer = url.pathname.endsWith('/confirm')
      ? next(routes.confirm)
      : url.pathname.endsWith('/dismiss')
        ? next(routes.dismiss)
        : next(routes.list);
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchStub);
  return calls;
}

const panel = () => render(<SuggestedBindingsPanel packageId={PKG} strings={STRINGS} />);
const rowEl = (set: string) => screen.findByTestId(`suggested-binding-${set}`);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SuggestedBindingsPanel — the state of each row (objectui#7611)', () => {
  it('lists every status for the package, not pending only', async () => {
    const calls = serve({ list: [listed([row({ permission_set_name: 'crm_reader' })])] });
    panel();
    await rowEl('crm_reader');
    expect(calls).toEqual([`GET /api/v1/security/suggested-bindings?packageId=${encodeURIComponent(PKG)}`]);
  });

  it('a pending row offers Accept and Dismiss', async () => {
    serve({ list: [listed([row({ permission_set_name: 'crm_reader' })])] });
    panel();
    const el = await rowEl('crm_reader');
    expect(el.dataset.state).toBe('pending');
    expect(el.textContent).toContain('PROMPT everyone crm_reader');
    expect(screen.getByTestId('suggested-binding-confirm-crm_reader')).toBeTruthy();
    expect(screen.getByTestId('suggested-binding-dismiss-crm_reader')).toBeTruthy();
    expect(screen.queryByTestId('suggested-binding-revoke-crm_reader')).toBeNull();
  });

  it('an accepted row (confirmed by a deployment decision) offers Revoke and no Accept', async () => {
    serve({ list: [listed([row({ permission_set_name: 'crm_reader', status: 'confirmed', deployment_decision: true, resolved_by: 'u_admin' })])] });
    panel();
    const el = await rowEl('crm_reader');
    expect(el.dataset.state).toBe('accepted');
    expect(el.textContent).toContain('ACCEPTED crm_reader');
    expect(screen.getByTestId('suggested-binding-revoke-crm_reader')).toBeTruthy();
    expect(screen.queryByTestId('suggested-binding-confirm-crm_reader')).toBeNull();
    expect(screen.queryByTestId('suggested-binding-dismiss-crm_reader')).toBeNull();
  });

  it('a dismissed or revoked row says it is not granted and offers no action', async () => {
    serve({ list: [listed([row({ permission_set_name: 'crm_reader', status: 'dismissed', deployment_decision: true, resolved_by: 'u_admin' })])] });
    panel();
    const el = await rowEl('crm_reader');
    expect(el.dataset.state).toBe('dismissed');
    expect(el.textContent).toContain('NOT GRANTED crm_reader');
    expect(el.querySelectorAll('button')).toHaveLength(0);
  });

  it('a baseline row (confirmed, no deployment decision) is not drawn — this surface does not decide the baseline', async () => {
    serve({
      list: [listed([
        row({ permission_set_name: 'baseline_set', status: 'confirmed', deployment_decision: false }),
        row({ permission_set_name: 'crm_reader' }),
      ])],
    });
    panel();
    await rowEl('crm_reader');
    expect(screen.queryByTestId('suggested-binding-baseline_set')).toBeNull();
  });

  it('CONTROL for the above: a panel holding only a baseline row renders nothing', async () => {
    const calls = serve({ list: [listed([row({ permission_set_name: 'baseline_set', status: 'confirmed', deployment_decision: false })])] });
    const { container } = panel();
    await waitFor(() => expect(calls).toHaveLength(1));
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
  });

  it('a guest row offers no Accept, says why, and keeps Dismiss', async () => {
    serve({ list: [listed([row({ permission_set_name: 'site_visitor', anchor: 'guest' })])] });
    panel();
    const el = await rowEl('site_visitor');
    expect(el.dataset.state).toBe('guest');
    expect(el.textContent).toContain('PROMPT guest site_visitor');
    expect(el.textContent).toContain('GUEST CANNOT BE ACCEPTED');
    expect(screen.queryByTestId('suggested-binding-confirm-site_visitor')).toBeNull();
    expect(screen.getByTestId('suggested-binding-dismiss-site_visitor')).toBeTruthy();
  });

  it('a 403 on the list renders nothing (a caller without manage_metadata)', async () => {
    const calls = serve({ list: [refused(403, 'PERMISSION_DENIED', '[Security] Access denied: listing audience-binding suggestions requires the `manage_metadata` capability.')] });
    const { container } = panel();
    await waitFor(() => expect(calls).toHaveLength(1));
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
  });
});

describe('SuggestedBindingsPanel — the actions (objectui#7611)', () => {
  it('Accept answered bindingCreated: true → the row is accepted, with Revoke, and the success toast', async () => {
    const pending = row({ permission_set_name: 'crm_reader' });
    const accepted = { ...pending, status: 'confirmed' as const, deployment_decision: true, resolved_by: 'u_admin' };
    const calls = serve({ list: [listed([pending])], confirm: [ok({ suggestion: accepted, bindingCreated: true })] });
    panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-confirm-crm_reader'));
    await screen.findByTestId('suggested-binding-revoke-crm_reader');
    expect((await rowEl('crm_reader')).dataset.state).toBe('accepted');
    expect(calls).toContain('POST /api/v1/security/suggested-bindings/sug_crm_reader/confirm');
    expect(toast.success).toHaveBeenCalledWith('GRANTED crm_reader');
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('Accept answered 200 with bindingCreated: false → accepted but NOT in force, a warning and no success toast', async () => {
    const pending = row({ permission_set_name: 'crm_reader' });
    const accepted = { ...pending, status: 'confirmed' as const, deployment_decision: true, resolved_by: 'u_admin' };
    serve({ list: [listed([pending])], confirm: [ok({ suggestion: accepted, bindingCreated: false })] });
    panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-confirm-crm_reader'));
    await waitFor(async () => expect((await rowEl('crm_reader')).dataset.state).toBe('notInForce'));
    expect((await rowEl('crm_reader')).textContent).toContain('NOT IN FORCE crm_reader');
    expect(toast.warning).toHaveBeenCalledWith('NOT IN FORCE crm_reader');
    expect(toast.success).not.toHaveBeenCalled();
    // The acceptance is recorded, so it can be revoked.
    expect(screen.getByTestId('suggested-binding-revoke-crm_reader')).toBeTruthy();
  });

  it('Dismiss on a pending row calls dismiss, and the row says it is not granted', async () => {
    const pending = row({ permission_set_name: 'crm_reader' });
    const dismissed = { ...pending, status: 'dismissed' as const, deployment_decision: true, resolved_by: 'u_admin' };
    const calls = serve({ list: [listed([pending])], dismiss: [ok({ suggestion: dismissed })] });
    panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-dismiss-crm_reader'));
    await waitFor(async () => expect((await rowEl('crm_reader')).dataset.state).toBe('dismissed'));
    expect(calls).toContain('POST /api/v1/security/suggested-bindings/sug_crm_reader/dismiss');
    expect(toast.success).toHaveBeenCalledWith('DISMISSED crm_reader');
  });

  it('Revoke on an accepted row is the dismiss call; the row says it is not granted and the revoke toast shows', async () => {
    const accepted = row({ permission_set_name: 'crm_reader', status: 'confirmed', deployment_decision: true, resolved_by: 'u_admin' });
    const revoked = { ...accepted, status: 'dismissed' as const };
    const calls = serve({ list: [listed([accepted])], dismiss: [ok({ suggestion: revoked })] });
    panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-revoke-crm_reader'));
    await waitFor(async () => expect((await rowEl('crm_reader')).dataset.state).toBe('dismissed'));
    expect(calls).toContain('POST /api/v1/security/suggested-bindings/sug_crm_reader/dismiss');
    expect(calls.some((c) => c.endsWith('/confirm'))).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('REVOKED crm_reader');
  });

  it('Revoke refused 409 → the server message is shown, and the panel re-reads and shows what the server holds', async () => {
    const accepted = row({ permission_set_name: 'crm_reader', status: 'confirmed', deployment_decision: true, resolved_by: 'u_admin' });
    const elsewhere = { ...accepted, status: 'dismissed' as const };
    const message = "Audience-binding suggestion 'sug_crm_reader' is already dismissed — only a pending or accepted suggestion can be dismissed.";
    const calls = serve({
      list: [listed([accepted]), listed([elsewhere])],
      dismiss: [refused(409, 'SUGGESTION_STATE', message)],
    });
    panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-revoke-crm_reader'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    await waitFor(async () => expect((await rowEl('crm_reader')).dataset.state).toBe('dismissed'));
    expect(calls.filter((c) => c.startsWith('GET '))).toHaveLength(2);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('Accept refused 403 (a bit the everyone anchor forbids) → the server message is shown and the row stays pending', async () => {
    const pending = row({ permission_set_name: 'crm_risky' });
    const message = "[Security] Access denied: permission set 'crm_risky' cannot be given to the 'everyone' audience anchor — it carries viewAllRecords on crm_account (ADR-0090 D5/D7).";
    serve({ list: [listed([pending])], confirm: [refused(403, 'PERMISSION_DENIED', message)] });
    panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-confirm-crm_risky'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect((await rowEl('crm_risky')).dataset.state).toBe('pending');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('Revoke refused 403 and the re-read refused 403 → the message is shown, then the panel renders nothing', async () => {
    const accepted = row({ permission_set_name: 'crm_reader', status: 'confirmed', deployment_decision: true, resolved_by: 'u_admin' });
    const message = '[Security] Access denied: dismissing an audience-binding suggestion requires the `manage_metadata` capability.';
    serve({
      list: [listed([accepted]), refused(403, 'PERMISSION_DENIED', message)],
      dismiss: [refused(403, 'PERMISSION_DENIED', message)],
    });
    const { container } = panel();
    fireEvent.click(await screen.findByTestId('suggested-binding-revoke-crm_reader'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
