/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A ⌘K built-in command is found by the words of the label it shows, in the
 * member's language (objectstack#33061).
 *
 * The full-search and theme commands were matched on their hidden values
 * alone (`search all results full page`, `theme light`, …). The row labelled
 * "Open Full Search Page" was not found by `open` or `full search`, and under
 * a non-English locale no command was found by any word of its label: "浅色主题"
 * answered `theme` and `light`, never `浅色`.
 *
 * Pinned through the real `CommandPaletteProvider` (opened by its `?palette=1`
 * deep link) under a real `I18nProvider`, typing into the palette's input.
 * Each label is read from the shipped locale pack, so the pin follows the
 * pack's words:
 *
 *  - `open` and `full search` find "Open Full Search Page" under `en`;
 *  - under `zh-Hans` the words of the pack's full-search and light-theme
 *    labels find those rows;
 *  - CONTROLS: `search` (a word of the value) still finds the full-search row,
 *    and an unrelated word, English or Chinese, finds no command.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

/** A shipped pack's `console.commandPalette` rows. */
const paletteRows = (language: string): Record<string, string> =>
  (builtInLocales as unknown as Record<string, { console: { commandPalette: Record<string, string> } }>)[language]
    .console.commandPalette;

const APP = { name: 'showcase_app', label: 'Showcase', navigation: [] };

function mount(language: string, query: string) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [] })),
    searchAll: vi.fn(async () => ({ hits: [] })),
  };
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/showcase_app?palette=1']}>
        <CommandPaletteProvider>
          <CommandPalette apps={[APP]} activeApp={APP} objects={[]} onAppChange={() => {}} dataSource={dataSource} />
        </CommandPaletteProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  const input = document.querySelector('[cmdk-input]');
  if (!input) throw new Error('the palette did not open');
  fireEvent.change(input, { target: { value: query } });
}

/** The visible text of every command item cmdk rendered whose value starts with `kind `. */
function shown(kind: 'search' | 'theme'): string[] {
  return Array.from(document.querySelectorAll(`[cmdk-item][data-value^="${kind} "]`)).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

/** Types `query` into the open palette's input. */
function type(query: string) {
  fireEvent.change(document.querySelector('[cmdk-input]')!, { target: { value: query } });
}

const commands = () => [...shown('search'), ...shown('theme')];

afterEach(() => cleanup());

describe('objectstack#33061 — a ⌘K built-in command is found by the words of its own label', () => {
  const en = paletteRows('en');
  const zh = paletteRows('zh-Hans');

  it('`open` and `full search` find "Open Full Search Page" under en', () => {
    expect(en.openFullSearch).toBe('Open Full Search Page');

    mount('en', 'open');
    expect(shown('search')).toEqual([en.openFullSearch]);
    cleanup();

    mount('en', 'full search');
    expect(shown('search')).toEqual([en.openFullSearch]);
  });

  it('under zh-Hans the words of the pack labels find the full-search and light-theme rows', async () => {
    const fullSearchWords = '完整搜索';
    const lightWords = '浅色';
    expect(zh.openFullSearch).toContain(fullSearchWords);
    expect(zh.lightTheme).toContain(lightWords);
    expect(zh.openFullSearch).not.toBe(en.openFullSearch);

    mount('zh-Hans', fullSearchWords);
    await waitFor(() => expect(shown('search')).toEqual([zh.openFullSearch]));
    expect(shown('theme')).toEqual([]);
    cleanup();

    mount('zh-Hans', lightWords);
    await waitFor(() => expect(shown('theme')).toEqual([zh.lightTheme]));
    expect(shown('search')).toEqual([]);
  });

  it('CONTROL: `search`, a word of the value, still finds the full-search row', () => {
    mount('en', 'search');
    expect(shown('search')).toEqual([en.openFullSearch]);
  });

  it('CONTROL: an unrelated word finds no command, in en or zh-Hans', async () => {
    mount('en', 'invoice');
    expect(commands()).toEqual([]);
    cleanup();

    // The zh-Hans labels are drawn first, so the empty answer is read against them.
    mount('zh-Hans', '');
    await waitFor(() => expect(shown('search')).toEqual([zh.openFullSearch]));
    type('发票');
    expect(commands()).toEqual([]);
  });
});
