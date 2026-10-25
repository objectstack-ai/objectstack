/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Data pillar's last-saved hint reads the DISPLAY locale, not the
 * designer's string-table language (objectui#10232).
 *
 * The pillar's `locale` is `useMetadataLocale()`, which picks one of the
 * metadata-admin `t()` tables and is `'en-US'` for every language that is not
 * zh. The saved time used to be formatted with it, so a de-DE session read
 * "Saved 03:30 PM". The time is now formatted with `useDisplayLocale()`; the
 * sentence around it keeps the string-table language.
 *
 * The UI language is `en` in both sessions, so only the declared display
 * locale differs. The saved time is "now", so the faces are told apart by the
 * convention, not by a fixed clock: a 24-hour de-DE time carries no day
 * period, an en one does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { completeAddFieldPopover } from './__tests__/dataPillarAddField';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const mockClient = {
  list: vi.fn(async () => [{ name: 'showcase_task', label: 'Task' }]),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// objectui#8620: the records grid calls `find()` on this adapter. `{}` had no
// `find()`, so `ListView`'s fetch threw and its `catch` swallowed the error.
// `dataSource` is an empty-backend `DataSource`, created once below the imports
// so every render gets the same object.
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

afterEach(cleanup);

/** Mounts the pillar under a declared display `locale`, makes an edit, and returns the saved hint once the auto-save lands. */
async function readSavedHint(locale: string): Promise<string> {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
          <DataPillar packageId="com.example.showcase" />
        </MemoryRouter>
      </LocalizationProvider>
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  // An edit sets `dirty`; the debounced auto-save lands it and shows the hint.
  fireEvent.click((await screen.findAllByRole('button', { name: /Add field/i }))[0]);
  // objectui#12516 — Add field asks for the label first.
  await completeAddFieldPopover();
  const hint = await screen.findByTestId('data-saved-at', undefined, { timeout: 5000 });
  const text = hint.textContent ?? '';
  cleanup();
  return text;
}

describe('Data pillar — the last-saved time follows the display locale (objectui#10232)', () => {
  it('says the de-DE face under a de-DE session', async () => {
    const text = await readSavedHint('de-DE');
    expect(text, `got: ${text}`).toMatch(/\b\d{2}:\d{2}\b/);
    expect(text, `got: ${text}`).not.toMatch(/\b(AM|PM)\b/);
  });

  it('keeps the en face under an en session', async () => {
    const text = await readSavedHint('en');
    expect(text, `got: ${text}`).toMatch(/\d{2}:\d{2}\s(AM|PM)/);
  });

  it('every locale-taking call receives the declared tag', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await readSavedHint('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
