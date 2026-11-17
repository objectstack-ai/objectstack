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
import { FormSectionNav } from './FormSectionNav';

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

const scrollIntoView = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  cleanup();
});

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

    fireEvent.click(entries[2]);

    // The scroll target is the third section's heading row — its stable DOM id.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const target = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(target.getAttribute('data-form-section')).toBe('__section_qualification');
    expect(target.textContent).toContain('Qualification');
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

    fireEvent.click(screen.getByTestId('form-section-nav:__section_strategy'));

    await waitFor(() => expect(document.querySelector('textarea[name="notes"]')).not.toBeNull());
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect((scrollIntoView.mock.contexts[0] as HTMLElement).getAttribute('data-form-section')).toBe('__section_strategy');
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

    fireEvent.click(screen.getByTestId('form-section-nav:__section_description'));
    expect((scrollIntoView.mock.contexts[0] as HTMLElement).getAttribute('data-form-section')).toBe('__section_description');
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
describe('FormSectionNav highlight follows the scroll position after a click (objectstack#34819)', () => {
  const VIEW_TOP = 100;
  const VIEW_HEIGHT = 600;

  function mountFixture(offsets: number[], contentHeight: number) {
    const keys = offsets.map((_, i) => `s${i}`);
    let scrollTop = 0;
    const host = render(
      <div>
        <FormSectionNav
          items={keys.map((key, i) => ({
            key,
            label: `Section ${i}`,
            anchorId: `anchor-${key}`,
            errorCount: 0,
            collapsed: false,
            expand: () => {},
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
    return { scrollTo, highlighted };
  }

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
