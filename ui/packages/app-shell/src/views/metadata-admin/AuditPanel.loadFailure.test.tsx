// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Audit tab must not report a measurement it never made — objectui#5169.
 *
 * ## The defect
 *
 * `AuditPanel` held `events: MetadataAuditEntry[] | null` + `error: string |
 * null` + `loading: boolean`, and the catch set the error AND zeroed the events:
 *
 *     } catch (err: any) {
 *       setError(String(err?.message ?? err));
 *       setEvents([]);
 *     } finally { setLoading(false); }
 *
 * Nothing gated the count or the empty branch on the error, so a failed read
 * rendered all three of these AT ONCE, contradicting each other:
 *
 *   • the rose failure banner                     — "the read failed"
 *   • the header count, `0 events`                — a measurement
 *   • "No audit events yet" / "No save, publish, rollback, delete or reset
 *     attempts have been recorded for this item." — a positive claim
 *
 * Unlike objectui#5110 the failure was at least visible, so nothing was
 * silently swallowed. What was wrong is that the operator was handed a
 * contradiction and left to pick which half to believe — on the surface people
 * read for compliance-shaped questions ("did anyone touch this?"), where the
 * false zero is the half that matters.
 *
 * ## What is pinned
 *
 *   1. a FAILED read renders the failure and NOT the empty state or a count;
 *   2. a genuinely EMPTY SUCCESSFUL read still renders "No audit events yet"
 *      and a real `0` — the one case where that sentence is true;
 *   3. the loading flag clears in both, and Refresh re-runs the read.
 *
 * Case 2 is what makes case 1's absence assertions mean something: had the fix
 * simply deleted the empty state, every "the empty copy is absent" assertion
 * would pass for the wrong reason.
 *
 * The empty copy itself is deliberately UNCHANGED by this card. It is correct
 * for a read that completed and found nothing; the fix makes it reachable only
 * from `loaded`, it does not reword it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetadataAuditEntry, MetadataClient } from '@object-ui/data-objectstack';
import { AuditPanel } from './AuditPanel';
import { t } from './i18n';

/** The positive claim this card exists to keep off a failed read. */
const EMPTY_TITLE = t('engine.edit.auditEmptyTitle', 'en-US');
const EMPTY_DESC = t('engine.edit.auditEmptyDescription', 'en-US');

const auditImpl = { current: vi.fn() };

const mockClient = {
  audit: vi.fn(async (...args: unknown[]) => auditImpl.current(...args)),
} as unknown as MetadataClient;

const ENTRY: MetadataAuditEntry = {
  id: 'evt_1',
  occurredAt: '2026-08-18T09:00:00.000Z',
  actor: 'alice',
  source: 'protocol.saveMetaItem',
  operation: 'save',
  outcome: 'denied',
  code: 'item_locked',
  lockState: 'full',
  lockOverridden: false,
  requestId: 'req_abc123',
  note: 'metadata is locked',
};

function mount() {
  return render(
    <AuditPanel type="object" name="showcase_account" client={mockClient} locale="en-US" />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Audit tab — a failed read is not a measured zero (#5169)', () => {
  it('loading: neither a count nor a verdict while the read is in flight', async () => {
    let release!: (v: { events: MetadataAuditEntry[] }) => void;
    auditImpl.current = vi.fn(
      () => new Promise<{ events: MetadataAuditEntry[] }>((res) => { release = res; }),
    );

    mount();

    // No count, no empty state, no failure — the question is still open.
    expect(screen.queryByTestId('audit-count')).toBeNull();
    expect(screen.queryByTestId('audit-empty')).toBeNull();
    expect(screen.queryByTestId('audit-error')).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();

    release({ events: [] });
    await screen.findByTestId('audit-empty');
  });

  it('empty success: a completed read that found nothing still says so, and shows a real 0', async () => {
    auditImpl.current = vi.fn(async () => ({ events: [] }));

    mount();

    // The one case where the sentence is true. Keeping it is what makes the
    // failure case's absence assertions non-vacuous.
    expect(await screen.findByTestId('audit-empty')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(EMPTY_DESC)).toBeInTheDocument();
    // A completed read MAY show its count, and it is a real zero.
    expect(screen.getByTestId('audit-count')).toHaveTextContent('0');
    expect(screen.queryByTestId('audit-error')).toBeNull();
    // Loading cleared: Refresh is available again.
    await waitFor(() =>
      expect(screen.getByTitle(t('engine.edit.refresh', 'en-US'))).toBeEnabled(),
    );
  });

  it('failure: the failure is shown, and the false 0 and the positive claim are both gone', async () => {
    auditImpl.current = vi.fn(async () => {
      throw new Error('500 Internal Server Error: audit store unavailable');
    });

    mount();

    // 1. The failure is stated, with its cause.
    const banner = await screen.findByTestId('audit-error');
    expect(banner).toHaveTextContent('500 Internal Server Error: audit store unavailable');
    expect(screen.getByTestId('audit-error-state')).toBeInTheDocument();
    expect(
      screen.getByText(t('engine.edit.auditErrorTitle', 'en-US')),
    ).toBeInTheDocument();

    // 2. The positive claim about the record must not appear ANYWHERE — this
    //    is the card. Asserted against the empty state's own strings, read from
    //    the table, so rewording that copy cannot quietly narrow this.
    expect(screen.queryByTestId('audit-empty')).toBeNull();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(EMPTY_TITLE);
    expect(document.body.textContent ?? '').not.toContain(EMPTY_DESC);

    // 3. No count: a `0` over a failed read is the same false measurement in
    //    miniature, and it is the half that matters on a compliance surface.
    expect(screen.queryByTestId('audit-count')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(
      `0 ${t('engine.edit.auditCount', 'en-US')}`,
    );

    // 4. Loading cleared — a failure is settled, not pending.
    await waitFor(() =>
      expect(screen.getByTitle(t('engine.edit.refresh', 'en-US'))).toBeEnabled(),
    );
  });

  it('Refresh re-runs the read, and a recovered read replaces the failure with rows', async () => {
    auditImpl.current = vi.fn(async () => {
      throw new Error('boom');
    });

    mount();
    await screen.findByTestId('audit-error');
    expect(mockClient.audit).toHaveBeenCalledTimes(1);

    auditImpl.current = vi.fn(async () => ({ events: [ENTRY] }));
    await userEvent.click(screen.getByTitle(t('engine.edit.refresh', 'en-US')));

    await waitFor(() => expect(mockClient.audit).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-error')).toBeNull();
    expect(screen.queryByTestId('audit-error-state')).toBeNull();
    expect(screen.getByTestId('audit-count')).toHaveTextContent('1');
  });

  it('a loaded trail that later fails does not keep its stale rows next to the failure', async () => {
    // The other direction of the same rule: once the read has failed, the rows
    // on screen are no longer a measurement of anything current.
    auditImpl.current = vi.fn(async () => ({ events: [ENTRY] }));

    mount();
    expect(await screen.findByText('alice')).toBeInTheDocument();

    auditImpl.current = vi.fn(async () => {
      throw new Error('session expired');
    });
    await userEvent.click(screen.getByTitle(t('engine.edit.refresh', 'en-US')));

    await screen.findByTestId('audit-error');
    expect(screen.queryByText('alice')).toBeNull();
    expect(screen.queryByTestId('audit-count')).toBeNull();
    expect(screen.queryByTestId('audit-empty')).toBeNull();
  });
});

/**
 * Locale parity for the keys this card adds — same reasoning as the picker
 * suite: the designer table is out of reach of the pack gates, so a key added
 * to only one of the two tables fails nowhere.
 */
describe('audit failure copy (#5169)', () => {
  it('exists in both locales and is not the empty copy', () => {
    for (const key of [
      'engine.edit.auditErrorTitle',
      'engine.edit.auditErrorDescription',
    ] as const) {
      const en = t(key, 'en-US');
      const zh = t(key, 'zh-CN');
      expect(en, `EN missing ${key}`).not.toBe(key);
      expect(zh, `ZH missing ${key}`).not.toBe(key);
      expect(en, `${key} is untranslated`).not.toBe(zh);
    }

    for (const locale of ['en-US', 'zh-CN'] as const) {
      expect(
        t('engine.edit.auditErrorTitle', locale),
        `${locale} error title collapsed into the empty title`,
      ).not.toBe(t('engine.edit.auditEmptyTitle', locale));
      const errorCopy = t('engine.edit.auditErrorDescription', locale);
      const emptyCopy = t('engine.edit.auditEmptyDescription', locale);
      expect(errorCopy, `${locale} error copy collapsed into the empty copy`).not.toBe(emptyCopy);
      expect(errorCopy).not.toContain(emptyCopy);
    }
  });
});
