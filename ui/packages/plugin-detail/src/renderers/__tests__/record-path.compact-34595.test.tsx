/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:path` below `sm` is the COMPACT path (objectstack#34595).
 *
 * Measured on an opportunity at 375 px: seven equal shares cut every stage
 * name to its first letters ("Pr… Q… Ne… Pr…"), so the path could not say
 * where the record stood. Below `sm` the path now draws one rail segment per
 * stage with no names, then one summary line — "Step N of M" (the form's
 * `stepOf` copy) and the current stage's full name — and that line opens the
 * list of every stage by its full name.
 *
 * The test DOM resolves no Tailwind, so this file reads class tokens and
 * attributes; the geometry is pinned in Chromium by
 * `e2e/record-path-phone-row.spec.ts`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, fireEvent, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

afterEach(() => cleanup());

/** The opportunity's path as the CRM seed draws it: five open steps, then won, then lost. */
const OPPORTUNITY_STAGES = [
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'qualification', label: 'Qualification' },
  { value: 'needs_analysis', label: 'Needs Analysis' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'closed_won', label: 'Closed Won', terminal: 'won' },
  { value: 'closed_lost', label: 'Closed Lost', terminal: 'lost' },
];

function mount(stage: string, language?: string): RenderResult {
  const tree = (
    <RecordContextProvider objectName="opportunity" recordId="o1" data={{ id: 'o1', stage }}>
      <RecordPathRenderer schema={{ statusField: 'stage', stages: OPPORTUNITY_STAGES } as never} />
    </RecordContextProvider>
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{tree}</I18nProvider>
    ) : (
      tree
    ),
  );
}

const compactOf = (r: RenderResult): HTMLElement =>
  r.container.querySelector('[data-record-path-compact]') as HTMLElement;
const summaryOf = (r: RenderResult): HTMLElement =>
  within(compactOf(r)).getByRole('button', { expanded: false }) as HTMLElement;
const listOf = (r: RenderResult): HTMLElement =>
  compactOf(r).querySelector('[data-record-path-stage-list]') as HTMLElement;
const railsOf = (r: RenderResult): HTMLElement[] =>
  Array.from(compactOf(r).querySelectorAll('[data-record-path-rails] > [data-stage-rail]')) as HTMLElement[];
const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);
const textOf = (el: Element): string => (el.textContent ?? '').replace(/[✓✗]/g, '').trim();

describe('record:path below `sm` is the compact path (objectstack#34595)', () => {
  it('is drawn below `sm` (and in a path narrower than `@sm`, objectstack#34696), beside the desktop rail', () => {
    const r = mount('negotiation');
    expect(tokens(compactOf(r))).toContain('sm:@sm:hidden');
    const desktop = r.container.querySelector('[role="list"]') as HTMLElement;
    expect(tokens(desktop)).toEqual(expect.arrayContaining(['hidden', 'sm:@sm:flex']));
    expect(compactOf(r).contains(desktop)).toBe(false);
  });

  it('draws one rail segment per stage, no names on them, as one decorative bar', () => {
    const r = mount('negotiation');
    const bar = compactOf(r).querySelector('[data-record-path-rails]') as HTMLElement;
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    const rails = railsOf(r);
    expect(rails).toHaveLength(OPPORTUNITY_STAGES.length);
    expect(rails.every((rail) => textOf(rail) === '')).toBe(true);
    expect(rails.map((rail) => rail.getAttribute('data-stage-state'))).toEqual([
      'completed', 'completed', 'completed', 'completed', 'current', 'upcoming', 'upcoming',
    ]);
    expect(rails[6]).toHaveAttribute('data-stage-terminal', 'lost');
    for (const rail of rails) expect(tokens(rail)).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
  });

  it('reads the current stage\'s full name and its step, counted over the forward stages', () => {
    const r = mount('negotiation');
    const summary = summaryOf(r);
    // Six forward stages (the five open ones and the won terminus); the lost
    // stage stands apart, as on the desktop rail.
    expect(textOf(summary)).toBe('Step 5 of 6·Negotiation');
    expect(within(summary).getByText('Negotiation')).toHaveClass('[overflow-wrap:anywhere]');
    expect(within(summary).getByText('Negotiation')).not.toHaveClass('truncate');
  });

  it('says the step in the session language through the existing `form.stepOf` copy', () => {
    const r = mount('negotiation', 'zh');
    expect(textOf(summaryOf(r))).toBe('第 5 步，共 6 步·Negotiation');
  });

  it('tapping the summary opens every stage by its full name, and tapping again closes it', () => {
    const r = mount('negotiation');
    const summary = summaryOf(r);
    const list = listOf(r);
    // The list follows its button; no generated id, so a render is stable.
    expect(summary.nextElementSibling).toBe(list);
    expect(list).not.toHaveAttribute('id');
    expect(tokens(list)).toContain('hidden');

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(tokens(list)).toContain('flex');
    expect(tokens(list)).not.toContain('hidden');
    const items = within(list).getAllByRole('listitem');
    expect(items.map(textOf)).toEqual(OPPORTUNITY_STAGES.map((s) => s.label));
    expect(items[4]).toHaveAttribute('aria-current', 'step');
    for (const item of items) {
      const label = item.querySelector(':scope > span:not([data-stage-rail])') as HTMLElement;
      expect(tokens(label)).toContain('[overflow-wrap:anywhere]');
      expect(tokens(label)).not.toContain('truncate');
    }

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(tokens(list)).toContain('hidden');
  });

  it('a record standing on the lost stage shows that stage, marked lost, and no step', () => {
    const r = mount('closed_lost');
    const summary = summaryOf(r);
    expect(textOf(summary)).toBe('Closed Lost');
    expect(within(summary).getByText('Closed Lost')).toHaveClass('text-destructive');
    expect(summary.textContent).not.toMatch(/Step/);
  });

  it('a record standing on no stage names the path, with no step', () => {
    const r = mount('not_a_stage');
    expect(textOf(summaryOf(r))).toBe('Record path');
  });

  it('CONTROL: the desktop rail is unchanged — every stage named on the rail, the ordinary label truncated', () => {
    const r = mount('negotiation');
    const desktop = r.container.querySelector('[role="list"]') as HTMLElement;
    const items = within(desktop).getAllByRole('listitem');
    expect(items.map(textOf)).toEqual(OPPORTUNITY_STAGES.map((s) => s.label));
    const negotiation = items[4].querySelector(':scope > span:not([data-stage-rail])') as HTMLElement;
    expect(tokens(negotiation)).toContain('truncate');
    expect(within(desktop).queryByRole('button')).toBeNull();
  });
});

describe('record:path picks its row by the viewport AND its own width (objectstack#34696)', () => {
  // A 380 px record drawer at a desktop viewport drew the desktop row, whose
  // seven equal shares cut each stage to a letter. The path's root is now a
  // container, and each row's switch stacks `sm` on the container's `@sm`.
  it('the root is the container both rows query, with no container between', () => {
    const r = mount('negotiation');
    const compact = compactOf(r);
    const desktop = r.container.querySelector('[role="list"]') as HTMLElement;
    const root = compact.parentElement as HTMLElement;
    expect(desktop.parentElement).toBe(root);
    expect(tokens(root)).toEqual(expect.arrayContaining(['@container', 'w-full']));
    for (const row of [compact, desktop]) {
      expect(row.closest('[class~="@container"]')).toBe(root);
    }
  });

  it('neither row switches on the viewport alone any more', () => {
    const r = mount('negotiation');
    const compact = tokens(compactOf(r));
    const desktop = tokens(r.container.querySelector('[role="list"]') as HTMLElement);
    expect(compact).toContain('sm:@sm:hidden');
    expect(compact).not.toContain('sm:hidden');
    expect(compact).not.toContain('hidden');
    expect(desktop).toEqual(expect.arrayContaining(['hidden', 'sm:@sm:flex']));
    expect(desktop).not.toContain('sm:flex');
  });
});
