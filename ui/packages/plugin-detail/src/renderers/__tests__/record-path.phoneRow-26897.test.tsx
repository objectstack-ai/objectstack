/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:path` — the phone row fits its stages, and a label that does not fit
 * ellipsises with its full text kept (objectstack#26897).
 *
 * Measured at 390×844 on the HotCRM seed: the row below `sm` held
 * content-width, `whitespace-nowrap` stages in a sideways scroller with a
 * hidden scrollbar, so the stage at the right edge read "Resolu" with nothing
 * to say the row scrolled. Now every stage takes an equal share with a floor,
 * an ordinary label truncates and carries its full text in `title`, and a
 * terminal label wraps, as on the desktop rail (#25895).
 *
 * The test DOM resolves no Tailwind, so this file reads class tokens and
 * attributes; the widths themselves are pinned in Chromium by
 * `e2e/record-path-phone-row.spec.ts`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

afterEach(() => cleanup());

/** The card's case path; `closed` is the won terminus by token, `cancelled` is lost. */
const CASE_STAGES = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting on Customer' },
  { value: 'resolved', label: 'Resolution Proposed' },
  { value: 'closed', label: 'Closed', terminal: 'won' },
  { value: 'cancelled', label: 'Cancelled', terminal: 'lost' },
];

function mount(status = 'waiting'): RenderResult {
  return render(
    <RecordContextProvider objectName="crm_case" recordId="c1" data={{ id: 'c1', status }}>
      <RecordPathRenderer schema={{ statusField: 'status', stages: CASE_STAGES } as never} />
    </RecordContextProvider>,
  );
}

/** The desktop rail is the first `role="list"`; the phone one is the second. */
const rows = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

const stageNamed = (row: HTMLElement, label: string): HTMLElement =>
  within(row)
    .getAllByRole('listitem')
    .find((el) => (el.textContent ?? '').includes(label)) as HTMLElement;

/** A stage's visible label element: the span after the decorative rail. */
const labelOf = (stage: HTMLElement): HTMLElement =>
  stage.querySelector(':scope > span:not([data-stage-rail])') as HTMLElement;

const tokens = (el: HTMLElement): string[] => el.className.split(/\s+/).filter(Boolean);

describe('record:path — the phone row fits and ellipsises (objectstack#26897)', () => {
  it('every phone stage takes an equal share with a floor, instead of its content width', () => {
    const phone = rows(mount())[1];
    expect(tokens(phone)).toContain('sm:hidden');
    for (const stage of within(phone).getAllByRole('listitem')) {
      const t = tokens(stage);
      expect(t).toContain('flex-1');
      expect(t).toContain('min-w-10');
      expect(t).not.toContain('shrink-0');
    }
  });

  it('an ordinary phone label truncates and keeps its full text in title', () => {
    const phone = rows(mount())[1];
    for (const label of ['In Progress', 'Waiting on Customer', 'Resolution Proposed']) {
      const el = labelOf(stageNamed(phone, label));
      const t = tokens(el);
      expect(t).toContain('truncate');
      expect(t).toContain('min-w-0');
      expect(t).not.toContain('whitespace-nowrap');
      expect(el).toHaveAttribute('title', label);
    }
  });

  it('a terminal phone label wraps, as on the desktop rail', () => {
    const phone = rows(mount())[1];
    for (const label of ['Closed', 'Cancelled']) {
      const stage = stageNamed(phone, label);
      expect(stage).toHaveAttribute('data-stage-terminal');
      const t = tokens(labelOf(stage));
      expect(t).toContain('[overflow-wrap:anywhere]');
      expect(t).not.toContain('truncate');
      expect(t).not.toContain('whitespace-nowrap');
    }
  });

  it('CONTROL: the desktop rail is unchanged — no title, the ordinary label still truncates', () => {
    const desktop = rows(mount())[0];
    expect(tokens(desktop)).toContain('sm:flex');
    const el = labelOf(stageNamed(desktop, 'Waiting on Customer'));
    expect(tokens(el)).toContain('truncate');
    expect(el).not.toHaveAttribute('title');
  });
});
