// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Under zh-CN, the showcase's two authored headings that had no translation
 * slot are served translated:
 *
 *  - the joined report `showcase_task_overview` — its title was translated
 *    while its block headings ("Open Tasks", "Completed Tasks") stayed English;
 *  - the inline line-item grids on the invoice and expense-report create forms,
 *    headed by the child field's `inlineTitle` ("Line Items", "Expense Lines").
 *
 * Both reach the console as the served document: the joined report renderer
 * draws `block.label` off `GET /meta/report`, and the console's inline-subform
 * pass copies the child field's `inlineTitle` off `GET /meta/object`. So the
 * pin is the translator applied to the app's own metadata with the app's own
 * bundle, exactly what the REST boundary does per request locale.
 */
import { describe, expect, it } from 'vitest';
import { translateMetadataDocument, type TranslationBundle } from '@objectstack/spec/system';
import { TaskOverviewReport } from '../src/ui/reports/index.js';
import { InvoiceLine } from '../src/data/objects/invoice.object.js';
import { ExpenseLine } from '../src/data/objects/expense-report.object.js';
import { ShowcaseTranslationBundle } from '../src/system/translations/index.js';

const bundle = ShowcaseTranslationBundle as unknown as TranslationBundle;
const zh = { locale: 'zh-CN' };

describe('showcase under zh-CN — authored headings with a slot of their own', () => {
  it('serves the joined report\'s block headings translated, under its translated title', () => {
    const out = translateMetadataDocument('report', TaskOverviewReport, bundle, zh);
    expect(out.label).toBe('任务概览（联合）');
    expect(out.blocks.map((b: { name: string; label: unknown }) => [b.name, b.label])).toEqual([
      ['open_block', '未完成任务'],
      ['done_block', '已完成任务'],
    ]);
  });

  it('serves the invoice and expense-report inline grid headings translated', () => {
    const invoiceLine = translateMetadataDocument('object', InvoiceLine, bundle, zh);
    expect(invoiceLine.fields.invoice.inlineTitle).toBe('发票明细');
    const expenseLine = translateMetadataDocument('object', ExpenseLine, bundle, zh);
    expect(expenseLine.fields.expense_report.inlineTitle).toBe('费用明细');
  });

  it('leaves the authored English in place for a locale the bundle does not carry', () => {
    const out = translateMetadataDocument('report', TaskOverviewReport, bundle, { locale: 'en' });
    expect(out.blocks.map((b: { label: unknown }) => b.label)).toEqual(['Open Tasks', 'Completed Tasks']);
    expect(translateMetadataDocument('object', InvoiceLine, bundle, { locale: 'en' }).fields.invoice.inlineTitle)
      .toBe('Line Items');
  });
});
