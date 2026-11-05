// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connection form and the config gate must describe ONE shape (#4410).
 *
 * Before this, the catalog carried hand-written JSON-Schema literals while
 * `packages/spec` carried zod schemas for the same drivers — two descriptions,
 * neither checked against the other and neither validating anything, so the
 * drift was invisible. Now that the zod side is the gate `DatasourceSchema` and
 * `DatasourceAdminService` both parse `config` against, a divergence stops being
 * cosmetic: a form field the gate rejects is a Save that cannot succeed, and a
 * gate key the form omits is a setting only hand-written JSON can reach.
 *
 * The catalog is derived rather than reconciled, so these are proofs that the
 * derivation is real — the failure they exist to catch is someone "simplifying"
 * it back into literals.
 */

import { describe, it, expect } from 'vitest';
import {
  getDriverConfigJsonSchemaById,
  validateDriverConfig,
  type BuiltinDriverId,
} from '@objectstack/spec/data';

import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';

import { DRIVER_CATALOG, driverCatalogFor, driverCatalogLocaleOf } from '../driver-catalog.js';
import { DRIVER_CATALOG_TRANSLATIONS } from '../driver-catalog-translations.js';

describe('DRIVER_CATALOG', () => {
  it('serves the spec projection for every offered driver', () => {
    expect(DRIVER_CATALOG.length).toBeGreaterThan(0);
    for (const entry of DRIVER_CATALOG) {
      expect(entry.configSchema, entry.id)
        .toBe(getDriverConfigJsonSchemaById(entry.id as BuiltinDriverId));
    }
  });

  it('offers only drivers the platform can build and validate', () => {
    for (const entry of DRIVER_CATALOG) {
      expect(validateDriverConfig(entry.id, {}).known, entry.id).toBe(true);
    }
  });

  it('keeps its curation — label, description and icon per entry', () => {
    for (const entry of DRIVER_CATALOG) {
      expect(entry.label, entry.id).toBeTruthy();
      expect(entry.description, entry.id).toBeTruthy();
      expect(entry.icon, entry.id).toBeTruthy();
    }
    // `mongodb`, not `mongo`, since commit e2798fab7 renamed the canonical driver id. This
    // list is the PUBLISHED contract Studio writes into `datasource.driver`, so
    // the assertion is the one that has to move with the rename — stored rows
    // carrying `mongo` are converged by the ADR-0087 conversion
    // `datasource-driver-mongo-to-mongodb`.
    expect(DRIVER_CATALOG.map((d) => d.id)).toEqual(['memory', 'sqlite', 'postgres', 'mysql', 'mongodb']);
  });

  /**
   * The form renders the AUTHOR-facing shape, so a field carrying a default
   * must not be marked required — an input-mode projection, not output-mode.
   * Getting this backwards would make the wizard demand a `host` the driver
   * already defaults.
   */
  it('projects the input shape, so defaulted fields stay optional', () => {
    const postgres = DRIVER_CATALOG.find((d) => d.id === 'postgres')!;
    const schema = postgres.configSchema as { required?: string[]; properties: Record<string, unknown> };

    expect(Object.keys(schema.properties)).toContain('host');
    expect(schema.required ?? []).not.toContain('host');
  });

  it('every field the form offers is a field the gate accepts', () => {
    for (const entry of DRIVER_CATALOG) {
      const schema = entry.configSchema as { properties: Record<string, unknown> };
      for (const key of Object.keys(schema.properties)) {
        const result = validateDriverConfig(entry.id, { [key]: undefined });
        expect(result.known, `${entry.id}.${key}`).toBe(true);
        const issues = (result as { issues: Array<{ message: string }> }).issues;
        const unknownKey = issues.some((i) => i.message.includes('Unrecognized key'));
        expect(unknownKey, `${entry.id}.${key} is offered by the form but rejected by the gate`)
          .toBe(false);
      }
    }
  });
});

type JsonProp = { title?: string; description?: string; type?: string };
const propsOf = (entry: { configSchema: Record<string, unknown> }) =>
  (entry.configSchema as { properties: Record<string, JsonProp> }).properties;
const entryOf = (catalog: typeof DRIVER_CATALOG, id: string) => {
  const entry = catalog.find((d) => d.id === id);
  if (!entry) throw new Error(`no ${id} entry`);
  return entry;
};
const filenameTitle = (tag: string | undefined) => propsOf(entryOf(driverCatalogFor(tag), 'sqlite')).filename.title;

/** The labels that are product names, served as written in every language. */
const PRODUCT_NAME_LABELS = new Set(['sqlite', 'postgres', 'mysql', 'mongodb']);

/**
 * The catalog's words in the requester's language. The New datasource dialog
 * draws exactly what the drivers route serves and has no key of its own for
 * these words, so a Chinese console read `Filename`, `Auto-migrate schema`,
 * `Host` and `Port` in English until the route served them translated.
 */
describe('driverCatalogFor', () => {
  it('serves Simplified Chinese words for SQLite and the network drivers', () => {
    const zh = driverCatalogFor('zh-CN');

    const sqlite = entryOf(zh, 'sqlite');
    expect(sqlite.description).toBe('基于文件（或内存）的 SQL 数据库，适合本地开发和小型部署。');
    expect(propsOf(sqlite).filename.title).toBe('文件名');
    expect(propsOf(sqlite).filename.description).toBe('数据库文件路径，或填 ":memory:" 使用临时内存数据库');
    expect(propsOf(sqlite).autoMigrate.title).toBe('自动迁移表结构');

    const postgres = entryOf(zh, 'postgres');
    expect(propsOf(postgres).host).toMatchObject({ title: '主机', description: '主机地址' });
    expect(propsOf(postgres).port).toMatchObject({ title: '端口', description: '端口号' });
    expect(propsOf(postgres).password.title).toBe('密码');

    expect(propsOf(entryOf(zh, 'mysql')).host.title).toBe('主机');
    expect(propsOf(entryOf(zh, 'mongodb')).port.title).toBe('端口');
    expect(entryOf(zh, 'memory').label).toBe('内存');
  });

  it('serves a word of its own in every language on the platform table', () => {
    const expected: Record<string, string> = {
      'zh-Hans': '文件名',
      'zh-Hant': '檔案名稱',
      es: 'Nombre de archivo',
      ar: 'اسم الملف',
      fr: 'Nom de fichier',
      'pt-BR': 'Nome do arquivo',
      ru: 'Имя файла',
      de: 'Dateiname',
      ja: 'ファイル名',
      ko: '파일 이름',
    };
    expect(Object.keys(expected).sort()).toEqual(PLATFORM_LOCALE_TAGS.filter((t) => t !== 'en').sort());
    for (const [tag, title] of Object.entries(expected)) expect(filenameTitle(tag), tag).toBe(title);
  });

  it('reads Traditional Chinese codes as Traditional, never Simplified', () => {
    for (const tag of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-hant', 'zh-Hant-TW', 'zh-Hant-HK']) {
      expect(driverCatalogLocaleOf(tag), tag).toBe('zh-Hant');
      expect(filenameTitle(tag), tag).toBe('檔案名稱');
    }
    for (const tag of ['zh', 'zh-CN', 'zh-cn', 'zh-SG', 'zh-Hans', 'zh-Hans-CN']) {
      expect(driverCatalogLocaleOf(tag), tag).toBe('zh-Hans');
      expect(filenameTitle(tag), tag).toBe('文件名');
    }
  });

  it('reads aliases and regional codes through the platform table', () => {
    const cases: Array<[string, string]> = [
      ['ja-JP', 'ja'], ['es-ES', 'es'], ['es-MX', 'es'], ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'],
      ['fr-CA', 'fr'], ['de-AT', 'de'], ['ko-KR', 'ko'], ['ar-EG', 'ar'], ['ru-RU', 'ru'],
    ];
    for (const [code, tag] of cases) expect(driverCatalogLocaleOf(code), code).toBe(tag);
  });

  it('keeps everything but the words: ids, icons, types and defaults are the English entry\'s', () => {
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const served = driverCatalogFor(tag);
      expect(served.map((d) => [d.id, d.icon]), tag).toEqual(DRIVER_CATALOG.map((d) => [d.id, d.icon]));
      for (const entry of served) {
        const english = propsOf(entryOf(DRIVER_CATALOG, entry.id));
        const translated = propsOf(entry);
        expect(Object.keys(translated), `${tag}.${entry.id}`).toEqual(Object.keys(english));
        for (const key of Object.keys(english)) {
          const { title: _t, description: _d, ...rest } = translated[key];
          const { title: _et, description: _ed, ...englishRest } = english[key];
          expect(rest, `${tag}.${entry.id}.${key}`).toEqual(englishRest);
        }
      }
    }
  });

  it('serves English for no locale, English, or a code the platform table does not name', () => {
    for (const tag of [undefined, '', 'en', 'en-US', 'en-GB', 'it', 'nl-NL', 'constructor', '__proto__']) {
      expect(driverCatalogFor(tag), String(tag)).toBe(DRIVER_CATALOG);
    }
    expect(propsOf(entryOf(DRIVER_CATALOG, 'sqlite')).filename.title).toBe('Filename');
    expect(propsOf(entryOf(DRIVER_CATALOG, 'postgres')).host.title).toBe('Host');
  });

  it('falls back to the English word where a language has none, never to a key', () => {
    const zh = driverCatalogFor('zh-CN');
    // Product names are not translated: the English label is served.
    expect(entryOf(zh, 'sqlite').label).toBe('SQLite');
    expect(entryOf(zh, 'postgres').label).toBe('PostgreSQL');
    // The memory driver's fields carry a description and no title in English;
    // the translation adds no title, so the form still names the field by key.
    expect(propsOf(entryOf(zh, 'memory')).strictMode.title).toBeUndefined();
    expect(propsOf(entryOf(zh, 'memory')).strictMode.description).toBe('记录不存在时抛出错误，而不是返回 null');
  });

  it('never writes the spec projection it overlays', () => {
    for (const tag of PLATFORM_LOCALE_TAGS) driverCatalogFor(tag);
    const sqlite = getDriverConfigJsonSchemaById('sqlite') as { properties: Record<string, JsonProp> };
    expect(sqlite.properties.filename.title).toBe('Filename');
    expect(propsOf(entryOf(DRIVER_CATALOG, 'sqlite')).filename.title).toBe('Filename');
    expect(entryOf(DRIVER_CATALOG, 'memory').label).toBe('In-Memory');
  });
});

/**
 * Every language on the platform locale table against the served shape. It
 * walks `PLATFORM_LOCALE_TAGS`, not the translation table's own keys, so a
 * language the table lacks goes red here: the platform has one list of
 * languages, each complete. A driver or field a language names must exist, so
 * a renamed field cannot leave a translation that silently stops applying; and
 * every word the English form shows must be translated, so a field the spec
 * adds goes red here rather than reading English in a translated dialog.
 */
describe('DRIVER_CATALOG_TRANSLATIONS coverage', () => {
  const offered = new Set(DRIVER_CATALOG.map((d) => d.id));
  const languages = PLATFORM_LOCALE_TAGS.filter((tag) => tag !== 'en');

  it('carries every non-English language on the platform table, and nothing else', () => {
    expect(PLATFORM_LOCALE_TAGS).toContain('en');
    expect(Object.keys(DRIVER_CATALOG_TRANSLATIONS).sort()).toEqual([...languages].sort());
  });

  for (const locale of languages) {
    it(`${locale}: names only drivers and fields the catalog serves`, () => {
      const table = DRIVER_CATALOG_TRANSLATIONS[locale];
      expect(table, locale).toBeDefined();
      for (const [id, text] of Object.entries(table ?? {})) {
        expect(offered.has(id), `${locale}.${id}`).toBe(true);
        const props = propsOf(entryOf(DRIVER_CATALOG, id));
        for (const key of Object.keys(text?.fields ?? {})) {
          expect(Object.prototype.hasOwnProperty.call(props, key), `${locale}.${id}.fields.${key}`).toBe(true);
        }
      }
    });

    it(`${locale}: translates every word the English form shows`, () => {
      const table = DRIVER_CATALOG_TRANSLATIONS[locale];
      for (const entry of DRIVER_CATALOG) {
        const text = table?.[entry.id as keyof typeof table];
        expect(text?.description, `${locale}.${entry.id}.description`).toBeTruthy();
        if (!PRODUCT_NAME_LABELS.has(entry.id)) expect(text?.label, `${locale}.${entry.id}.label`).toBeTruthy();
        for (const [key, prop] of Object.entries(propsOf(entry))) {
          const field = text?.fields?.[key];
          if (prop.title !== undefined) expect(field?.title, `${locale}.${entry.id}.${key}.title`).toBeTruthy();
          if (prop.description !== undefined) {
            expect(field?.description, `${locale}.${entry.id}.${key}.description`).toBeTruthy();
          }
        }
      }
    });
  }
});
