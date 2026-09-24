// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19629 — `scale` is RETIRED from the `currency` field type (maintainer ruling
 * 5791803339, batch #215 item 1, letter B): a currency field carrying `scale`
 * is refused at parse. The remedy is worded by ruling 5805782503 (batch #218
 * item 2, letter 乙 — a currency's decimal places are the currency's, not a
 * setting): delete the key; the currency's ISO 4217 minor unit decides its
 * display, and its write allowance stays unconstrained. It names no other key
 * to carry the value, and the remedy pins below hold both halves: the ruled
 * wording is present, and the retired pointer is absent.
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

/**
 * The ruled remedy, held on the message itself: the wording is the contract
 * here (ruling 乙 rules the prescription, not only the refusal), so the pin
 * reads the first sentence verbatim, the two ruled clauses, and the ABSENCE of
 * any key the author could be sent to instead.
 */
function expectRuledRemedy(message: string): void {
  expect(message.startsWith('`scale` is not valid on a `currency` field — delete the key.')).toBe(true);
  expect(message).toContain('the currency\'s ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD) decides how the amount displays');
  expect(message).toContain('the field\'s write allowance stays unconstrained');
  expect(message).not.toMatch(/currencyConfig|precision/);
}

describe('#19629 — `scale` on a `currency` field is refused at parse', () => {
  it('refuses the designer-produced shape, located at `scale`, with the ruled remedy: delete the key, and no other key named', () => {
    const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale: 3 });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['scale']);
    expectRuledRemedy(issues[0].message);
  });

  it('refuses every declared value, `scale: 0` and `scale: 2` included — it is the key that is retired', () => {
    for (const scale of [0, 2, 10]) {
      const result = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale });
      expect(result.success, `scale: ${scale}`).toBe(false);
      expect(scaleIssues(result), `scale: ${scale}`).toHaveLength(1);
    }
  });

  it('refuses it beside a `currencyConfig` too, with the same remedy — the block neither licenses the key nor receives its value', () => {
    const result = FieldSchema.safeParse({
      name: 'amount',
      label: 'Amount',
      type: 'currency',
      scale: 2,
      currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' },
    });
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    // The field that most invites a "move it into the block" remedy gets the
    // same prescription as every other: delete the key.
    expectRuledRemedy(issues[0].message);
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
    expectRuledRemedy(issues[0].message);
  });
});

describe('#19629 — CONTROLS: what the refusal must leave alone', () => {
  it('a currency field without `scale` parses, and its parse output re-parses unchanged', () => {
    const once = FieldSchema.parse({ name: 'amount', label: 'Amount', type: 'currency', min: 0 });
    expect('scale' in once).toBe(false);
    expect(FieldSchema.parse(once)).toEqual(once);
  });

  it('following the remedy parses: each refused shape, with `scale` deleted and nothing added, is accepted', () => {
    const refused: Record<string, unknown>[] = [
      { name: 'amount', label: 'Amount', type: 'currency', scale: 3 },
      { name: 'amount', label: 'Amount', type: 'currency', scale: 2, min: 0, currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'KWD' } },
    ];
    for (const shape of refused) {
      expect(FieldSchema.safeParse(shape).success).toBe(false);
      const remedied = { ...shape };
      delete remedied.scale;
      expect(Object.keys(remedied)).toEqual(Object.keys(shape).filter((k) => k !== 'scale'));
      const result = FieldSchema.safeParse(remedied);
      expect(result.success, JSON.stringify(remedied)).toBe(true);
      if (result.success) expect('scale' in result.data).toBe(false);
    }
  });

  it('every type the key still applies to keeps it — number, percent, rating, slider', () => {
    for (const type of ['number', 'percent', 'rating', 'slider'] as const) {
      const result = FieldSchema.safeParse({ name: 'n', label: 'N', type, scale: 2 });
      expect(result.success, type).toBe(true);
      if (result.success) expect(result.data.scale, type).toBe(2);
    }
  });

  it('the describe names the type set the key still applies to, and the currency refusal with the ruled remedy', () => {
    const description = (FieldSchema.shape as Record<string, { description?: string }>).scale?.description ?? '';
    expect(description).toContain('Applies to `number`, `percent`, `rating` and `slider`');
    expect(description).toContain('REFUSED on a `currency` field — delete it there');
    expect(description).toContain('the currency\'s ISO 4217 minor unit decides how the amount displays');
    expect(description).not.toContain('currencyConfig');
  });
});
