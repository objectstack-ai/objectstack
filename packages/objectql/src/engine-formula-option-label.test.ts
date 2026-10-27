// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26608 — a record name composed of select option labels renders in the
 * reader's locale.
 *
 * `label(record.<field>)` (`@objectstack/formula`) answers from the option
 * labels the engine pins for the read (`formula-option-labels.ts`). These
 * tests drive the engine's own read and write paths, because the readers the
 * card names read exactly these answers: the console's save toast names the
 * record from the WRITE response, the record page H1 from `findOne`, a related
 * list from `find`. None of them evaluates the formula itself.
 *
 * The locale is the read's `ExecutionContext.locale` (the request's
 * `Accept-Language`); the labels are the object's declared `options` with the
 * i18n service's bundle laid over them by `translateObject`, as
 * `GET /meta/object/:name` serves them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

/** The hotclm contract-version shape from the card: a version number and a select. */
const VERSION = {
  name: 'ol_version',
  label: 'Contract Version',
  nameField: 'display_name',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    version_no: { name: 'version_no', label: 'Version', type: 'number' as const },
    kind: {
      name: 'kind', label: 'Kind', type: 'select' as const,
      options: [{ label: 'Clean', value: 'clean' }, { label: 'Redline', value: 'redline' }],
    },
    display_name: {
      name: 'display_name', label: 'Name', type: 'formula' as const,
      expression: { dialect: 'cel', source: "'v' + string(record.version_no) + ' · ' + label(record.kind)" },
    },
    // A STORED computed field reading the same label: computed once on the
    // write and kept for every later reader and for search.
    search_name: {
      name: 'search_name', label: 'Search Name', type: 'text' as const,
      expression: { dialect: 'cel', source: "'v' + string(record.version_no) + ' · ' + label(record.kind)" },
    },
  },
};

/** The i18n service shape the engine is bridged to: a zh-CN bundle and an English default. */
function makeI18n(overrides: Record<string, unknown> = {}) {
  const translations: Record<string, Record<string, unknown>> = {
    'zh-CN': { objects: { ol_version: { fields: { kind: { options: { clean: '清稿', redline: '修订稿' } } } } } },
    en: {},
  };
  return {
    t: (key: string) => key,
    getLocales: () => Object.keys(translations),
    getTranslations: (locale: string) => translations[locale] ?? {},
    getFallbackLocale: () => 'en',
    getDefaultLocale: () => 'en',
    ...overrides,
  };
}

function makeStubDriver() {
  const store = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
      if (k.startsWith('$')) continue;
      const expected = v && typeof v === 'object' && '$eq' in (v as Record<string, unknown>)
        ? (v as Record<string, unknown>).$eq
        : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  // Shallow COPIES, never live references: the read path hydrates the rows a
  // driver returns in place, and a leaked reference would write the label into
  // the store on the first read.
  const driver = {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find(_o: string, ast: { where?: unknown }) {
      return [...store.values()].filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(_o: string, ast: { where?: unknown }) {
      for (const r of store.values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      store.set(id, { ...data, id });
      return { ...data, id };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const cur = store.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      store.set(id, next);
      return { ...next };
    },
    async delete(_o: string, id: string) { return store.delete(id); },
    async count(_o: string, ast: { where?: unknown }) { return (await this.find(_o, ast)).length; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return { driver, store };
}

async function makeEngine(i18n: ReturnType<typeof makeI18n> | null = makeI18n()) {
  const engine = new ObjectQL();
  const rig = makeStubDriver();
  engine.registerDriver(rig.driver as never, true);
  await engine.init();
  engine.registry.registerObject(VERSION as never, 'test');
  if (i18n) engine.setI18nService(i18n);
  return { engine, ...rig };
}

type Rig = Awaited<ReturnType<typeof makeEngine>>;
type Rec = Record<string, unknown>;

const zhCN = { locale: 'zh-CN' } as never;
const enUS = { locale: 'en-US' } as never;

describe('#26608 — label() reads the option label in the reader\'s locale', () => {
  let rig: Rig;
  beforeEach(async () => { rig = await makeEngine(); });

  it('the write response — what the save toast names the record from — reads zh-CN and en-US', async () => {
    const zh = await rig.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: zhCN }) as Rec;
    expect(zh.display_name).toBe('v2 · 清稿');
    const en = await rig.engine.insert('ol_version', { version_no: 3, kind: 'redline' }, { context: enUS }) as Rec;
    expect(en.display_name).toBe('v3 · Redline');
  });

  it('an update response reads the updater\'s locale', async () => {
    const created = await rig.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: enUS }) as Rec;
    const updated = await rig.engine.update(
      'ol_version', { id: created.id, kind: 'redline' }, { context: zhCN },
    ) as Rec;
    expect(updated.display_name).toBe('v2 · 修订稿');
  });

  it('a read — the record H1 and a related list — reads each reader\'s own locale', async () => {
    const created = await rig.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: enUS }) as Rec;
    const one = (locale: unknown) =>
      rig.engine.findOne('ol_version', { where: { id: created.id }, context: locale } as never) as Promise<Rec>;
    expect((await one(zhCN)).display_name).toBe('v2 · 清稿');
    expect((await one(enUS)).display_name).toBe('v2 · Clean');
    const rows = await rig.engine.find('ol_version', { context: zhCN } as never) as Rec[];
    expect(rows.map((r) => r.display_name)).toEqual(['v2 · 清稿']);
  });

  it('a base-language tag resolves as the metadata route resolves it', async () => {
    const created = await rig.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: { locale: 'zh' } as never }) as Rec;
    expect(created.display_name).toBe('v2 · 清稿');
  });

  it('a read with no locale reads the declared labels', async () => {
    const created = await rig.engine.insert('ol_version', { version_no: 2, kind: 'clean' }) as Rec;
    expect(created.display_name).toBe('v2 · Clean');
  });

  it('a STORED expression stores the declared label, whatever locale the writer used', async () => {
    const created = await rig.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: zhCN }) as Rec;
    expect(created.display_name).toBe('v2 · 清稿');
    expect(rig.store.get(created.id as string)?.search_name).toBe('v2 · Clean');
  });

  it('no i18n service, or one that fails: the declared labels, and the read still answers', async () => {
    const bare = await makeEngine(null);
    const a = await bare.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: zhCN }) as Rec;
    expect(a.display_name).toBe('v2 · Clean');

    const broken = await makeEngine(makeI18n({ getTranslations: () => { throw new Error('bundle offline'); } }));
    const b = await broken.engine.insert('ol_version', { version_no: 2, kind: 'clean' }, { context: zhCN }) as Rec;
    expect(b.display_name).toBe('v2 · Clean');
  });
});
