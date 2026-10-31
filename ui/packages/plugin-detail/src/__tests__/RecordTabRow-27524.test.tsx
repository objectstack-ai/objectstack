/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524, Target 8 — the record page's tab row as drawn: its
 * visible count follows its own width and is recomputed on a resize, the
 * active tab is always on it, the 「+N ▾」 dropdown lists the rest with their
 * counts and the hidden panels' tabs at its end, and the row is one tab stop.
 *
 * jsdom has no layout engine, so the widths are given: each measured tab
 * answers its width from `WIDTHS`, the trigger `MORE`, the row `rowWidth`;
 * the ResizeObserver is a stub the test fires. The rule itself is pinned in
 * `synth/__tests__/recordTabRow-27524.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordTabRow, RECORD_TAB_OVERVIEW, type RecordTab } from '../RecordTabRow';

const TABS: RecordTab[] = [
  { id: RECORD_TAB_OVERVIEW, label: 'Overview' },
  { id: 'timeline', label: 'Activity', count: 14 },
  { id: 'task.lead_id', label: 'Tasks', count: 2 },
  { id: 'event.lead_id', label: 'Events', count: 1 },
  { id: 'campaign_member.lead_id', label: 'Campaign members', count: 1 },
  { id: 'attendee.lead_id', label: 'Attendees', count: 0 },
];
const HIDDEN: RecordTab[] = [{ id: 'duplicate.lead_id', label: 'Duplicates', count: 0 }];
const WIDTHS = [60, 70, 60, 60, 120, 100];
const MORE = 40;

let rowWidth = 2000;
let observers: Array<() => void> = [];

beforeEach(() => {
  rowWidth = 2000;
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      observe() {
        observers.push(this.cb);
      }
      unobserve() {}
      disconnect() {
        observers = observers.filter((cb) => cb !== this.cb);
      }
    },
  );
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    let width = 0;
    if (this.hasAttribute('data-record-tab-row')) width = rowWidth;
    else if (this.hasAttribute('data-record-tab-measure-more')) width = MORE;
    else if (this.hasAttribute('data-record-tab-measure')) {
      width = WIDTHS[Array.from(this.parentElement!.querySelectorAll('[data-record-tab-measure]')).indexOf(this)] ?? 0;
    }
    return { width, height: 36, top: 0, left: 0, right: width, bottom: 36, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const shownIds = () => Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('data-record-tab'));
const more = () => document.querySelector('[data-record-tab-more]');
const resizeTo = (width: number) => {
  rowWidth = width;
  act(() => observers.forEach((cb) => cb()));
};

describe('RecordTabRow (objectstack#27524, Target 8)', () => {
  it('the visible count follows the row width, recomputed on resize', () => {
    render(<RecordTabRow tabs={TABS} activeId={RECORD_TAB_OVERVIEW} onSelect={vi.fn()} />);
    // Wide: every tab, no dropdown.
    expect(shownIds()).toEqual(TABS.map((tab) => tab.id));
    expect(more()).toBeNull();
    // Medium (budget 480 - 40 - 16 = 424): Overview · Activity · Tasks · Events, then +2.
    resizeTo(480);
    expect(shownIds()).toEqual(['overview', 'timeline', 'task.lead_id', 'event.lead_id']);
    expect(more()?.textContent).toBe('+2');
    // Narrow: Overview and one more.
    resizeTo(200);
    expect(shownIds()).toEqual(['overview', 'timeline']);
    expect(more()?.textContent).toBe('+4');
  });

  it('the active tab is always on the row, in the last slot when it would have folded', () => {
    rowWidth = 480;
    render(<RecordTabRow tabs={TABS} activeId="campaign_member.lead_id" onSelect={vi.fn()} />);
    expect(shownIds()).toEqual(['overview', 'timeline', 'task.lead_id', 'campaign_member.lead_id']);
    const active = document.querySelector('[aria-selected="true"]')!;
    expect(active.getAttribute('data-record-tab')).toBe('campaign_member.lead_id');
    expect(active.getAttribute('tabindex')).toBe('0');
    // Narrow: Overview and the active tab.
    resizeTo(200);
    expect(shownIds()).toEqual(['overview', 'campaign_member.lead_id']);
  });

  it('each tab carries its count; a tab with no known count draws no chip', () => {
    render(<RecordTabRow tabs={[...TABS.slice(0, 2), { id: 'x.y', label: 'Pending' }]} activeId="overview" onSelect={vi.fn()} />);
    const chip = (id: string) => document.querySelector(`[role="tab"][data-record-tab="${id}"] [data-record-tab-count]`);
    expect(chip('timeline')?.textContent).toBe('14');
    expect(chip('overview')).toBeNull();
    expect(chip('x.y')).toBeNull();
  });

  it('「+N ▾」 lists the folded tabs with their counts, then the hidden panels\' tabs; choosing one selects it', async () => {
    rowWidth = 480;
    const onSelect = vi.fn();
    render(<RecordTabRow tabs={TABS} hiddenTabs={HIDDEN} activeId="overview" onSelect={onSelect} />);
    expect(more()?.textContent).toBe('+3');
    const user = userEvent.setup();
    await user.click(more()!);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('data-record-tab-menu-item'))).toEqual([
      'campaign_member.lead_id',
      'attendee.lead_id',
      'duplicate.lead_id',
    ]);
    expect(items.map((item) => item.querySelector('[data-record-tab-count]')?.textContent)).toEqual(['1', '0', '0']);
    expect(items[2].hasAttribute('data-record-tab-hidden')).toBe(true);
    await user.click(items[0]);
    expect(onSelect).toHaveBeenCalledWith('campaign_member.lead_id');
  });

  it('a hidden panel makes the dropdown even on a wide row', () => {
    render(<RecordTabRow tabs={TABS} hiddenTabs={HIDDEN} activeId="overview" onSelect={vi.fn()} />);
    expect(shownIds()).toEqual(TABS.map((tab) => tab.id));
    expect(more()?.textContent).toBe('+1');
  });

  it('clicking a tab selects it; the active tab does nothing', () => {
    const onSelect = vi.fn();
    render(<RecordTabRow tabs={TABS} activeId="task.lead_id" onSelect={onSelect} />);
    fireEvent.click(document.querySelector('[data-record-tab="task.lead_id"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('[data-record-tab="overview"]')!);
    expect(onSelect).toHaveBeenCalledWith('overview');
  });

  it('is one tab stop: ← → Home End move the focus between the shown tabs', () => {
    render(<RecordTabRow tabs={TABS.slice(0, 3)} activeId="timeline" onSelect={vi.fn()} />);
    const tab = (id: string) => document.querySelector(`[data-record-tab="${id}"]`) as HTMLButtonElement;
    expect(Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    act(() => tab('timeline').focus());
    fireEvent.keyDown(tab('timeline'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('task.lead_id'));
    fireEvent.keyDown(tab('task.lead_id'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('overview'));
    fireEvent.keyDown(tab('overview'), { key: 'End' });
    expect(document.activeElement).toBe(tab('task.lead_id'));
    fireEvent.keyDown(tab('task.lead_id'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('overview'));
    fireEvent.keyDown(tab('overview'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('task.lead_id'));
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Record tabs');
  });
});
