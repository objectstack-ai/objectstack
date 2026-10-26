/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record approvals timeline's action times read the DECLARED session
 * locale, never the machine's (objectui#9909).
 *
 * `formatDate`'s `catch` is for an unparseable DATE string, not for a tag
 * `Intl` rejected, so the bare call was the primary leg rather than a
 * fallback. The same thread renders twice — under a declared `de-DE` tenant
 * locale and a declared `en` one, the UI language `en` on both — and must read
 * differently; the runtime tripwire then checks the argument every
 * locale-taking call received.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';
import type { ApprovalRequestLite } from '../hooks/useRecordApprovals';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { RecordApprovalsPanel } from './RecordApprovalsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 2020-03-04 15:30:00 UTC — the suite runs in UTC. */
const STORED = '2020-03-04T15:30:00.000Z';

const REQUEST: ApprovalRequestLite = {
  id: 'req_1',
  process_name: 'flow:qif_review',
  process_label: 'QIF Review',
  object_name: 'qif_report',
  record_id: 'rec_1',
  status: 'approved',
  submitter_id: 'u_submitter',
  submitter_name: 'Zhou Ming',
  submitted_at: STORED,
  completed_at: STORED,
};

function stubActions(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      /\/approvals\/requests\/req_1\/actions$/.test(String(url))
        ? ({
            ok: true,
            json: async () => ({
              data: [{ id: 'a1', request_id: 'req_1', action: 'approve', actor_id: 'u2', actor_name: 'Wang Fang', created_at: STORED }],
            }),
          } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
    ),
  );
}

async function timelineUnder(locale: string): Promise<string> {
  stubActions();
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <RecordApprovalsPanel
          approvals={{ available: true, requests: [REQUEST], pendingRequest: null }}
          currentUserId="u_viewer"
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
  const actor = await screen.findByText('Wang Fang');
  const text = actor.closest('li')?.textContent ?? '';
  cleanup();
  vi.unstubAllGlobals();
  return text.replace(/\s+/g, ' ');
}

describe('approval timeline times follow the declared session locale (objectui#9909)', () => {
  it('says the de-DE face under a de-DE session', async () => {
    const text = await timelineUnder('de-DE');
    expect(text, `got: ${text}`).toMatch(/4\.3\.2020, 15:30:00/);
  });

  it('keeps its en face under an en session', async () => {
    const text = await timelineUnder('en');
    expect(text, `got: ${text}`).toMatch(/3\/4\/2020, 3:30:00\sPM/);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it('is a reading of the session, not of the machine', async () => {
    expect(await timelineUnder('de-DE')).not.toBe(await timelineUnder('en'));
  });

  it('every locale-taking call receives the declared tag', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await timelineUnder('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
