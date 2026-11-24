import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
import { formatValue } from './template-engine';
import { inferExpressionType } from './validate';
import type { EvalOptionLabels } from './types';
import type { Expression } from '@objectstack/spec';

/**
 * `label(record.<field>)` — a select field's stored value as the label its
 * reader reads (#26608). The record name a formula composes out of option
 * values (`v2 · clean`) renders in the reader's locale (`v2 · 清稿`).
 *
 * The labels are DATA the caller pinned (`EvalContext.optionLabels`), resolved
 * in the reader's locale before evaluation; these tests hand the two maps a
 * zh-CN and an en-US reader receive and pin what each reads.
 */

const cel = (source: string): Expression => ({ dialect: 'cel', source });

const NAME = "'v' + string(record.version_no) + ' · ' + label(record.kind)";

const zhCN: EvalOptionLabels = { kind: { clean: '清稿', redline: '修订稿' }, stage: { draft: '草稿' } };
const enUS: EvalOptionLabels = { kind: { clean: 'Clean', redline: 'Redline' }, stage: { draft: 'Draft' } };

const record = { version_no: 2, kind: 'clean', stage: 'draft', title: 'Master agreement', tags: ['a'] };

describe('label(record.<field>) — option labels in the reader\'s locale (#26608)', () => {
  it('composes a record name in zh-CN and in en-US from the same stored value', () => {
    expect(celEngine.evaluate(cel(NAME), { record, optionLabels: zhCN })).toEqual({ ok: true, value: 'v2 · 清稿' });
    expect(celEngine.evaluate(cel(NAME), { record, optionLabels: enUS })).toEqual({ ok: true, value: 'v2 · Clean' });
  });

  it('reads each field\'s own options — the field name picks the map, not the value', () => {
    const r = celEngine.evaluate(cel("label(record.kind) + ' / ' + label(record.stage)"), {
      record,
      optionLabels: zhCN,
    });
    expect(r).toEqual({ ok: true, value: '清稿 / 草稿' });
  });

  it('answers \'\' for an empty select, so a composed name still evaluates', () => {
    const r = celEngine.evaluate(cel(NAME), { record: { ...record, kind: null }, optionLabels: zhCN });
    expect(r).toEqual({ ok: true, value: 'v2 · ' });
  });

  it('shows a stored value no option declares as itself, as the select control does', () => {
    const r = celEngine.evaluate(cel('label(record.kind)'), { record: { kind: 'retired' }, optionLabels: zhCN });
    expect(r).toEqual({ ok: true, value: 'retired' });
  });

  it('refuses at run time when the context carries no option labels — never the stored value', () => {
    const r = celEngine.evaluate(cel(NAME), { record });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('runtime');
      expect(r.error.message).toContain('label(record.kind) cannot be answered');
      expect(r.error.message).toContain('optionLabels');
    }
  });

  it('refuses a field that declares no options, on every row', () => {
    const plain = celEngine.evaluate(cel('label(record.title)'), { record, optionLabels: zhCN });
    expect(plain.ok).toBe(false);
    if (!plain.ok) {
      expect(plain.error.kind).toBe('runtime');
      expect(plain.error.message).toContain('`title` declares no options');
    }
    // …on every row: an empty value does not hide that the field has no options.
    const empty = celEngine.evaluate(cel('label(record.title)'), { record: { ...record, title: null }, optionLabels: zhCN });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.message).toContain('`title` declares no options');
  });

  it('refuses an object value at run time — it is no option value', () => {
    const r = celEngine.evaluate(cel('label(record.kind)'), { record: { kind: { v: 'clean' } }, optionLabels: zhCN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('compiles the one argument shape and refuses every other at the type check', () => {
    expect(celEngine.compile(NAME).ok).toBe(true);
    for (const source of [
      "label('clean')",
      'label(record.account.type)',
      'label(record.?kind)',
      'label(previous.kind)',
      "label(record.kind + '')",
    ]) {
      const r = celEngine.compile(source);
      expect(r.ok, source).toBe(false);
      if (!r.ok) {
        expect(r.error.kind, source).toBe('type');
        expect(r.error.message, source).toContain('label(record.<field>)');
      }
    }
  });

  it('types as text, so a formula built on it is a text formula', () => {
    expect(inferExpressionType(NAME)).toBe('text');
    expect(inferExpressionType('label(record.kind)')).toBe('text');
  });
});

/**
 * `label(record.<field>)` over a `multiple: true` select — a list of stored
 * values — prints the label of each value, in the order the record stores
 * them, joined with `, `: the rule the mail template's `option` hole applies
 * to the same list (`OPTION_ARGUMENT_RULE`), through one shared helper.
 */
describe('label(record.<field>) over a multi-select — each selected label, joined', () => {
  const GAPS = 'label(record.gaps)';
  const zh: EvalOptionLabels = {
    gaps: { no_sales_price: '无销售价', no_customer: '无客户', no_freight_region: '无运费区域' },
    one: { no_customer: '无客户' },
  };
  const en: EvalOptionLabels = {
    gaps: { no_sales_price: 'No sales price', no_customer: 'No customer', no_freight_region: 'No freight region' },
    one: { no_customer: 'No customer' },
  };
  const evalIn = (labels: EvalOptionLabels, rec: Record<string, unknown>, source = GAPS) =>
    celEngine.evaluate(cel(source), { record: rec, optionLabels: labels });

  it('reads each selected value\'s label in the reader\'s language, joined with `, `', () => {
    const rec = { gaps: ['no_sales_price', 'no_customer'] };
    expect(evalIn(zh, rec)).toEqual({ ok: true, value: '无销售价, 无客户' });
    expect(evalIn(en, rec)).toEqual({ ok: true, value: 'No sales price, No customer' });
  });

  it('reads a one-element list as that one label', () => {
    expect(evalIn(zh, { gaps: ['no_freight_region'] })).toEqual({ ok: true, value: '无运费区域' });
    expect(evalIn(en, { gaps: ['no_freight_region'] })).toEqual({ ok: true, value: 'No freight region' });
  });

  it('keeps the order the record stores, not the order the options are declared in', () => {
    expect(evalIn(en, { gaps: ['no_freight_region', 'no_sales_price'] }))
      .toEqual({ ok: true, value: 'No freight region, No sales price' });
  });

  it('reads an empty list and an empty field as \'\', as a single select reads empty', () => {
    expect(evalIn(zh, { gaps: [] })).toEqual({ ok: true, value: '' });
    expect(evalIn(zh, { gaps: null })).toEqual({ ok: true, value: '' });
  });

  it('reads a listed value no option declares as itself, as the single-value path does', () => {
    expect(evalIn(en, { one: 'retired' }, 'label(record.one)')).toEqual({ ok: true, value: 'retired' });
    expect(evalIn(en, { gaps: ['no_customer', 'retired'] })).toEqual({ ok: true, value: 'No customer, retired' });
  });

  it('composes into a sentence like any string', () => {
    const r = evalIn(zh, { gaps: ['no_customer'] }, "'缺: ' + label(record.gaps)");
    expect(r).toEqual({ ok: true, value: '缺: 无客户' });
  });

  it('a field that declares no options still faults on a list, as on every other value', () => {
    const r = celEngine.evaluate(cel('label(record.tags)'), { record: { tags: ['a'] }, optionLabels: zh });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('a list holding an object faults — an object is no option value', () => {
    const r = evalIn(zh, { gaps: ['no_customer', { v: 'x' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('runtime');
  });

  it('⭐ prints what the mail template\'s `option` hole prints for the same list — one rule', () => {
    const list = ['no_freight_region', 'retired', 'no_customer'];
    const viaLabel = evalIn(en, { gaps: list });
    const viaHole = formatValue('option', list, 'quote_line.gaps', {
      optionLabels: { 'quote_line.gaps': en.gaps },
    });
    expect(viaLabel).toEqual({ ok: true, value: viaHole });
    expect(viaHole).toBe('No freight region, retired, No customer');
  });
});
