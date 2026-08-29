// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
// `QuerySchema` left with `extractQuery` in 17.0.0 (#4509) — a mapping no
// longer carries a query of its own.

/**
 * Shared history for this file (#4001).
 *
 * An import mapping is instructions for moving somebody's data. A dropped key
 * does not fail the import — it runs, to completion, with a "success" the
 * author reads as "the data arrived the way I described it". The rows land
 * untransformed, or unmatched, or duplicated, and the diagnosis starts from a
 * green run.
 */
const MAPPING_HISTORY =
  'Until this shape was closed these were dropped silently — the mapping still ran to '
  + 'completion and reported success, minus whatever the key was meant to control.';

/**
 * Keys retired from `MappingSchema` in 17.0.0 (#4509, ADR-0049).
 *
 * All three parsed, stored, and controlled nothing. They are grouped here
 * rather than inlined because two of them were **unwarnable**: `errorPolicy`
 * and `batchSize` carried schema defaults, and a default materialises at parse
 * time, so the liveness lint could not tell an authored value from one the
 * schema filled in (`_authorWarnSkipped` in `liveness/mapping.json`). A key the
 * advisory lint structurally cannot warn about has exactly one way to become
 * audible to its author, and this is it — which is why they went out in the
 * 17.0.0 window rather than waiting to be "warned about first".
 *
 * The old alias spellings (`query`, `onError`, `errorHandling`, `errorMode`,
 * `batch`, `chunkSize`, `skipErrors`) are listed too: an author who learned the
 * alias should land on the prescription, not on a "did you mean" pointing at a
 * key that is also gone. A `guidance` entry suppresses the rename suggestion,
 * which is the behaviour we want here.
 */
const RETIRED_EXTRACT_QUERY =
  '`mapping.extractQuery` was removed in @objectstack/spec 17.0.0 (ADR-0049) — no '
  + 'exporter ever read a mapping artifact, so "Query to run for export only" promised an '
  + 'export path that does not exist. Delete the key. Exports run through the ordinary '
  + 'query API (`POST /api/v1/data/:object/query`); if a mapping-driven export is ever '
  + 'designed, this is where it plugs back in. '
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

const RETIRED_ERROR_POLICY =
  '`mapping.errorPolicy` was removed in @objectstack/spec 17.0.0 (ADR-0049) — no '
  + 'import code ever read it, so `skip` / `abort` / `retry` selected between three '
  + 'behaviours that were all the same behaviour. Delete the key. Error handling on the '
  + 'import path belongs to the import REQUEST\'s own options, not to the stored mapping. '
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

const RETIRED_BATCH_SIZE =
  '`mapping.batchSize` was removed in @objectstack/spec 17.0.0 (ADR-0049) — no '
  + 'import code ever batched by it; the write path sizes its own batches. Delete the key. '
  + 'CAREFUL — do NOT "fix" this by relocating the value to a neighbouring `batchSize`: '
  + '`bulkActionDef.batchSize`, `connector.batchSize`, `sync.batchSize`, `offline.batchSize`, '
  + 'the seed loader\'s and the NoSQL driver cursor\'s are all LIVE and enforced — but each is '
  + 'a DIFFERENT key on a different type sizing its own path, and none of them sizes a '
  + 'mapping import. '
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

const MAPPING_RETIRED_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  extractQuery: RETIRED_EXTRACT_QUERY,
  query: RETIRED_EXTRACT_QUERY,
  errorPolicy: RETIRED_ERROR_POLICY,
  onError: RETIRED_ERROR_POLICY,
  errorHandling: RETIRED_ERROR_POLICY,
  errorMode: RETIRED_ERROR_POLICY,
  skipErrors: RETIRED_ERROR_POLICY,
  batchSize: RETIRED_BATCH_SIZE,
  batch: RETIRED_BATCH_SIZE,
  chunkSize: RETIRED_BATCH_SIZE,
};

/**
 * `params`' lookup-steering keys, retired in the 17.x line (#10329, ADR-0049).
 *
 * `object` / `fromField` / `toField` / `autoCreate` declared a per-entry
 * reference-resolution dialect that the import path never implemented:
 * `applyMappingToRows` handles `lookup` in the same branch as `none` (the cell
 * is copied through unchanged), and reference resolution happens afterwards in
 * `import-coerce.ts`, driven by the TARGET FIELD's own metadata — never by
 * these keys. Implementing them was considered and declined (a second
 * reference-resolution dialect on the import path; the code comment in
 * `packages/rest/src/import-mapping.ts` declines it and the #10329 triage
 * ruling confirms), so under ADR-0049 they go.
 *
 * `autoCreate` is the one with teeth: it reads as "create the referenced
 * record when nothing matches", and what actually happens — with or without
 * the key — is that the row FAILS with an unresolved-reference error
 * (`import_reference_not_found`). The guidance says so outright.
 *
 * The alias spellings (`lookupObject`/`targetObject`, `match`/`matchOn`/
 * `matchField`/`keyField`, `returnField`/`valueField`, `create`/
 * `createIfMissing`/`upsert`) are listed too: an author who learned any of
 * them should land on the prescription, not on a "did you mean" pointing at a
 * key that is also gone.
 */
const RETIRED_LOOKUP_OBJECT =
  '`fieldMapping[].params.object` was removed in @objectstack/spec 17 (ADR-0049) — the '
  + '`lookup` transform never read it: the cell is copied through unchanged and the import '
  + 'pipeline resolves references from the TARGET FIELD\'s own metadata (the field\'s declared '
  + '`reference` names the lookup object), so "Lookup Object" steered nothing. Delete the key; '
  + 'point `target` at a reference field and the referenced object is the field\'s own '
  + '`reference`. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const RETIRED_LOOKUP_FROM_FIELD =
  '`fieldMapping[].params.fromField` was removed in @objectstack/spec 17 (ADR-0049) — '
  + 'the `lookup` transform never read it: the import pipeline matches the cell\'s display '
  + 'value (name / email / id) against the referenced object itself, not against a '
  + 'mapping-declared match field, so "Match on" steered nothing. Delete the key. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const RETIRED_LOOKUP_TO_FIELD =
  '`fieldMapping[].params.toField` was removed in @objectstack/spec 17 (ADR-0049) — '
  + 'the `lookup` transform never read it: reference resolution always writes the referenced '
  + 'record\'s id (what a reference column stores), so "Value to take" steered nothing. '
  + 'Delete the key. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const RETIRED_LOOKUP_AUTO_CREATE =
  '`fieldMapping[].params.autoCreate` was removed in @objectstack/spec 17 (ADR-0049) — '
  + 'it read as "create the referenced record when nothing matches", and nothing was ever '
  + 'created: with or without this key, a cell that resolves to no record FAILS its row with an '
  + 'unresolved-reference error (`import_reference_not_found`). Delete the key; create or '
  + 'import the referenced records first, then import the rows that point at them. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

const PARAMS_RETIRED_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  object: RETIRED_LOOKUP_OBJECT,
  lookupObject: RETIRED_LOOKUP_OBJECT,
  targetObject: RETIRED_LOOKUP_OBJECT,
  fromField: RETIRED_LOOKUP_FROM_FIELD,
  match: RETIRED_LOOKUP_FROM_FIELD,
  matchOn: RETIRED_LOOKUP_FROM_FIELD,
  matchField: RETIRED_LOOKUP_FROM_FIELD,
  keyField: RETIRED_LOOKUP_FROM_FIELD,
  toField: RETIRED_LOOKUP_TO_FIELD,
  returnField: RETIRED_LOOKUP_TO_FIELD,
  valueField: RETIRED_LOOKUP_TO_FIELD,
  autoCreate: RETIRED_LOOKUP_AUTO_CREATE,
  create: RETIRED_LOOKUP_AUTO_CREATE,
  createIfMissing: RETIRED_LOOKUP_AUTO_CREATE,
  upsert: RETIRED_LOOKUP_AUTO_CREATE,
};

/**
 * Transformation Logic
 * Built-in helpers for converting data during import.
 */
import { lazySchema } from '../shared/lazy-schema';
export const TransformType = z.enum([
  'none',         // Direct copy
  'constant',     // Use a hardcoded value
  'lookup',       // Resolve FK (Name -> ID)
  'split',        // "John Doe" -> ["John", "Doe"]
  'join',         // ["John", "Doe"] -> "John Doe"
  'javascript',   // Custom script (Review security!)
  'map'           // Value mapping (e.g. "Active" -> "active")
]);
export type TransformType = z.input<typeof TransformType>;

/**
 * Import Field Mapping Item — one column of an import mapping.
 *
 * Renamed from `FieldMappingSchema` / `FieldMapping` (#4703, ADR-0112 D9a).
 * Three entry points published that name for three declarations, so which type
 * an importer got depended only on the import path (the #4411 trap). This one
 * was never a spelling variant of the other two: it maps **source columns of a
 * file onto object fields** for `MappingSchema`'s import pipeline, not fields
 * of a connector's remote object. Three ways the shapes are incompatible, each
 * pinned in `src/integration/connector.test.ts` (the cross-entry block, next to
 * the #4684 one) so a future "let's just unify these" has to argue with a red
 * test:
 *
 * 1. `transform` is a plain {@link TransformType} enum defaulting to `'none'`,
 *    steering a flat `params` bag — and it is the only one of the three that is
 *    ENFORCED: `packages/rest/src/import-mapping.ts` applies it row by row, and
 *    rejects its `javascript` value with a 400 because no server sandbox
 *    exists. `shared`/`integration` used to declare the same key as a
 *    discriminated union (`FieldMappingTransformSchema`), which nothing ever
 *    executed; #5552 retired it there under ADR-0049, so the key is now live
 *    here and tombstoned on the other two. Same name, opposite dispositions.
 * 2. `source` / `target` accept `string | string[]` here — one target field may
 *    be composed from several columns (`split` / `join`). The other two take a
 *    single `string`.
 * 3. This schema is a {@link strictObject} (#4001): an unknown key THROWS with
 *    an alias/typo prescription. The other two are plain `z.object` and strip
 *    silently. Opposite failure modes under one name is exactly how a snippet
 *    copied across domains "works" and quietly does nothing.
 */
export const ImportFieldMappingSchema = lazySchema(() => strictObject({
  surface: 'this field mapping',
  history: MAPPING_HISTORY,
  aliases: {
    from: 'source', sourceField: 'source', column: 'source', header: 'source',
    to: 'target', targetField: 'target', field: 'target',
    type: 'transform', operation: 'transform', fn: 'transform',
    config: 'params', options: 'params', args: 'params',
  },
}, {
  /** Source Column */
  source: z.union([z.string(), z.array(z.string())]).describe('Source column header(s)'),

  /** Target Field */
  target: z.union([z.string(), z.array(z.string())]).describe('Target object field(s)'),

  /** Transformation */
  transform: TransformType.default('none'),

  /** Configuration for transform */
  // One flat bag rather than a per-`transform` discriminated union, so which
  // keys are meaningful depends on `transform`. Closing it catches the spelling;
  // it does NOT catch `separator` on a `lookup` (a key that is real but inert
  // here). Narrowing per transform is a refinement, not a strictness question.
  params: strictObject({
    surface: 'this transform’s params',
    history: MAPPING_HISTORY,
    aliases: {
      default: 'value', defaultValue: 'value', constant: 'value',
      // NOTE: `lookupObject` / `targetObject` / `match` / `matchOn` /
      // `matchField` / `keyField` / `returnField` / `valueField` / `create` /
      // `createIfMissing` / `upsert` were aliases onto the four lookup keys
      // removed in the 17.x line (#10329). An alias pointing at a key that no
      // longer exists routes the author into a second rejection, so their
      // spellings fall through to the `guidance` prescriptions instead —
      // the 17.0.0 (#4509) treatment, one level down.
      map: 'valueMap', mapping: 'valueMap', values: 'valueMap', valueMapping: 'valueMap',
      delimiter: 'separator', splitOn: 'separator', joinWith: 'separator',
    },
    guidance: PARAMS_RETIRED_KEY_GUIDANCE,
  }, {
    // Constant
    value: z.unknown().optional(),

    // `object` / `fromField` / `toField` / `autoCreate` — the `lookup`
    // transform's steering keys — were removed in the 17.x line (#10329,
    // ADR-0049); see PARAMS_RETIRED_KEY_GUIDANCE above. The live mechanism:
    // `lookup` copies the cell through and the import pipeline resolves the
    // reference from the target field's own metadata (`import-coerce.ts`),
    // so there was never anything for these to steer.

    // Map
    valueMap: z.record(z.string(), z.unknown()).optional(), // { "Open": "draft" }

    // Split/Join
    separator: z.string().optional()
  }).optional()
}));

/**
 * Data Mapping Schema
 * Defines a reusable data mapping configuration for ETL operations.
 * 
 * **NAMING CONVENTION:**
 * Mapping names are machine identifiers and must be lowercase snake_case.
 * 
 * @example Good mapping names
 * - 'salesforce_to_crm'
 * - 'csv_import_contacts'
 * - 'api_sync_orders'
 * 
 * @example Bad mapping names (will be rejected)
 * - 'SalesforceToCRM' (PascalCase)
 * - 'CSV Import' (spaces)
 */
export const MappingSchema = lazySchema(() => strictObject({
  surface: 'this mapping',
  history: MAPPING_HISTORY,
  aliases: {
    object: 'targetObject', target: 'targetObject', to: 'targetObject',
    format: 'sourceFormat', source: 'sourceFormat', sourceType: 'sourceFormat',
    mappings: 'fieldMapping', fields: 'fieldMapping', columns: 'fieldMapping', fieldMappings: 'fieldMapping',
    key: 'upsertKey', matchOn: 'upsertKey', externalId: 'upsertKey', externalIdField: 'upsertKey',
    // NOTE: `query` / `onError` / `errorHandling` / `errorMode` / `batch` /
    // `chunkSize` were aliases onto `extractQuery` / `errorPolicy` /
    // `batchSize`, all three removed in 17.0.0 (#4509). An alias pointing at a
    // key that no longer exists is worse than no alias — it routes the author
    // into a second rejection. Their spellings now fall through to the
    // `guidance` prescriptions below, which is where the real answer is.
  },
  guidance: {
    // `mode: 'upsert'` needs `upsertKey`; an author reaching for a
    // dedup/matching knob under another name is describing that pair.
    dedupe: 'deduplication is `mode: \'upsert\'` plus `upsertKey: [<field>]` — there is no separate dedupe switch',
    ...MAPPING_RETIRED_KEY_GUIDANCE,
  },
}, {
  /** Identity */
  name: SnakeCaseIdentifierSchema.describe('Mapping unique name (lowercase snake_case)'),
  label: z.string().optional(),

  /** Scope */
  sourceFormat: z.enum(['csv', 'json', 'xml', 'sql']).default('csv'),
  targetObject: z.string().describe('Target Object Name'),

  /** Column Mappings */
  fieldMapping: z.array(ImportFieldMappingSchema),

  /** Upsert Logic */
  mode: z.enum(['insert', 'update', 'upsert']).default('insert'),
  upsertKey: z.array(z.string()).optional().describe('Fields to match for upsert (e.g. email)'),

  // `extractQuery`, `errorPolicy` and `batchSize` were removed in 17.0.0
  // (#4509) — see MAPPING_RETIRED_KEY_GUIDANCE above for what each promised and
  // what actually controls it. The live mechanisms: exports go through the
  // ordinary query API, and both error handling and batch sizing belong to the
  // import request / write path, neither of which consults the mapping.

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `mapping` is a registered metadata type, so `MetadataPlugin`'s loader
  // stamps `_packageId` / `_provenance` on it like every sibling. Undeclared,
  // they were dropped on every parse: protection metadata lost on round-trip,
  // and a hard 422 the day this shape closed — which is today.
  ...MetadataProtectionFields,
}));

export type Mapping = z.input<typeof MappingSchema>;
/** Post-parse shape of {@link Mapping} — defaults applied, transforms run (ADR-0122). */
export type MappingParsed = z.infer<typeof MappingSchema>;

/**
 * Type-safe factory for a data import/export mapping. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Mapping` literal.
 */
export function defineMapping(config: z.input<typeof MappingSchema>): MappingParsed {
  return MappingSchema.parse(config);
}
export type ImportFieldMapping = z.input<typeof ImportFieldMappingSchema>;
/** Post-parse shape of {@link ImportFieldMapping} — defaults applied, transforms run (ADR-0122). */
export type ImportFieldMappingParsed = z.infer<typeof ImportFieldMappingSchema>;
