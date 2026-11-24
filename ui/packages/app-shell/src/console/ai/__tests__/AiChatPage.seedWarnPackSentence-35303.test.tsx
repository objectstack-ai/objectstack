/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35303 — the AI chat page's publish warns about a failed seed in
 * the customer's words, never in the seed loader's.
 *
 * A failed seed answers `seedApplied.success === false`. Its `error` is the
 * loader's own engine text, and an `errors[]` entry is a structured row
 * (`{ row, reason }`), both written for whoever repairs the seed. The toast's
 * description is the pack sentence `chatbot.build.health.seedFailed` (the
 * sentence the chat's publish-health line says for the same failure,
 * objectstack#32984); the engine text and the row reach `console.warn`
 * whole, never the toast.
 *
 * Real: `AiChatPage`'s publish handler, `useMetadataClient` and its client,
 * the publish-health reader, and `I18nProvider` with the shipped `en` and
 * `zh-Hans` packs. Stubbed: `sonner` (the terminal sink), `globalThis.fetch`
 * (the server), `console.warn` (observed), and the chat tree, reduced to the
 * button that fires `onPublishDrafts`.
 *
 * Its own file: `I18nProvider` installs a module-level i18next global, which
 * would leak into the default-value `t` the sibling publish pin reads.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.k9qk';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

/** What the chat card's Publish handed back. */
let publishResult: unknown;

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: () => ({
      messages: [],
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      const onPublishDrafts = props.onPublishDrafts as ((packageId: string) => Promise<unknown>) | undefined;
      return (
        <button
          type="button"
          data-testid="card-publish"
          onClick={() => {
            void (async () => {
              publishResult = await onPublishDrafts?.(PACKAGE_ID);
            })();
          }}
        >
          publish
        </button>
      );
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));

import { toast } from 'sonner';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { AiChatPage } from '../AiChatPage';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const PACK = { en, 'zh-Hans': zh } as const;
type Locale = keyof typeof PACK;
const LOCALES: Locale[] = ['en', 'zh-Hans'];

/** The seed loader's own text, as the runtime words a stopped seed apply. */
const ENGINE_TEXT = "seed apply stopped at the seed for object 'crm_task': Reference not found: owner = \"ann\"";
/** One per-record failure as the loader reports it: a structured row, no `error`. */
const ROW_ERROR = { row: 3, reason: 'Reference not found: owner = "ann"' };
/** The prefix of the handler's console line, so other warnings never count. */
const SEED_LOG_PREFIX = '[app-shell] Published, but the seed failed to load';

/** A published batch carrying the given `seedApplied`, inside the dispatcher's envelope. */
function batchWithSeed(seedApplied: Record<string, unknown>) {
  return {
    success: true,
    data: {
      success: true,
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'seed', name: 'crm_sample_rows' }],
      failed: [],
      seedApplied,
    },
  };
}

let batchBody: unknown;
let publishPosts = 0;
let warnSpy: MockInstance<typeof console.warn>;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  batchBody = undefined;
  publishPosts = 0;
  publishResult = undefined;
  window.localStorage.clear();
  window.sessionStorage.clear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/publish-drafts')) {
        publishPosts += 1;
        return json(batchBody);
      }
      return json({ success: true, data: [] });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
});

function LanguageProbe() {
  const { language } = useObjectTranslation();
  return <div data-testid="language">{language}</div>;
}

/** Render the build surface in `locale` and fire a draft card's Publish. */
async function publishFromAChatCardIn(locale: Locale): Promise<void> {
  render(
    <I18nProvider config={{ defaultLanguage: locale, detectBrowserLanguage: false }}>
      <LanguageProbe />
      <MemoryRouter initialEntries={['/ai/build']}>
        <Routes>
          <Route path="/ai/:agent" element={<AiChatPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('language')).toHaveTextContent(locale));
  fireEvent.click(await screen.findByTestId('card-publish'));
  await waitFor(() => expect(publishPosts).toBe(1));
  await waitFor(() => expect(publishResult).toMatchObject({ ok: true }));
}

/** The one warning the publish raised: its title and its detail. */
function seedWarning(): { title: string; description: unknown } {
  const warnings = vi.mocked(toast.warning).mock.calls;
  expect(warnings).toHaveLength(1);
  const [title, opts] = warnings[0] as [string, { description?: unknown }];
  return { title, description: opts?.description };
}

/** The handler's console lines for a failed seed, with their payloads. */
function seedLogs(): unknown[][] {
  return warnSpy.mock.calls.filter((args) => typeof args[0] === 'string' && args[0].startsWith(SEED_LOG_PREFIX));
}

describe('AI chat publish warns about a failed seed in the pack’s sentence (objectstack#35303)', () => {
  it.each(LOCALES)('%s: a seed that failed with engine text shows the pack sentence', async (locale) => {
    batchBody = batchWithSeed({ success: false, inserted: 0, updated: 0, error: ENGINE_TEXT });
    await publishFromAChatCardIn(locale);

    const { title, description } = seedWarning();
    expect(title).toBe(PACK[locale].console.ai.seedWarn);
    expect(description).toBe(PACK[locale].chatbot.build.health.seedFailed);
    expect(String(description)).not.toContain(ENGINE_TEXT);
    expect(toast.success).not.toHaveBeenCalled();

    const logs = seedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ packageId: PACKAGE_ID, error: ENGINE_TEXT });
  });

  it.each(LOCALES)('%s: a seed that failed with a structured row and no error shows the pack sentence', async (locale) => {
    batchBody = batchWithSeed({ success: false, inserted: 0, updated: 0, errors: [ROW_ERROR] });
    await publishFromAChatCardIn(locale);

    const { title, description } = seedWarning();
    expect(title).toBe(PACK[locale].console.ai.seedWarn);
    expect(description).toBe(PACK[locale].chatbot.build.health.seedFailed);
    expect(String(description)).not.toContain('[object Object]');

    const logs = seedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0][1]).toMatchObject({ packageId: PACKAGE_ID, errors: [ROW_ERROR] });
  });
});

describe('control: a seed that loaded reads as before (objectstack#35303)', () => {
  it.each(LOCALES)('%s: a seed that loaded raises no warning and logs nothing', async (locale) => {
    batchBody = batchWithSeed({ success: true, inserted: 2, updated: 0 });
    await publishFromAChatCardIn(locale);

    expect(toast.warning).not.toHaveBeenCalled();
    expect(seedLogs()).toEqual([]);
    expect(vi.mocked(toast.success).mock.calls).toHaveLength(1);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe(PACK[locale].console.ai.publishOk);
  });
});
