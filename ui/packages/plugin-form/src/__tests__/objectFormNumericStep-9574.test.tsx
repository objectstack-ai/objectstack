/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectForm`'s numeric `step` follows `scale`, not `precision` (objectui#9574).
 *
 * `@objectstack/spec` declares the two members apart — `precision` is "Total
 * digits (non-negative integer)", `scale` is "Decimal places (non-negative
 * integer)" — and `NumberField` states the consequence verbatim one layer
 * down: "Step follows `scale` (decimal places), not `precision` (total digit
 * count)". `ObjectForm` derived the same quantity from the other member, so a
 * `decimal(10, 0)` field was handed a step of `1e-10` instead of `1`.
 *
 * ## Two routes, and only one of them can see the producer
 *
 * Measured on this branch's base, through a real render of this component:
 *
 *  - **Registered widget** (the ordinary route — importing `ObjectForm` pulls
 *    `@object-ui/fields` in, whose module body registers every `field:*`
 *    widget): the widget receives a `step` PROP and drops it. Its metadata
 *    carrier is the `field` key — the raw object-schema field — and its
 *    `toDomProps` whitelist does not forward `step`, so `NumberField` derives
 *    its own from `scale`. Deleting the producer's assignment outright left
 *    every rendered `<input>` on this route byte-identical.
 *  - **Built-in `input` control** (a field declaring `widget: 'input'`): since
 *    objectui#12130 `ObjectForm` writes no `step`. The renderer's `input`
 *    branch derives the `<input>`'s step from the same metadata carrier, by
 *    `NumberField`'s rule (an explicit `step`, else `10^-scale`, else `any`),
 *    and that derived step is the attribute the browser enforces, so the
 *    first block below pins the derivation. Until objectui#12110 this block
 *    reached a second such input through a `widget` naming a component
 *    nothing registers; that name now degrades to the `type` renderer, as
 *    `@objectstack/spec`'s `FieldSchema.widget` describes, which is the
 *    registered route above.
 *
 * ⇒ the first block below is the load-bearing pin — it fails on the
 * `precision`-derived expression, where these three inputs all read
 * `step="1e-10"`. The second block pins the same user-visible rule through the
 * ordinary route and PASSES ON BOTH configurations of the producer: it is a
 * pin of the whole chain (metadata carrier → widget → attribute), deliberately
 * kept and deliberately labelled, not evidence for this card's change.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from '../ObjectForm';

/**
 * `decimal(10, 0)` and `decimal(10, 2)` — the two cases the card names — plus
 * a field that declares neither digit member.
 *
 * The `widget` key names the built-in `input` control, which is what routes
 * them to the branch that spreads the producer's props (see the header).
 */
const FALLBACK_OBJECT = {
  name: 'invoice_line',
  fields: {
    qty: { type: 'number', label: 'Qty', precision: 10, scale: 0, widget: 'input' },
    amount: { type: 'number', label: 'Amount', precision: 10, scale: 2, widget: 'input' },
    fee: { type: 'currency', label: 'Fee', precision: 10, scale: 2, widget: 'input' },
    rate: { type: 'percent', label: 'Rate', precision: 10, scale: 2, widget: 'input' },
    unscaled: { type: 'number', label: 'Unscaled', precision: 10, widget: 'input' },
  },
};

/** Same two cases, no `widget` override — the ordinary registered-widget route. */
const REGISTERED_OBJECT = {
  name: 'invoice_line',
  fields: {
    qty: { type: 'number', label: 'Qty', precision: 10, scale: 0 },
    amount: { type: 'number', label: 'Amount', precision: 10, scale: 2 },
  },
};

const makeDataSource = (objectSchema: unknown) => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

async function renderFields(objectSchema: unknown) {
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'invoice_line', mode: 'create' } as any}
      dataSource={makeDataSource(objectSchema) as any}
    />,
  );
  await waitFor(() => {
    if (!container.querySelector('input[name="qty"]')) throw new Error('form not ready');
  });
  return (name: string) => {
    const el = container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`no input rendered for ${name}`);
    return el;
  };
}

describe('ObjectForm numeric step follows `scale` (objectui#9574)', () => {
  it('hands the built-in input a step of 10^-scale — 1 for scale 0, 0.01 for scale 2', async () => {
    const input = await renderFields(FALLBACK_OBJECT);

    // `decimal(10, 0)`: ten total digits, ZERO decimal places ⇒ steps by 1.
    // The defect read `precision` here and produced `1e-10`.
    expect(input('qty').getAttribute('step'), 'decimal(10, 0) steps by 1').toBe('1');
    // `decimal(10, 2)` ⇒ hundredths.
    expect(input('amount').getAttribute('step'), 'decimal(10, 2) steps by 0.01').toBe('0.01');
    // Same derivation for the other two numeric types the branch covers, so
    // the producer cannot drift type by type. ⚠️ For `percent` this pins the
    // producer's UNIFORMITY only: what `scale` means for a percent field that
    // stores a 0–1 fraction (stored decimals, which is what the record
    // validator enforces, vs displayed percentage points, which is the landed
    // display convention) is open at objectui#9810, and a ruling there
    // re-prices this line.
    expect(input('fee').getAttribute('step'), 'currency follows scale too').toBe('0.01');
    expect(input('rate').getAttribute('step'), 'percent follows scale too').toBe('0.01');
  });

  it('claims no granularity when no `scale` is declared', async () => {
    const input = await renderFields(FALLBACK_OBJECT);

    // NOT an absent attribute: absent means HTML's default step of 1, which
    // marks every decimal `:invalid` and blocks the submit — a constraint the
    // author never declared. `'any'` is the tail `NumberField` already uses.
    expect(input('unscaled').getAttribute('step'), 'undeclared scale ⇒ step="any"').toBe('any');
  });

  it('CHAIN PIN, not a pin of this card: the ordinary route shows the same two steps', async () => {
    // ⚠️ This passes on BOTH configurations of the producer — the registered
    // widget drops the `step` prop and derives its own from the same `scale`
    // (see the header). It is kept because it is the rule as a user meets it:
    // the metadata carrier reaching the widget, and the widget's derivation,
    // are both live links in that chain and neither is pinned here otherwise.
    const input = await renderFields(REGISTERED_OBJECT);

    expect(input('qty').getAttribute('step')).toBe('1');
    expect(input('amount').getAttribute('step')).toBe('0.01');
  });
});
