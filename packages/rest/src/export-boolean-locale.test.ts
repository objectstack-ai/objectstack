// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24945] A boolean or toggle cell of `GET /data/:object/export` is written in
 * the caller's language — the same language as the header row of that file.
 *
 * The export formatter used to write the literal `是` / `否` for every boolean
 * cell, whatever the caller read: an `Accept-Language: en-US` caller got the
 * English header row ("Converted", "Do Not Call") over Chinese cells. The words
 * now come from the one table the import template already offers them from,
 * `templateText(locale).booleanWords` (`import-template.ts`), for the locale the
 * route resolves for its header labels — the request's i18n service read once
 * and handed to both the header translation and the words, so the two halves of
 * the file cannot read two different locales.
 *
 * The file must stay importable in either language: the last block exports in
 * each language and re-imports the file through the real import route into a
 * fresh store, so the boolean column has to read back as the values it left as.
 *
 * Driven end to end: the real export and import routes, a real ObjectQL engine
 * and protocol, and a real sqlite `:memory:` driver (the harness of
 * `export-integration.test.ts`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { templateText } from './import-template.js';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** Authored in English; the zh-CN bundle below translates every label. */
const LEAD = {
  name: 'lead',
  label: 'Lead',
  systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    full_name: { name: 'full_name', type: 'text' as const, label: 'Full Name' },
    is_converted: { name: 'is_converted', type: 'boolean' as const, label: 'Converted' },
    do_not_call: { name: 'do_not_call', type: 'toggle' as const, label: 'Do Not Call' },
  },
};

const BUNDLE: Record<string, unknown> = {
  'zh-CN': {
    objects: {
      lead: {
        label: '线索',
        fields: {
          id: { label: '编号' },
          full_name: { label: '姓名' },
          is_converted: { label: '已转化' },
          do_not_call: { label: '请勿致电' },
        },
      },
    },
  },
};

/** An i18n service of the shape `@objectstack/service-i18n` serves. */
function i18nService(defaultLocale?: string) {
  return {
    getLocales: () => Object.keys(BUNDLE),
    getTranslations: (locale: string) => BUNDLE[locale],
    ...(defaultLocale ? { getDefaultLocale: () => defaultLocale } : {}),
  };
}

const ROWS = [
  { id: '1', full_name: 'Wren Halvorsen', is_converted: true, do_not_call: false },
  { id: '2', full_name: 'Tomas Okafor', is_converted: false, do_not_call: true },
];

const EN_HEADER = ['ID', 'Full Name', 'Converted', 'Do Not Call'];
const ZH_HEADER = ['编号', '姓名', '已转化', '请勿致电'];
const EN_CELLS = [['1', 'Wren Halvorsen', 'yes', 'no'], ['2', 'Tomas Okafor', 'no', 'yes']];
const ZH_CELLS = [['1', 'Wren Halvorsen', '是', '否'], ['2', 'Tomas Okafor', '否', '是']];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res: any = {
    write: (c: any) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; },
    end: () => {},
    header: (n: string, v: string) => { headers[n] = v; return res; },
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return { res, headers, text: () => Buffer.concat(chunks).toString('utf8'), buffer: () => Buffer.concat(chunks) };
}

/**
 * Boot one engine + REST server. `i18n` is the request's i18n service:
 * `null` leaves the server's own resolution in place (none in this harness).
 */
async function boot(i18n: unknown, rows: ReadonlyArray<Record<string, unknown>> = ROWS) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }), true);
  await engine.init();
  engine.registry.registerObject(LEAD as any);
  await engine.syncSchemas();
  for (const row of rows) await engine.insert('lead', { ...row });
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  if (i18n !== null) (rest as any).resolveI18nService = async () => i18n;
  rest.registerRoutes();
  const routes = rest.getRoutes();
  const exportRoute = routes.find((r: any) => r.method === 'GET' && r.path === '/api/v1/data/:object/export')!;
  const importRoute = routes.find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import')!;
  return { engine, exportRoute, importRoute };
}

async function exportFile(
  route: any,
  format: 'csv' | 'xlsx' | 'json',
  opts: { acceptLanguage?: string; locale?: string } = {},
) {
  const { res, text, buffer } = makeRes();
  await route.handler({
    params: { object: 'lead' },
    query: { format, ...(opts.locale ? { locale: opts.locale } : {}) },
    headers: opts.acceptLanguage ? { 'accept-language': opts.acceptLanguage } : {},
  } as any, res);
  return { text, buffer };
}

function csvRows(text: string): string[][] {
  return text.split('\r\n').filter((l) => l.length > 0).map((l) => l.split(','));
}

async function xlsxRows(buffer: Buffer): Promise<string[][]> {
  const ws = (await loadXlsxWorkbook(buffer)).worksheets[0];
  const out: string[][] = [];
  ws.eachRow((row) => { out.push((row.values as unknown[]).slice(1).map((v) => String(v))); });
  return out;
}

describe('export: a boolean cell speaks the language of its header row', () => {
  it('an English caller gets yes / no under the English header (csv)', async () => {
    const { exportRoute } = await boot(i18nService('en'));
    const rows = csvRows((await exportFile(exportRoute, 'csv', { acceptLanguage: 'en-US' })).text());
    expect(rows).toEqual([EN_HEADER, ...EN_CELLS]);
  });

  it('a Chinese caller gets 是 / 否 under the Chinese header (csv)', async () => {
    const { exportRoute } = await boot(i18nService('en'));
    const rows = csvRows((await exportFile(exportRoute, 'csv', { acceptLanguage: 'zh-CN' })).text());
    expect(rows).toEqual([ZH_HEADER, ...ZH_CELLS]);
  });

  it('xlsx writes the same words as csv, per caller', async () => {
    const { exportRoute } = await boot(i18nService('en'));
    expect(await xlsxRows((await exportFile(exportRoute, 'xlsx', { acceptLanguage: 'en-US' })).buffer()))
      .toEqual([EN_HEADER, ...EN_CELLS]);
    expect(await xlsxRows((await exportFile(exportRoute, 'xlsx', { acceptLanguage: 'zh-CN' })).buffer()))
      .toEqual([ZH_HEADER, ...ZH_CELLS]);
  });

  it('json writes the same words as csv, per caller', async () => {
    const { exportRoute } = await boot(i18nService('en'));
    const en = JSON.parse((await exportFile(exportRoute, 'json', { acceptLanguage: 'en-US' })).text());
    expect(en.map((r: any) => [r.is_converted, r.do_not_call])).toEqual([['yes', 'no'], ['no', 'yes']]);
    const zh = JSON.parse((await exportFile(exportRoute, 'json', { acceptLanguage: 'zh-CN' })).text());
    expect(zh.map((r: any) => [r.is_converted, r.do_not_call])).toEqual([['是', '否'], ['否', '是']]);
  });

  it('`?locale=` picks the language of the header and the cells alike', async () => {
    const { exportRoute } = await boot(i18nService('en'));
    const rows = csvRows((await exportFile(exportRoute, 'csv', { locale: 'zh-CN' })).text());
    expect(rows).toEqual([ZH_HEADER, ...ZH_CELLS]);
  });

  it('a caller naming no locale gets the deployment default locale in the header and the cells alike', async () => {
    // The default locale is read off the i18n service. Both halves of the
    // file must read it from the SAME service, or a zh-CN deployment would
    // write a Chinese header over English cells to every header-less caller.
    const zh = await boot(i18nService('zh-CN'));
    expect(csvRows((await exportFile(zh.exportRoute, 'csv')).text())).toEqual([ZH_HEADER, ...ZH_CELLS]);
    const en = await boot(i18nService('en'));
    expect(csvRows((await exportFile(en.exportRoute, 'csv')).text())).toEqual([EN_HEADER, ...EN_CELLS]);
  });

  it('no locale at all and no i18n service: the authored header and templateText(undefined) words', async () => {
    const { exportRoute } = await boot(null);
    const [yes, no] = templateText(undefined).booleanWords;
    const rows = csvRows((await exportFile(exportRoute, 'csv')).text());
    expect(rows).toEqual([EN_HEADER, ['1', 'Wren Halvorsen', yes, no], ['2', 'Tomas Okafor', no, yes]]);
  });
});

describe('export → import: each language re-imports its boolean column', () => {
  const MAPPINGS: Record<'en' | 'zh', Record<string, string>> = {
    en: { 'ID': 'id', 'Full Name': 'full_name', 'Converted': 'is_converted', 'Do Not Call': 'do_not_call' },
    zh: { '编号': 'id', '姓名': 'full_name', '已转化': 'is_converted', '请勿致电': 'do_not_call' },
  };

  for (const [lang, acceptLanguage] of [['en', 'en-US'], ['zh', 'zh-CN']] as const) {
    it(`${lang}: csv`, async () => {
      const source = await boot(i18nService('en'));
      const csv = (await exportFile(source.exportRoute, 'csv', { acceptLanguage })).text();

      const target = await boot(i18nService('en'), []);
      const { res } = makeRes();
      await target.importRoute.handler({
        params: { object: 'lead' },
        headers: { 'accept-language': acceptLanguage },
        body: { format: 'csv', csv, mapping: MAPPINGS[lang] },
      } as any, res);
      expect(res._json).toMatchObject({ total: 2, ok: 2, errors: 0, created: 2 });
      const stored = await target.engine.find('lead', { orderBy: [{ field: 'id', order: 'asc' }] } as any);
      expect(stored.map((r: any) => [r.id, r.is_converted, r.do_not_call]))
        .toEqual([['1', true, false], ['2', false, true]]);
    });

    it(`${lang}: xlsx`, async () => {
      const source = await boot(i18nService('en'));
      const xlsxBase64 = (await exportFile(source.exportRoute, 'xlsx', { acceptLanguage })).buffer().toString('base64');

      const target = await boot(i18nService('en'), []);
      const { res } = makeRes();
      await target.importRoute.handler({
        params: { object: 'lead' },
        headers: { 'accept-language': acceptLanguage },
        body: { format: 'xlsx', xlsxBase64, mapping: MAPPINGS[lang] },
      } as any, res);
      expect(res._json).toMatchObject({ total: 2, ok: 2, errors: 0, created: 2 });
      const stored = await target.engine.find('lead', { orderBy: [{ field: 'id', order: 'asc' }] } as any);
      expect(stored.map((r: any) => [r.id, r.is_converted, r.do_not_call]))
        .toEqual([['1', true, false], ['2', false, true]]);
    });
  }
});
