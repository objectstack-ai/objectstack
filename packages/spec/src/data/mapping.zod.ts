// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { OverrideDeclarationFields } from '../kernel/override-declaration.zod';
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
  + 'This edit left `os migrate meta` with the protocol-16.x conversions: apply it by hand, or run the tool on a release that still carries the conversion — https://objectstack.ai/docs/protocol-upgrade.';

const RETIRED_ERROR_POLICY =
  '`mapping.errorPolicy` was removed in @objectstack/spec 17.0.0 (ADR-0049) — no '
  + 'import code ever read it, so `skip` / `abort` / `retry` selected between three '
  + 'behaviours that were all the same behaviour. Delete the key. Error handling on the '
  + 'import path belongs to the import REQUEST\'s own options, not to the stored mapping. '
  + 'This edit left `os migrate meta` with the protocol-16.x conversions: apply it by hand, or run the tool on a release that still carries the conversion — https://objectstack.ai/docs/protocol-upgrade.';

const RETIRED_BATCH_SIZE =
  '`mapping.batchSize` was removed in @objectstack/spec 17.0.0 (ADR-0049) — no '
  + 'import code ever batched by it; the write path sizes its own batches. Delete the key. '
  + 'CAREFUL — do NOT "fix" this by relocating the value to a neighbouring `batchSize`: '
  + '`bulkActionDef.batchSize`, `connector.batchSize`, `sync.batchSize`, `offline.batchSize`, '
  + 'the seed loader\'s and the NoSQL driver cursor\'s are all LIVE and enforced — but each is '
  + 'a DIFFERENT key on a different type sizing its own path, and none of them sizes a '
  + 'mapping import. '
  + 'This edit left `os migrate meta` with the protocol-16.x conversions: apply it by hand, or run the tool on a release that still carries the conversion — https://objectstack.ai/docs/protocol-upgrade.';

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
 * `params`' lookup-steering keys, retired in the 17.x line (commit 15d58dbf1, ADR-0049).
 *
 * `object` / `fromField` / `toField` / `autoCreate` declared a per-entry
 * reference-resolution dialect that the import path never implemented:
 * `applyMappingToRows` handles `lookup` in the same branch as `none` (the cell
 * is copied through unchanged), and reference resolution happens afterwards in
 * `import-coerce.ts`, driven by the TARGET FIELD's own metadata — never by
 * these keys. Implementing them was considered and declined (a second
 * reference-resolution dialect on the import path; the code comment in
 * `packages/rest/src/import-mapping.ts` declines it and the triage ruling
 * commit 15d58dbf1 landed confirms), so under ADR-0049 they go.
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
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const RETIRED_LOOKUP_FROM_FIELD =
  '`fieldMapping[].params.fromField` was removed in @objectstack/spec 17 (ADR-0049) — '
  + 'the `lookup` transform never read it: the import pipeline matches the cell\'s display '
  + 'value (name / email / id) against the referenced object itself, not against a '
  + 'mapping-declared match field, so "Match on" steered nothing. Delete the key. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const RETIRED_LOOKUP_TO_FIELD =
  '`fieldMapping[].params.toField` was removed in @objectstack/spec 17 (ADR-0049) — '
  + 'the `lookup` transform never read it: reference resolution always writes the referenced '
  + 'record\'s id (what a reference column stores), so "Value to take" steered nothing. '
  + 'Delete the key. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

const RETIRED_LOOKUP_AUTO_CREATE =
  '`fieldMapping[].params.autoCreate` was removed in @objectstack/spec 17 (ADR-0049) — '
  + 'it read as "create the referenced record when nothing matches", and nothing was ever '
  + 'created: with or without this key, a cell that resolves to no record FAILS its row with an '
  + 'unresolved-reference error (`import_reference_not_found`). Delete the key; create or '
  + 'import the referenced records first, then import the rows that point at them. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

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
 * Keys an author reaches for on `connectorSource` that the binding
 * deliberately does not carry — each names where the intent really lives.
 * The connector-side sync vocabulary (`connector.syncConfig`) was retired
 * because none of it ran, so its words must land on a prescription here,
 * never on a "did you mean" that points at a neighbouring key.
 */
const CONNECTOR_SOURCE_CADENCE =
  'a connector pull has no cadence key — schedule it with a `job` (`Job.schedule`); '
  + 'the connector-side `syncConfig.schedule` was deleted because nothing ever ran it';

const CONNECTOR_SOURCE_NO_POLICY =
  'a pull is one-way and writes through this mapping\'s `mode` (`upsert`) and `upsertKey` — '
  + 'there is no conflict or direction policy to set';

// ADR-0153 D3: what a source delete does is the source block's `deletePolicy`.
// `deleteMode` is the retired connector-side spelling an author reaches for; it
// lands here rather than on an alias because its old values were not these.
const SOURCE_DELETE_POLICY =
  'a source delete is set with `deletePolicy`: \'mark\' stamps the row as deleted at the source '
  + '(the default when the key is absent), \'ignore\' leaves the row as it is — a pull never deletes '
  + 'a row physically';

const CONNECTOR_SOURCE_GUIDANCE: Readonly<Record<string, string>> = {
  schedule: CONNECTOR_SOURCE_CADENCE,
  cron: CONNECTOR_SOURCE_CADENCE,
  interval: CONNECTOR_SOURCE_CADENCE,
  deleteMode: SOURCE_DELETE_POLICY,
  conflictResolution: CONNECTOR_SOURCE_NO_POLICY,
  direction: CONNECTOR_SOURCE_NO_POLICY,
  strategy: 'full vs incremental is whether `watermark` is set — there is no strategy switch',
  credentialRef: 'the connector instance holds the credential (its ADR-0097 `auth`) — a mapping never does',
  auth: 'the connector instance holds the credential (its ADR-0097 `auth`) — a mapping never does',
};

/**
 * Keys an author reaches for on `datasourceSource` that it deliberately does
 * not carry (ADR-0153 D1). The datasource, the remote table and its schema are
 * the federated object's own binding, spelled once on that object, so each
 * of their words lands on a prescription naming where the binding lives.
 */
const DATASOURCE_SOURCE_BINDING =
  'a datasource source names a federated object, and that object\'s own `datasource` and `external` '
  + 'binding (remoteName, remoteSchema, columnMap) say where its rows live — declare them there and '
  + 'name the object in `object`';

const DATASOURCE_SOURCE_GUIDANCE: Readonly<Record<string, string>> = {
  datasource: DATASOURCE_SOURCE_BINDING,
  remoteName: DATASOURCE_SOURCE_BINDING,
  remoteSchema: DATASOURCE_SOURCE_BINDING,
  table: DATASOURCE_SOURCE_BINDING,
  schedule: CONNECTOR_SOURCE_CADENCE,
  cron: CONNECTOR_SOURCE_CADENCE,
  interval: CONNECTOR_SOURCE_CADENCE,
  deleteMode: SOURCE_DELETE_POLICY,
  conflictResolution: CONNECTOR_SOURCE_NO_POLICY,
  direction: CONNECTOR_SOURCE_NO_POLICY,
  paging: 'a datasource source is read in windows cut on `watermark.field` and paged by its key — '
    + 'there is no paging to declare; `paging` belongs to a connector source',
  strategy: 'full vs incremental is `full: true` — there is no strategy switch',
};

/**
 * The two keys both source blocks carry for deletes (ADR-0153 D3).
 *
 * `deletePolicy` declares NO `.default()`: an absent value reads as `'mark'`,
 * and keeping it absent in the parsed output is what lets the liveness lint
 * tell an authored value from one the schema filled in. Module-private: both
 * blocks spread the one pair, so the two cannot drift apart.
 */
const sourceDeleteFields = () => ({
  deletePolicy: z.enum(['mark', 'ignore']).optional().describe(
    'What a pull does with a row the source no longer has: \'mark\' stamps the row\'s source-deleted '
    + 'mark and clears it if the row comes back, \'ignore\' leaves the row as it is. Absent reads as '
    + '\'mark\'. A pull never deletes a row physically. A full pull marks only when its read was '
    + 'complete; an incremental pull sees a delete only through `deletedField`',
  ),
  deletedField: z.string().min(1).optional().describe(
    'Source field whose truthy value means the row was deleted at the source — how an incremental pull, '
    + 'which cannot see an absent row, learns of a delete',
  ),
});

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
 *    single `string`. A target may also name a declared PART of a compound
 *    field, `field.part` (`mailing_address.street`, #20149): the import path
 *    assembles every part one row maps into that field's one value. Which
 *    fields are compound, and which parts they declare, is read from each
 *    field's value schema when `indexImportMappingTargets` indexes the object
 *    (its module-private `importTargetPartsOf`, `import-mapping-target.ts`);
 *    `judgeImportMappingTarget`, the one verdict every door asks, then judges
 *    a `field.part` target against that set.
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

  /** Target Field — a field name, or `field.part` for a declared part of a compound field (#20149). */
  target: z.union([z.string(), z.array(z.string())]).describe(
    'Target object field(s); a declared part of a compound field is written field.part '
    + '(e.g. mailing_address.street), and the parts one row maps are assembled into that field\'s value',
  ),

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
      // removed in the 17.x line (commit 15d58dbf1). An alias pointing at a key that no
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
    // transform's steering keys — were removed in the 17.x line (commit 15d58dbf1,
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
 * [ADR-0153 D1] A mapping pulls from one source. Two would be two definitions
 * of where one target's rows come from, and no pull could honour both.
 */
const MAPPING_SOURCE_EXCLUSIVE =
  'A mapping carries at most one source: `connectorSource` or `datasourceSource`, never both. A pull reads '
  + 'its rows from one place; to copy from a second source, declare a second mapping.';

/**
 * [ADR-0153 D4] The refusal of a sourced mapping whose `mode` is not `upsert`.
 * Each of the other two modes loses data on a repeated pull, and the sentence
 * says which way, so the author sees why the rule is not a preference.
 */
function sourcedMappingModeRefusal(source: string, mode: string): string {
  const loss = mode === 'update'
    ? '`update` never creates a row, so every row the source adds is dropped without a word'
    : '`insert` cannot match a row again, so every run adds a second copy of every row it reads';
  return `A mapping with a \`${source}\` must write in \`mode: 'upsert'\` with an \`upsertKey\`; `
    + `it declares mode '${mode}' (the default is 'insert'). A pull reads the same rows again on every run: `
    + `${loss}. Write mode: 'upsert' and name the upsertKey field the source key is copied onto.`;
}

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

  /**
   * Connector source — the pull binding (ADR-0049 ENFORCE route for
   * connector-attached sync; ADR-0087 moved the definition here from the
   * retired `connector.syncConfig` / `connector.fieldMappings`).
   *
   * A sync is defined on its TARGET, the way the mainstream platforms bind it
   * (a target table with a field map and a match key, pulled on a cadence):
   * this mapping already names the object it writes (`targetObject`), its
   * field map (`fieldMapping`), its write mode and its match key (`mode`,
   * `upsertKey`). `connectorSource` adds only where the rows come from.
   * Version 1 is a ONE-WAY PULL, external → local, full or
   * timestamp-incremental, from a `rest` or `openapi` connector instance whose
   * credentials are its own ADR-0097 static `auth`. It deliberately carries:
   *
   * - **no cadence** — a `job` (`Job.schedule`) drives the pull; the
   *   2026-09-10 ruling that deleted `syncConfig.schedule` stands;
   * - **no credential** — the connector instance holds it;
   * - **no conflict or direction policy** — a pull writes through this
   *   mapping's `mode` / `upsertKey`, which must be `upsert` with a key (the
   *   mapping's refinement below, ADR-0153 D4). What a source DELETE does is
   *   `deletePolicy` / `deletedField` (ADR-0153 D3), and how the read action
   *   pages is `paging` (D2): both declared spec-first, `planned` in the
   *   liveness ledger until the P2 engine card's pull reads them.
   *
   * EXECUTED WHEN A JOB PULLS IT: `@objectstack/service-automation`'s
   * connector sync executor (`pullConnectorSource`, on the `automation`
   * service's contract) reads every key here and writes through the import
   * runner, so the liveness ledger grades every key `live`. A `job` whose
   * `pull` names this mapping (`JobSchema.pull`) drives it on the job's
   * schedule, as the organization the job declares; the binding alone moves
   * no rows, which the `.describe()` below says where an author reads it. A
   * pull makes ONE action call and reads ONE response (see `watermark`).
   * `sourceFormat` keeps governing the manual import door; a pulled row is
   * the connector's JSON record.
   */
  connectorSource: strictObject({
    surface: 'this mapping’s connector source',
    history: MAPPING_HISTORY,
    aliases: {
      connectorName: 'connector', connectorId: 'connector',
      operation: 'action', operationId: 'action', actionKey: 'action',
      params: 'input', request: 'input', arguments: 'input',
      itemsPath: 'recordsPath', dataPath: 'recordsPath', resultsPath: 'recordsPath', rowsPath: 'recordsPath',
      cursor: 'watermark', incremental: 'watermark', since: 'watermark',
    },
    guidance: CONNECTOR_SOURCE_GUIDANCE,
  }, {
    connector: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe(
      'Name of the connector instance the rows are pulled from — a `connectors[]` entry whose '
      + '`provider` is `rest` or `openapi` (version 1)',
    ),
    action: z.string().min(1).describe(
      'Key of the connector action that reads the records: `request` on a `rest` connector, '
      + 'an operation key on an `openapi` connector',
    ),
    input: z.record(z.string(), z.unknown()).optional().describe(
      'Fixed input passed to the action on every pull (e.g. `{ method: \'GET\', path: \'/contacts\' }` '
      + 'for `rest`)',
    ),
    recordsPath: z.string().min(1).optional().describe(
      'Dot path, within the action\'s result, to the array of records (e.g. `body.results`); '
      + 'omitted ⇒ the result\'s `body` is the array',
    ),
    watermark: strictObject({
      surface: 'this connector source’s watermark',
      history: MAPPING_HISTORY,
      aliases: {
        timestampField: 'field', cursorField: 'field', column: 'field',
        queryParam: 'param', parameter: 'param', sinceParam: 'param',
      },
    }, {
      field: z.string().min(1).describe(
        'Field of the pulled record holding its last-modified timestamp. The next pull\'s starting '
        + 'point is read from the TARGET: the highest value stored in the field a `fieldMapping` entry '
        + 'copies this field onto (transform `none`); a field no entry maps that way is refused at pull time',
      ),
      param: z.string().min(1).describe(
        'Query parameter of the read action that receives that starting point',
      ),
    }).optional().describe(
      'Timestamp-incremental pull; omitted ⇒ every pull reads the full set. Either way a pull makes ONE '
      + 'action call and reads ONE response: the connector\'s paging is not followed, so a paged endpoint '
      + 'yields its first page only — and an incremental pull over a newest-first paged endpoint moves its '
      + 'starting point past the pages it never read',
    ),
    // ADR-0153 D2 — the connector's declared paging convention. Declared
    // spec-first: the pull's paging loop is the P2 engine card's, so the
    // liveness row is `planned` and warns its author until that reader lands.
    // `style`'s companions are judged by the block's own refinement below.
    paging: strictObject({
      surface: 'this connector source’s paging',
      history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
      aliases: {
        type: 'style', mode: 'style',
        pageParam: 'param', cursorParam: 'param', offsetParam: 'param',
        next: 'nextPath', cursorPath: 'nextPath', nextCursorPath: 'nextPath',
      },
    }, {
      style: z.enum(['page', 'cursor', 'offset', 'none']).describe(
        'How the read action pages: `page` sends `param` = 1, 2, …; `offset` sends `param` = the count of '
        + 'records read so far; `cursor` sends `param` = the value read at `nextPath` in the previous '
        + 'response; `none` sends nothing and states that one response is the whole set',
      ),
      param: z.string().min(1).optional().describe(
        'Query parameter of the read action that receives the page, offset or cursor — required for '
        + '`page`, `offset` and `cursor`, refused beside `none`',
      ),
      nextPath: z.string().min(1).optional().describe(
        'Dot path, within the action\'s result, to the next cursor (`cursor`, where it is required) or to '
        + 'the "more pages" marker (`page` / `offset`, optional: without it a pull stops at the first page '
        + 'that carries no records); refused beside `none`',
      ),
    }).superRefine((paging, ctx) => {
      if (paging.style === 'none') {
        for (const key of ['param', 'nextPath'] as const) {
          if (paging[key] !== undefined) {
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: `\`paging.${key}\` is refused beside \`style: 'none'\`: a source that does not page `
                + 'sends nothing and reads no next page. Remove the key, or name the style the source pages by.',
            });
          }
        }
        return;
      }
      if (paging.param === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['param'],
          message: `\`paging.style: '${paging.style}'\` needs \`param\`, the query parameter the read action `
            + 'receives each page on.',
        });
      }
      if (paging.style === 'cursor' && paging.nextPath === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['nextPath'],
          message: '`paging.style: \'cursor\'` needs `nextPath`, the dot path in the response the next cursor '
            + 'is read from.',
        });
      }
    }).optional().describe(
      'The connector\'s paging convention: page, cursor or offset, or `none` for a source whose one '
      + 'response is the whole set. Omitted ⇒ a pull reads one response and does not treat it as complete',
    ),
    ...sourceDeleteFields(),
  }).optional().describe(
    'Pull binding: the rest/openapi connector this mapping pulls rows from (one-way, full or '
    + 'timestamp-incremental; a `job` sets the cadence). Pulled when a job drives it — a `job` whose '
    + '`pull: { mapping }` names this mapping, on the job\'s schedule; the binding alone moves no rows',
  ),

  /**
   * Datasource source — a federated object as the pull's source (ADR-0153 D1),
   * the sibling of {@link connectorSource}; a mapping carries at most one of
   * the two (the refinement below).
   *
   * `object` names a FEDERATED object (ADR-0015): one whose own `external`
   * binding (`remoteName`, `remoteSchema`, `columnMap`) addresses the remote
   * table, a warehouse table included. Reading through a declared object keeps
   * the pull inside the platform's own read path: the binding is federation's,
   * the field types the windows compare by are the object's, and the pull
   * writes no driver state of its own. The windows are cut on
   * `watermark.field`, and the rows are keyed by the source column the
   * object's `external.columnMap` maps onto `id`.
   *
   * Judged when it lands, by `defineStack` / `os validate` (the stack knows
   * the objects): the source is a declared federated object; its `columnMap`
   * maps a column onto `id` (`source_key_missing`) of a string or exact integer
   * type (`source_key_not_exact`); `watermark.field` is a `datetime`, a `date`
   * or a `scale: 0` `number` field (an exact one, `watermark_not_exact`); a
   * `fieldMapping` entry copies it unchanged onto a target field of its type
   * (`watermark_field_unmapped`); and the target is a `synced` object.
   *
   * READ BY NOTHING YET: the windowed reader is the P2 engine card's
   * (ADR-0153's children table), so the liveness row is `planned` and warns
   * its author until that reader lands.
   */
  datasourceSource: strictObject({
    surface: 'this mapping’s datasource source',
    history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: {
      sourceObject: 'object', objectName: 'object', from: 'object',
      cursor: 'watermark', incremental: 'watermark', since: 'watermark',
      fullRefresh: 'full', fullSync: 'full',
    },
    guidance: DATASOURCE_SOURCE_GUIDANCE,
  }, {
    object: z.string().min(1).describe(
      'Name of the federated object (ADR-0015) whose rows the pull reads — an object whose own `external` '
      + 'binding addresses the remote table, and whose `external.columnMap` maps the source key onto `id`',
    ),
    watermark: strictObject({
      surface: 'this datasource source’s watermark',
      history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
      aliases: {
        timestampField: 'field', cursorField: 'field', column: 'field',
        from: 'start', since: 'start', initial: 'start', startAt: 'start',
      },
    }, {
      field: z.string().min(1).describe(
        'Field of the source object the read windows are cut on: a `datetime`, a `date`, or a `number` '
        + 'field declaring `scale: 0` (and, as an integer, a `precision` of 15 digits or fewer). Its value '
        + 'must only grow — an update clock or a source-wide sequence, never a per-row version counter — '
        + 'and a `fieldMapping` entry must copy it unchanged onto a target field of the same type',
      ),
      start: z.union([z.string().min(1), z.number().int()]).describe(
        'The lowest watermark value a pull reads, where the first pull (and every `full` pull) starts: an '
        + 'ISO date or date-time for a `date` / `datetime` field, an integer for an integer field',
      ),
    }).describe('The field the read windows are cut on, and where the first read starts'),
    full: z.boolean().optional().describe(
      'Re-read from `watermark.start` on every run (a full pull, the one that can mark deletes by '
      + 'absence); omitted ⇒ each run reads on from the position the last run committed',
    ),
    ...sourceDeleteFields(),
  }).optional().describe(
    'Pull binding: the federated object this mapping pulls rows from (one-way; a `job` sets the cadence), '
    + 'read in windows cut on `watermark.field`. Exclusive with `connectorSource`. Pulled when a job drives '
    + 'it — a `job` whose `pull: { mapping }` names this mapping; the binding alone moves no rows',
  ),

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
  // ADR-0146 D2 — the override declaration (authored; travels with the item).
  ...OverrideDeclarationFields,
// ADR-0153 D1 / D4 — the rules over a SOURCED mapping that the mapping alone
// can judge, refused at parse on every door. The rules that need the objects
// (a federated source, a `synced` target, the key and the watermark's types)
// are `defineStack`'s, where the stack's objects are known. No arm in the
// closed projection list states either rule, so the published JSON Schema
// stays wider than this parse; the site is recorded in
// `dropped-refinements.baseline.json`.
}).superRefine((mapping, ctx) => {
  const sources = (['connectorSource', 'datasourceSource'] as const).filter((key) => mapping[key] !== undefined);
  if (sources.length === 2) {
    ctx.addIssue({
      code: 'custom',
      path: ['datasourceSource'],
      message: MAPPING_SOURCE_EXCLUSIVE,
    });
  }
  if (sources.length === 0) return;
  if (mapping.mode !== 'upsert') {
    ctx.addIssue({
      code: 'custom',
      path: ['mode'],
      message: sourcedMappingModeRefusal(sources[0], mapping.mode),
    });
  } else if (!Array.isArray(mapping.upsertKey) || mapping.upsertKey.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['upsertKey'],
      message: `A mapping with a \`${sources[0]}\` writes in \`mode: 'upsert'\`, which needs \`upsertKey\`: the `
        + 'target fields a pulled row is matched on, so a row the source sends again updates its copy '
        + 'instead of adding a second one. Name the field the source key is copied onto.',
    });
  }
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

// [#20150] The ONE verdict on what `target` above may name — shared by the
// import door (`@objectstack/rest`) and the author-time check
// (`@objectstack/lint`), which both depend on this package and not on each
// other. See the module for what a target may name and where it has no opinion.
export * from './import-mapping-target';
