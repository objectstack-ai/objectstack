/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Display popover's Layout row folds its segments to icons when they would
 * not fit (objectstack#26637).
 *
 * Walked on a zh-CN list offering four layouts, the row read
 * 「布局 | 表格 | 看板 | 日历 | 时间线」 and each label broke onto two lines: the
 * panel is a fixed width and the row shares it with its title. The ruling is a
 * MEASURED fold, never a count or a breakpoint, in every locale; the popover
 * does not widen. Folded, the unselected segments keep their icon, accessible
 * name and tooltip, and the selected one keeps its label.
 *
 * jsdom has no layout, so the widths are a model of the console's tokens: a
 * segment is `px-2.5` (20) + a 16 px icon, plus `gap-1.5` (6) and its words
 * when they show; the track adds `p-0.5` (4) and `gap-0.5` (2) between
 * segments; `text-xs` draws a CJK character 12 px wide and a Latin one about
 * 7 px. The model reads the fold the way the class does (an unselected tab's
 * words are gone while the slot carries `data-layout-fold`), so a measurement
 * that forgot to lift the fold would read the folded width, unfold, read the
 * full width and fold again until React gives up.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import type { ListViewVisualization } from '@object-ui/core';
import { ViewSettingsPopover, type ViewSettingsPopoverProps } from '../components/ViewSettingsPopover';
import { ViewSwitcherDropdown } from '../ViewSwitcher';

/** `w-80`: the popover's width, which this card must not change. */
const POPOVER_WIDTH = 320;
/** The row's `px-3` on both sides and the `gap-3` between title and slot. */
const ROW_CHROME = 24 + 12;

function textWidth(text: string): number {
  let w = 0;
  // CJK punctuation through the unified ideographs: one em wide at `text-xs`.
  for (const ch of text) w += ch.codePointAt(0)! >= 0x3000 && ch.codePointAt(0)! <= 0x9fff ? 12 : 7;
  return w;
}

/** Whether a tab's words are drawn: the fold hides an unselected tab's, nothing else does. */
function labelShows(tab: Element): boolean {
  return !(tab.closest('[data-layout-fold]') && tab.getAttribute('aria-selected') === 'false');
}

/** The model width of a segmented control as the DOM now stands. */
function tablistWidth(list: Element): number {
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  let w = 4 + 2 * Math.max(0, tabs.length - 1);
  for (const tab of tabs) {
    w += 20 + 16;
    const words = tab.querySelector(':scope > span')?.textContent ?? '';
    if (words && labelShows(tab)) w += 6 + textWidth(words);
  }
  return w;
}

let slotWidth = 0;
let readsWhileFolded = 0;
const saved: Record<'scrollWidth' | 'clientWidth', PropertyDescriptor | undefined> = {
  scrollWidth: undefined,
  clientWidth: undefined,
};

beforeEach(() => {
  readsWhileFolded = 0;
  saved.scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  saved.clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute('role') !== 'tablist') return 0;
      if (this.closest('[data-layout-fold]')) readsWhileFolded += 1;
      return tablistWidth(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === 'display-layout-slot' ? slotWidth : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  for (const key of ['scrollWidth', 'clientWidth'] as const) {
    if (saved[key]) Object.defineProperty(HTMLElement.prototype, key, saved[key]!);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});

/** The slot's width inside the popover, beside the row's title in this locale. */
function slotAtPopoverWidth(title: string): number {
  return POPOVER_WIDTH - ROW_CHROME - textWidth(title);
}

/**
 * Five layouts as a host would draw them: the segmented shape the popover folds
 * (`role="tab"`, name in `aria-label` and `title`, words in a child span).
 * `ViewSwitcherDropdown` itself turns five into a dropdown, so the five-segment
 * row is drawn here.
 */
function FiveSegments({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div role="tablist">
      {labels.map((label, i) => (
        <button key={label} type="button" role="tab" aria-selected={i === current} aria-label={label} title={label}>
          <svg aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function Harness({ layout }: { layout: React.ReactNode }) {
  const { t } = useObjectTranslation();
  return (
    <ViewSettingsPopover
      t={t as ViewSettingsPopoverProps['t']}
      allFields={[]}
      layout={() => layout}
    />
  );
}

function inLocale(language: string, layout: React.ReactNode) {
  const tree = (node: React.ReactNode) => (
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <Harness layout={node} />
    </I18nProvider>
  );
  const view = render(tree(layout));
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  return { rerender: (node: React.ReactNode) => view.rerender(tree(node)) };
}

function switcher(views: ListViewVisualization[]) {
  return <ViewSwitcherDropdown currentView="grid" availableViews={views} onViewChange={() => {}} animated={false} />;
}

const FOUR: ListViewVisualization[] = ['grid', 'kanban', 'calendar', 'timeline'];

function slot() {
  return screen.getByTestId('display-layout-slot');
}

/** Every segment fits on one line: the row's segments take no more than the slot. */
function expectFits() {
  expect(tablistWidth(screen.getByRole('tablist'))).toBeLessThanOrEqual(slotWidth);
}

describe('Display popover: the Layout row folds to icons when its segments would not fit (objectstack#26637)', () => {
  it('zh-CN, the walked row 「布局 | 表格 | 看板 | 日历 | 时间线」: folds, and every segment keeps its name and tooltip', () => {
    slotWidth = slotAtPopoverWidth('布局');
    inLocale('zh', switcher(FOUR));

    expect(slot().getAttribute('data-layout-fold')).toBe('icons');
    expectFits();
    for (const name of ['表格', '看板', '日历', '时间线']) {
      const tab = screen.getByRole('tab', { name });
      expect(tab.getAttribute('title')).toBe(name);
    }
    // The selected segment keeps its words; the others show their icon only.
    const shown = screen.getAllByRole('tab').filter(labelShows).map((tab) => tab.getAttribute('aria-label'));
    expect(shown).toEqual(['表格']);
    expect(readsWhileFolded).toBe(0);
  });

  it('en: the same four layouts fold too, where the labels are longer still', () => {
    slotWidth = slotAtPopoverWidth('Layout');
    inLocale('en', switcher(FOUR));

    expect(slot().getAttribute('data-layout-fold')).toBe('icons');
    expectFits();
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('title')).toBe('Timeline');
    expect(readsWhileFolded).toBe(0);
  });

  it('five layouts at the popover width: the fold engages and the row fits', () => {
    slotWidth = slotAtPopoverWidth('布局');
    inLocale('zh', <FiveSegments labels={['表格', '看板', '日历', '时间线', '画廊']} current={3} />);

    expect(slot().getAttribute('data-layout-fold')).toBe('icons');
    expectFits();
    const shown = screen.getAllByRole('tab').filter(labelShows).map((tab) => tab.getAttribute('aria-label'));
    expect(shown).toEqual(['时间线']);
  });

  it('measured, not counted: the same five layouts do not fold where they fit, and two never fold at the popover width', () => {
    slotWidth = 600;
    const { rerender } = inLocale('zh', <FiveSegments labels={['表格', '看板', '日历', '时间线', '画廊']} current={0} />);
    expect(slot().hasAttribute('data-layout-fold')).toBe(false);

    slotWidth = slotAtPopoverWidth('布局');
    rerender(switcher(['grid', 'kanban']));
    expect(slot().hasAttribute('data-layout-fold')).toBe(false);
    expectFits();
  });

  it('re-measures with every label shown: a row that fits again unfolds', () => {
    slotWidth = slotAtPopoverWidth('布局');
    const { rerender } = inLocale('zh', switcher(FOUR));
    expect(slot().getAttribute('data-layout-fold')).toBe('icons');

    rerender(switcher(['grid', 'kanban']));
    expect(slot().hasAttribute('data-layout-fold')).toBe(false);
    expect(screen.getAllByRole('tab').every(labelShows)).toBe(true);
    expect(readsWhileFolded).toBe(0);
  });
});
