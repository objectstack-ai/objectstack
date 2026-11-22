/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34605 — the section navigation of a stacked sectioned form, in
 * its two hosts: the record dialog (`ModalForm`, between the header and the
 * scrolling body) and the full-page form (`ObjectForm`, above the sections).
 *
 * The card's acceptance, row by row:
 *   1. a four-section form draws four entries under the dialog title, and the
 *      third scrolls to the third section;
 *   2. a required field left empty in section two, submitted, puts "1" on
 *      section two's entry;
 *   3. a form with one section draws no navigation.
 * Plus the card's rules: a section its `visibleWhen` hides is not listed, a
 * collapsed section unfolds before the jump, and a tabbed form gets none.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup, act } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { ObjectForm } from './ObjectForm';
import { FormSectionNav, JUMP_MARK_ATTR, JUMP_MARK_MS } from './FormSectionNav';

registerAllFields();

const ds: any = {
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'deal',
    fields: {
      name: { type: 'text', label: 'Deal Name' },
      amount: { type: 'number', label: 'Amount' },
      forecast: { type: 'text', label: 'Forecast Category', required: true },
      quarter: { type: 'text', label: 'Quarter' },
      budget: { type: 'text', label: 'Budget' },
      notes: { type: 'textarea', label: 'Notes' },
      stage: { type: 'text', label: 'Stage' },
    },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  update: vi.fn(),
  findOne: vi.fn(),
};

const FOUR_SECTIONS = [
  { name: 'overview', label: 'Overview', fields: ['name', 'amount'] },
  { name: 'forecast', label: 'Forecast', fields: ['forecast', 'quarter'] },
  { name: 'qualification', label: 'Qualification', fields: ['budget'] },
  { name: 'description', label: 'Description', fields: ['notes'] },
];

// A jump scrolls the form's own scroller (`scrollTo` on it, or on the window
// when nothing above the heading scrolls) and never calls an element
// `scrollIntoView`, which would scroll every scrollable ancestor too
// (objectstack#35092).
const scrollIntoView = vi.fn();
const elementScrollTo = vi.fn();
const windowScrollTo = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalElementScrollTo = Element.prototype.scrollTo;
const originalWindowScrollTo = window.scrollTo;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.scrollTo = elementScrollTo as typeof Element.prototype.scrollTo;
  window.scrollTo = windowScrollTo as typeof window.scrollTo;
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Element.prototype.scrollTo = originalElementScrollTo;
  window.scrollTo = originalWindowScrollTo;
  cleanup();
});

const rectAt = (top: number, height = 20) =>
  ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/**
 * The test DOM loads no stylesheet, so the dialog's Tailwind overflow classes
 * compute to nothing: give the form's scroller and the dialog box the
 * overflow their classes declare, and the scroller its box.
 */
function styleDialogScrollers(scrollerTop: number) {
  const scroller = document.querySelector('form')!.closest<HTMLElement>('.overflow-y-auto')!;
  scroller.style.overflowY = 'auto';
  scroller.getBoundingClientRect = () => rectAt(scrollerTop, 600);
  const dialog = scroller.closest<HTMLElement>('[role="dialog"]')!;
  dialog.style.overflowY = 'hidden';
  return scroller;
}

const heading = (sectionKey: string) =>
  document.querySelector<HTMLElement>(`[data-form-section="${sectionKey}"]`)!;

const renderModal = (extra: Record<string, unknown> = {}) =>
  render(
    <ModalForm
      schema={{
        type: 'object-form',
        formType: 'modal',
        objectName: 'deal',
        mode: 'create',
        open: true,
        title: 'New Deal',
        sections: FOUR_SECTIONS,
        ...extra,
      } as any}
      dataSource={ds}
    />,
  );

const nav = () => screen.queryByTestId('form-section-nav');

// A section's entry and heading row are keyed by its divider row's name,
// which `projectSectionDivider` derives from the section key.

describe('ModalForm section navigation (objectstack#34605)', () => {
  it('draws one entry per section between the title and the body, and a click scrolls to that section', async () => {
    renderModal();
    await waitFor(() => expect(nav()).not.toBeNull());

    const entries = within(nav()!).getAllByRole('button');
    expect(entries.map((b) => b.textContent)).toEqual(['Overview', 'Forecast', 'Qualification', 'Description']);
    // Outside the form and above its scroller: it stays in view while the body scrolls.
    expect(nav()!.closest('form')).toBeNull();
    const form = document.querySelector('form')!;
    expect(nav()!.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The first section is current before anything scrolls.
    expect(entries[0].getAttribute('aria-current')).toBe('true');

    // The scroll target is the third section's heading row — its stable DOM id.
    const target = heading('__section_qualification');
    expect(target.textContent).toContain('Qualification');
    const scroller = styleDialogScrollers(100);
    target.getBoundingClientRect = () => rectAt(460);

    fireEvent.click(entries[2]);

    // Only the form's scroller moves, by the heading's distance below its top
    // edge; the dialog box, its title and this navigation stay where they are.
    expect(elementScrollTo).toHaveBeenCalledTimes(1);
    expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
    expect(elementScrollTo).toHaveBeenCalledWith({ top: 360, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScrollTo).not.toHaveBeenCalled();
    expect(within(nav()!).getAllByRole('button')[2].getAttribute('aria-current')).toBe('true');
  });

  it('marks a section with a required field left empty once a submit is refused, and clears the mark when it is filled', async () => {
    renderModal();
    await waitFor(() => expect(nav()).not.toBeNull());
    expect(screen.queryByTestId('form-section-nav-count:__section_forecast')).toBeNull();

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() =>
      expect(screen.getByTestId('form-section-nav:__section_forecast').getAttribute('data-error')).toBe('true'),
    );
    const count = screen.getByTestId('form-section-nav-count:__section_forecast');
    expect(count.querySelector('[aria-hidden="true"]')!.textContent).toBe('· 1');
    expect(screen.getByTestId('form-section-nav:__section_overview').hasAttribute('data-error')).toBe(false);
    expect(ds.create).not.toHaveBeenCalled();

    fireEvent.change(document.querySelector('input[name="forecast"]')!, { target: { value: 'Commit' } });
    await waitFor(() => expect(screen.queryByTestId('form-section-nav-count:__section_forecast')).toBeNull());
  });

  it('draws no navigation for a form with one section', async () => {
    renderModal({ sections: [FOUR_SECTIONS[0]] });
    await waitFor(() => expect(document.body.textContent).toContain('Deal Name'));
    expect(nav()).toBeNull();
  });

  it('leaves out a section its visibleWhen hides, and lists it again when the predicate admits it', async () => {
    renderModal({
      sections: [
        FOUR_SECTIONS[0],
        { name: 'closing', label: 'Closing', fields: ['stage'] },
        { name: 'won', label: 'Won Details', fields: ['notes'], visibleWhen: "record.stage == 'won'" },
      ],
    });
    await waitFor(() => expect(nav()).not.toBeNull());
    expect(within(nav()!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Overview', 'Closing']);

    fireEvent.change(document.querySelector('input[name="stage"]')!, { target: { value: 'won' } });
    await waitFor(() =>
      expect(within(nav()!).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Overview',
        'Closing',
        'Won Details',
      ]),
    );
  });

  it('unfolds a collapsed section before scrolling to it', async () => {
    renderModal({
      sections: [
        FOUR_SECTIONS[0],
        { name: 'strategy', label: 'Strategy', fields: ['notes'], collapsible: true, collapsed: true },
      ],
    });
    await waitFor(() => expect(nav()).not.toBeNull());
    expect(document.querySelector('textarea[name="notes"]')).toBeNull();
    const scroller = styleDialogScrollers(100);
    heading('__section_strategy').getBoundingClientRect = () => rectAt(380);

    fireEvent.click(screen.getByTestId('form-section-nav:__section_strategy'));

    await waitFor(() => expect(document.querySelector('textarea[name="notes"]')).not.toBeNull());
    await waitFor(() => expect(elementScrollTo).toHaveBeenCalled());
    expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
    expect(elementScrollTo).toHaveBeenCalledWith({ top: 280, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('draws no navigation for a tabbed dialog, whose tab strip already switches groups', async () => {
    renderModal({ contentLayout: 'tabbed' });
    await waitFor(() => expect(screen.getByTestId('form-tab:forecast')).toBeTruthy());
    expect(nav()).toBeNull();
  });
});

describe('ObjectForm section navigation (objectstack#34605)', () => {
  it('draws the navigation above a full-page sectioned form', async () => {
    render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'deal', mode: 'create', sections: FOUR_SECTIONS } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(nav()).not.toBeNull());
    expect(within(nav()!).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Overview',
      'Forecast',
      'Qualification',
      'Description',
    ]);
    const form = document.querySelector('form')!;
    expect(nav()!.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Nothing above a full-page form scrolls here, so the jump scrolls the window.
    heading('__section_description').getBoundingClientRect = () => rectAt(900);
    fireEvent.click(screen.getByTestId('form-section-nav:__section_description'));
    expect(windowScrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'smooth' });
    expect(elementScrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#34819 — the highlight follows the scroll position, including a
 * scroll that lands inside the hold a click starts: a refused submit taking
 * the form back to its first error right after a jump left the highlight on
 * the section the click had picked.
 *
 * jsdom does no layout, so the scroller and its headings are a fixture whose
 * geometry the test sets: the scroller's box spans 100..700, each heading sits
 * at its offset in the content minus `scrollTop`.
 */
const VIEW_TOP = 100;
const VIEW_HEIGHT = 600;

function mountFixture(offsets: number[], initialContentHeight: number, collapsedKeys: string[] = []) {
  const keys = offsets.map((_, i) => `s${i}`);
  let scrollTop = 0;
  let contentHeight = initialContentHeight;
  const expanded: string[] = [];
  const host = render(
    <div data-testid="fixture-dialog" style={{ overflowY: 'hidden' }}>
      <FormSectionNav
        items={keys.map((key, i) => ({
          key,
          label: `Section ${i}`,
          anchorId: `anchor-${key}`,
          errorCount: 0,
          collapsed: collapsedKeys.includes(key),
          expand: () => {
            expanded.push(key);
          },
        }))}
      />
      <div data-testid="fixture-scroller" style={{ overflowY: 'auto' }}>
        {keys.map((key) => (
          <div key={key} id={`anchor-${key}`} />
        ))}
      </div>
    </div>,
  );
  const scroller = screen.getByTestId('fixture-scroller');
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  scroller.getBoundingClientRect = () => rect(VIEW_TOP, VIEW_HEIGHT);
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEW_HEIGHT });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => contentHeight });
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => scrollTop });
  keys.forEach((key, i) => {
    document.getElementById(`anchor-${key}`)!.getBoundingClientRect = () => rect(VIEW_TOP + offsets[i] - scrollTop, 20);
  });
  /** Move the scroller and let the spy's frame run. */
  const scrollTo = (top: number) => {
    scrollTop = top;
    act(() => {
      fireEvent.scroll(scroller);
      vi.advanceTimersToNextFrame();
    });
  };
  const highlighted = () =>
    within(host.container.querySelector('[data-testid="form-section-nav"]') as HTMLElement)
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-current') === 'true')
      ?.textContent;
  /** Grow or shrink the content, as a section unfolding does. */
  const setContentHeight = (height: number) => {
    contentHeight = height;
  };
  return { scrollTo, highlighted, scroller, setContentHeight, expanded };
}

describe('FormSectionNav highlight follows the scroll position after a click (objectstack#34819)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('follows a scroll back to the top that lands inside the click hold, once the hold ends', () => {
    const { scrollTo, highlighted } = mountFixture([0, 600, 1200, 1800], 2400);
    fireEvent.click(screen.getByTestId('form-section-nav:s2'));
    scrollTo(1200);
    expect(highlighted()).toBe('Section 2');

    // The refused submit's scroll back to the first error, inside the hold.
    scrollTo(0);
    expect(highlighted()).toBe('Section 2');

    act(() => {
      vi.advanceTimersByTime(800);
      vi.advanceTimersToNextFrame();
    });
    expect(highlighted()).toBe('Section 0');
  });

  it('follows a scroll back to the top that comes after the hold', () => {
    const { scrollTo, highlighted } = mountFixture([0, 600, 1200, 1800], 2400);
    fireEvent.click(screen.getByTestId('form-section-nav:s2'));
    scrollTo(1200);
    act(() => {
      vi.advanceTimersByTime(800);
      vi.advanceTimersToNextFrame();
    });
    expect(highlighted()).toBe('Section 2');

    scrollTo(0);
    expect(highlighted()).toBe('Section 0');
  });

  it('CONTROL: the jump a click starts does not move the highlight through the sections it passes', () => {
    const { scrollTo, highlighted } = mountFixture([0, 600, 1200, 1800], 2400);
    fireEvent.click(screen.getByTestId('form-section-nav:s2'));
    const seen: Array<string | undefined> = [highlighted()];
    for (const top of [150, 450, 700, 950, 1200]) {
      scrollTo(top);
      seen.push(highlighted());
    }
    act(() => {
      vi.advanceTimersByTime(800);
      vi.advanceTimersToNextFrame();
    });
    seen.push(highlighted());
    expect(new Set(seen)).toEqual(new Set(['Section 2']));
  });

  it('CONTROL: at the bottom of a short tail, the section the click picked keeps the highlight when the hold ends', () => {
    // Content 1900 high in a 600 box: the deepest scroll is 1300, where the
    // third heading (1350) sits in view below the top edge, the fourth too.
    const { scrollTo, highlighted } = mountFixture([0, 600, 1350, 1700], 1900);
    fireEvent.click(screen.getByTestId('form-section-nav:s2'));
    scrollTo(1300);
    act(() => {
      vi.advanceTimersByTime(800);
      vi.advanceTimersToNextFrame();
    });
    expect(highlighted()).toBe('Section 2');

    // Scrolled there by hand, the bottom still reads as the last section.
    scrollTo(400);
    expect(highlighted()).toBe('Section 0');
    scrollTo(1300);
    expect(highlighted()).toBe('Section 3');
  });
});

/**
 * objectstack#35092 — a click scrolls the form's own scroller and nothing
 * else. An element `scrollIntoView` also scrolls every scrollable ancestor,
 * the `overflow: hidden` dialog box included; when the form's scroller cannot
 * bring a short last section to its top, the rest of the distance moved the
 * dialog box and took its title and this navigation out of view.
 *
 * Layout-free here: the fixture's scroller sits in an `overflow: hidden` box,
 * and the pin is which element is asked to scroll, and how far. The geometry
 * (the dialog box's `scrollTop` staying 0 in a real browser) is pinned by
 * `ui/e2e/form-section-nav-dialog-scroll-35092.spec.ts`.
 */
describe('FormSectionNav jump scrolls only the form scroller (objectstack#35092)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrolls the form scroller by the heading's distance below its top edge, and never calls an element scrollIntoView", () => {
    const { scrollTo, scroller } = mountFixture([0, 600, 1200, 1800], 2400);
    scrollTo(300);

    fireEvent.click(screen.getByTestId('form-section-nav:s3'));

    expect(elementScrollTo).toHaveBeenCalledTimes(1);
    expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
    // Content offset 1800, whatever the scroller's current position.
    expect(elementScrollTo).toHaveBeenCalledWith({ top: 1800, behavior: 'smooth' });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it("keeps the heading's scroll margin, as scrollIntoView did", () => {
    const { scroller } = mountFixture([0, 600, 1200, 1800], 2400);
    document.getElementById('anchor-s2')!.style.scrollMarginTop = '8px';

    fireEvent.click(screen.getByTestId('form-section-nav:s2'));

    expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
    expect(elementScrollTo).toHaveBeenCalledWith({ top: 1192, behavior: 'smooth' });
  });

  it('a short last section asks for more than the scroller holds, and still only the scroller is asked', () => {
    // Content 1900 high in a 600 box: the deepest scroll is 1300, short of
    // the last heading (1700). The browser clamps the scroller; nothing hands
    // the remainder to an ancestor.
    const { scroller } = mountFixture([0, 600, 1350, 1700], 1900);

    fireEvent.click(screen.getByTestId('form-section-nav:s3'));

    expect(elementScrollTo).toHaveBeenCalledTimes(1);
    expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScrollTo).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#35472 — the bar is a jump bar, and every click on it shows where
 * it went. A dialog derived from an object's field groups drew the bar over
 * all sections stacked; when they fit, a click had nothing to scroll and only
 * the highlight moved, which read as tabs that do not switch.
 *
 * Two pins: (1) with nothing to scroll there is no bar, and the bar comes back
 * when the content outgrows the scroller; (2) a click marks the heading it
 * jumped to for a moment, so a jump to a heading already in view still shows.
 *
 * The test DOM does no layout and its `ResizeObserver` is a no-op: the boxes
 * are given their heights, and a recording observer stands in, so the test
 * says when the sizes changed.
 */
describe('FormSectionNav is a jump bar: hidden when the sections fit, a click marks its section (objectstack#35472)', () => {
  let resizeCallbacks: Array<() => void> = [];
  class RecordingResizeObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      resizeCallbacks = resizeCallbacks.filter((c) => c !== this.callback);
    }
  }
  const resized = () => act(() => resizeCallbacks.forEach((c) => c()));

  beforeEach(() => {
    resizeCallbacks = [];
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('a fixture scroller', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('draws no bar while the sections fit the scroller, and draws it once they outgrow it', () => {
      // Two short sections in a 600 box: nothing to scroll.
      const { setContentHeight } = mountFixture([0, 200], 400);
      resized();
      expect(nav()).toBeNull();

      // A section unfolds and the content outgrows the box.
      setContentHeight(1400);
      resized();
      expect(nav()).not.toBeNull();
      expect(within(nav()!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Section 0', 'Section 1']);

      setContentHeight(600);
      resized();
      expect(nav()).toBeNull();
    });

    it('a click marks the heading it jumped to for a moment, even one already in view', () => {
      const { scroller } = mountFixture([0, 300, 1200, 1800], 2400);
      resized();
      const anchor = (key: string) => document.getElementById(`anchor-${key}`)!;

      // s1's heading (300) is already inside the 600 box.
      fireEvent.click(screen.getByTestId('form-section-nav:s1'));
      expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
      expect(anchor('s1').hasAttribute(JUMP_MARK_ATTR)).toBe(true);

      // A second jump moves the mark: one section is marked at a time.
      fireEvent.click(screen.getByTestId('form-section-nav:s3'));
      expect(anchor('s1').hasAttribute(JUMP_MARK_ATTR)).toBe(false);
      expect(anchor('s3').hasAttribute(JUMP_MARK_ATTR)).toBe(true);

      act(() => {
        vi.advanceTimersByTime(JUMP_MARK_MS);
      });
      expect(anchor('s3').hasAttribute(JUMP_MARK_ATTR)).toBe(false);
    });

    it('CONTROL: a trailing collapsed section stays folded until its own entry is clicked, then unfolds and is marked', () => {
      const { expanded } = mountFixture([0, 600, 1200], 2400, ['s2']);
      resized();
      fireEvent.click(screen.getByTestId('form-section-nav:s1'));
      expect(expanded).toEqual([]);

      fireEvent.click(screen.getByTestId('form-section-nav:s2'));
      expect(expanded).toEqual(['s2']);
      // The jump waits a frame for the unfolded fields to mount.
      act(() => {
        vi.advanceTimersToNextFrame();
      });
      expect(document.getElementById('anchor-s2')!.hasAttribute(JUMP_MARK_ATTR)).toBe(true);
    });
  });

  describe('the record dialog', () => {
    /** The dialog's form scroller, given a box and content of its own. */
    const sizeScroller = (clientHeight: number, scrollHeight: number) => {
      const scroller = styleDialogScrollers(100);
      Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => clientHeight });
      Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => scrollHeight });
      return scroller;
    };
    const header = () => document.querySelector<HTMLElement>('[role="dialog"] h2')!.parentElement!;

    it('draws no bar when every section fits the body, and the header keeps its own separator', async () => {
      renderModal();
      await waitFor(() => expect(nav()).not.toBeNull());
      // With the bar drawn, the bar is the separator under the header.
      await waitFor(() => expect(header().classList.contains('border-b')).toBe(false));

      sizeScroller(600, 420);
      resized();
      expect(nav()).toBeNull();
      expect(header().classList.contains('border-b')).toBe(true);
      // Every section is still drawn, stacked.
      for (const key of ['overview', 'forecast', 'qualification', 'description']) {
        expect(heading(`__section_${key}`)).not.toBeNull();
      }
    });

    it('draws the bar when the sections overflow the body, and a click scrolls and marks the section', async () => {
      renderModal();
      await waitFor(() => expect(nav()).not.toBeNull());
      const scroller = sizeScroller(600, 1500);
      resized();
      expect(nav()).not.toBeNull();
      heading('__section_qualification').getBoundingClientRect = () => rectAt(460);

      fireEvent.click(screen.getByTestId('form-section-nav:__section_qualification'));

      expect(elementScrollTo.mock.contexts[0]).toBe(scroller);
      expect(elementScrollTo).toHaveBeenCalledWith({ top: 360, behavior: 'smooth' });
      expect(heading('__section_qualification').hasAttribute(JUMP_MARK_ATTR)).toBe(true);
    });

    it('CONTROL: an authored tabbed dialog keeps its tab strip, which switches the panel, and draws no bar', async () => {
      renderModal({ contentLayout: 'tabbed' });
      await waitFor(() => expect(screen.getByTestId('form-tab:forecast')).toBeTruthy());
      expect(nav()).toBeNull();
      expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
        'Overview',
        'Forecast',
        'Qualification',
        'Description',
      ]);
      const panel = (key: string) => screen.getByTestId(`form-tab-panel:${key}`).getAttribute('data-state');
      expect(panel('overview')).toBe('active');
      // Radix tabs activate on the pointer press.
      fireEvent.mouseDown(screen.getByTestId('form-tab:forecast'), { button: 0, ctrlKey: false });
      await waitFor(() => expect(panel('forecast')).toBe('active'));
      expect(panel('overview')).toBe('inactive');
    });
  });
});
