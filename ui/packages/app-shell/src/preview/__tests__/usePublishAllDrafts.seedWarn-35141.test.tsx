// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35141 — Home's *Publish all* and the draft-preview bar warn
 * about a failed seed in the customer's words, never in the seed loader's.
 *
 * A failed seed answers `seedApplied.success === false`, and its `error` is
 * the loader's own engine text (`seed apply stopped at the seed for object
 * 'x': …`), written for whoever repairs the seed. The chat's publish-health
 * line (objectstack#32984) says the pack sentence
 * `chatbot.build.health.seedFailed` for it and folds the engine text away;
 * the toast says the same sentence, on both of the hook's doors: the
 * package batch (`publish-drafts`, read through `publishHealthFromResponse`)
 * and the by-reference publish of a package-less seed. The engine text and
 * the hard-coded English "NAME: sample data failed to load" never reach it.
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
const SEED_NAME = 'crm_sample_rows';
/** The seed loader's own text, as the runtime words a stopped seed apply. */
const ENGINE_TEXT = "seed apply stopped at the seed for object 'crm_task': Reference not found: owner = \"ann\"";

const PACK = { en, 'zh-Hans': zh } as const;
type Locale = keyof typeof PACK;
const LOCALES: Locale[] = ['en', 'zh-Hans'];

/** What the server answers on each door; a test sets the ones it drives. */
let drafts: Array<Record<string, unknown>>;
let batchBody: unknown;
let seedPublishBody: unknown;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A published batch carrying the given `seedApplied`, inside the dispatcher's envelope. */
function batchWithSeed(seedApplied: Record<string, unknown>) {
  return {
    success: true,
    data: {
      success: true,
      outcome: 'published',
      publishedCount: 1,
      failedCount: 0,
      published: [{ type: 'seed', name: SEED_NAME, version: 'sha256:0' }],
      failed: [],
      seedApplied,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  drafts = [];
  batchBody = undefined;
  seedPublishBody = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/publish-drafts')) return json(batchBody);
      if (/\/meta\/seed\/[^/]+\/publish$/.test(url)) return json(seedPublishBody);
      if (url.includes('/meta/_drafts')) return json({ drafts });
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

/** The one warning the publish raised: its title and its detail. */
function seedWarning(): { title: string; description: string } {
  const warnings = vi.mocked(toast.warning).mock.calls;
  expect(warnings).toHaveLength(1);
  const [title, opts] = warnings[0] as [string, { description: string }];
  return { title, description: opts.description };
}

describe('Publish all warns about a failed seed in the pack’s sentence (objectstack#35141)', () => {
  it.each(LOCALES)('%s: a package batch whose seed failed with engine text shows the pack sentence', async (locale) => {
    drafts = [{ type: 'seed', name: SEED_NAME, packageId: PKG_ID }];
    batchBody = batchWithSeed({ success: false, inserted: 0, updated: 0, error: ENGINE_TEXT });
    await publishAllIn(locale);
    const { title, description } = seedWarning();
    expect(title).toBe(PACK[locale].home.pendingDrafts.seedWarn);
    expect(description).toBe(PACK[locale].chatbot.build.health.seedFailed);
    expect(description).not.toContain(ENGINE_TEXT);
    expect(vi.mocked(toast.success).mock.calls).toEqual([]);
  });

  it.each(LOCALES)('%s: a package-less seed that failed with engine text shows the pack sentence', async (locale) => {
    drafts = [{ type: 'seed', name: SEED_NAME, packageId: null }];
    seedPublishBody = { success: true, seedApplied: { success: false, inserted: 0, updated: 0, error: ENGINE_TEXT } };
    await publishAllIn(locale);
    const { title, description } = seedWarning();
    expect(title).toBe(PACK[locale].home.pendingDrafts.seedWarn);
    expect(description).toBe(PACK[locale].chatbot.build.health.seedFailed);
    expect(description).not.toContain(ENGINE_TEXT);
  });

  it.each(LOCALES)('%s: a package-less seed that failed with no text shows the pack sentence, not English', async (locale) => {
    drafts = [{ type: 'seed', name: SEED_NAME, packageId: null }];
    seedPublishBody = { success: true, seedApplied: { success: false, inserted: 0, updated: 0, errors: [] } };
    await publishAllIn(locale);
    const { description } = seedWarning();
    expect(description).toBe(PACK[locale].chatbot.build.health.seedFailed);
    expect(description).not.toContain('sample data failed to load');
  });
});

describe('control: a seed that loaded reads as before (objectstack#35141)', () => {
  it.each(LOCALES)('%s: a package-less seed that loaded raises no warning', async (locale) => {
    drafts = [{ type: 'seed', name: SEED_NAME, packageId: null }];
    seedPublishBody = { success: true, seedApplied: { success: true, inserted: 2, updated: 0 } };
    await publishAllIn(locale);
    expect(vi.mocked(toast.warning).mock.calls).toEqual([]);
    expect(vi.mocked(toast.success).mock.calls).toHaveLength(1);
  });
});
