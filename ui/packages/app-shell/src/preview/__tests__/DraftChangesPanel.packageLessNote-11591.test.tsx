/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11591 — the pending-changes sheet's confirm note states what THAT
 * scope's Publish does.
 *
 * A package's sheet publishes through `POST /packages/:id/publish-drafts`, one
 * atomic pass, and its note says so. The package-less "Organization flows"
 * page (objectui#11553) has no package to publish as a batch: its Publish
 * promotes each draft by reference, one request per draft, and a draft that
 * fails stays pending while the others go live. The sheet there used to read
 * "Publishing releases the 1 pending draft of this package atomically." — a
 * package it does not have, and an atomicity it does not deliver.
 *
 * Rendered through a REAL `I18nProvider` over the shipped `en` pack, so the
 * sentence asserted is the one an author reads, not the call site's inline
 * `defaultValue`. That every locale's copy moved with `en` is pinned beside
 * the packs, in `packages/i18n/src/__tests__/confirmNoteSeparate-11591.test.ts`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { DraftChangesPanel } from '../DraftChangesPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Draft = { type: string; name: string; packageId: string | null };

/** Answer the `_drafts` feed with `drafts`, and every other read as absent. */
function serveDrafts(drafts: Draft[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/_drafts')) return ok(drafts);
    if (/\/meta\/flow(\?|$)/.test(url)) return ok([]);
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

function renderSheet(packageId: string | null) {
  return render(
    <I18nProvider
      instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}
      persistLanguage={false}
    >
      <DraftChangesPanel open onOpenChange={() => {}} packageId={packageId} onPublish={vi.fn()} />
    </I18nProvider>,
  );
}

/** The confirm footer's note — the paragraph right above the publish button. */
async function confirmNote(): Promise<string> {
  const button = await screen.findByTestId('draft-changes-publish', undefined, { timeout: 4000 });
  const note = button.parentElement?.querySelector('p');
  if (!note) throw new Error('the confirm footer rendered no note');
  return note.textContent ?? '';
}

describe('the confirm note says what this scope publishes (objectui#11591)', () => {
  it('package-less, one draft: no package, no atomicity', async () => {
    serveDrafts([{ type: 'flow', name: 'qa_urgent_alert_clone', packageId: null }]);
    renderSheet(null);

    const note = await confirmNote();
    expect(note).toBe('Publishing releases the 1 pending draft on its own: if it fails, it stays pending.');
    expect(note).not.toMatch(/atomic/i);
    expect(note).not.toMatch(/package/i);
  });

  it('package-less, several drafts: each separately, and a partial publish is possible', async () => {
    serveDrafts([
      { type: 'flow', name: 'qa_urgent_alert_clone', packageId: null },
      { type: 'flow', name: 'qa_daily_digest_clone', packageId: null },
    ]);
    renderSheet(null);

    const note = await confirmNote();
    expect(note).toBe(
      'Publishing releases the 2 pending drafts one at a time: a draft that fails stays pending while the others go live.',
    );
    expect(note).not.toMatch(/atomic/i);
    expect(note).not.toMatch(/package/i);
  });

  it('control — a package’s sheet keeps its sentence, byte for byte', async () => {
    serveDrafts([{ type: 'flow', name: 'showcase_daily_digest', packageId: 'com.example.showcase' }]);
    renderSheet('com.example.showcase');

    await waitFor(async () =>
      expect(await confirmNote()).toBe('Publishing releases the 1 pending draft of this package atomically.'),
    );
  });

  it('control — a package’s sheet, several drafts', async () => {
    serveDrafts([
      { type: 'flow', name: 'showcase_daily_digest', packageId: 'com.example.showcase' },
      { type: 'flow', name: 'showcase_urgent_task_alert', packageId: 'com.example.showcase' },
    ]);
    renderSheet('com.example.showcase');

    expect(await confirmNote()).toBe('Publishing releases all 2 pending drafts of this package atomically.');
  });
});
