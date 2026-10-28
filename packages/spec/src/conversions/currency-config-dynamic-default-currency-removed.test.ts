// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ObjectSchema } from '../data/object.zod.js';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry.js';
import { applyConversions } from './apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * [#27157] `currency-config-dynamic-default-currency-removed` — the D2 half of
 * the `currencyConfig.defaultCurrency` narrowing (ruling 6464202770 on
 * #27119, Q2 = X).
 *
 * Every parse before this change baked `defaultCurrency: 'CNY'` into a
 * currency config, so a stored object row carries it on a `dynamic` config
 * nobody wrote a code for. The conversion strips it there (no reader takes a
 * `dynamic` config's code) and leaves a `fixed` config's code alone (it is the
 * currency the field displayed). The fixture pair in `conversions.test.ts`
 * proves before → after over the whole table; this file pins it on a STORED
 * row, the seam that replays it.
 */

const ID = 'currency-config-dynamic-default-currency-removed';
const D3_ID = 'currency-config-fixed-default-currency-required';

/** An object row as an earlier parse stored it: every currency config carries a code. */
function storedObject() {
  return {
    name: 'billing_invoice',
    label: 'Invoice',
    fields: {
      amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' } },
      // `{ currencyMode: 'fixed' }` as authored: the old parse filled in CNY.
      legacy_fixed: { name: 'legacy_fixed', type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'CNY' } },
      tax: { name: 'tax', type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' } },
      net: {
        name: 'net',
        type: 'formula',
        expression: 'record.amount - record.tax',
        returnType: 'currency',
        currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' },
      },
      qty: { name: 'qty', type: 'number' },
    },
  };
}

function convertStored(row: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const item = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) });
  return { item: item as ReturnType<typeof storedObject>, notices: notices.filter((n) => n.conversionId === ID) };
}

describe('currency-config-dynamic-default-currency-removed (ADR-0087 D2)', () => {
  it('is registered for protocol 18, retired from the authoring load path, and linked from its D3 entry', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
    expect(CONVERSIONS_BY_MAJOR[18]!.map((c) => c.id)).toContain(ID);
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(ID);
    const d3 = MIGRATIONS_BY_MAJOR[18]!.semantic.find((s) => s.id === D3_ID);
    expect(d3?.conversionIds).toEqual([ID]);
  });

  it('strips the code from every dynamic config of a stored row and keeps every fixed one', () => {
    const row = storedObject();
    const { item, notices } = convertStored(row);
    expect(item.fields.tax.currencyConfig).toEqual({ currencyMode: 'dynamic' });
    expect(item.fields.net.currencyConfig).toEqual({ currencyMode: 'dynamic' });
    expect(item.fields.amount).toBe(row.fields.amount);
    expect(item.fields.legacy_fixed).toBe(row.fields.legacy_fixed);
    expect(item.fields.qty).toBe(row.fields.qty);
    expect(notices.map((n) => [n.path, n.from, n.to])).toEqual([
      ['objects[0].fields.tax.currencyConfig.defaultCurrency', 'defaultCurrency', '(removed)'],
      ['objects[0].fields.net.currencyConfig.defaultCurrency', 'defaultCurrency', '(removed)'],
    ]);
  });

  it('a converted row parses to itself: fixed keeps its code, dynamic carries none', () => {
    const { item } = convertStored(storedObject());
    const parsed = ObjectSchema.parse(item);
    expect(parsed.fields.amount!.currencyConfig).toEqual({ currencyMode: 'fixed', defaultCurrency: 'USD' });
    expect(parsed.fields.legacy_fixed!.currencyConfig).toEqual({ currencyMode: 'fixed', defaultCurrency: 'CNY' });
    expect(parsed.fields.tax!.currencyConfig).toEqual({ currencyMode: 'dynamic' });
    expect(parsed.fields.net!.currencyConfig).toEqual({ currencyMode: 'dynamic' });
  });

  it('is idempotent: a second replay finds nothing to strip', () => {
    const once = convertStored(storedObject()).item;
    const twice = convertStored(once);
    expect(twice.notices).toEqual([]);
    expect(twice.item).toEqual(once);
  });

  it('does not run on the authoring load path: an authored dynamic code stays (legal, unread)', () => {
    const stack = { objects: [storedObject()] };
    const notices: ConversionNotice[] = [];
    const out = applyConversions(stack, { onNotice: (n) => notices.push(n) });
    expect(notices.filter((n) => n.conversionId === ID)).toEqual([]);
    expect((out as typeof stack).objects[0]!.fields.tax.currencyConfig)
      .toEqual({ currencyMode: 'dynamic', defaultCurrency: 'CNY' });
  });
});
