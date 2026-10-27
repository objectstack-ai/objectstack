// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Two authored, user-visible labels the extractor did not walk:
//
//  - a joined report's block heading and caption
//    (`reports.<name>.blocks.<block_name>.label` / `.description`);
//  - a master-detail field's inline grid heading
//    (`objects.<child>.fields.<field>.inlineTitle`).
//
// Both are served through their translators (`translateReport`,
// `translateObject`), so without this walk `os i18n extract` scaffolded no key
// for them and `os i18n check` measured a debt of zero while a zh-CN user read
// them in English.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { TranslationDataSchema } from '@objectstack/spec/system';

const config = () => ({
  objects: [
    {
      name: 'invoice_line',
      label: 'Invoice Line',
      fields: {
        invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice', inlineEdit: 'grid', inlineTitle: 'Line Items' },
        // No inlineTitle: the grid is headed by the child's label, nothing to demand.
        amount: { type: 'currency', label: 'Amount' },
      },
    },
  ],
  reports: [
    {
      name: 'task_overview',
      label: 'Task Overview',
      type: 'joined',
      blocks: [
        { name: 'open_block', label: 'Open Tasks', description: 'Still in flight', type: 'summary', dataset: 'tasks', values: ['n'] },
        // No label: the renderer falls back to the block's machine name.
        { name: 'done_block', type: 'summary', dataset: 'tasks', values: ['n'] },
      ],
    },
  ],
});

const byKey = () => new Map(collectExpectedEntries(config()).map((e) => [e.path.join('.'), e]));

describe('i18n extract — joined report blocks', () => {
  it('walks each block\'s label and description under the report', () => {
    const keys = [...byKey().keys()].filter((k) => k.startsWith('reports.task_overview.blocks.')).sort();
    expect(keys).toEqual([
      'reports.task_overview.blocks.done_block.description',
      'reports.task_overview.blocks.done_block.label',
      'reports.task_overview.blocks.open_block.description',
      'reports.task_overview.blocks.open_block.label',
    ]);
  });

  it('seeds authored text and records an unwritten string without demanding it', () => {
    const entries = byKey();
    expect(entries.get('reports.task_overview.blocks.open_block.label'))
      .toMatchObject({ sourceValue: 'Open Tasks', inline: 'Open Tasks', source: 'report' });
    expect(entries.get('reports.task_overview.blocks.open_block.description'))
      .toMatchObject({ sourceValue: 'Still in flight', source: 'report' });
    const unwritten = entries.get('reports.task_overview.blocks.done_block.label');
    expect(unwritten?.sourceValue).toBeUndefined();
    expect(unwritten?.inline).toBeUndefined();
  });
});

describe('i18n extract — a field\'s inlineTitle', () => {
  it('walks the heading on the child field that declares it, and only there', () => {
    const entries = byKey();
    expect(entries.get('objects.invoice_line.fields.invoice.inlineTitle'))
      .toMatchObject({ sourceValue: 'Line Items', inline: 'Line Items', source: 'field' });
    expect(entries.get('objects.invoice_line.fields.amount.inlineTitle')?.inline).toBeUndefined();
  });
});

describe('i18n extract + check — both slots', () => {
  it('`TranslationDataSchema` accepts a bundle written at the extracted paths', () => {
    const out = extractTranslations(config(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.reports?.task_overview?.blocks?.open_block?.label).toBeDefined();
    expect(zh?.objects?.invoice_line?.fields?.invoice?.inlineTitle).toBeDefined();
    expect(TranslationDataSchema.safeParse({ reports: zh.reports, objects: zh.objects }).success).toBe(true);
  });

  it('reports an untranslated block heading and inline heading, and clears them once translated', () => {
    const coverage = (translations: unknown[]) => computeI18nCoverage({
      ...config(),
      i18n: { supportedLocales: ['en', 'zh-CN'] },
      translations,
    } as any).issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key);

    const before = coverage([{ 'zh-CN': { reports: { task_overview: { label: '任务概览' } } } }]);
    expect(before).toContain('reports.task_overview.blocks.open_block.label');
    expect(before).toContain('reports.task_overview.blocks.open_block.description');
    expect(before).toContain('objects.invoice_line.fields.invoice.inlineTitle');
    // Nothing authored ⇒ nothing to translate.
    expect(before).not.toContain('reports.task_overview.blocks.done_block.label');
    expect(before).not.toContain('objects.invoice_line.fields.amount.inlineTitle');

    const after = coverage([{
      'zh-CN': {
        reports: { task_overview: { label: '任务概览', blocks: { open_block: { label: '未完成任务', description: '仍在进行中' } } } },
        objects: { invoice_line: { fields: { invoice: { inlineTitle: '发票明细' } } } },
      },
    }]);
    expect(after).not.toContain('reports.task_overview.blocks.open_block.label');
    expect(after).not.toContain('reports.task_overview.blocks.open_block.description');
    expect(after).not.toContain('objects.invoice_line.fields.invoice.inlineTitle');
  });
});
