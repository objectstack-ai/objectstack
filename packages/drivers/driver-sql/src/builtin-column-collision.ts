// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12015 — WHICH HALF of a declaration on a builtin column name is discarded.
 *
 * `initObjects` emits `id`, `created_at` and `updated_at` itself and skips any
 * declared field colliding with one, so the column that lands is the
 * platform's rather than the author's. The first cut of the diagnostic said so
 * for *any* such declaration — and on the dominant population that sentence
 * was not merely noisy, it was **false**. Measured before this narrowing: 116
 * warnings on a stock boot of `@objectstack/platform-objects` alone, against
 * declarations like
 *
 * ```ts
 * id: Field.text({ label: 'Presence ID', required: true, readonly: true })
 * ```
 *
 * whose `label` **is** applied — it feeds the generated
 * `*.objects.generated.ts` translation files in four locales, `highlightFields`,
 * FLS and sortability — and whose `required` **is** enforced, by the engine's
 * write contract. Only the *storage* half is thrown away. "The declaration is
 * NOT applied … remove the declaration" was therefore untrue there, and acting
 * on it would have deleted an author-facing label for a column every list view
 * shows.
 *
 * Maintainer ruling 2026-08-25: narrow the trigger to declarations asking for
 * **storage behaviour the platform's own column does not deliver**, and stay
 * silent when only the honoured half is declared. The narrowing changes what we
 * SAY, not what we DO: the platform still owns these three columns, the
 * declaration still does not take effect, no accept/reject door moves.
 * ⛔ Not route C (make the declaration meaningful) and ⛔ not route B (refuse).
 *
 * # Why the classification lives here, in one table
 *
 * Scattering "is this key storage?" across the three call sites is how the two
 * halves drift apart. One table, one answer, and {@link FIELD_KEY_STORAGE_CLASS}
 * is pinned against `FieldSchema.shape` by
 * `builtin-column-collision.test.ts` — so a key added to the spec later fails
 * that pin until someone classifies it deliberately, rather than defaulting
 * into silence unnoticed.
 *
 * At RUNTIME an unclassified key is treated as presentation (silent). That is
 * the safe direction for a diagnostic on a boot path: an unknown key can only
 * ever fail to produce a warning, never invent a false one, and never refuse a
 * boot — the pin, not a throw, is what makes the omission visible.
 */

import { isNowDefaultToken } from '@objectstack/spec/data';

/**
 * Storage-affecting = the SQL driver's DDL layer would have read this key to
 * shape the physical column or its indexes, so on a builtin column name it is
 * discarded. Presentation = honoured by some other layer (metadata, i18n, the
 * engine's write contract, the UI), so on a builtin column name it still takes
 * effect and must NOT be reported as discarded.
 *
 * ⚠️ The line is drawn at what the DDL reads, not at what the key "feels" like.
 * The load-bearing example is `required`: ADR-0113 makes it the **write
 * contract**, deliberately NOT a column constraint (`storage.notNull` is), and
 * the engine enforces it on the platform's own column exactly as on any other.
 * Classifying it as storage would re-create the false sentence this narrowing
 * exists to remove.
 *
 * Where a key is storage-class in intent but this driver's DDL happens not to
 * read it yet (`precision`, `scale`, `dimensions`, `deleteBehavior`), it is
 * still classified `storage`. A diagnostic may say "this was discarded" about
 * something no emitter honours; it may not stay silent about something an
 * emitter would have honoured.
 */
export type FieldKeyClass = 'storage' | 'presentation';

export const FIELD_KEY_STORAGE_CLASS: Readonly<Record<string, FieldKeyClass>> = Object.freeze({
  // ---- storage: the column's own shape -------------------------------------
  type: 'storage',            // `createColumn`: the column type itself
  maxLength: 'storage',       // `createColumn`: varchar(n) vs TEXT, and the #11374 keyable decision
  multiple: 'storage',        // `createColumn`: a multi-value field is a JSON column
  precision: 'storage',       // numeric column shape (this driver does not read it yet)
  scale: 'storage',           // numeric column shape (this driver does not read it yet)
  dimensions: 'storage',      // vector column width
  defaultValue: 'storage',    // `createColumn`: the physical column DEFAULT
  storage: 'storage',         // ADR-0113: `storage.notNull` IS the column constraint
  unique: 'storage',          // materialized as a UNIQUE index by `syncTableIndexes`
  reference: 'storage',       // `createColumn` shapes a lookup column after its target key
  referenceVia: 'storage',    // junction storage for a multi-value reference
  deleteBehavior: 'storage',  // referential behaviour of the stored key
  expression: 'storage',      // a formula field materializes NO column (`fieldHasColumn`)
  returnType: 'storage',      // the formula's stored/returned type
  summaryOperations: 'storage', // rollup storage
  currencyConfig: 'storage',  // currency mode can change what is physically stored

  // ---- presentation: honoured by layers other than the DDL -----------------
  name: 'presentation',       // identity; the physical column is the field KEY (`columnName` was retired, #2377)
  label: 'presentation',      // metadata + i18n; the half the false sentence used to deny
  description: 'presentation',
  inlineHelpText: 'presentation',
  placeholder: 'presentation',
  format: 'presentation',     // display/validation hint
  required: 'presentation',   // ADR-0113: the WRITE contract, enforced by the engine, not the column
  minLength: 'presentation',  // write-time validation
  min: 'presentation',        // write-time validation
  max: 'presentation',        // write-time validation
  step: 'presentation',       // input granularity
  rows: 'presentation',       // inline multiline-editor height (objectui#6140) — read by objectui's TextAreaField/RichTextField, never by the DDL (a rows-sized editor surface, not a column shape)
  useGrouping: 'presentation',
  options: 'presentation',    // select values: validation + UI, no DDL
  accept: 'presentation',     // upload validation
  maxSize: 'presentation',    // upload validation
  language: 'presentation',   // editor language hint
  searchable: 'presentation',
  sortable: 'presentation',
  trackHistory: 'presentation', // history rows live in their own object
  group: 'presentation',
  widget: 'presentation',
  hidden: 'presentation',
  internal: 'presentation',
  readonly: 'presentation',
  visibleWhen: 'presentation',
  readonlyWhen: 'presentation',
  requiredWhen: 'presentation',
  conditionalRequired: 'presentation',
  requiredPermissions: 'presentation',
  maskingRule: 'presentation',
  ackPlaintextMasking: 'presentation',
  system: 'presentation',
  inlineEdit: 'presentation',
  inlineTitle: 'presentation',
  inlineColumns: 'presentation',
  inlineAmountField: 'presentation',
  relatedList: 'presentation',
  relatedListTitle: 'presentation',
  relatedListColumns: 'presentation',
  relatedListFilter: 'presentation',
  displayField: 'presentation',
  descriptionField: 'presentation',
  lookupColumns: 'presentation',
  lookupPageSize: 'presentation',
  lookupFilters: 'presentation',
  dependsOn: 'presentation',
  allowCreate: 'presentation',
  // Read by the WRITE path, never by the DDL: `initObjects` registers an
  // autonumber generator off `type: 'auto_number'` without skipping builtin
  // names, so the format an author declares is honoured rather than discarded.
  autonumberFormat: 'presentation',
  externalId: 'presentation',   // upsert matching semantics; no column of its own
  // ADR-0010 governance/provenance markers stamped by the metadata loader.
  // Metadata about the declaration, never about the column.
  _lock: 'presentation',
  _lockReason: 'presentation',
  _lockSource: 'presentation',
  _lockDocsUrl: 'presentation',
  _packageId: 'presentation',
  _packageVersion: 'presentation',
  _provenance: 'presentation',
});

/**
 * What the platform's own column ACTUALLY delivers — read off the emitting
 * lines in `SqlDriver`, not assumed:
 *
 *   - `id`         — `table.string('id').primary()`: varchar(255), NOT NULL,
 *                    PRIMARY KEY (so: unique), no column default (the engine
 *                    generates the key). varchar canonicalizes to the field
 *                    type `text`, which is what the table below records.
 *   - `created_at` / `updated_at` — `createAuditTimestampColumn`: a timestamp
 *                    (MySQL `datetime(3)`) defaulted to the database clock,
 *                    left NULLABLE and stamped by the driver on every write.
 *
 * A declared storage attribute equal to what the column already delivers is
 * NOT a disagreement and must stay silent — `created_at: { type: 'datetime',
 * defaultValue: 'NOW()' }` describes precisely what lands.
 */
export interface BuiltinColumnDelivery {
  /**
   * The field type whose column this builtin actually is, spelled in the
   * SPEC's `FieldType` vocabulary — because that is the vocabulary a
   * declaration's `type` is written in, and this value is compared against it
   * with `===`.
   *
   * ⛔ NEVER the knex builder name. `id` is emitted by `table.string('id')`,
   * but knex's `string` IS varchar(255), and `canonicalizeSqlType('varchar(255)')`
   * is `'text'` — so the field type this column delivers is `'text'`, and
   * `isCompatible('varchar(255)', 'text')` is EXACT (both pinned in
   * `type-compat.test.ts`). Spelling the builder name here compares two
   * vocabularies and reports every correct `id: Field.text(...)` declaration
   * as a disagreement: measured at 45 false warnings on a stock boot of
   * `@objectstack/platform-objects`, on declarations that were right all
   * along. `'string'` is not even authorable — it is absent from `FieldType`'s
   * members and `FieldSchema` refuses it — so no declaration could have
   * silenced it.
   */
  type: string;
  /** Fixed varchar width, when the column is bounded. */
  maxLength?: number;
  /** Does the column already carry a uniqueness guarantee? */
  unique: boolean;
  /** Does the column already carry a physical NOT NULL? */
  notNull: boolean;
  /** `'NOW()'` when the column defaults to the database clock; `null` for no default. */
  defaultValue: 'NOW()' | null;
}

export const BUILTIN_COLUMN_DELIVERY: Readonly<Record<string, BuiltinColumnDelivery>> = Object.freeze({
  // `table.string('id')` is knex's varchar(255); the FIELD TYPE it delivers is
  // `text` (see the vocabulary note on `BuiltinColumnDelivery.type` — do not
  // put the builder name back here).
  id: Object.freeze({ type: 'text', maxLength: 255, unique: true, notNull: true, defaultValue: null }),
  created_at: Object.freeze({ type: 'datetime', unique: false, notNull: false, defaultValue: 'NOW()' as const }),
  updated_at: Object.freeze({ type: 'datetime', unique: false, notNull: false, defaultValue: 'NOW()' as const }),
});

/** One storage attribute the declaration asked for and the builtin column does not provide. */
export interface UndeliveredAttribute {
  /** The declared key, spelled as the author wrote it. */
  key: string;
  /** What the author asked for. */
  declared: unknown;
  /** What the platform's column provides instead, or `undefined` when it provides nothing of the kind. */
  delivered: unknown;
}

/** A declared value that asks for nothing at all — absent, or an explicit opt-out. */
function asksForNothing(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) return true;
  return false;
}

/**
 * The storage attributes `field` declares that the builtin `column` does not
 * deliver — empty when the declaration and the platform's column agree, or
 * when only the honoured (presentation) half was declared.
 *
 * Pure and side-effect free: the caller decides whether to log. `field` is
 * whatever the author wrote, so every read is defensive.
 */
export function undeliveredStorageAttributes(
  column: string,
  field: Record<string, unknown> | undefined,
): UndeliveredAttribute[] {
  const delivery = BUILTIN_COLUMN_DELIVERY[column];
  if (!delivery || !field || typeof field !== 'object') return [];

  const out: UndeliveredAttribute[] = [];
  for (const [key, declared] of Object.entries(field)) {
    if (FIELD_KEY_STORAGE_CLASS[key] !== 'storage') continue;

    // `storage: { notNull }` is the one nested storage key (ADR-0113): compare
    // the constraint it asks for, not the wrapper object.
    if (key === 'storage') {
      const notNull = (declared as { notNull?: unknown } | undefined)?.notNull;
      if (asksForNothing(notNull)) continue;
      if (delivery.notNull === true) continue;
      out.push({ key: 'storage.notNull', declared: notNull, delivered: false });
      continue;
    }

    if (asksForNothing(declared)) continue;

    switch (key) {
      case 'type':
        if (declared === delivery.type) continue;
        out.push({ key, declared, delivered: delivery.type });
        continue;
      case 'maxLength':
        if (delivery.maxLength !== undefined && declared === delivery.maxLength) continue;
        out.push({ key, declared, delivered: delivery.maxLength });
        continue;
      case 'unique':
        if (delivery.unique) continue;
        out.push({ key, declared, delivered: false });
        continue;
      case 'defaultValue':
        // The framework's clock token is a vocabulary, not a literal — a
        // column already defaulted to the database clock DELIVERS it.
        if (delivery.defaultValue === 'NOW()' && isNowDefaultToken(declared as string)) continue;
        out.push({ key, declared, delivered: delivery.defaultValue ?? undefined });
        continue;
      default:
        // Every other storage key: the builtin column provides nothing of the
        // kind, so asking for it is always a disagreement.
        out.push({ key, declared, delivered: undefined });
        continue;
    }
  }
  return out;
}

/** `type: 'text'` → `type: 'text'`; objects are summarized rather than dumped. */
export function formatAttribute(attr: UndeliveredAttribute): string {
  const show = (v: unknown): string =>
    typeof v === 'string' ? `'${v}'` : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  return attr.delivered === undefined
    ? `${attr.key}: ${show(attr.declared)}`
    : `${attr.key}: ${show(attr.declared)} (the column is ${show(attr.delivered)})`;
}
