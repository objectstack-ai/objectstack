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
