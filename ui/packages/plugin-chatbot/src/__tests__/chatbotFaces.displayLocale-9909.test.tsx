/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The chatbot's date and time faces read the DECLARED session locale, never
 * the machine's (objectui#9909): the approvals inbox's past-30-days date tail
 * and the time `useObjectChat` stamps on a local-mode message.
 *
 * Each surface is read twice — under a declared `de-DE` tenant locale and a
 * declared `en` one, the UI language `en` on both — and must read differently:
 * a literal expectation would measure the runner, on which a broken surface
 * and a repaired one print the same bytes. The runtime tripwire then checks
 * the argument every locale-taking call received.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { PendingActionRow } from '@objectstack/spec/contracts';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';
import { AiPendingActionsInbox } from '../AiPendingActionsInbox';
import { useObjectChat } from '../useObjectChat';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Session({ locale, children }: { locale: string; children?: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/** Proposed 2020-03-04 — far past the 30-day relative window. */
const PROPOSED_AT = '2020-03-04T15:30:00.000Z';

function stubInbox(): void {
  const row: PendingActionRow = {
    id: 'aaaaaaaa1111',
    object_name: 'task',
    action_name: 'delete',
    tool_name: 'action_delete_task',
    tool_input: '{"id":"t1"}',
    status: 'pending',
    proposed_by: 'agent_1',
    proposed_at: PROPOSED_AT,
  } as PendingActionRow;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ items: [row], total: 1 }) }) as unknown as Response,
    ),
  );
}

interface Surface {
  name: string;
  /** Mounts the surface under `locale` and returns the face under test. */
  read: (locale: string) => Promise<string>;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: 'AiPendingActionsInbox — past-30-days date tail',
    read: async (locale) => {
      stubInbox();
      render(
        <Session locale={locale}>
          <AiPendingActionsInbox pollInterval={0} />
        </Session>,
      );
      return waitFor(() => {
        const text = document.body.textContent ?? '';
        expect(text).toMatch(/2020/);
        return text;
      });
    },
    de: /4\.3\.2020/,
    en: /3\/4\/2020/,
  },
  {
    // Both local-mode stamps: the user's message, and the auto-response the
    // hook appends after `autoResponseDelay` — two call sites, one surface.
    name: 'useObjectChat — local-mode message timestamps (user and auto-response)',
    read: async (locale) => {
      // 15:30:45 UTC — the suite runs in UTC; `de` is 24-hour, `en` is 12-hour.
      // Only `Date` is faked, so the auto-response's real timer still fires.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.UTC(2020, 2, 4, 15, 30, 45)));
      const { result } = renderHook(
        () => useObjectChat({ showTimestamp: true, autoResponse: true, autoResponseText: 'ok', autoResponseDelay: 0 }),
        { wrapper: ({ children }) => <Session locale={locale}>{children}</Session> },
      );
      act(() => result.current.sendMessage('hello'));
      await waitFor(() => expect(result.current.messages).toHaveLength(2));
      vi.useRealTimers();
      return result.current.messages.map((m) => m.timestamp ?? '').join(' | ');
    },
    de: /^15:30:45 \| 15:30:45$/,
    en: /^3:30:45\sPM \| 3:30:45\sPM$/,
  },
];

async function faceUnder(locale: string, surface: Surface): Promise<string> {
  const text = (await surface.read(locale)).replace(/\s+/g, ' ').trim();
  cleanup();
  vi.unstubAllGlobals();
  return text;
}

describe('chatbot date and time faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async (surface) => {
    const text = await faceUnder('de-DE', surface);
    expect(text, `got: ${text}`).toMatch(surface.de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async (surface) => {
    const text = await faceUnder('en', surface);
    expect(text, `got: ${text}`).toMatch(surface.en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async (surface) => {
    expect(await faceUnder('de-DE', surface)).not.toBe(await faceUnder('en', surface));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async (surface) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await surface.read('de-DE');
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
