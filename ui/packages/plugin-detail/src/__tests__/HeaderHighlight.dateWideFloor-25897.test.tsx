/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25897: the case record's highlight strip showed its SLA due
 * datetime as "2026/10/2…" — the ellipsis landed inside the day.
 *
 * A 9rem chip leaves its value about 103px once its padding and separator are
 * paid. Chromium (Inter, the strip's 14px semibold) read the compact
 * `datetime` face at 151-164px and the zh-CN `date` face at 114px, so both
 * date types joined the wide display types on the 16rem floor (216px). The
 * strip still declares truncation for a line that runs out, with the whole
 * value as the clip box's `title`; that half is unchanged and pinned here too.
 *
 * happy-dom has no layout engine, so these are class-semantics pins, the same
 * approach as the objectui#11684 and objectui#12523 pins beside this file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import type { HighlightField } from '@object-ui/types';
import { HeaderHighlight } from '../HeaderHighlight';

const CLOCK = '2026-10-23T12:00:00.000Z';
const SLA_DUE = '2026-10-26T02:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The HotCRM case's strip, with its own field types. */
const caseSchema = {
  fields: {
    priority: { type: 'text', label: 'Priority' },
    sla_due_date: { type: 'datetime', label: 'SLA Due' },
    opened_on: { type: 'date', label: 'Opened On' },
  },
};

const fields: HighlightField[] = [
  { name: 'priority', label: 'Priority' },
  { name: 'sla_due_date', label: 'SLA Due' },
  { name: 'opened_on', label: 'Opened On' },
];

const data = { priority: 'High', sla_due_date: SLA_DUE, opened_on: '2026-10-20' };

/** The chip column (`group flex flex-col …`) whose label is `label`. */
const chip = (label: string) => screen.getByText(label).closest('div.group') as HTMLElement;

describe('a date chip gets the floor its value fits in (objectstack#25897)', () => {
  it('gives a `datetime` chip the 16rem floor, the grow and the content cap', () => {
    render(<HeaderHighlight fields={fields} data={data} objectSchema={caseSchema} />);

    const due = chip('SLA Due');
    expect(due).toHaveClass('grow', 'max-w-max', 'basis-[16rem]', 'min-w-[min(16rem,100%)]');
    expect(due).not.toHaveClass('basis-[9rem]');
  });

  it('gives a `date` chip the same floor', () => {
    render(<HeaderHighlight fields={fields} data={data} objectSchema={caseSchema} />);

    const opened = chip('Opened On');
    expect(opened).toHaveClass('basis-[16rem]', 'min-w-[min(16rem,100%)]');
    expect(opened).not.toHaveClass('basis-[9rem]');
  });

  it('CONTROL: a plain `text` chip keeps the 9rem floor', () => {
    render(<HeaderHighlight fields={fields} data={data} objectSchema={caseSchema} />);

    const priority = chip('Priority');
    expect(priority).toHaveClass('basis-[9rem]', 'min-w-[min(9rem,100%)]');
    expect(priority).not.toHaveClass('basis-[16rem]');
  });

  it('keeps the declared truncation for a line that runs out, with the whole value reachable', () => {
    render(<HeaderHighlight fields={fields} data={data} objectSchema={caseSchema} />);

    const clipBox = chip('SLA Due').querySelector('span.truncate');
    expect(clipBox).not.toBeNull();
    expect(clipBox).toHaveAttribute('title', SLA_DUE);
  });
});
