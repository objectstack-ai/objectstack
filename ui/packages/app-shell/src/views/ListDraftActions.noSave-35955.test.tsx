/**
 * objectstack#35955 — the draft's actions where no save is offered (personal
 * views not ready, or no grant to create one on a shared view): both faces
 * are Reset alone. The narrow face never draws a save button that holds
 * nothing to save.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ListDraftActions } from './ListDraftActions';

afterEach(() => cleanup());

describe('Reset and Update view with no save offered (objectstack#35955)', () => {
  it('draws Reset on both faces and no save button at all', () => {
    const onDiscard = vi.fn();
    render(<ListDraftActions parts={['sort']} onDiscard={onDiscard} />);

    expect(screen.queryByTestId('list-draft-save')).toBeNull();
    expect(screen.queryByTestId('list-draft-compact')).toBeNull();
    expect(screen.getByTestId('list-draft-discard')).toBeTruthy();
    const compact = screen.getByTestId('list-draft-compact-discard');
    // A plain button, not a menu item: it discards on a click.
    expect(compact.tagName).toBe('BUTTON');
    fireEvent.click(compact);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: with a save offered, the narrow face is one save button whose menu holds Reset', () => {
    render(<ListDraftActions parts={['sort']} onDiscard={() => {}} onSaveAsMyView={() => {}} />);

    expect(screen.getByTestId('list-draft-compact')).toBeTruthy();
    // Reset lives inside that menu, not beside it.
    expect(screen.queryByTestId('list-draft-compact-discard')).toBeNull();
  });
});

/**
 * objectstack#36737 — the draft's actions read as the view's own (Twenty's
 * 「Reset / Update view」), not as a second page Save beside the design
 * mode's: 「重置 / 更新视图」, and the split menu keeps 「Save as my view」.
 * Read through the real language packs.
 */
describe('「重置 / 更新视图」: the view\'s own actions (objectstack#36737)', () => {
  const draw = (language: string) =>
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <ListDraftActions parts={['sort']} onDiscard={() => {}} onSaveToView={() => {}} onSaveAsMyView={() => {}} />
      </I18nProvider>,
    );
  const openMenu = (testId: string) => fireEvent.pointerDown(screen.getByTestId(testId), { button: 0, ctrlKey: false, pointerType: 'mouse' });

  it('zh: 重置 beside 更新视图, whose menu keeps both saves', async () => {
    draw('zh');
    expect(screen.getByTestId('list-draft-discard').textContent?.trim()).toBe('重置');
    expect(screen.getByTestId('list-draft-save').textContent?.trim()).toBe('更新视图');
    openMenu('list-draft-save');
    const menu = await screen.findByTestId('list-draft-save-menu');
    expect(menu.querySelector('[data-testid="list-draft-save-to-view"]')?.textContent).toBe('保存到这个视图');
    expect(menu.querySelector('[data-testid="list-draft-save-as"]')?.textContent).toBe('另存为我的视图');
  });

  it('en: Reset beside Update view; the narrow face is one Update view whose menu holds Reset', async () => {
    draw('en');
    expect(screen.getByTestId('list-draft-discard').textContent?.trim()).toBe('Reset');
    expect(screen.getByTestId('list-draft-save').textContent?.trim()).toBe('Update view');
    expect(screen.getByTestId('list-draft-compact').textContent?.trim()).toBe('Update view');
    openMenu('list-draft-compact');
    const menu = await screen.findByTestId('list-draft-compact-menu');
    expect(menu.querySelector('[data-testid="list-draft-save-as"]')?.textContent).toBe('Save as my view');
    expect(menu.querySelector('[data-testid="list-draft-compact-discard"]')?.textContent).toBe('Reset');
  });
});

/**
 * objectstack#36737 (seat review S1) — the button names the save its menu
 * holds: 「更新视图」 where the open view can take the change, else
 * 「另存为我的视图」, the one save there is (a view a read-only package ships,
 * or a reader who may not write the view). The narrow face, the phone's chip
 * row, reads 「保存」 there: the longer name squeezed the view switcher beside
 * it down to its count at 375 px (measured: 44 px for the switcher against
 * 76 px beside 「更新视图」).
 */
describe('the save button names the save it offers (objectstack#36737)', () => {
  const draw = (language: string, saveToView: boolean) =>
    render(
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        <ListDraftActions
          parts={['sort']}
          onDiscard={() => {}}
          onSaveToView={saveToView ? () => {} : undefined}
          onSaveAsMyView={() => {}}
        />
      </I18nProvider>,
    );
  const faces = () => [
    screen.getByTestId('list-draft-save').textContent?.trim(),
    screen.getByTestId('list-draft-compact').textContent?.trim(),
  ];

  it('zh: 更新视图 where the view can take the change, 另存为我的视图 where it cannot', () => {
    draw('zh', true);
    expect(faces()).toEqual(['更新视图', '更新视图']);
    cleanup();
    draw('zh', false);
    expect(faces()).toEqual(['另存为我的视图', '保存']);
    expect(screen.getByTestId('list-draft-discard').textContent?.trim()).toBe('重置');
  });

  it('en: Update view where the view can take the change, Save as my view where it cannot', async () => {
    draw('en', false);
    expect(faces()).toEqual(['Save as my view', 'Save']);
    fireEvent.pointerDown(screen.getByTestId('list-draft-save'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const menu = await screen.findByTestId('list-draft-save-menu');
    expect(menu.querySelector('[data-testid="list-draft-save-to-view"]')).toBeNull();
    expect(menu.querySelector('[data-testid="list-draft-save-as"]')?.textContent).toBe('Save as my view');
    cleanup();
    draw('en', true);
    expect(faces()).toEqual(['Update view', 'Update view']);
  });
});
