// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in datasource driver catalog.
 *
 * Each entry carries a JSON-Schema `configSchema` describing the driver's
 * connection options, so the Studio UI can render a typed connection form
 * instead of a raw-JSON editor (the `DriverDefinitionSchema.configSchema`
 * contract — "Used by the UI to generate the connection form").
 *
 * Served by `GET /api/v1/datasources/drivers`. This is the curated set of
 * connection drivers the connection form offers; a future runtime driver
 * registry can supersede this list without changing the route contract.
 *
 * ## The schemas are PROJECTED, not written here (#4410)
 *
 * They used to be JSON-Schema literals maintained in this file, in parallel
 * with `packages/spec`'s per-driver zod schemas — two descriptions of one shape,
 * neither checked against the other, and neither validating anything. #4410
 * made the zod side the gate `DatasourceSchema` parses `config` against, which
 * turns that duplication from untidy into dangerous: a form offering a field the
 * gate rejects is a Setup wizard whose Save cannot succeed, with the platform's
 * own form as the thing at fault.
 *
 * So the form renders the projection of the same schema that judges the save.
 * What stays local is CURATION — which drivers the form offers, and their
 * label/description/icon. `sqlite-wasm` is deliberately absent: it is
 * constructible and has a config contract, but it exists for CI and
 * no-native-build environments rather than as something an admin picks here.
 * `turso` is absent for the same reason since commit e2798fab7 gave it a contract: it is a
 * full builtin now, but it additionally needs an optional package installed next
 * to the server, which is not a thing a dropdown can arrange.
 * `mssql` (#31327) is absent for that reason too — its `tedious` binding is an
 * optional peer of driver-sql. It is also federation-only (`schemaMode:
 * 'external'` or `'validate-only'`), so it is declared in code with its
 * `external` block; its Tables tab and table import work once it is.
 *
 * ## The words are served in the requester's language
 *
 * `DRIVER_CATALOG` is the English catalog. The route serves
 * {@link driverCatalogFor} the requester's locale, which overlays the
 * translated label, description and field words of
 * `driver-catalog-translations.ts` on it; a word with no translation stays
 * English.
 */

import { getDriverConfigJsonSchemaById, type BuiltinDriverId } from '@objectstack/spec/data';
import { platformLocaleTagOf } from '@objectstack/spec/system';

import {
  DRIVER_CATALOG_TRANSLATIONS,
  type DriverCatalogLocale,
  type DriverCatalogText,
  type DriverFieldText,
} from './driver-catalog-translations.js';

export interface DriverCatalogEntry {
  /** Unique driver identifier used as `datasource.driver`. */
  id: string;
  /** Display label. */
  label: string;
  /** Optional one-line description. */
  description?: string;
  /** Optional Lucide icon name. */
  icon?: string;
  /** JSON Schema (draft-2020-12) for the driver's `config` object. */
  configSchema: Record<string, unknown>;
}

/** The curated part — everything except the shape, which comes from the spec. */
const CURATED: ReadonlyArray<{
  id: BuiltinDriverId;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'memory',
    label: 'In-Memory',
    description: 'Ephemeral in-memory driver for dev, tests, and prototyping. No connection settings.',
    icon: 'memory-stick',
  },
  {
    id: 'sqlite',
    label: 'SQLite',
    description: 'File-backed (or in-memory) SQL database. Great for local dev and small deployments.',
    icon: 'database',
  },
  {
    id: 'postgres',
    label: 'PostgreSQL',
    description: 'PostgreSQL connection. Supply host/port/database or a connection URL.',
    icon: 'database',
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    description: 'MySQL or MariaDB connection.',
    icon: 'database',
  },
  {
    // `mongodb` since commit e2798fab7 — the canonical driver id was renamed to the
    // spelling both boot hosts and `@objectstack/driver-mongodb` already used.
    // This `id` is what Studio writes into `datasource.driver`, so rows written
    // before the rename carry `mongo`; the ADR-0087 conversion
    // `datasource-driver-mongo-to-mongodb` converges them at rehydration. Since
    // 18 an authored `mongo` is refused; the spelling stays on the spec's
    // contract face only, so a stored row keeps its contract and its redaction.
    id: 'mongodb',
    label: 'MongoDB',
    description: 'MongoDB connection via a connection URI.',
    icon: 'database',
  },
];

export const DRIVER_CATALOG: DriverCatalogEntry[] = CURATED.map((entry) => ({
  ...entry,
  configSchema: getDriverConfigJsonSchemaById(entry.id),
}));

/** A property's own string, read without reaching `Object.prototype`. */
function ownString(record: Record<string, unknown>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * `prop` with its `title` / `description` replaced by `field`'s, each only
 * where the English side has that word: a translation never adds a word the
 * English form does not show.
 */
function localizeField(prop: Record<string, unknown>, field: DriverFieldText): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prop };
  if (field.title !== undefined && ownString(prop, 'title') !== undefined) out.title = field.title;
  if (field.description !== undefined && ownString(prop, 'description') !== undefined) {
    out.description = field.description;
  }
  return out;
}

/**
 * `entry` with `text` laid over it. The spec's projected schema is shared, so
 * it is copied, never written: the top-level object and `properties` are new,
 * and every property not translated is the same object as before.
 */
function localizeEntry(entry: DriverCatalogEntry, text: DriverCatalogText | undefined): DriverCatalogEntry {
  if (!text) return entry;
  let configSchema = entry.configSchema;
  const properties = configSchema.properties;
  if (text.fields && properties && typeof properties === 'object') {
    const props = properties as Record<string, Record<string, unknown>>;
    const localized: Record<string, unknown> = { ...props };
    for (const [key, field] of Object.entries(text.fields)) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      const prop = props[key];
      if (prop && typeof prop === 'object') localized[key] = localizeField(prop, field);
    }
    configSchema = { ...configSchema, properties: localized };
  }
  return {
    ...entry,
    label: text.label ?? entry.label,
    description: text.description ?? entry.description,
    configSchema,
  };
}

/**
 * The platform locale table language a requested code names, or `undefined`
 * for English and for a code the table does not name.
 *
 * Read through the table's own reader, `platformLocaleTagOf`, so a read alias
 * finds its language (`zh-TW`, `zh-HK` → `zh-Hant`; `zh`, `zh-CN` → `zh-Hans`;
 * `pt` → `pt-BR`). A code the table does not name is shortened one subtag at a
 * time (RFC 4647 lookup: `fr-CA` → `fr`, `zh-Hant-TW` → `zh-Hant`), the shape
 * the storage connection test reads a caller's language with. It never falls
 * to "the first variant of the base language", which would hand a Traditional
 * Chinese reader the Simplified text.
 */
export function driverCatalogLocaleOf(requested: string | undefined): DriverCatalogLocale | undefined {
  if (typeof requested !== 'string' || requested.length === 0) return undefined;
  const subtags = requested.split('-');
  for (let n = subtags.length; n > 0; n -= 1) {
    const tag = platformLocaleTagOf(subtags.slice(0, n).join('-'));
    if (tag) return tag === 'en' ? undefined : tag;
  }
  return undefined;
}

/**
 * The driver catalog in the language `requested` names — what
 * `GET /api/v1/datasources/drivers` serves.
 *
 * The language is {@link driverCatalogLocaleOf}. No locale, English, a code
 * the platform table does not name, or a word a language does not translate
 * is served in English, the `DRIVER_CATALOG` text, never a key.
 */
export function driverCatalogFor(requested: string | undefined): DriverCatalogEntry[] {
  const locale = driverCatalogLocaleOf(requested);
  if (locale === undefined) return DRIVER_CATALOG;
  const translations = DRIVER_CATALOG_TRANSLATIONS[locale];
  return DRIVER_CATALOG.map((entry) => localizeEntry(entry, translations[entry.id as BuiltinDriverId]));
}
