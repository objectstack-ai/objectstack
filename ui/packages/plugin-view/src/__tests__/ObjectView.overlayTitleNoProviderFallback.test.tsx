/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectView`'s split-mode record-detail heading still resolves to ENGLISH,
 * and to the SAME BYTES as before, when no `I18nProvider` is mounted —
 * objectui#3459.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: `object-view` renders wherever its type is
 * registered, so any host that renders schema without mounting a provider (this
 * package's own tests, the preview gallery, an embedding app) reads whatever
 * the defaults map says. The English default lives in
 * `VIEW_DEFAULT_TRANSLATIONS` (`ObjectView.tsx`) — that map is what
 * `createSafeTranslation` falls back to when its
 * `detail.recordDetailWithLabel` probe comes back unresolved, and it is what
 * interpolates `{{label}}`.
 *
 * The byte-identity matters beyond aesthetics: the heading is `Contacts Detail`
 * before the change and `Contacts Detail` after, so e2e specs and host tests
 * that address this chrome by its English name keep addressing it.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `ObjectView.overlayTitleI18n.test.tsx`. A missing map entry would have turned
 * it red by rendering the raw key `detail.recordDetailWithLabel`, which is
 * precisely the regression it exists to catch.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, every later
 * "no provider" render in that same file silently resolves against the Chinese
 * instance — a green-looking file that asserts nothing about the fallback.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DataSource } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

const rows = [{ id: '1', name: 'Alice' }];

function dataSourceLabelled(label?: string): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn().mockResolvedValue(rows[0]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'contacts',
      ...(label ? { label } : {}),
      fields: { name: { label: 'Name', type: 'text' } },
    }),
  } as unknown as DataSource;
}

function renderView(label?: string) {
  return render(
    <ObjectView
      schema={{
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'split' },
        table: { fields: ['name'] },
      } as never}
      dataSource={dataSourceLabelled(label)}
    />,
  );
}

async function openSplitPanel() {
  const cell = await screen.findByText('Alice');
  fireEvent.click(cell);
}

// objectui#4688 — ObjectGrid batches a record-level explain probe for the
// rows on screen; with no host `apiFetch` here it would otherwise escape to
// the real network under happy-dom. See `explainDouble.ts`.
beforeEach(() => installExplainDouble());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectView split heading — English fallback with no provider (objectui#3459)', () => {
  it('interpolates the object label in English, never the raw key', async () => {
    renderView('Contacts');
    await openSplitPanel();

    await waitFor(() => expect(screen.getByText('Contacts Detail')).toBeInTheDocument());
    expect(screen.queryByText('detail.recordDetailWithLabel')).toBeNull();
  });

  it('falls back to the objectName when the object declares no label', async () => {
    renderView();
    await openSplitPanel();

    await waitFor(() => expect(screen.getByText('contacts Detail')).toBeInTheDocument());
  });
});
