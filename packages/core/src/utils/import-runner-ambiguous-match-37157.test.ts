// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `AMBIGUOUS_MATCH` row refusal (a row whose match key finds more than one
 * stored record) reads in the importing principal's language, as its sibling
 * row refusals do: it is the `import_ambiguous_match` entry of the shared
 * validation catalog, rendered with the caller's locale and override hook,
 * naming the key set by field LABEL and the object by its declared label. It
 * used to be the English sentence `matchFields matched more than one <object
 * API name> record`. The row keeps its shape and its code.
 *
 * Driven against an `ImportProtocolLike` double, as the sibling pins in
 * `import-runner-duplicate-match-key-36980.test.ts` are.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ValidationMessageTranslator } from '@objectstack/spec/system';
import { runImport, type ImportProtocolLike } from './import-runner';
import type { ExportFieldMeta } from './import-field-meta.js';

const OBJECT = 'crm_lead';

/** Every lookup answers two stored records, so every row is ambiguous. */
function protocol(objectLabel?: string): ImportProtocolLike & { getMetaItem: ReturnType<typeof vi.fn> } {
  return {
    findData: vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }]),
    createData: vi.fn(),
    updateData: vi.fn(),
    getMetaItem: vi.fn(async () => ({
      type: 'object', name: OBJECT,
      item: { name: OBJECT, ...(objectLabel !== undefined ? { label: objectLabel } : {}) },
    })),
  };
}

const meta = (labels: { email?: string; company?: string }) => new Map<string, ExportFieldMeta>([
  ['email', { name: 'email', type: 'email', ...(labels.email !== undefined ? { label: labels.email } : {}) }],
  ['company', { name: 'company', type: 'text', ...(labels.company !== undefined ? { label: labels.company } : {}) }],
]);

async function importWith(opts: {
  p: ImportProtocolLike;
  locale?: string;
  labels: { email?: string; company?: string };
  matchFields?: string[];
  rows?: Record<string, unknown>[];
  translate?: ValidationMessageTranslator;
}) {
  return runImport({
    p: opts.p,
    objectName: OBJECT,
    context: (opts.locale ? { locale: opts.locale } : {}) as any,
    rows: (opts.rows ?? [{ email: 'ada@example.com', company: 'Acme' }]) as any,
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

describe('the AMBIGUOUS_MATCH row refusal reads in the request language', () => {
  it('zh-CN: names the key by its field label and the object by its label', async () => {
    const p = protocol('线索');
    const s = await importWith({ p, locale: 'zh-CN', labels: { email: '邮箱' } });
    expect(s).toMatchObject({ ok: 0, errors: 1 });
    const r = s.results[0]!;
    // The row keeps its shape and its code: no new member.
    expect(Object.keys(r).sort()).toEqual(['action', 'code', 'error', 'ok', 'row']);
    expect(r).toMatchObject({ row: 1, ok: false, action: 'failed', code: 'AMBIGUOUS_MATCH' });
    expect(r.error).toBe('匹配键(邮箱)匹配到多条线索记录,因此该行未写入:请改用取值能唯一确定一条记录的字段匹配');
    expect(p.createData).not.toHaveBeenCalled();
    expect(p.updateData).not.toHaveBeenCalled();
  });

  it('en: the English sentence names the labels, never matchFields or the API names', async () => {
    const s = await importWith({ p: protocol('Lead'), locale: 'en', labels: { email: 'Email' } });
    expect(s.results[0]!.error).toBe(
      'The match key (Email) matches more than one Lead record, so the row was not written: '
      + 'match on fields whose values identify one record',
    );
  });

  it('no locale on the context reads English', async () => {
    const s = await importWith({ p: protocol('Lead'), labels: { email: 'Email' } });
    expect(s.results[0]!.error).toBe(
      'The match key (Email) matches more than one Lead record, so the row was not written: '
      + 'match on fields whose values identify one record',
    );
  });

  it('a key set of several fields names each label; a label-less field and object fall back to their API names', async () => {
    const s = await importWith({ p: protocol(), locale: 'zh-CN', labels: { email: '邮箱' }, matchFields: ['email', 'company'] });
    expect(s.results[0]!.error).toBe('匹配键(邮箱 + company)匹配到多条crm_lead记录,因此该行未写入:请改用取值能唯一确定一条记录的字段匹配');
    const noRead: ImportProtocolLike = { findData: vi.fn(async () => [{ id: 'a1' }, { id: 'a2' }]), createData: vi.fn(), updateData: vi.fn() };
    const bare = await importWith({ p: noRead, locale: 'en', labels: { email: 'Email', company: 'Company' }, matchFields: ['email', 'company'] });
    expect(bare.results[0]!.error).toBe(
      'The match key (Email + Company) matches more than one crm_lead record, so the row was not written: '
      + 'match on fields whose values identify one record',
    );
  });

  it('the object declaration is read once per run, however many rows are ambiguous', async () => {
    const p = protocol('线索');
    const s = await importWith({
      p, locale: 'zh-CN', labels: { email: '邮箱' },
      rows: [{ email: 'a@example.com' }, { email: 'b@example.com' }, { email: 'c@example.com' }],
    });
    expect(s.results.map((r) => r.code)).toEqual(['AMBIGUOUS_MATCH', 'AMBIGUOUS_MATCH', 'AMBIGUOUS_MATCH']);
    expect(p.getMetaItem).toHaveBeenCalledTimes(1);
  });

  it("a deployment's `validation.field.import_ambiguous_match` override wins, filled with the labels, the API names and the object", async () => {
    const translate: ValidationMessageTranslator = (key, locale) =>
      key === 'validation.field.import_ambiguous_match' && locale === 'zh-CN'
        ? '{{object}}中有多条记录的 {{label}}({{field}})相同' : key;
    const s = await importWith({ p: protocol('线索'), locale: 'zh-CN', labels: { email: '邮箱' }, translate });
    expect(s.results[0]!.error).toBe('线索中有多条记录的 邮箱(email)相同');
  });
});
