// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12611 — the Studio item header at a narrow content column (1024 px
 * with the rail and an aside open). The row gives way in one order: the meta
 * slot first, then the status chip's text (its pencil and its tooltip stay),
 * and the title truncates last; the tab row never wraps a label, scrolls
 * sideways with a fade on the edge that has more tabs, and brings the active
 * tab into view.
 *
 * jsdom has no layout, so the widths are read in a browser (the pull request
 * carries the readings); this file pins the contract that produces them: the
 * row is the container, the classes that fold each slot sit on that slot and
 * on nothing else, the DOM order the folding relies on, the tab row's
 * one-line classes and scroll container, the fade attribute the scroll
 * position drives, and the active tab's `scrollIntoView`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workflow } from 'lucide-react';
import { StudioItemHeader, StudioStatusChip, StudioTab } from './StudioItemHeader';
import {
  STUDIO_ITEM_META_FOLD,
  STUDIO_ITEM_ROW,
  STUDIO_STATUS_TEXT_FOLD,
  STUDIO_TAB,
  STUDIO_TAB_ROW,
} from './studio-tokens';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The card's 26-character flow title. */
const TITLE = 'Enroll Members in Campaign';
const STATUS = { label: 'Unpublished draft', title: 'Edits save as drafts until the package is published.' };

function Header({ active = 'canvas' }: { active?: string }) {
  return (
    <StudioItemHeader
      testId="hdr"
      icon={Workflow}
      title={TITLE}
      titleProps={{ 'data-testid': 'hdr-title' }}
      status={STATUS}
      meta={<span data-testid="hdr-meta">Trigger: screen · Status: Enabled</span>}
      actions={<button type="button">Enabled</button>}
      tabs={
        <>
          {['canvas', 'variables', 'runs', 'problems', 'debug'].map((key) => (
            <StudioTab key={key} active={active === key} data-testid={`tab-${key}`}>
              {key}
            </StudioTab>
          ))}
        </>
      }
    />
  );
}

const classesOf = (token: string) => token.split(' ');

describe('the item header gives way in order on a narrow column (objectui#12611)', () => {
  it('the title row is the container, and its slots sit title, identity, status, meta, actions', () => {
    render(<Header />);
    const title = screen.getByTestId('hdr-title');
    const row = title.parentElement as HTMLElement;
    expect(row).toHaveClass(...classesOf(STUDIO_ITEM_ROW));
    expect(row).toHaveClass('@container');
    // The header itself is not a container: the tab row under it holds the
    // Data pillar's own fold, which measures the content column.
    expect(screen.getByTestId('hdr')).not.toHaveClass('@container');

    const kids = Array.from(row.children);
    const at = (el: Element | null) => kids.indexOf(el as Element);
    const status = screen.getByTestId('studio-item-status');
    const meta = screen.getByTestId('hdr-meta').parentElement;
    expect(at(title)).toBeLessThan(at(row.querySelector('[data-slot="identity-chips"]')));
    expect(at(row.querySelector('[data-slot="identity-chips"]'))).toBeLessThan(at(status));
    expect(at(status)).toBeLessThan(at(meta));
    expect(at(meta)).toBeLessThan(kids.length - 1);
  });

  it('the meta slot folds first: hidden below the row width, and while it shows it takes only the room left', () => {
    render(<Header />);
    const meta = screen.getByTestId('hdr-meta').parentElement as HTMLElement;
    expect(meta).toHaveClass(...classesOf(STUDIO_ITEM_META_FOLD));
    expect(STUDIO_ITEM_META_FOLD).toMatch(/^hidden /);
    expect(STUDIO_ITEM_META_FOLD).toContain('@min-[640px]:block');
    // A zero basis: the meta never puts the row short, so the title never shrinks for it.
    expect(meta).toHaveClass('basis-0', 'grow', 'min-w-0', 'truncate');
  });

  it('the status chip keeps its pencil; its text folds into the accessible name and the tooltip', async () => {
    render(<Header />);
    const chip = screen.getByTestId('studio-item-status');
    expect(chip.querySelector('svg')).not.toBeNull();
    const text = chip.querySelector('[data-slot="status-text"]') as HTMLElement;
    expect(text).toHaveTextContent(STATUS.label);
    expect(text).toHaveClass(...classesOf(STUDIO_STATUS_TEXT_FOLD));
    // `sr-only`, not `hidden`: a folded chip still says what it is.
    expect(STUDIO_STATUS_TEXT_FOLD).toBe('sr-only @min-[480px]:not-sr-only');
    // The chip's own text is its label alone (objectui#12524 reads it).
    expect(chip.textContent).toBe(STATUS.label);
    // The longer sentence is its description, and the tooltip holds both.
    expect(chip).toHaveAccessibleDescription(STATUS.title);
    expect(chip).toHaveAttribute('tabindex', '0');
    await userEvent.setup().hover(chip);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(STATUS.label);
    expect(tip).toHaveTextContent(STATUS.title);
  });

  it('CONTROL — the chip outside a header row does not fold its text', () => {
    render(<StudioStatusChip label={STATUS.label} />);
    const text = screen.getByTestId('studio-item-status').querySelector('[data-slot="status-text"]');
    expect(text).not.toHaveClass('sr-only');
    expect(text?.className ?? '').not.toContain('@min-');
  });

  it('the title folds last: it carries no hiding class and keeps its whole text', () => {
    render(<Header />);
    const title = screen.getByTestId('hdr-title');
    expect(title.textContent).toBe(TITLE);
    expect(TITLE).toHaveLength(26);
    expect(title).toHaveClass('min-w-0', 'truncate');
    expect(title).not.toHaveClass('hidden');
    expect(title.className).not.toMatch(/@min-|shrink-\[/);
  });
});

describe('the tab row never wraps (objectui#12611)', () => {
  it('one line: every tab keeps its label on one line, and the row scrolls sideways with no scrollbar', () => {
    render(<Header />);
    const nav = screen.getByTestId('tab-canvas').parentElement as HTMLElement;
    expect(nav.tagName).toBe('NAV');
    expect(nav).toHaveClass(...classesOf(STUDIO_TAB_ROW));
    expect(nav).toHaveClass('flex', 'overflow-x-auto', 'overflow-y-hidden', '[scrollbar-width:none]');
    for (const key of ['canvas', 'variables', 'runs', 'problems', 'debug']) {
      const tab = screen.getByTestId(`tab-${key}`);
      expect(tab).toHaveClass(...classesOf(STUDIO_TAB));
      expect(tab).toHaveClass('whitespace-nowrap', 'shrink-0');
    }
  });

  it('fades the edge that has tabs past it, from the scroll position', () => {
    render(<Header />);
    const nav = screen.getByTestId('tab-canvas').parentElement as HTMLElement;
    // jsdom lays nothing out: every width reads 0, so nothing overflows.
    expect(nav).toHaveAttribute('data-fade', 'none');

    let scrollLeft = 0;
    Object.defineProperty(nav, 'scrollWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(nav, 'clientWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(nav, 'scrollLeft', { configurable: true, get: () => scrollLeft });
    act(() => {
      fireEvent.scroll(nav);
    });
    expect(nav).toHaveAttribute('data-fade', 'end');
    scrollLeft = 100;
    act(() => {
      fireEvent.scroll(nav);
    });
    expect(nav).toHaveAttribute('data-fade', 'both');
    scrollLeft = 200;
    act(() => {
      fireEvent.scroll(nav);
    });
    expect(nav).toHaveAttribute('data-fade', 'start');
    for (const fade of ['start', 'end', 'both']) {
      expect(STUDIO_TAB_ROW).toContain(`data-[fade=${fade}]:[mask-image:`);
    }
  });

  it('the tab that becomes active scrolls itself into view, and only that one', () => {
    const calls: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = vi.fn(function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      calls.push(this);
      expect(arg).toEqual({ block: 'nearest', inline: 'nearest' });
    });
    try {
      const { rerender } = render(<Header active="canvas" />);
      expect(calls).toEqual([screen.getByTestId('tab-canvas')]);
      rerender(<Header active="debug" />);
      expect(calls).toEqual([screen.getByTestId('tab-canvas'), screen.getByTestId('tab-debug')]);
      // A re-render that changes nothing scrolls nothing.
      rerender(<Header active="debug" />);
      expect(calls).toHaveLength(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('CONTROL — a ref forwarded to a tab still reaches the button (a menu trigger wraps it)', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <StudioTab ref={ref} data-testid="t">
        x
      </StudioTab>,
    );
    expect(ref.current).toBe(screen.getByTestId('t'));
  });
});
