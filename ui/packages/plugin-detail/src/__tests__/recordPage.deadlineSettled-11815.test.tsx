/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — the record page judges a declared deadline's `settledWhen`
 * against its record and hands the cell `deadlineSettled` (ruling D).
 *
 * Through the real `DetailSection` and `HeaderHighlight`: a done record's past
 * declared deadline reads neutral, an open record's reads "Overdue Nd" in red.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import type { DetailViewSection } from '@object-ui/types';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const OBJECT_SCHEMA = {
  name: 'task',
  fields: {
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
    due_date: {
      name: 'due_date',
      type: 'date',
      label: 'Due',
      dueLike: true,
      settledWhen: "record.status == 'done'",
    },
  },
};

const SECTION = { title: 'S', fields: [{ name: 'due_date', label: 'Due' }] } as unknown as DetailViewSection;

const dueSpan = (container: HTMLElement) => {
  const span = container.querySelector('span.tabular-nums') as HTMLElement | null;
  return { text: span?.textContent ?? '', red: !!span?.className.includes('text-red-600') };
};

describe('DetailSection — a declared deadline is judged against the record (objectui#11815)', () => {
  it('an open record past its deadline reads overdue in red', () => {
    const { container } = render(
      <DetailSection section={SECTION} data={{ title: 'Open', status: 'open', due_date: daysAgo(5) }} objectSchema={OBJECT_SCHEMA} />,
    );
    expect(dueSpan(container)).toEqual({ text: 'Overdue 5d', red: true });
  });

  it('a done record past the same deadline reads neutral, with no red', () => {
    const { container } = render(
      <DetailSection section={SECTION} data={{ title: 'Done', status: 'done', due_date: daysAgo(5) }} objectSchema={OBJECT_SCHEMA} />,
    );
    expect(dueSpan(container)).toEqual({ text: '5 days ago', red: false });
  });

  it('CONTROL — an undeclared due_date past its day reads neutral on an open record', () => {
    const undeclared = { ...OBJECT_SCHEMA, fields: { ...OBJECT_SCHEMA.fields, due_date: { name: 'due_date', type: 'date' } } };
    const { container } = render(
      <DetailSection section={SECTION} data={{ status: 'open', due_date: daysAgo(5) }} objectSchema={undeclared} />,
    );
    expect(dueSpan(container)).toEqual({ text: '5 days ago', red: false });
  });
});

describe('HeaderHighlight — the same judgement on the highlights strip (objectui#11815)', () => {
  const FIELDS = [{ name: 'due_date', label: 'Due' }];

  it('an open record past its deadline reads overdue in red', () => {
    const { container } = render(
      <HeaderHighlight fields={FIELDS as any} data={{ status: 'open', due_date: daysAgo(5) }} objectSchema={OBJECT_SCHEMA} />,
    );
    expect(dueSpan(container)).toEqual({ text: 'Overdue 5d', red: true });
  });

  it('a done record past the same deadline reads neutral, with no red', () => {
    const { container } = render(
      <HeaderHighlight fields={FIELDS as any} data={{ status: 'done', due_date: daysAgo(5) }} objectSchema={OBJECT_SCHEMA} />,
    );
    expect(dueSpan(container)).toEqual({ text: '5 days ago', red: false });
  });
});
