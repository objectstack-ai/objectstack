// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36980] The `DUPLICATE_MATCH_KEY` row refusal reads in the importing
 * principal's language and names the key by field LABEL, as the cell-coercion
 * failures in the same row report already do. It is rendered from the shared
 * validation catalog (`validation.field.import_duplicate_match_key`) with the
 * request locale and the deployment's override hook; the row numbers stay in
 * the sentence, and the row result keeps its shape (`row`, `ok`, `action`,
 * `code`, `error`).
 *
 * Driven against an `ImportProtocolLike` double; the route over a real engine
 * is pinned in `packages/rest/src/import-upsert-in-file-duplicate-key.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderValidationMessage, type ValidationMessageTranslator } from '@objectstack/spec/system';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

type ValidateArgs = Parameters<NonNullable<ImportProtocolLike['validateData']>>[0];

const OBJECT = 'crm_lead';

function protocol(): ImportProtocolLike {
  return {
    findData: vi.fn(async () => []),
    createData: vi.fn(async (args: any) => ({ record: { id: 'r1', ...args.data } })),
    updateData: vi.fn(),
    validateData: vi.fn(async (args: ValidateArgs) => ({
      object: OBJECT, mode: args.mode ?? 'insert', valid: true,
      results: [{ valid: true, errors: [], warnings: [] }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    })),
  };
}

const meta = (labels: { email?: string; company?: string }) => new Map<string, ExportFieldMeta>([
  ['first_name', { name: 'first_name', type: 'text', label: 'First Name' }],
  ['email', { name: 'email', type: 'email', ...(labels.email !== undefined ? { label: labels.email } : {}) }],
  ['company', { name: 'company', type: 'text', ...(labels.company !== undefined ? { label: labels.company } : {}) }],
]);

/** Rows 1 and 3 share the key; row 2 does not. */
const ROWS = [
  { first_name: 'Ada', email: 'ada@example.com', company: 'Acme' },
  { first_name: 'Bob', email: 'bob@example.com', company: 'Beta' },
  { first_name: 'Ada again', email: 'ada@example.com', company: 'Acme' },
];

async function importWith(opts: {
  locale?: string;
  labels: { email?: string; company?: string };
  matchFields?: string[];
  translate?: ValidationMessageTranslator;
}) {
  return runImport({
    p: protocol(),
    objectName: OBJECT,
    context: (opts.locale ? { locale: opts.locale } : {}) as any,
    rows: ROWS,
    metaMap: meta(opts.labels),
    ...(opts.translate ? { translate: opts.translate } : {}),
    writeMode: 'upsert',
    matchFields: opts.matchFields ?? ['email'],
    dryRun: true,
    runAutomations: false,
    trimWhitespace: true,
    createMissingOptions: false,
    skipBlankMatchKey: false,
  });
}

const expected = (label: string, locale: string) =>
  renderValidationMessage({ messageKey: 'import_duplicate_match_key', label, params: { rows: '1, 3' } }, { locale });

describe('[#36980] the duplicate-match-key row refusal reads in the request language', () => {
  it('zh-CN: the sentence is the zh-CN catalog entry, names the key by its label and keeps the row numbers', async () => {
    const s = await importWith({ locale: 'zh-CN', labels: { email: '邮箱' } });
    expect(s).toMatchObject({ ok: 1, errors: 2 });
    for (const row of [1, 3]) {
      const r = s.results[row - 1]!;
      // The row result keeps its shape: no new member.
      expect(Object.keys(r).sort()).toEqual(['action', 'code', 'error', 'ok', 'row']);
      expect(r).toMatchObject({ row, ok: false, action: 'failed', code: 'DUPLICATE_MATCH_KEY' });
      expect(r.error).toBe(expected('邮箱', 'zh-CN'));
      expect(r.error).toContain('邮箱');
      expect(r.error).toContain('1, 3');
      expect(r.error).not.toContain('email');
      expect(r.error).toMatch(/\p{Script=Han}/u);
      expect(r.error).not.toBe(expected('邮箱', 'en'));
    }
    expect(s.results[1]).toMatchObject({ row: 2, ok: true });
  });

  it('en: the English sentence names the key by its label, never the API name', async () => {
    const s = await importWith({ locale: 'en', labels: { email: 'Email' } });
    const r = s.results[0]!;
    expect(r).toMatchObject({ code: 'DUPLICATE_MATCH_KEY', error: expected('Email', 'en') });
    expect(r.error).toContain('(Email)');
    expect(r.error).toContain('1, 3');
    expect(r.error).not.toMatch(/\p{Script=Han}/u);
  });

  it('no locale on the context renders the English catalog entry', async () => {
    const s = await importWith({ labels: { email: 'Email' } });
    expect(s.results[0]!.error).toBe(expected('Email', 'en'));
  });

  it('a key set of several fields is named by each label; a field with no label falls back to its API name', async () => {
    const s = await importWith({ locale: 'zh-CN', labels: { email: '邮箱' }, matchFields: ['email', 'company'] });
    expect(s.results[0]!.error).toBe(expected('邮箱 + company', 'zh-CN'));
    const labelled = await importWith({ locale: 'zh-CN', labels: { email: '邮箱', company: '公司' }, matchFields: ['email', 'company'] });
    expect(labelled.results[0]!.error).toBe(expected('邮箱 + 公司', 'zh-CN'));
  });

  it("a deployment's `validation.field.import_duplicate_match_key` override wins, filled with the same label and rows", async () => {
    const translate: ValidationMessageTranslator = (key, locale) =>
      key === 'validation.field.import_duplicate_match_key' && locale === 'zh-CN'
        ? '重复的匹配键 {{label}}:第 {{rows}} 行' : key;
    const s = await importWith({ locale: 'zh-CN', labels: { email: '邮箱' }, translate });
    expect(s.results[0]!.error).toBe('重复的匹配键 邮箱:第 1, 3 行');
  });
});

/**
 * The importer's two other ROW refusals read the same way: a row blank on
 * every ordered key set (`BLANK_MATCH_KEY`, `import_blank_match_key`) and a
 * match key naming a field that holds a list or a structured value
 * (`VALIDATION_ERROR`, `import_multi_value_match_key`), each in the request
 * locale and naming the fields by label. The codes do not change.
 */
describe('the blank and multi-value match-key row refusals read in the request language', () => {
  const keyMeta = new Map<string, ExportFieldMeta>([
    ['first_name', { name: 'first_name', type: 'text', label: '名' }],
    ['email', { name: 'email', type: 'email', label: '邮箱' }],
    ['phone', { name: 'phone', type: 'phone', label: '电话' }],
    ['company', { name: 'company', type: 'text' }],
    ['tags', { name: 'tags', type: 'tags', label: '标签' }],
  ]);
  const run = (opts: { locale?: string; matchFields: string[] | string[][]; rows: Record<string, unknown>[] }) =>
    runImport({
      p: protocol(),
      objectName: OBJECT,
      context: (opts.locale ? { locale: opts.locale } : {}) as any,
      rows: opts.rows as any,
      metaMap: keyMeta,
      writeMode: 'upsert',
      matchFields: opts.matchFields,
      dryRun: true,
      runAutomations: false,
      trimWhitespace: true,
      createMissingOptions: false,
      skipBlankMatchKey: false,
    });

  it('zh-CN: a row blank on every key set is refused in zh-CN, naming each set by its labels', async () => {
    const s = await run({
      locale: 'zh-CN',
      matchFields: [['email'], ['phone', 'company']],
      rows: [{ first_name: 'Ada', email: 'ada@example.com' }, { first_name: 'Bob' }],
    });
    const r = s.results[1]!;
    expect(r).toMatchObject({ row: 2, ok: false, action: 'failed', code: 'BLANK_MATCH_KEY' });
    expect(r.error).toBe(renderValidationMessage(
      { messageKey: 'import_blank_match_key', label: '邮箱; 电话 + company' }, { locale: 'zh-CN' },
    ));
    expect(r.error).toContain('邮箱; 电话 + company');
    expect(r.error).not.toContain('email');
    expect(r.error).not.toContain('matchFields');
    expect(r.error).toBe('该行没有匹配键:每组匹配键(邮箱; 电话 + company)在该行都有空白字段');
    expect(s.results[0]).toMatchObject({ row: 1, ok: true });
  });

  it('zh-CN: a match key naming a multi-value field fails every row in zh-CN, naming the field by its label', async () => {
    const s = await run({
      locale: 'zh-CN',
      matchFields: ['email', 'tags'],
      rows: [{ email: 'ada@example.com', tags: 'a' }, { email: 'bob@example.com', tags: 'b' }],
    });
    for (const r of s.results) {
      expect(r).toMatchObject({ ok: false, action: 'failed', field: 'tags', code: 'VALIDATION_ERROR' });
      expect(r.error).toBe(renderValidationMessage(
        { messageKey: 'import_multi_value_match_key', label: '标签' }, { locale: 'zh-CN' },
      ));
      expect(r.error).toContain('标签');
      expect(r.error).not.toContain('tags');
      expect(r.error).not.toContain('matchFields');
      expect(r.error).toBe('不能用标签作为匹配键:匹配键每个字段只比较一个值,而列表或结构化值没有单一的值可比较,请改用单值字段(如编码、名称、邮箱)匹配');
    }
  });

  it('en and no locale: both read the English catalog entries, by label', async () => {
    for (const locale of ['en', undefined]) {
      const blank = await run({ locale, matchFields: [['email'], ['phone']], rows: [{ first_name: 'Bob' }] });
      expect(blank.results[0]!.error).toBe(renderValidationMessage(
        { messageKey: 'import_blank_match_key', label: '邮箱; 电话' }, { locale: 'en' },
      ));
      const multi = await run({ locale, matchFields: ['tags'], rows: [{ tags: 'a' }] });
      expect(multi.results[0]!.error).toBe(renderValidationMessage(
        { messageKey: 'import_multi_value_match_key', label: '标签' }, { locale: 'en' },
      ));
      expect(blank.results[0]!.error).toContain('The row has no match key');
      expect(multi.results[0]!.error).toContain('The match key cannot use 标签');
    }
  });

  it("a deployment's `validation.field.import_blank_match_key` override wins, filled with the labels and the API names", async () => {
    const translate: ValidationMessageTranslator = (key, locale) =>
      key === 'validation.field.import_blank_match_key' && locale === 'zh-CN'
        ? '缺少匹配键:{{label}} [{{field}}]' : key;
    const s = await runImport({
      p: protocol(),
      objectName: OBJECT,
      context: { locale: 'zh-CN' } as any,
      rows: [{ first_name: 'Bob' }] as any,
      metaMap: keyMeta,
      translate,
      writeMode: 'upsert',
      matchFields: [['email'], ['phone', 'company']],
      dryRun: true,
      runAutomations: false,
      trimWhitespace: true,
      createMissingOptions: false,
      skipBlankMatchKey: false,
    });
    expect(s.results[0]).toMatchObject({ code: 'BLANK_MATCH_KEY', error: '缺少匹配键:邮箱; 电话 + company [email; phone + company]' });
  });
});
