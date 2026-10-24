/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The timeline marks an admin override (objectui#5178).
 *
 * framework#4466 added `sys_approval_action.via_override` precisely because
 * "an override and an ordinary approval were byte-for-byte identical" in the
 * audit trail — and its own *Expected* said the marker should be surfaced in
 * the timeline. That half never landed: the column was written by the service,
 * projected by `rowFromAction`, sent by
 * `GET /approvals/requests/:id/actions` — and read by nothing. Measured on
 * objectui `main` @ `a2a974779`, `via_override` had ZERO hits repo-wide.
 *
 * So this pins the read: an override row says so, and — just as important — a
 * row that is NOT an override, and a row too old to know, both stay silent.
 * A marker that appears on ordinary approvals is worse than no marker.
 *
 * ## Why this file settles the way it does (objectui#9158)
 *
 * This pin previously awaited `findByTestId('record-approvals-panel')` — the
 * panel SHELL — and then read the chips synchronously. The chips live on rows
 * built from the stubbed `/actions` response, a SECOND async state that lands
 * after the shell. So the pin settled on something that is ready EARLIER than
 * the thing it asserts, and under load the assertion could run before the rows
 * existed.
 *
 * The damage was not a wasted CI minute. Both of these produced the SAME
 * failure text, measured on `865d34485`:
 *
 *   cause A — the chip stops rendering entirely (a real objectui#5178 regression)
 *   cause B — the rows had not arrived yet (a timing reading about the harness)
 *
 *   both: `Unable to find an element by: [data-testid="via-override-chip"]`
 *
 * A pin whose two causes are indistinguishable from its output teaches the
 * reader to re-run rather than to look, which is exactly how a real regression
 * on this marker gets re-run to green. And the twist worth carrying forward:
 * the `await` was not missing. It was present, and pointed at the wrong
 * element — so a reviewer saw an `await` and stopped looking. The check is not
 * "is there an await", it is "does the awaited element land in the same flush
 * as the asserted one".
 *
 * Two rules therefore hold in this file, and `describe('the pin discriminates
 * its two causes')` at the bottom keeps them honest:
 *
 *   1. Settle on the ROWS. {@link renderPanel} does not return until every row
 *      the stub declared is in the DOM, and it fails with a TIMING message that
 *      says so — never with a chip-shaped one.
 *   2. Every absence assertion carries a LIVE POSITIVE CONTROL in the same DOM.
 *      An absence is satisfied by a panel that renders nothing at all: with the
 *      chip deleted outright, three of the assertions below used to pass. A
 *      permanently-green absence is worse than an intermittently-red presence,
 *      because nothing ever surfaces it.
 *
 * Note what is deliberately NOT done here: no timeout was raised and no
 * `waitFor` wraps an assertion block. Waiting longer for `via-override-chip`
 * would have kept both causes under one message and merely delayed the verdict.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';

const REQUEST: ApprovalRequestLite = {
  id: 'req_1',
  process_name: 'flow:budget',
  process_label: 'Budget Approval',
  object_name: 'budget',
  record_id: 'rec_1',
  status: 'approved',
  submitter_id: 'u_submitter',
  submitted_at: '2026-08-01T08:00:00Z',
  completed_at: '2026-08-03T08:00:00Z',
};

/** A row of the stubbed `GET /approvals/requests/:id/actions` payload. */
interface StubAction {
  id: string;
  request_id: string;
  action: string;
  actor_id: string;
  /** Every stub row names its actor, because the settle keys on these. */
  actor_name: string;
  created_at: string;
  step_name?: string;
  via_override?: boolean;
}

/**
 * One thread carrying all three states of the column at once, so the assertions
 * below are about the ROW and not about the panel happening to render a chip
 * somewhere. The two approvals are otherwise identical — same action, same
 * step — which is exactly the indistinguishability being fixed.
 */
const ACTIONS: StubAction[] = [
  {
    id: 'a1', request_id: 'req_1', action: 'submit',
    actor_id: 'u_submitter', actor_name: 'Zhou Ming', created_at: '2026-08-01T08:00:00Z',
  },
  {
    id: 'a2', request_id: 'req_1', action: 'approve', step_name: 'stage_one',
    actor_id: 'u_qa_head', actor_name: 'Qian Hua', created_at: '2026-08-02T08:00:00Z',
    via_override: false,
  },
  {
    id: 'a3', request_id: 'req_1', action: 'approve', step_name: 'stage_two',
    actor_id: 'u_admin', actor_name: 'Sun Wei', created_at: '2026-08-03T08:00:00Z',
    via_override: true,
  },
  {
    id: 'a4', request_id: 'req_1', action: 'approve', step_name: 'stage_zero',
    actor_id: 'u_legacy', actor_name: 'Old Row', created_at: '2026-07-01T08:00:00Z',
    // No `via_override` at all — written before framework#4466 added the column.
  },
];

/** The thread the override row has been taken out of — nobody earns a chip. */
const ACTIONS_WITHOUT_OVERRIDE = ACTIONS.filter((a) => a.via_override !== true);

const CHIP = 'via-override-chip';

interface StubOptions {
  /**
   * Answer the `/actions` request with a promise that never settles, which is
   * cause B — "the rows have not arrived" — made deterministic. Used only by
   * the discrimination pin at the bottom of this file.
   */
  withholdActions?: boolean;
}

function stubApi(rows: StubAction[], opts: StubOptions = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (/\/approvals\/requests\/[^/]+\/actions$/.test(String(url))) {
        if (opts.withholdActions) return new Promise<never>(() => {});
        return { ok: true, json: async () => ({ data: rows }) } as any;
      }
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }),
  );
}

/** What the panel looks like right now, for a failure message to carry. */
function panelSnapshot(): string {
  const shell = screen.queryByTestId('record-approvals-panel');
  if (!shell) return 'panel shell: ABSENT — the component rendered nothing testable';
  const text = (shell.textContent ?? '').replace(/\s+/g, ' ').trim();
  return `panel shell: present · list rows: ${shell.querySelectorAll('li').length}`
    + ` · text: ${text.slice(0, 240)}`;
}

/** Cause B's message. It must never be confusable with a marker reading. */
function timelineNeverArrived(expected: string[]): string {
  const present = expected.filter((n) => screen.queryAllByText(n).length > 0);
  const missing = expected.filter((n) => screen.queryAllByText(n).length === 0);
  return [
    'TIMELINE ROWS NEVER ARRIVED — a TIMING reading about this harness, NOT a statement',
    'about the via_override marker (objectui#9158).',
    `  rows expected (${expected.length}): ${expected.join(', ')}`,
    `  rows present  (${present.length}): ${present.join(', ') || '(none)'}`,
    `  rows missing  (${missing.length}): ${missing.join(', ') || '(none)'}`,
    `  ${panelSnapshot()}`,
    'The GET /approvals/requests/:id/actions flush had not landed when the settle window',
    'closed, so whether the override chip still renders is UNTESTED by this run. Fix the',
    'async path or the harness; re-running to green proves nothing about objectui#5178.',
  ].join('\n');
}

/** Cause A's message. It asserts the rows were settled, so timing is excluded. */
const MARKER_GONE = [
  'VIA_OVERRIDE MARKER REGRESSION — the timeline rows are SETTLED (renderPanel awaited',
  'every stubbed row before this assertion ran), so a missing chip is the marker no',
  'longer rendering (objectui#5178), not a row that had not arrived. Re-running will not',
  'change this reading.',
].join('\n');

const CONTROL_DEAD = [
  'POSITIVE CONTROL DEAD — the override row (Sun Wei) carries no chip, so the absence',
  'asserted in this test would also be satisfied by a panel that renders NO chip at all.',
  'An absence is evidence only while the marker is demonstrably live in the same DOM.',
].join('\n');

const ZERO_CONTROL_DEAD = [
  'POSITIVE CONTROL DEAD — with the override row put back, the same harness and the same',
  'settle produced no chip. So the zero asserted above is not "nobody earned one", it is',
  '"the marker never renders" (objectui#5178).',
].join('\n');

/**
 * Settle on the rows the assertions are about.
 *
 * `findByText` is Testing Library's own await, one per stubbed row, so the
 * window closes only once the `/actions` flush has produced the whole payload.
 * On failure it is re-thrown as a TIMING message — the single reason this
 * helper exists rather than a bare `await findByTestId(...)`.
 */
async function settleTimelineRows(rows: StubAction[]): Promise<void> {
  const expected = rows.map((r) => r.actor_name);
  try {
    for (const name of expected) await screen.findByText(name);
  } catch {
    throw new Error(timelineNeverArrived(expected));
  }
}

async function renderPanel(rows: StubAction[] = ACTIONS, opts: StubOptions = {}) {
  stubApi(rows, opts);
  const view = render(
    <RecordApprovalsPanel
      approvals={{ available: true, requests: [REQUEST], pendingRequest: null }}
      currentUserId="u_viewer"
    />,
  );
  await settleTimelineRows(rows);
  return view;
}

/** The `<li>` a given actor's row renders into. */
function rowFor(actorName: string): HTMLElement {
  const cell = screen.getByText(actorName);
  const li = cell.closest('li');
  if (!li) throw new Error(`no timeline row for ${actorName}`);
  return li as HTMLElement;
}

/** The live control every absence assertion in this file leans on. */
function expectMarkerIsLive(): void {
  expect(within(rowFor('Sun Wei')).queryByTestId(CHIP), CONTROL_DEAD).not.toBeNull();
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RecordApprovalsPanel — via_override marker (objectui#5178)', () => {
  it('marks the override row, and only the override row', async () => {
    await renderPanel();
    // Exactly one chip in the whole timeline, on the row that earned it.
    expect(screen.queryAllByTestId(CHIP), MARKER_GONE).toHaveLength(1);
    expect(within(rowFor('Sun Wei')).queryByTestId(CHIP), MARKER_GONE).not.toBeNull();
  });

  it('leaves a checked-and-NOT-override approval unmarked', async () => {
    await renderPanel();
    expectMarkerIsLive();
    // `via_override: false` is a positive statement that this was an ordinary
    // approval. Marking it would be a false accusation in an audit surface.
    expect(within(rowFor('Qian Hua')).queryByTestId(CHIP)).toBeNull();
  });

  it('leaves a pre-column row unmarked — "not recorded" is not "not an override"', async () => {
    await renderPanel();
    expectMarkerIsLive();
    expect(within(rowFor('Old Row')).queryByTestId(CHIP)).toBeNull();
  });

  it('still reads as an approval — the marker annotates, it does not replace', async () => {
    await renderPanel();
    const row = rowFor('Sun Wei');
    expect(row.textContent).toContain('Approved');
    expect(row.textContent).toContain('Sun Wei');
    expect(row.textContent, MARKER_GONE).toContain('Admin override');
  });

  it('gives the override row a different timeline dot from an ordinary approval', async () => {
    // The "byte-for-byte identical" complaint is about a glance down the
    // timeline, not only about reading one row's text.
    await renderPanel();
    const dot = (actor: string) => rowFor(actor).querySelector('span[aria-hidden]')?.className ?? '';
    expect(dot('Sun Wei')).toContain('bg-amber-500');
    expect(dot('Qian Hua')).toContain('bg-emerald-500');
    expect(dot('Sun Wei')).not.toBe(dot('Qian Hua'));
  });

  it('renders no chip at all for a thread with no overrides', async () => {
    await renderPanel(ACTIONS_WITHOUT_OVERRIDE);
    expect(screen.queryAllByTestId(CHIP)).toHaveLength(0);

    // The control for that zero. This thread has no override row, so the live
    // control has to be a second render: same harness, same settle, override
    // row restored. Without it, the zero above is also what a deleted chip
    // reads, and the two are indistinguishable again.
    cleanup();
    await renderPanel(ACTIONS);
    expect(screen.queryAllByTestId(CHIP), ZERO_CONTROL_DEAD).toHaveLength(1);
  });
});

/**
 * The property objectui#9158 asks for, asserted rather than argued: the two
 * ways this pin can fail read differently. Proving it once in a PR ablation
 * leaves nothing behind; these two keep the property from eroding.
 */
describe('RecordApprovalsPanel — the pin discriminates its two causes (objectui#9158)', () => {
  it('rows that never land fail as a TIMING reading, naming neither the chip nor a regression', async () => {
    const err = await renderPanel(ACTIONS, { withholdActions: true }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err, 'withholding the /actions flush must fail the pin, not pass it').not.toBeNull();
    expect(err!.message).toContain('TIMELINE ROWS NEVER ARRIVED');
    expect(err!.message).toContain('rows missing  (4)');
    // The whole point: this cause must not borrow the marker's vocabulary.
    expect(err!.message).not.toContain('MARKER REGRESSION');
    expect(err!.message).not.toContain(CHIP);
  });

  it('a settled timeline with no chip fails as a MARKER reading, naming neither timing nor arrival', async () => {
    // Rows present, nothing earning a chip — which is, from the harness's point
    // of view, exactly what a chip deleted from the panel looks like.
    await renderPanel(ACTIONS_WITHOUT_OVERRIDE);
    const err = ((): Error | null => {
      try {
        expect(screen.queryAllByTestId(CHIP), MARKER_GONE).toHaveLength(1);
        return null;
      } catch (e: unknown) {
        return e as Error;
      }
    })();
    expect(err, 'a settled timeline missing its chip must fail').not.toBeNull();
    expect(err!.message).toContain('VIA_OVERRIDE MARKER REGRESSION');
    expect(err!.message).not.toContain('TIMELINE ROWS NEVER ARRIVED');
  });
});
