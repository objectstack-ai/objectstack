/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26681 — the Display menu's Open records section.
 *
 * The side-by-side pane is each reader's own choice (maintainer ruling
 * 2026-10-27, objectstack#26677), so the section answers by the mode the host
 * resolved for the object and view:
 *
 *   - `drawer`: two segments, Drawer | Split, each writing the reader's
 *     preference through the host's setter, with the note that the choice is
 *     the reader's own;
 *   - `page`: one read-only line — the declaration wins, nothing to choose;
 *   - `new_window` / `none`, or no `recordOpen` at all: no section.
 *
 * The note and the read-only line are read against the packs, not spelled
 * here: what is pinned is which line is drawn, not its wording. Rendered in
 * zh-CN as well, the language the ruling was given in.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { en, zh as zhPack } from '@object-ui/i18n/locales';
import { ViewSettingsPopover, type ViewSettingsRecordOpen } from '../components/ViewSettingsPopover';

afterEach(cleanup);

function Harness({ recordOpen }: { recordOpen?: ViewSettingsRecordOpen }) {
  const { t } = useObjectTranslation();
  return (
    <ViewSettingsPopover
      t={t as (key: string, opts?: any) => string}
      allFields={[{ name: 'name', label: 'Name' }]}
      recordOpen={recordOpen}
      onRefresh={() => {}}
    />
  );
}

function openDisplay(recordOpen: ViewSettingsRecordOpen | undefined, language = 'en') {
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <Harness recordOpen={recordOpen} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
}

const drawer = (preference: 'drawer' | 'split', setPreference = vi.fn()): ViewSettingsRecordOpen => ({
  resolvedMode: 'drawer',
  preference,
  setPreference,
});

describe('ViewSettingsPopover — Open records (objectstack#26681)', () => {
  it('a drawer object: the two segments, the reader\'s current choice pressed, and the note', async () => {
    openDisplay(drawer('drawer'));
    const section = await screen.findByTestId('display-record-open');
    expect(section.textContent).toContain('Open records');
    const group = screen.getByRole('radiogroup', { name: 'Open records' });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Drawer' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Split' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('display-record-open-note').textContent).toBe(en.list.recordOpenNote);
    expect(screen.queryByTestId('display-record-open-declared')).toBeNull();
  });

  it('choosing Split hands `split` to the host; pressing the pressed segment writes nothing', async () => {
    const setPreference = vi.fn();
    openDisplay(drawer('drawer', setPreference));
    fireEvent.click(await screen.findByRole('radio', { name: 'Drawer' }));
    expect(setPreference).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
    expect(setPreference).toHaveBeenCalledTimes(1);
    expect(setPreference).toHaveBeenCalledWith('split');
  });

  it('a reader who prefers the split pane sees Split pressed, and can go back to Drawer', async () => {
    const setPreference = vi.fn();
    openDisplay(drawer('split', setPreference));
    expect((await screen.findByRole('radio', { name: 'Split' })).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Drawer' }));
    expect(setPreference).toHaveBeenCalledWith('drawer');
  });

  it('a `page` object: the read-only line, no segments, no note', async () => {
    openDisplay({ resolvedMode: 'page', preference: 'split', setPreference: vi.fn() });
    expect((await screen.findByTestId('display-record-open-declared')).textContent).toBe(
      en.list.recordOpenDeclaredPage,
    );
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByTestId('display-record-open-note')).toBeNull();
  });

  it.each(['new_window', 'none'] as const)('a `%s` object: no section', async (resolvedMode) => {
    openDisplay({ resolvedMode, preference: 'drawer', setPreference: vi.fn() });
    await screen.findByTestId('view-settings-content');
    expect(screen.queryByTestId('display-record-open')).toBeNull();
  });

  it('a host that passes no `recordOpen`: no section', async () => {
    openDisplay(undefined);
    await screen.findByTestId('view-settings-content');
    expect(screen.queryByTestId('display-record-open')).toBeNull();
  });

  it('zh-CN: the section reads the zh pack', async () => {
    const zh = zhPack.list;
    openDisplay(drawer('drawer'), 'zh');
    // The zh pack loads on demand: wait for its words, not for the section.
    expect(await screen.findByRole('radio', { name: zh.recordOpenDrawer })).toBeTruthy();
    expect(screen.getByRole('radio', { name: zh.recordOpenSplit })).toBeTruthy();
    expect(screen.getByTestId('display-record-open').textContent).toContain(zh.recordOpen);
    expect(screen.getByTestId('display-record-open-note').textContent).toBe(zh.recordOpenNote);
    cleanup();
    openDisplay({ resolvedMode: 'page', preference: 'drawer', setPreference: vi.fn() }, 'zh');
    expect((await screen.findByText(zh.recordOpenDeclaredPage)).getAttribute('data-testid')).toBe('display-record-open-declared');
  });
});
