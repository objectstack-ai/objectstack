// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34553 — Home's *Publish all* and the draft-preview bar warn
 * about a publish whose runtime probes found an error in the customer's
 * words, never in the agent's.
 *
 * A probe finding carries two channels (objectstack#32984, ruling B: the
 * producer of a finding writes the customer sentence): `message` and `fix`
 * are written for the agent that repairs the build; `userMessage` is the
 * sentence for the person who published, already in the request's language.
 * The toast shows `userMessage`; for an error with none it shows the generic
 * sentence the chat's publish-health line shows (`chatbot.build.issuesSummary`),
 * from the locale pack. `message` and `fix` never reach it.
 *
 * Real: the hook, `useMetadataClient` and its client, the publish-health
 * reader, and `I18nProvider` with the shipped `en` and `zh-Hans` packs.
 * Stubbed: `sonner` (the terminal sink) and `globalThis.fetch` (the server).
 *
 * Its own file: `I18nProvider` installs a module-level i18next global, which
 * would leak into the key-echo `t` the other `usePublishAllDrafts` pins use.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
}));

import { toast } from 'sonner';
// The source under test reaches `@objectstack/lint` through a dynamic import; its
// first load is paid here, at collection, never inside a case's clock
// (`check:test-source-alias`).
import '@objectstack/lint';
import { usePublishAllDrafts } from '../usePublishAllDrafts';

const PKG_ID = 'com.acme.crm';
const AGENT_MESSAGE = "dashboard 'crm_board' widget 'open_tasks': query returned 0 rows although object 'crm_task' has 12";
const AGENT_FIX = "check the dataset 'crm_task_totals' measures and dimensions";

/** The producer's sentence per locale, as `build-probes.user-text.ts` words an `empty_query`. */
const USER_MESSAGE: Record<string, string> = {
  en: 'The widget "Open tasks" on dashboard "Task board" shows no data, although "Tasks" has records. Check the fields that its dataset "Task totals" measures and groups by, then publish again.',
  'zh-Hans': '仪表盘“团队看板”中的组件“未完成任务”没有显示任何数据，但“Tasks”中有记录。请检查其数据集“任务统计”所度量和分组的字段，然后重新发布。',
};

/** The generic sentence each shipped pack holds for an error set with no customer sentence. */
const PACK = { en, 'zh-Hans': zh } as const;
type Locale = keyof typeof PACK;
const LOCALES: Locale[] = ['en', 'zh-Hans'];
const issuesSummaryIn = (locale: Locale): string =>
  PACK[locale].chatbot.build.issuesSummary;

let batchBody: unknown;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A published batch whose probes found the given issues, inside the dispatcher's envelope. */
function publishedWith(issues: Array<Record<string, unknown>>) {
  return {
    success: true,
    data: {
      success: true,
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'view', name: 'lead_list', version: 'sha256:0' }],
      failed: [],
      probes: { checked: { seeds: 0, views: 1, widgets: 1, objects: 0 }, issues },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/publish-drafts')) return json(batchBody);
      if (url.includes('/meta/_drafts')) {
        return json({ drafts: [{ type: 'view', name: 'lead_list', packageId: PKG_ID }] });
      }
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function publishAllIn(locale: Locale) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: locale, detectBrowserLanguage: false }}>{children}</I18nProvider>
  );
  const { result } = renderHook(
    () => {
      const { t, language } = useObjectTranslation();
      return { language, ...usePublishAllDrafts(t) };
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current.language).toBe(locale));
  await act(async () => {
    await result.current.publishAll();
  });
}

/** The one probe warning the publish raised: its title and its detail. */
function probeWarning(): { title: string; description: string } {
  const warnings = vi.mocked(toast.warning).mock.calls;
  expect(warnings).toHaveLength(1);
  const [title, opts] = warnings[0] as [string, { description: string }];
  return { title, description: opts.description };
}

describe('Publish all warns about a probe error in the customer’s words (objectstack#34553)', () => {
  it.each(LOCALES)('%s: an error with a userMessage shows that sentence, not message or fix', async (locale) => {
    batchBody = publishedWith([
      { layer: 'L3', severity: 'error', artifact: 'dashboard', code: 'empty_query', message: AGENT_MESSAGE, fix: AGENT_FIX, userMessage: USER_MESSAGE[locale] },
    ]);
    await publishAllIn(locale);
    const { description } = probeWarning();
    expect(description).toBe(USER_MESSAGE[locale]);
    expect(description).not.toContain(AGENT_MESSAGE);
    expect(description).not.toContain(AGENT_FIX);
    expect(vi.mocked(toast.success).mock.calls).toEqual([]);
  });

  it.each(LOCALES)('%s: an error with no userMessage shows the pack’s generic sentence, not message', async (locale) => {
    batchBody = publishedWith([
      { layer: 'L3', severity: 'error', artifact: 'dashboard', code: 'empty_query', message: AGENT_MESSAGE, fix: AGENT_FIX },
    ]);
    await publishAllIn(locale);
    const { description } = probeWarning();
    expect(description).toBe(issuesSummaryIn(locale));
    expect(description).not.toContain(AGENT_MESSAGE);
  });

  it.each(LOCALES)('%s: the first error that carries a sentence speaks, ahead of an unvoiced one', async (locale) => {
    batchBody = publishedWith([
      { layer: 'L3', severity: 'error', artifact: 'view', code: 'view_read_failed', message: 'view lead_list: read failed' },
      { layer: 'L3', severity: 'error', artifact: 'dashboard', code: 'empty_query', message: AGENT_MESSAGE, userMessage: USER_MESSAGE[locale] },
    ]);
    await publishAllIn(locale);
    expect(probeWarning().description).toBe(USER_MESSAGE[locale]);
  });
});
