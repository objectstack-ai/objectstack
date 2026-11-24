// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36892 — the full-screen detail header: × back to the list, the
 * type and source package chips, ‹ › with "index / total", the primary button
 * and ⋯, composed from `StudioItemHeader`'s slots.
 *
 * jsdom has no layout, so the narrow-width describe block stubs the title
 * row's geometry the way `StudioItemHeader.titleRowFold-12897.test.tsx` does:
 * the row's width is the case's, every other box is fixed, and the title's box
 * is the room the row leaves it, capped at its text. The real widths are
 * measured in Chromium by `e2e/studio-detail-header-width.spec.ts`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Database } from 'lucide-react';
import { DropdownMenuItem } from '@object-ui/components';
import { StudioDetailHeader, detailSequence, type StudioDetailHeaderProps } from './StudioDetailHeader';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';
import { t } from '../metadata-admin/i18n';

const NAMES = ['account', 'contact', 'lead', 'opportunity', 'task'];

function Header(props: Partial<StudioDetailHeaderProps>) {
  return (
    <StudioDetailHeader
      locale="en"
      icon={Database}
      label="Lead"
      apiName="lead"
      typeLabel="Object"
      packageLabel="CRM"
      status={{ label: 'Unpublished draft' }}
      sequence={{ names: NAMES, current: 'lead' }}
      onOpenItem={vi.fn()}
      onClose={vi.fn()}
      primaryAction={
        <button type="button" data-testid="probe-primary">
          Publish
        </button>
      }
      menu={<DropdownMenuItem data-testid="probe-delete">Delete</DropdownMenuItem>}
      {...props}
    />
  );
}

function openMore(): HTMLElement {
  fireEvent.pointerDown(screen.getByTestId('studio-detail-more'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.getByRole('menu');
}

/** The elements Tab reaches, in document order (no positive tabIndex is used here). */
function tabbable(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'),
  ).filter((el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0 && !el.closest('[hidden]'));
}

/** `window.confirm`, which the leave guard asks; jsdom here has none of its own. */
function stubConfirm(answer: boolean) {
  const spy = vi.fn((_message?: string) => answer);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: spy });
  return spy;
}

const releases: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
});

describe('detailSequence: the position ‹ › step from', () => {
  it('a middle item has both neighbours and a 1-based index', () => {
    expect(detailSequence(NAMES, 'lead')).toEqual({ index: 3, total: 5, previous: 'contact', next: 'opportunity' });
  });

  it('the first item has no previous, the last no next: the ends do not wrap', () => {
    expect(detailSequence(NAMES, 'account')).toEqual({ index: 1, total: 5, previous: null, next: 'contact' });
    expect(detailSequence(NAMES, 'task')).toEqual({ index: 5, total: 5, previous: 'opportunity', next: null });
  });

  it('a lone item has neither neighbour', () => {
    expect(detailSequence(['lead'], 'lead')).toEqual({ index: 1, total: 1, previous: null, next: null });
  });

  it('a name the list does not hold has no position and no neighbours', () => {
    expect(detailSequence(NAMES, 'campaign')).toEqual({ index: null, total: 5, previous: null, next: null });
    expect(detailSequence([], 'lead')).toEqual({ index: null, total: 0, previous: null, next: null });
  });
});

describe('the header’s parts', () => {
  it('× leads the row, then the label, the api name, the type and package chips and the status', () => {
    render(<Header />);
    const title = screen.getByTestId('studio-detail-title');
    const row = title.parentElement!;
    expect(row.firstElementChild).toBe(screen.getByTestId('studio-detail-close'));
    expect(title).toHaveTextContent('Lead');
    expect(screen.getByTestId('studio-item-api-name')).toHaveTextContent('lead');
    expect(screen.getByTestId('studio-detail-type')).toHaveTextContent('Object');
    expect(screen.getByTestId('studio-detail-package')).toHaveTextContent('CRM');
    expect(screen.getByTestId('studio-detail-package')).toHaveAccessibleName('From package CRM');
    expect(screen.getByTestId('studio-item-status')).toHaveTextContent('Unpublished draft');
    expect(screen.getByTestId('studio-detail-close')).toHaveAccessibleName(t('engine.studio.detailHeader.close', 'en'));
  });

  it('the actions are ‹ index / total ›, the primary button and ⋯, in that order', () => {
    render(<Header />);
    const actions = screen.getByTestId('studio-detail-title').parentElement!.lastElementChild as HTMLElement;
    expect(Array.from(actions.children).map((el) => el.getAttribute('data-testid'))).toEqual([
      'studio-detail-pager',
      'probe-primary',
      'studio-detail-more',
    ]);
    expect(screen.getByTestId('studio-detail-position')).toHaveTextContent('3 / 5');
    expect(screen.getByTestId('studio-detail-pager')).toHaveAccessibleName('Item 3 of 5');
  });

  it('no switcher dropdown and no "open in app": the only menu is ⋯, and it holds the page’s own items', () => {
    render(<Header />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(document.querySelectorAll('[aria-haspopup]')).toHaveLength(1);
    const menu = openMore();
    expect(within(menu).getByTestId('probe-delete')).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
  });

  it('without a sequence there is no ‹ ›; without menu items the row has no ⋯ while nothing is folded', () => {
    render(<Header sequence={undefined} menu={undefined} />);
    expect(screen.queryByTestId('studio-detail-pager')).toBeNull();
    expect(screen.queryByTestId('studio-detail-more')).toBeNull();
  });
});

describe('‹ › step through the list, and the ends are off', () => {
  it('‹ opens the previous name and › the next', () => {
    const onOpenItem = vi.fn();
    render(<Header onOpenItem={onOpenItem} />);
    fireEvent.click(screen.getByTestId('studio-detail-previous'));
    fireEvent.click(screen.getByTestId('studio-detail-next'));
    expect(onOpenItem.mock.calls).toEqual([['contact'], ['opportunity']]);
  });

  it('on the first item ‹ is disabled; on the last › is', () => {
    const { unmount } = render(<Header sequence={{ names: NAMES, current: 'account' }} />);
    expect(screen.getByTestId('studio-detail-previous')).toBeDisabled();
    expect(screen.getByTestId('studio-detail-next')).toBeEnabled();
    expect(screen.getByTestId('studio-detail-position')).toHaveTextContent('1 / 5');
    unmount();
    render(<Header sequence={{ names: NAMES, current: 'task' }} />);
    expect(screen.getByTestId('studio-detail-previous')).toBeEnabled();
    expect(screen.getByTestId('studio-detail-next')).toBeDisabled();
    expect(screen.getByTestId('studio-detail-position')).toHaveTextContent('5 / 5');
  });

  it('an item outside the list shows no position, both steps off, and says so', () => {
    render(<Header sequence={{ names: NAMES, current: 'campaign' }} />);
    expect(screen.queryByTestId('studio-detail-position')).toBeNull();
    expect(screen.getByTestId('studio-detail-previous')).toBeDisabled();
    expect(screen.getByTestId('studio-detail-next')).toBeDisabled();
    expect(screen.getByTestId('studio-detail-pager')).toHaveAccessibleName(t('engine.studio.detailHeader.notInList', 'en'));
  });
});

describe('× and ‹ › go through the leave guard', () => {
  it('with unsaved edits, Cancel keeps the page: neither × nor › leaves', () => {
    releases.push(registerUnsavedEdits('Discard your changes?'));
    const confirm = stubConfirm(false);
    const onClose = vi.fn();
    const onOpenItem = vi.fn();
    render(<Header onClose={onClose} onOpenItem={onOpenItem} />);
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    fireEvent.click(screen.getByTestId('studio-detail-next'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledWith('Discard your changes?');
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('with unsaved edits, OK leaves', () => {
    releases.push(registerUnsavedEdits('Discard your changes?'));
    stubConfirm(true);
    const onClose = vi.fn();
    const onOpenItem = vi.fn();
    render(<Header onClose={onClose} onOpenItem={onOpenItem} />);
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    fireEvent.click(screen.getByTestId('studio-detail-previous'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenItem).toHaveBeenCalledWith('contact');
  });

  it('CONTROL: with nothing unsaved, × leaves without asking', () => {
    const confirm = stubConfirm(true);
    const onClose = vi.fn();
    render(<Header onClose={onClose} />);
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('the keyboard: Esc triggers ×, and ‹ › are reachable', () => {
  it('Esc on the page triggers ×, through the leave guard', () => {
    releases.push(registerUnsavedEdits('Discard your changes?'));
    const confirm = stubConfirm(true);
    const onClose = vi.fn();
    render(<Header onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc in a text field is the field’s: × is not triggered', () => {
    const onClose = vi.fn();
    render(
      <>
        <Header onClose={onClose} />
        <input data-testid="probe-input" />
      </>,
    );
    fireEvent.keyDown(screen.getByTestId('probe-input'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc with the ⋯ menu open closes the menu only; the next Esc triggers ×', () => {
    const onClose = vi.fn();
    render(<Header onClose={onClose} />);
    const menu = openMore();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: with closeOnEscape off, Esc does nothing; a modified Esc never closes', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Header onClose={onClose} closeOnEscape={false} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    unmount();
    render(<Header onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape', shiftKey: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('×, ‹ and › are native buttons in the tab order, ‹ before ›, and take the focus', () => {
    render(<Header />);
    const order = tabbable();
    const close = screen.getByTestId('studio-detail-close');
    const previous = screen.getByTestId('studio-detail-previous');
    const next = screen.getByTestId('studio-detail-next');
    for (const el of [close, previous, next]) {
      expect(el.tagName).toBe('BUTTON');
      expect(order).toContain(el);
    }
    expect(order.indexOf(close)).toBeLessThan(order.indexOf(previous));
    expect(order.indexOf(previous)).toBeLessThan(order.indexOf(next));
    act(() => next.focus());
    expect(next).toHaveFocus();
    expect(previous).toHaveAccessibleName(t('engine.studio.detailHeader.previous', 'en'));
    expect(next).toHaveAccessibleName(t('engine.studio.detailHeader.next', 'en'));
  });
});

// ---------------------------------------------------------------------------
// Narrow width: the fold is StudioItemHeader's, unchanged.
// ---------------------------------------------------------------------------

/** Stubbed widths, in px. */
const LEAD = 32;
const ICON = 32;
const STATUS = 30;
const API = 90;
const TYPE = 50;
const PACKAGE = 80;
const PAGER = 64;
const POSITION = 40;
const PRIMARY = 70;
const MORE = 32;
const TITLE_TEXT = 200;
/** The title's first twelve characters. */
const READABLE = 100;
const layout = { row: 900 };

const resizeCallbacks = new Set<() => void>();
const realRect = HTMLElement.prototype.getBoundingClientRect;
const rect = (width: number) =>
  ({ left: 0, right: width, width, top: 0, bottom: 32, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const isRow = (el: Element) => el.classList.contains('@container');
const inRow = (testId: string) => {
  const el = screen.queryByTestId(testId);
  return !!el && !el.closest('[role="menu"]');
};
const labelsShown = () => !document.querySelector('[data-fold="labels"]');
const chipsWidth = () =>
  (inRow('studio-item-api-name') ? API : 0) + (inRow('studio-detail-type') ? TYPE : 0) + (inRow('studio-detail-package') ? PACKAGE : 0);
const actionsWidth = () =>
  (screen.queryByTestId('studio-detail-pager') ? PAGER : 0) +
  (screen.queryByTestId('studio-detail-position') && labelsShown() ? POSITION : 0) +
  (screen.queryByTestId('probe-primary') ? PRIMARY : 0) +
  (screen.queryByTestId('studio-detail-more') ? MORE : 0);
const titleBox = () => Math.max(0, Math.min(TITLE_TEXT, layout.row - LEAD - ICON - chipsWidth() - STATUS - actionsWidth()));

function resizeRow(width: number) {
  layout.row = width;
  act(() => {
    for (const cb of resizeCallbacks) cb();
  });
}

describe('on a narrow row the fold follows StudioItemHeader’s rules', () => {
  beforeEach(() => {
    layout.row = 900;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly cb: () => void;
        constructor(cb: () => void) {
          this.cb = cb;
          resizeCallbacks.add(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          resizeCallbacks.delete(this.cb);
        }
      },
    );
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(() => rect(READABLE));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const id = this.dataset.testid;
      if (isRow(this)) return rect(layout.row);
      if (id === 'studio-item-api-name') return rect(API);
      if (id === 'studio-detail-type') return rect(TYPE);
      if (id === 'studio-detail-package') return rect(PACKAGE);
      if (id === 'studio-detail-close') return rect(LEAD);
      if (id === 'studio-item-status') return rect(STATUS);
      if (id === 'studio-detail-title') return rect(titleBox());
      if (this.hasAttribute('data-studio-fold-label')) return rect(labelsShown() ? POSITION : 1);
      if (this.parentElement && isRow(this.parentElement)) {
        if (this.dataset.slot === 'identity-chips') return rect(chipsWidth());
        if (this.tagName === 'SPAN') return rect(ICON);
        if (this.tagName === 'DIV') return rect(actionsWidth());
      }
      return realRect.call(this);
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      if (isRow(this)) return layout.row;
      if (this.dataset.testid === 'studio-detail-title') return titleBox();
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === 'studio-detail-title' ? TITLE_TEXT : 0;
    });
  });

  afterEach(() => {
    resizeCallbacks.clear();
    vi.unstubAllGlobals();
  });

  const actions = () => screen.getByTestId('studio-detail-title').parentElement!.lastElementChild as HTMLElement;

  it('wide (900 px): nothing folds — the chips, the position and the title are whole in the row', () => {
    render(<Header />);
    expect(inRow('studio-detail-type')).toBe(true);
    expect(inRow('studio-detail-package')).toBe(true);
    expect(inRow('studio-item-api-name')).toBe(true);
    expect(actions()).not.toHaveAttribute('data-fold');
    expect(titleBox()).toBe(TITLE_TEXT);
  });

  it('narrow (560 px): the identity chips leave for ⋯ first, the position keeps its text', () => {
    layout.row = 560;
    render(<Header />);
    // Whole: 560 − 32 − 32 − 220 − 30 − 206 = 40 px of title. Chips folded: 260 px.
    expect(screen.queryByTestId('studio-detail-type')).toBeNull();
    expect(screen.queryByTestId('studio-detail-package')).toBeNull();
    expect(actions()).not.toHaveAttribute('data-fold');
    expect(titleBox()).toBe(TITLE_TEXT);
    const menu = openMore();
    const entry = within(menu).getByTestId('studio-item-header-folded-chips');
    expect(within(entry).getByTestId('studio-detail-type')).toHaveTextContent('Object');
    expect(within(entry).getByTestId('studio-detail-package')).toHaveTextContent('CRM');
    expect(within(menu).getByTestId('probe-delete')).toBeInTheDocument();
  });

  it('narrower (380 px): then the position text leaves too, ‹ › stay, and the title keeps its readable width', () => {
    layout.row = 380;
    render(<Header />);
    expect(actions()).toHaveAttribute('data-fold', 'labels');
    expect(screen.getByTestId('studio-detail-previous')).toBeInTheDocument();
    expect(screen.getByTestId('studio-detail-next')).toBeInTheDocument();
    // The group keeps the position as its name while the text is out of the row.
    expect(screen.getByTestId('studio-detail-pager')).toHaveAccessibleName('Item 3 of 5');
    expect(titleBox()).toBeGreaterThanOrEqual(READABLE);
  });

  it('it follows the row: folds as it narrows, and gives everything back as it widens', () => {
    render(<Header />);
    resizeRow(380);
    expect(actions()).toHaveAttribute('data-fold', 'labels');
    expect(screen.queryByTestId('studio-detail-type')).toBeNull();
    resizeRow(900);
    expect(actions()).not.toHaveAttribute('data-fold');
    expect(inRow('studio-detail-type')).toBe(true);
  });

  it('without menu items of its own, the header draws its ⋯ only while the chips are folded', () => {
    layout.row = 560;
    render(<Header menu={undefined} />);
    const menu = openMore();
    expect(within(menu).getByTestId('studio-item-header-folded-chips')).toBeInTheDocument();
    cleanup();
    layout.row = 900;
    render(<Header menu={undefined} />);
    expect(screen.queryByTestId('studio-detail-more')).toBeNull();
  });
});
