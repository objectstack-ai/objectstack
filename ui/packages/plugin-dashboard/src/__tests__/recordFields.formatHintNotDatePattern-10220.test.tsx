/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10220 — `renderFieldValue` reads a field's `format` as a date
 * pattern only when the field IS a date.
 *
 * ## The defect
 *
 * The date branch used to fire on any `format` string containing one of the
 * letters Y / M / D / H / m / s, whatever the field's type. One `format` key has
 * several readers with different vocabularies, and that letter test collided
 * with all of them:
 *
 *   - `{ type: 'text', format: 'email' }` — a hint `resolveCellRendererType`
 *     (`@object-ui/fields`) honours as a `mailto:` cell — contains `m`, so the
 *     address went to `formatDate` and came back as an em dash: the value
 *     vanished from the dashboard table and the record drawer.
 *   - `format: 'money'` (the same resolver's currency hint) took the same
 *     branch; a numeric value then PARSED as an epoch timestamp and rendered as
 *     a 1970 date instead of money.
 *   - an `autonumber` field's `format` is its record-number pattern, and the
 *     date-token patterns the field docs teach (`ORD-{YYYYMMDD}-{00}`) hit the
 *     same branch — not a renderer hint word at all, so excluding hint words
 *     would not have reached it. Nor would it have reached a `time` field's
 *     `HH:mm`: `formatDate` cannot parse a bare time, so that value vanished
 *     too.
 *
 * ## Why the gate is the field TYPE, not a list of hint words
 *
 * A hint-word exclusion list would be a second copy of the resolver's
 * vocabulary, kept in step by hand — and the autonumber case above shows it
 * would still be incomplete. The `FieldSchema.format` description
 * objectstack#19763 wrote for `@objectstack/spec` already treats `format` as
 * type-dependent: the `date` and `datetime` cells read it as a display style,
 * and plain-text fields read a small set of renderer-hint words. So the branch
 * now asks the question that description asks: is this a `date` / `datetime`
 * field? A field whose type is unknown is not a date
 * cell either — a column with no schema type declares one (`type: 'date'`) to
 * get the date face, which the last case below pins.
 *
 * ## Cases
 *
 * Every case renders through the real `renderFieldValue` and reads the painted
 * text, because the defect's symptom IS the painted text. The two date cases
 * are the positive controls: they must render the date face identically
 * before and after the change.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { buildFieldMeta, renderFieldValue, type FieldMeta } from '../recordFields';

afterEach(() => cleanup());

const EM_DASH = '—';
/** Midday UTC, a past year: `Mar 4, 2020` in en-US from any runner timezone. */
const STORED_DATE = '2020-03-04T12:00:00.000Z';

function paint(value: unknown, meta: FieldMeta): HTMLElement {
  const { container } = render(<>{renderFieldValue(value, meta, undefined, 'en-US')}</>);
  return container;
}

describe('renderFieldValue — a renderer hint is not a date pattern (objectui#10220)', () => {
  it("the card's probe: a text field hinted `format: 'email'` paints its address as a mailto link", () => {
    const meta = buildFieldMeta({
      accessorKey: 'email_addr',
      label: 'Email',
      def: { type: 'text', format: 'email' },
    });
    const el = paint('ada@example.com', meta);
    expect(el.textContent).not.toBe(EM_DASH);
    expect(el.textContent).toContain('ada@example.com');
    expect(el.querySelector('a[href="mailto:ada@example.com"]')).not.toBeNull();
  });

  it("a text field hinted `format: 'money'` paints money, not an epoch date", () => {
    const meta = buildFieldMeta({
      accessorKey: 'deal_value',
      label: 'Deal value',
      def: { type: 'text', format: 'money', currency: 'USD' },
    });
    const el = paint(1234.5, meta);
    expect(el.textContent).toContain('1,234.50');
    expect(el.textContent).not.toMatch(/1970/);
  });

  it("a type-less meta hinted `format: 'email'` is not a date cell either", () => {
    const el = paint('ada@example.com', { name: 'contact', label: 'Contact', format: 'email' });
    expect(el.querySelector('a[href="mailto:ada@example.com"]')).not.toBeNull();
  });

  it('an autonumber pattern carrying date tokens paints the record number', () => {
    const meta = buildFieldMeta({
      accessorKey: 'order_no',
      label: 'Order #',
      def: { type: 'autonumber', format: 'ORD-{YYYYMMDD}-{00}' },
    });
    const el = paint('ORD-20240315-01', meta);
    expect(el.textContent).toBe('ORD-20240315-01');
  });

  it("a time field's `format: 'HH:mm'` paints the stored time — `formatDate` cannot parse a bare time", () => {
    const meta = buildFieldMeta({
      accessorKey: 'opens_at',
      label: 'Opens at',
      def: { type: 'time', format: 'HH:mm' },
    });
    expect(paint('14:30', meta).textContent).toBe('14:30');
  });

  it("CONTROL: a date field's `format: 'YYYY-MM-DD'` still takes the date face", () => {
    const meta = buildFieldMeta({
      accessorKey: 'close_date',
      label: 'Close date',
      def: { type: 'date', format: 'YYYY-MM-DD' },
    });
    expect(paint(STORED_DATE, meta).textContent).toBe('Mar 4, 2020');
  });

  it("CONTROL: a datetime field's pattern still takes the same date face", () => {
    const meta = buildFieldMeta({
      accessorKey: 'closed_at',
      label: 'Closed at',
      def: { type: 'datetime', format: 'YYYY-MM-DD HH:mm' },
    });
    expect(paint(STORED_DATE, meta).textContent).toBe('Mar 4, 2020');
  });

  it("a column with no schema field gets the date face by declaring `type: 'date'`", () => {
    const meta = buildFieldMeta({
      accessorKey: 'closed_on',
      label: 'Closed on',
      overrides: { type: 'date', format: 'YYYY-MM-DD' },
    });
    expect(paint(STORED_DATE, meta).textContent).toBe('Mar 4, 2020');
  });
});
