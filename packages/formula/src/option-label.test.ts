import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
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

  it('refuses a field that declares no options, on every row, and a list value', () => {
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
    const list = celEngine.evaluate(cel('label(record.tags)'), {
      record,
      optionLabels: { ...zhCN, tags: { a: 'A' } },
    });
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.message).toContain('renders ONE option value');
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
