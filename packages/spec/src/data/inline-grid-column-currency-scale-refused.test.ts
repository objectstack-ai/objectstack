// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20045 — `scale` on an inline grid column that declares `type: 'currency'`
 * is refused at parse. Ruling 5791803339 (#19629, letter B) retired `scale`
 * from the currency FIELD type, and ruling 5805782503 (#19910, letter 乙 —
 * 「a currency's ISO 4217 minor unit decides its display」) worded the remedy.
 * Neither reached `InlineGridColumnSchema`, the strict mirror of the console
 * grid's column, which still offered per-column decimals on a currency column
 * and described a `¥` default symbol the grid no longer has. Triage read the
 * card as inherited from both rulings, so the mirror follows the field.
 *
 * What is pinned here (triage execution note 5):
 *
 *   1. THE REFUSAL — through the `FieldSchema` door on a real relationship
 *      field (strictness and refinements do not recurse by themselves, so a
 *      standalone parse proves nothing about the carrier), located at the
 *      column's `scale`, carrying ruling B's first sentence and remedy. Every
 *      declared value is refused, computed or not.
 *   2. THE CONTROLS — `scale` on a `number` column, and on a column that
 *      declares no `type`, parses with its value; `prefix` on a currency
 *      column is still accepted; following the remedy parses.
 *   3. THE SHAPE PARITY — the field refusal and the column refusal share the
 *      first sentence (subject swapped) and the minor-unit clause, so a
 *      rewording of one that leaves the other behind goes red.
 *   4. THE DESCRIBES — `prefix` no longer promises a default symbol, and
 *      `scale` names the currency refusal.
 *   5. THE ADR-0087 D3 ENTRY — registered under protocol major 18.
 *
 * Key-vs-value note: the rule judges the KEY on one declared type, whatever
 * its value, so the refusal is a full `safeParse` failure located at `scale`
 * and every control is a full `safeParse` success — never mere absence of
 * `unrecognized_keys`.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema, InlineGridColumnSchema } from './field.zod';
import { ObjectSchema } from './object.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

type Issue = { code: string; path: PropertyKey[]; message: string };
type Result = { success: boolean; error?: { issues: Issue[] }; data?: unknown };

/** The issues whose path ends at a `scale` key, or [] when the parse passed. */
function scaleIssues(result: Result): Issue[] {
  return result.success ? [] : result.error!.issues.filter((i) => i.path[i.path.length - 1] === 'scale');
}

/** A minimal master_detail relationship field — the real carrier of `inlineColumns`. */
const MD_FIELD = {
  name: 'invoice',
  label: 'Invoice',
  type: 'master_detail',
  reference: 'showcase_invoice',
  inlineEdit: 'grid',
} as const;

const parseColumns = (inlineColumns: Record<string, unknown>[]): Result =>
  FieldSchema.safeParse({ ...MD_FIELD, inlineColumns }) as Result;

const FIELD_FIRST_SENTENCE = '`scale` is not valid on a `currency` field — delete the key.';
const COLUMN_FIRST_SENTENCE = '`scale` is not valid on a `currency` inline grid column — delete the key.';
const MINOR_UNIT_CLAUSE = 'the currency\'s ISO 4217 minor unit (2 for USD, 0 for JPY, 3 for KWD) decides how';

/**
 * The ruled remedy on the message itself: the wording is the contract here
 * (the card carries ruling B's sentence and remedy to the mirror), so the pin
 * reads the first sentence verbatim, the minor-unit clause, and the ABSENCE of
 * any key the author could be sent to instead.
 */
function expectRuledRemedy(message: string): void {
  expect(message.startsWith(COLUMN_FIRST_SENTENCE)).toBe(true);
  expect(message).toContain(MINOR_UNIT_CLAUSE);
  expect(message).not.toMatch(/currencyConfig|precision/);
}

describe('`scale` on a currency inline grid column is refused at parse', () => {
  it('refuses the card\'s repro (computed currency column, `scale: 4`), located at the column\'s `scale`, with the ruled remedy', () => {
    const result = parseColumns([
      { name: 'quantity' },
      { name: 'amount', type: 'currency', computed: true, expr: 'quantity * unit_price', scale: 4 },
    ]);
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('custom');
    expect(issues[0].path).toEqual(['inlineColumns', 1, 'scale']);
    expectRuledRemedy(issues[0].message);
  });

  it('refuses every declared value on a currency column, computed or not — it is the key that is retired there', () => {
    for (const scale of [0, 2, 10]) {
      for (const computed of [{}, { computed: true, expr: 'quantity * unit_price' }]) {
        const label = `scale: ${scale}, ${JSON.stringify(computed)}`;
        const result = parseColumns([{ name: 'amount', type: 'currency', ...computed, scale }]);
        expect(result.success, label).toBe(false);
        const issues = scaleIssues(result);
        expect(issues, label).toHaveLength(1);
        expect(issues[0].path, label).toEqual(['inlineColumns', 0, 'scale']);
      }
    }
  });

  it('fires through `ObjectSchema` — the path an object document crosses', () => {
    const result = ObjectSchema.safeParse({
      name: 'showcase_invoice_line',
      label: 'Invoice Line',
      fields: {
        invoice: { ...MD_FIELD, inlineColumns: [{ name: 'unit_price', type: 'currency', prefix: '$', scale: 2 }] },
      },
    }) as Result;
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['fields', 'invoice', 'inlineColumns', 0, 'scale']);
    expectRuledRemedy(issues[0].message);
  });

  it('is the column schema\'s own refusal — a standalone column parse answers the same issue at `scale`', () => {
    const result = InlineGridColumnSchema.safeParse({ name: 'amount', type: 'currency', scale: 2 }) as Result;
    expect(result.success).toBe(false);
    const issues = scaleIssues(result);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['scale']);
    expectRuledRemedy(issues[0].message);
  });
});

describe('CONTROLS: what the refusal must leave alone', () => {
  it('`scale` on a `number` column parses, computed or not, and keeps its value', () => {
    for (const computed of [{}, { computed: true, expr: 'quantity * unit_price' }]) {
      const result = parseColumns([{ name: 'weight', type: 'number', ...computed, scale: 3 }]);
      expect(result.success, JSON.stringify(computed)).toBe(true);
      const columns = (result.data as { inlineColumns: Array<Record<string, unknown>> }).inlineColumns;
      expect(columns[0].scale).toBe(3);
    }
  });

  it('`scale` on a column that declares no `type` parses — the refusal judges only a DECLARED type', () => {
    const result = parseColumns([{ name: 'amount', computed: true, expr: 'quantity * unit_price', scale: 2 }]);
    expect(result.success).toBe(true);
    const columns = (result.data as { inlineColumns: Array<Record<string, unknown>> }).inlineColumns;
    expect(columns[0].scale).toBe(2);
  });

  it('`prefix` is still accepted on a currency column, and its value round-trips', () => {
    const result = parseColumns([{ name: 'unit_price', type: 'currency', prefix: 'US$' }]);
    expect(result.success).toBe(true);
    const columns = (result.data as { inlineColumns: Array<Record<string, unknown>> }).inlineColumns;
    expect(columns[0]).toMatchObject({ name: 'unit_price', type: 'currency', prefix: 'US$' });
  });

  it('following the remedy parses: each refused column, with `scale` deleted and nothing added, is accepted and re-parses unchanged', () => {
    const refused: Record<string, unknown>[] = [
      { name: 'amount', type: 'currency', scale: 0 },
      { name: 'amount', type: 'currency', computed: true, expr: 'quantity * unit_price', prefix: '$', scale: 4 },
    ];
    for (const column of refused) {
      expect(parseColumns([column]).success, JSON.stringify(column)).toBe(false);
      const remedied = { ...column };
      delete remedied.scale;
      expect(Object.keys(remedied)).toEqual(Object.keys(column).filter((k) => k !== 'scale'));
      const result = parseColumns([remedied]);
      expect(result.success, JSON.stringify(remedied)).toBe(true);
      const once = result.data as { inlineColumns: Array<Record<string, unknown>> };
      expect('scale' in once.inlineColumns[0]).toBe(false);
      expect(FieldSchema.parse(once)).toEqual(once);
    }
  });
});

describe('SHAPE PARITY with the currency FIELD refusal (its ruled text carried, not reworded)', () => {
  it('both refusals open with the same sentence, subject swapped, and share the minor-unit clause', () => {
    const field = FieldSchema.safeParse({ name: 'amount', label: 'Amount', type: 'currency', scale: 2 }) as Result;
    const column = parseColumns([{ name: 'amount', type: 'currency', scale: 2 }]);
    const [fieldIssue] = scaleIssues(field);
    const [columnIssue] = scaleIssues(column);
    expect(fieldIssue.message.startsWith(FIELD_FIRST_SENTENCE)).toBe(true);
    expect(COLUMN_FIRST_SENTENCE).toBe(FIELD_FIRST_SENTENCE.replace('`currency` field', '`currency` inline grid column'));
    expect(columnIssue.message.startsWith(COLUMN_FIRST_SENTENCE)).toBe(true);
    for (const message of [fieldIssue.message, columnIssue.message]) {
      expect(message).toContain(MINOR_UNIT_CLAUSE);
      expect(message).not.toMatch(/currencyConfig|precision/);
    }
  });
});

describe('the column describes', () => {
  const shape = InlineGridColumnSchema.shape as Record<string, { description?: string }>;

  it('`prefix` replaces the resolved currency symbol and promises no default', () => {
    const description = shape.prefix?.description ?? '';
    expect(description).toContain('in place of the resolved currency\'s own symbol');
    expect(description).toContain('No default');
    expect(description).not.toContain('¥');
  });

  it('`scale` names the currency refusal and no longer offers a currency result', () => {
    const description = shape.scale?.description ?? '';
    expect(description).toContain('REFUSED on a column declaring `type: \'currency\'` — delete it there');
    expect(description).not.toContain('numeric/currency');
  });
});

describe('the ADR-0087 D3 entry', () => {
  it('is registered under protocol major 18 with a replacement that deletes the key and names no carrier', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]?.semantic.find((e) => e.id === 'inline-grid-column-currency-scale-refused');
    expect(entry).toBeDefined();
    expect(entry!.replacement).toContain('DELETE the key');
    expect(entry!.replacement).not.toMatch(/currencyConfig|precision/);
  });
});
