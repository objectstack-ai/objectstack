// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19629 — `scale` is RETIRED from the `currency` field type (maintainer ruling
 * 5791803339, batch #215 item 1, letter B): a currency field carrying `scale`
 * is refused at parse, with a remedy naming `currencyConfig.precision`.
 *
 * On a currency field the key was offered by the field designer, never read by
 * the amount's cell, and still enforced on writes by `packages/objectql`'s
 * `max_scale` branch — a narrower write contract bought with no visible
 * change. The write seam drops `currency` from its enforced set in the same
 * change (pinned in that package's `record-validator.test.ts`); this file pins
 * the authoring half.
 *
 * Key-vs-value note: the rule judges the KEY on one type, whatever its value,
 * so the refusal is asserted as a full `safeParse` failure located at
 * `['scale']`, and every control is a full `safeParse` success — never mere
 * absence of `unrecognized_keys`.
 */

import { describe, expect, it } from 'vitest';
import { Field, FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };

/** The issues located at the field's `scale` key, or [] when the parse passed. */
function scaleIssues(result: { success: boolean; error?: { issues: Issue[] } }): Issue[] {
  return result.success ? [] : result.error!.issues.filter((i) => i.path[i.path.length - 1] === 'scale');
}

describe('#19629 — `scale` on a `currency` field is refused at parse', () => {
  it('refuses the designer-produced shape, located at `scale`, with the remedy naming `currencyConfig.precision`', () => {
    const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale: 3 });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['scale']);
    // The ruled remedy's named subject — the one knob the refusal points to.
    expect(issues[0].message).toContain('`currencyConfig.precision`');
  });

  it('refuses every declared value, `scale: 0` and `scale: 2` included — it is the key that is retired', () => {
    for (const scale of [0, 2, 10]) {
      const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale });
      expect(result.success, `scale: ${scale}`).toBe(false);
      expect(scaleIssues(result), `scale: ${scale}`).toHaveLength(1);
    }
  });

  it('refuses it beside a `currencyConfig` too — the width key is not an alias for it', () => {
    const result = FieldSchema.safeParse({
      name: 'amount',
      label: 'Amount',
      type: 'currency',
      scale: 2,
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
    });
    expect(result.success).toBe(false);
    expect(scaleIssues(result)).toHaveLength(1);
  });

  it('fires through the `Field.currency()` helper and `ObjectSchema` — the path an object document crosses', () => {
    const result = ObjectSchema.safeParse({
      name: 'invoice',
      label: 'Invoice',
      fields: { amount: Field.currency({ label: 'Amount', scale: 2, min: 0 }) },
    });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['fields', 'amount', 'scale']);
  });
});

describe('#19629 — CONTROLS: what the refusal must leave alone', () => {
  it('a currency field without `scale` parses, and its parse output re-parses unchanged', () => {
    const once = FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'currency', min: 0 });
    expect('scale' in once).toBe(false);
    expect(FieldSchema.parse(once)).toEqual(once);
  });

  it('the remedy target parses: `currencyConfig.precision` on a currency field', () => {
    const result = FieldSchema.safeParse({
      name: 'amount',
      label: 'Amount',
      type: 'currency',
      currencyConfig: { precision: 3, currencyMode: 'fixed', defaultCurrency: 'KWD' },
    });
    expect(result.success).toBe(true);
  });

  it('every type the key still applies to keeps it — number, percent, rating, slider', () => {
    for (const type of ['number', 'percent', 'rating', 'slider'] as const) {
      const result = FieldSchema.safeParse({ name: 'n', label: 'N', type, scale: 2 });
      expect(result.success, type).toBe(true);
      if (result.success) expect(result.data.scale, type).toBe(2);
    }
  });

  it('the describe names the type set the key still applies to, and the currency refusal', () => {
    const description = (FieldSchema.shape as Record<string, { description?: string }>).scale?.description ?? '';
    expect(description).toContain('Applies to `number`, `percent`, `rating` and `slider`');
    expect(description).toContain('REFUSED on a `currency` field');
  });
});
