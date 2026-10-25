// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Seed Import Strategy
 * Defines how the engine handles existing records when a seed is applied.
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { LocaleSchema } from '../system/translation.zod';
import { findClosestMatches, formatSuggestion } from '../shared/suggestions.zod';
import { resolveInjectedSystemColumns, type InjectedSystemColumnName } from './injected-system-columns';
import { ColumnApplyOnSchema } from './column-apply-on.zod';
export const SeedMode = z.enum([
  'insert',    // Try to insert, fail on duplicate
  'update',    // Only update found records, ignore new
  'upsert',    // Create new or Update existing (Standard)
  'replace',   // Delete ALL records in object then insert (Dangerous - use for cache tables)
  'ignore'     // Try to insert, silently skip duplicates
]);

/**
 * Seed Column — the write policy a seed dataset declares for one of its
 * columns, under {@link SeedSchema.shape.columns}.
 */
export const SeedColumnSchema = lazySchema(() => strictObject({
  surface: 'this seed column',
  history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
}, {
  /**
   * When a load writes this column (#25761, ruled on hotclm#41: "job-written
   * columns are written on first seed only — via the platform").
   *
   * `create` takes the column out of every write to a row the load MATCHED by
   * the dataset's `externalId`: an `upsert` replay over an existing row, and
   * every row of an `update` dataset. The column is not compared for the
   * replay's no-op check, not written, and — a reference column — not
   * resolved and not deferred to pass 2, so nothing the load does afterwards
   * writes it back. A row the load creates gets it like any other column.
   * `insert`, `ignore` and `replace` never update a matched row, so the policy
   * changes nothing on those modes.
   *
   * A column of the dataset's `externalId` is the key the row was matched by:
   * it stays in the matched row's update whatever it declares, as an import's
   * match key does.
   *
   * Same values, same default and same meaning as the import door's
   * `FieldMappingEntry.applyOn` ({@link ColumnApplyOnSchema}).
   */
  applyOn: ColumnApplyOnSchema.default('always')
    .describe(
      'When a seed load writes this column. `always` (default) writes it on every row the load ' +
      'creates or updates. `create` writes it only when the load creates the row: an `upsert` ' +
      'replay that matches an existing row leaves the row\'s value as it is, and an `update` ' +
      'dataset never writes it, so replaying the seed refreshes the `always` columns without ' +
      'reverting state the app wrote since the first load. A column of the dataset\'s ' +
      '`externalId` is still matched on and stays in the matched row\'s update. The same values ' +
      'and meaning as an import mapping entry\'s `applyOn`.',
    ),
}));
/** Author-time shape of {@link SeedColumnSchema}. */
export type SeedColumn = z.input<typeof SeedColumnSchema>;
/** Post-parse shape of {@link SeedColumn} — defaults applied, transforms run (ADR-0122). */
export type SeedColumnParsed = z.infer<typeof SeedColumnSchema>;

/**
 * Seed Schema (Seed Data / Fixtures)
 *
 * Standardized format for transporting initialization data. Used for:
 * 1. System Bootstrapping (Admin accounts, Standard Roles)
 * 2. Reference Data (Countries, Currencies)
 * 3. Demo / sample data (incl. AI-authored, applied on publish)
 *
 * This is the shape of the runtime-draftable `seed` metadata type: an author
 * (or the AI metadata assistant) stages a `seed` draft against this schema and
 * its rows load when the draft is published. Named `Seed` (not `Dataset`) so
 * the `dataset` name stays reserved for the ADR-0021 analytics semantic layer.
 */
export const SeedSchema = lazySchema(() => strictObject({
  surface: 'this seed',
  history:
    'Until this shape was closed, these were dropped silently — the seed still applied, on the defaults '
    + '(`mode: upsert`, `externalId: name`) rather than what was written.',
  aliases: {
    objectname: 'object',
    target: 'object',
    data: 'records',
    rows: 'records',
    values: 'records',
    key: 'externalId',
    externalkey: 'externalId',
    naturalkey: 'externalId',
    strategy: 'mode',
    conflict: 'mode',
    environment: 'env',
    environments: 'env',
    locales: 'locale',
    language: 'locale',
    languages: 'locale',
  },
  guidance: {
    applyOn:
      '`applyOn` is a per-column policy, not a dataset key — declare it under `columns`, keyed by the '
      + "field it governs: `columns: { status: { applyOn: 'create' } }`.",
  },
}, {
  /**
   * Target Object
   * The machine name of the object to populate.
   */
  object: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Target Object Name'),

  /**
   * Idempotency Key (The "Upsert" Key)
   * The field (or fields) used to check if a record already exists.
   * Best Practice: Use a natural key like 'code', 'slug', 'username' or 'external_id'.
   * Standard: 'id' is rarely used for portable seed data — prefer natural keys.
   *
   * A single field name matches on that one column. A **composite** natural key
   * — a list of field names — is required for objects with no single-field
   * natural key, most commonly a **join / junction table** keyed by both of its
   * foreign keys (e.g. `externalId: ['team', 'project']`). Without it such a
   * dataset can only run `mode: 'insert'`, which re-inserts every row on each
   * replay boot and duplicates the table (framework#3434). The reference fields
   * are matched by their RESOLVED ids, so a composite of foreign keys dedupes
   * correctly across restarts.
   */
  externalId: z
    .union([z.string(), z.array(z.string()).min(1)])
    .default('name')
    .describe('Field (or composite list of fields) matched for the uniqueness check'),

  /**
   * Import Strategy
   */
  mode: SeedMode.default('upsert').describe('Conflict resolution strategy'),

  /**
   * Column Policies
   *
   * Per-column write policy, keyed by the field a record writes; a column the
   * map does not name keeps every default. Today one policy,
   * {@link SeedColumnSchema.shape.applyOn}.
   *
   * A seed is replayed — every dev-server boot, every package re-publish — and
   * an `upsert` replay re-asserts every column a record declares on the row it
   * matched. That is right for master data and wrong for a column the app owns
   * after the first write: a status a scheduled job advances, a flag a job sets
   * once its notice is sent. Declared `applyOn: 'create'`, such a column is
   * written when the seed creates the row and left as the row holds it on every
   * replay after.
   *
   * Each key must name a column the target object has — a declared field or a
   * system column the platform injects on it. `defineSeed` refuses one that
   * does not when it runs, and the loader warns, naming the column, when it
   * loads a dataset whose map names one.
   */
  columns: z.record(z.string(), SeedColumnSchema).optional()
    .describe(
      'Per-column write policy, keyed by field name: `{ status: { applyOn: \'create\' } }` writes ' +
      '`status` only when the seed creates the row. Omitted, every column is written on create and update.',
    ),

  /**
   * Environment Scope
   * - 'all': Always load
   * - 'dev': Only for development/demo
   * - 'test': Only for CI/CD tests
   */
  env: z.array(z.enum(['prod', 'dev', 'test'])).default(['prod', 'dev', 'test']).describe('Applicable environments'),

  /**
   * Locale Scope
   *
   * Which locales this dataset applies to, as BCP-47 tags (`['zh-CN']`,
   * `['en', 'en-GB']`). The loader drops a dataset whose scope does not include
   * the locale it is loading for, so an app that ships one demo dataset per
   * language market declares both and lets the runtime pick — rather than
   * selecting between them while the config is assembled, which bakes the
   * choice into `dist` and leaves the other market's rows resident in the
   * database.
   *
   * **Omitted means every locale.** Unlike {@link SeedSchema.shape.env}, whose
   * environments are a closed set of three and can therefore be spelled out as
   * a default, locales are open-ended BCP-47 tags with no enumerable universe —
   * so absence, not a default array, is what carries "unrestricted". An empty
   * array is rejected rather than read as "no locale": a dataset that applies
   * nowhere is an authoring mistake, and the same reasoning already governs a
   * composite `externalId`.
   *
   * Tags are matched case-insensitively (`zh-cn` and `zh-CN` are the same tag
   * per BCP-47) and otherwise exactly: `['zh']` does not match a runtime locale
   * of `zh-CN`. Declare every tag the dataset is for.
   *
   * The platform translates nothing. This is the axis that SELECTS between
   * record sets the app authored itself.
   *
   * **Publishing and installing are locale-neutral acts — this axis is scoped
   * to the boot path, by decision.** The loader evaluates it against
   * `SeedLoaderConfig.locale`, which only the boot path supplies (AppPlugin
   * reads the app's declared `i18n.defaultLocale`). Package apply, draft
   * publish and marketplace install each build their own load request and pass
   * no locale, so a `locale`-scoped dataset reaching one of them is loaded for
   * **every** locale and the loader warns naming each dataset it let through.
   * That bound is the contract, not an unfinished path: a package is assembled
   * once for every market, and selecting a market is what happens when it is
   * opened. Ruled on #17011 (2026-09-10), which also kept the warning rather
   * than turning those paths into a refusal.
   */
  locale: z.array(LocaleSchema).min(1).optional()
    .describe('Applicable locales (BCP-47 tags); omitted applies to every locale. The publish and install paths do not filter by locale — they load every dataset and warn'),

  /**
   * The Payload
   * Array of raw JSON objects matching the Object Schema.
   */
  records: z.array(z.record(z.string(), z.unknown())).describe('Data records'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `seed` is a registered metadata type, so `MetadataPlugin`'s artifact loader
  // stamps `_packageId` / `_provenance` on it like every sibling, and
  // `getMetaItemLayered` → `saveMetaItem` round-trips a body carrying them.
  // Undeclared, those were stripped on every parse — the same inverse drift
  // that made `permission` 422 on the ADR-0094 overlay path when it went strict
  // (#4001 findings log, entry 2). Declared here so closing the shape cannot
  // repeat it.
  ...MetadataProtectionFields,
}));

/** Parsed/output type — all defaults are applied (env, mode, externalId always present) */
export type Seed = z.input<typeof SeedSchema>;
/** Post-parse shape of {@link Seed} — defaults applied, transforms run (ADR-0122). */
export type SeedParsed = z.infer<typeof SeedSchema>;

export type SeedImportMode = z.input<typeof SeedMode>;

/**
 * Per-field value type for a seed record.
 *
 * Reference fields (`lookup` / `master_detail`) are resolved during seeding by
 * matching the value against the target record's externalId — so the value MUST
 * be the plain natural-key string (e.g. `account: 'Acme Corp'`), or `null`.
 * Passing a wrapper object like `account: { externalId: 'Acme Corp' }` does NOT
 * resolve: the loader skips non-string reference values, the raw object reaches
 * the SQL driver, and on update it crashes with "SQLite3 can only bind numbers,
 * strings, bigints, buffers, and null" (silently masked on an always-empty
 * `:memory:` DB, fatal-looking on a persistent one). Constrain those fields to
 * `string | null` at compile time; every other field stays `unknown`.
 *
 * A `multiple: true` lookup is the one exception: it stores an ARRAY of ids, so
 * it is seeded from an ARRAY of natural keys — one per element (framework#3911).
 * A lone string stays legal there because the loader accepts it as one-element
 * shorthand for the array shape the field stores. `master_detail` is inherently
 * single-valued and so is never widened.
 */
type SeedFieldValue<TFieldDef> =
  TFieldDef extends { type: 'lookup' | 'master_detail' }
    ? TFieldDef extends { multiple: true }
      ? string | string[] | null
      : string | null
    : unknown;

/**
 * Shape of a single seed record, derived from the object's field definitions.
 *
 * Its keys are the object's declared `fields`, each typed by
 * {@link SeedFieldValue}, plus the system columns the platform injects without
 * the author declaring them ({@link InjectedSystemColumnName}: `created_at`,
 * `owner_id` and the rest), typed `unknown`. The injected half is the union
 * over EVERY object, because a type cannot evaluate an object's opt-outs
 * (`systemFields`, `ownership`, `managedBy`); {@link defineSeed} narrows it to
 * this object's own plan when it runs. A field the object declares under one of
 * those names keeps its declared value type.
 */
type SeedRecord<TFields> = {
  [K in keyof TFields]?: SeedFieldValue<TFields[K]>;
} & {
  [K in Exclude<InjectedSystemColumnName, keyof TFields>]?: unknown;
};

/**
 * Shape of a seed's {@link SeedSchema.shape.columns} map for one object: the
 * same key set as {@link SeedRecord} (the object's declared `fields` plus the
 * injectable system columns), each taking a {@link SeedColumn}.
 */
type SeedColumns<TFields> = {
  [K in keyof TFields | InjectedSystemColumnName]?: SeedColumn;
};

/**
 * The call-time half of {@link defineSeed}'s key check: every key of every
 * record, and every key of the `columns` map, must name a column the target
 * object has, which is a field it
 * declares or a system column the platform injects on THIS object. The injected
 * set is {@link resolveInjectedSystemColumns}, the per-object answer the
 * registry's own injection consumes, so a seed may write `created_at` (the
 * seed loader keeps an authored one on insert) on an object that carries the
 * audit columns, and is refused it on one built with `systemFields: false`.
 *
 * It judges what the type cannot see: a record that does not reach the call as
 * a fresh object literal (a variable, a `.map()` result, a spread of
 * `Record<string, unknown>[]`, which also silences TypeScript's check on every
 * inline record beside it), and an object whose `fields` type is a
 * string-keyed record (`ServiceObject`, an `ObjectSchema.parse()` result).
 *
 * All findings are collected and refused together, one line per key, in the
 * shape `ObjectSchema.create()` refuses an unknown object key: the object and
 * the key named, a near-miss suggested, the fix stated.
 *
 * No opinion without a field map: a caller outside the type that passes no
 * `fields` object is not judged here.
 */
function assertSeedKeysDeclared(
  objectDef: { name: string; fields: unknown },
  records: ReadonlyArray<Record<string, unknown>>,
  columns: Readonly<Record<string, unknown>> | undefined,
): void {
  const { fields } = objectDef;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;
  const known = [...Object.keys(fields), ...resolveInjectedSystemColumns(objectDef).names];
  const knownSet = new Set(known);
  const lines: string[] = [];
  const unknownKeys = new Set<string>();
  const surfaces = new Set<'records' | 'columns'>();
  const judge = (key: string, where: string, surface: 'records' | 'columns'): void => {
    if (knownSet.has(key)) return;
    unknownKeys.add(key);
    surfaces.add(surface);
    const suggestion = formatSuggestion(
      findClosestMatches(key, known, Math.max(2, Math.floor(key.length / 3)), 1),
    );
    lines.push(
      `  • ${where}: \`${key}\` is not a field of \`${objectDef.name}\`.`
      + (suggestion ? ` ${suggestion}` : ''),
    );
  };
  records.forEach((record, index) => {
    for (const key of Object.keys(record)) judge(key, `records[${index}]`, 'records');
  });
  // [#25761] A policy on a column the object does not have governs nothing:
  // the column it was meant for (a misspelt `status`) stays `always`.
  for (const key of Object.keys(columns ?? {})) judge(key, 'columns', 'columns');
  if (lines.length === 0) return;
  throw new Error(
    `defineSeed('${objectDef.name}'): unknown field(s) in ${[...surfaces].join(' and ')} — ${[...unknownKeys].join(', ')}.\n`
    + `A seed record key, and a \`columns\` key, must name a field \`${objectDef.name}\` declares or a system `
    + 'column the platform injects on it (`created_at`, `owner_id` and the rest, unless the object opts out of them).\n\n'
    + `${lines.join('\n')}\n\n`
    + `Fix the key's spelling, declare the field on \`${objectDef.name}\`, or remove the key.`,
  );
}

/**
 * Type-safe factory for creating seed definitions. Every record key is checked
 * against the object definition passed in, twice:
 *
 * - **At compile time**, for a record written as an object literal directly in
 *   `records`: its keys must be the object's declared `fields` or a system
 *   column the platform can inject (`created_at`, `owner_id`, … — see
 *   {@link SeedRecord}), and a reference field (lookup/master_detail) takes the
 *   natural-key string the loader resolves (see {@link SeedFieldValue}). This
 *   is TypeScript's excess-property check, so it sees only fresh literals on an
 *   object whose field keys are literal (`ObjectSchema.create()`): a record
 *   from a variable, a `.map()` or a spread, and an object typed `ServiceObject`,
 *   are not checked here.
 * - **When it runs** (module load: `os validate`, `os build`, boot), for every
 *   record whatever its shape: each key must be a field the object declares or
 *   a system column the platform injects on THIS object
 *   ({@link resolveInjectedSystemColumns}). A key that is neither is refused,
 *   naming the object, the record and the key, with a near-miss suggestion.
 *
 * The keys of {@link SeedSchema.shape.columns} are held to the same set, both
 * times ({@link SeedColumns}).
 *
 * @example
 * ```ts
 * export const leadSeed = defineSeed(Lead, {
 *   externalId: 'email',
 *   columns: { lead_source: { applyOn: 'create' } }, // ✅ written when the row is created, kept on replay
 *   records: [
 *     { first_name: 'Alice', lead_source: 'web' },   // ✅ type-checked
 *     { source: 'web' },                              // ❌ compile error (unknown field), and refused when it runs
 *     { first_name: 'Bob', created_at: cel`daysAgo(3)` }, // ✅ an injected system column
 *     { first_name: 'Bob', account: 'Acme Corp' },   // ✅ reference by natural key
 *     { first_name: 'Bob', account: { externalId: 'Acme Corp' } }, // ❌ object not allowed
 *   ],
 * });
 * ```
 */
export function defineSeed<
  const TObj extends { name: string; fields: Record<string, unknown> }
>(
  objectDef: TObj,
  config: Omit<Seed, 'object' | 'records' | 'columns'> & {
    records: Array<SeedRecord<TObj['fields']>>;
    columns?: SeedColumns<TObj['fields']>;
  }
): Seed {
  const seed = SeedSchema.parse({ ...config, object: objectDef.name });
  assertSeedKeysDeclared(objectDef, seed.records, seed.columns);
  return seed;
}
