/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The AI console's date, time and number faces read the DECLARED session
 * locale, never the machine's (objectui#9909): a conversation row's
 * older-than-a-week date and its absolute-time tooltip, and the build-debug
 * drawer's token count.
 *
 * The row's date tail is objectui#3441's shape one directory over: the recent
 * buckets go through `t('console.ai.daysAgo')`, and the 7-days-and-older bucket
 * fell out of them straight into the machine's locale.
 *
 * Each surface is read twice — under a declared `de-DE` tenant locale and a
 * declared `en` one, the UI language `en` on both — and must read differently.
 * The runtime tripwire then checks the argument every locale-taking call
 * received.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

/** 2020-03-04 15:30:00 UTC — far past the relative-age window; the suite runs in UTC. */
const { STORED } = vi.hoisted(() => ({ STORED: '2020-03-04T15:30:00.000Z' }));

vi.mock('../../../hooks/useConversationList', () => {
  const list = {
    conversations: [{ id: 'conv-a', title: 'Pipeline review', preview: 'p', updatedAt: STORED }],
    isLoading: false,
    error: undefined,
    refetch: () => {},
    remove: async () => undefined,
    rename: async () => undefined,
  };
  return { useConversationList: () => list };
});

import { ConversationsSidebar } from '../ConversationsSidebar';
import { BuildDebugDrawer } from '../BuildDebugDrawer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

const REPORT = {
  conversationId: 'conv_x',
  title: 'Build',
  summary: { models: ['m'], userTurns: 3, messages: 36, totalTokens: 242495, llmMs: 82900 },
  reconciliation: { orphaned: [], missing: [], errors: [], liveCount: 0, ok: true },
  verify: { status: 'passed', errors: 0, warnings: 0, userIssues: [], platformNoise: 0 },
  timeline: [],
  pendingActions: [],
};

interface Surface {
  name: string;
  read: (locale: string) => Promise<string>;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: 'ConversationsSidebar row — the older-than-a-week date tail',
    read: async (locale) => {
      render(
        session(
          locale,
          <MemoryRouter initialEntries={['/ai/conv-a']}>
            <Routes>
              <Route path="/ai/:conversationId" element={<ConversationsSidebar userId="u1" apiBase="/api/v1/ai" />} />
            </Routes>
          </MemoryRouter>,
        ),
      );
      const text = screen.getByTestId('ai-conversation-select-conv-a').textContent ?? '';
      cleanup();
      return text;
    },
    de: /4\.3\.2020/,
    en: /3\/4\/2020/,
  },
  {
    name: 'ConversationsSidebar row — the absolute-time tooltip',
    read: async (locale) => {
      render(
        session(
          locale,
          <MemoryRouter initialEntries={['/ai/conv-a']}>
            <Routes>
              <Route path="/ai/:conversationId" element={<ConversationsSidebar userId="u1" apiBase="/api/v1/ai" />} />
            </Routes>
          </MemoryRouter>,
        ),
      );
      const titled = [...document.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? '');
      cleanup();
      return titled.join(' | ');
    },
    de: /4\.3\.2020, 15:30:00/,
    en: /3\/4\/2020, 3:30:00\sPM/,
  },
  {
    name: 'BuildDebugDrawer — token count',
    read: async (locale) => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => REPORT })));
      render(session(locale, <BuildDebugDrawer apiBase="/api/v1/ai" conversationId="conv_x" open onOpenChange={() => {}} />));
      const line = await screen.findByText(/tok/);
      const text = line.textContent ?? '';
      cleanup();
      vi.unstubAllGlobals();
      return text;
    },
    de: /242\.495 tok/,
    en: /242,495 tok/,
  },
];

describe('AI console faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async ({ read, de }) => {
    const text = await read('de-DE');
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async ({ read, en }) => {
    const text = await read('en');
    expect(text, `got: ${text}`).toMatch(en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async ({ read }) => {
    expect(await read('de-DE')).not.toBe(await read('en'));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async ({ read }) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await read('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
