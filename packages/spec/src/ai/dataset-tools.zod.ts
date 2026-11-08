// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { DimensionType } from '../data/analytics.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { AggregationFunction } from '../data/query.zod';
import { DatasetMeasurePolarity } from '../ui/dataset.zod';
import { AnalyticsResultResponseSchema, DatasetSelectionSchema } from '../api/analytics.zod';

/**
 * Dataset AI tools — the inputs and outputs of `list_datasets` and
 * `query_dataset` (ADR-0149 D2).
 *
 * The two tools give an AI the business semantic layer a person already reads
 * through dashboards and reports: `list_datasets` returns the catalogue (the
 * datasets the caller may query, their dimensions and measures, each member's
 * business vocabulary, and which of the caller's words matched which member),
 * and `query_dataset` runs a `DatasetSelection` against one saved dataset and
 * answers rows plus a `provenance` block naming the dataset and the measures
 * used. The shapes are declared here once and projected to the JSON Schema an
 * `AIToolDefinition` carries ({@link getDatasetToolJsonSchemas}), so the MCP
 * registration and the product AI's registration read one definition.
 *
 * `query_dataset`'s `selection` is `DatasetSelectionSchema` BY REFERENCE, the
 * body `POST /api/v1/analytics/dataset/query` takes under the same key: the AI
 * has no private dialect, and the selection's own aliases and guidance apply
 * inside it. Only a saved dataset is addressed, by `datasetName`: there is no
 * inline `dataset` and no `previewDrafts` on this tool, because an AI that could
 * author a dataset inline could author its own 口径.
 *
 * Only the shapes are spec. The executor, the catalogue builder with its
 * admission and member withholding, the term matcher and the row cap
 * (`selection.limit` held to the bridge's `maxQueryLimit`) belong to
 * `@objectstack/service-analytics` (card #31589); the MCP registration under
 * `data:read` to `@objectstack/mcp` (card #31590). The tool descriptions, which
 * carry the ADR-0149 D3 selection rule to the model, are written by the
 * executor: AI guidance text does not enter the spec (ADR-0149 M1, ruled A).
 */

/** The `list_datasets` tool name, in the `list_objects` family's spelling. */
export const LIST_DATASETS_TOOL_NAME = 'list_datasets';
/** The `query_dataset` tool name, in the `query_records` family's spelling. */
export const QUERY_DATASET_TOOL_NAME = 'query_dataset';

const BORN_CLOSED = 'Declared closed from its first day: an unrecognized key is refused, never dropped.';

// ==========================================
// 1. list_datasets
// ==========================================

/**
 * `list_datasets` input. One optional member: the candidate words the caller
 * lifted from the question. Without it the whole catalogue is returned.
 */
export const ListDatasetsInputSchema = lazySchema(() => strictObject(
  {
    surface: 'the `list_datasets` input',
    history: BORN_CLOSED,
    aliases: {
      query: 'terms',
      q: 'terms',
      keywords: 'terms',
      search: 'terms',
    },
  },
  {
    terms: z.array(z.string().min(1)).optional().describe(
      'Candidate business words lifted from the question (e.g. ["营收", "销售阶段"]). Each is compared, after '
      + 'normalization (`normalizeDatasetTerm`), with every listed member\'s name, label and synonyms, and each hit '
      + 'is reported on its dataset\'s `matches`. Omit it to list the whole catalogue.',
    ),
  },
));

/**
 * Which of a member's words a term matched. `label` covers every locale of an
 * inline label map; `synonym` any of the member's `synonyms`.
 */
export const DatasetTermMatchedOn = z.enum(['name', 'label', 'synonym']);

/** One term that matched one member of a listed dataset. */
export const DatasetTermMatchSchema = lazySchema(() => z.object({
  term: z.string().describe('The caller\'s term, as sent in `terms`'),
  member: z.string().regex(/^(dimensions|measures)\.[a-z][a-z0-9_]*$/).describe(
    'The member the term matched, as `measures.<name>` or `dimensions.<name>`',
  ),
  matchedOn: DatasetTermMatchedOn.describe(
    'Which of the member\'s words the term equals after normalization: its `name`, its `label` (any locale) or '
    + 'one of its `synonyms`',
  ),
}));

/**
 * A dimension as the catalogue lists it.
 *
 * The three catalogue schemas carry `Tool` in their names because
 * `@object-ui/app-shell` already declares its own `DatasetCatalogEntry`, the
 * Studio designer's picker list, which is a different shape (`ui`'s
 * `check:spec-symbols` refuses a spec export under that name).
 */
export const DatasetToolCatalogDimensionSchema = lazySchema(() => z.object({
  name: z.string().describe('Dimension name — what `selection.dimensions` takes'),
  label: z.string().describe(
    'Display label at the caller\'s locale — the text the query answer\'s `fields[].label` carries for this '
    + 'dimension',
  ),
  description: z.string().optional().describe(
    'The dimension\'s business definition at the caller\'s locale; absent when the dataset declares none',
  ),
  type: DimensionType.describe(
    'Column type in the `DimensionType` vocabulary — the word the query answer\'s `fields[].type` carries for '
    + 'this dimension (a date dimension is `time`)',
  ),
  synonyms: z.array(z.string()).optional().describe(
    'The words a person uses for this dimension in a question, as the dataset declares them; matched, never '
    + 'rendered',
  ),
}));

/** A measure as the catalogue lists it. */
export const DatasetToolCatalogMeasureSchema = lazySchema(() => z.object({
  name: z.string().describe('Measure name — what `selection.measures` takes'),
  label: z.string().describe(
    'Display label at the caller\'s locale — the text the query answer\'s `fields[].label` carries for this '
    + 'measure',
  ),
  description: z.string().optional().describe(
    'The measure\'s business definition at the caller\'s locale: what the number includes and when to use '
    + 'it. Absent when the dataset declares none',
  ),
  aggregate: AggregationFunction.optional().describe(
    'The measure\'s aggregate; absent on a derived measure, which has no single aggregate',
  ),
  format: z.string().optional().describe('Display format hint, as the measure declares it (e.g. "$0,0", "0.0%")'),
  polarity: DatasetMeasurePolarity.optional().describe(
    'Which direction of change is good news, as the measure declares it; absent means a rise is good',
  ),
  synonyms: z.array(z.string()).optional().describe(
    'The words a person uses for this measure in a question, as the dataset declares them; matched, never '
    + 'rendered',
  ),
}));

/** One dataset the caller may query, with the members the caller may read. */
export const DatasetToolCatalogEntrySchema = lazySchema(() => z.object({
  name: z.string().describe('Dataset name — what `query_dataset` takes as `datasetName`'),
  label: z.string().describe('Dataset label at the caller\'s locale'),
  description: z.string().optional().describe(
    'Dataset description at the caller\'s locale; absent when the dataset declares none',
  ),
  object: z.string().describe('The dataset\'s base object, by machine name'),
  membersWithheld: z.literal(true).optional().describe(
    'Present, and `true`, when a member was left out because this caller cannot read a field it reads: the '
    + 'narrowing is stated, so an answer can say a measure exists that this caller may not see (ADR-0090 D10). '
    + 'Absent when every member the dataset publishes is listed',
  ),
  dimensions: z.array(DatasetToolCatalogDimensionSchema).describe('The dimensions this caller may group by'),
  measures: z.array(DatasetToolCatalogMeasureSchema).describe('The measures this caller may read'),
  matches: z.array(DatasetTermMatchSchema).optional().describe(
    'Each of the caller\'s `terms` that matched a member of this dataset, computed by the platform under the '
    + 'same normalization the dataset\'s own validation uses. Absent when no `terms` were sent',
  ),
}));

/** `list_datasets` output. */
export const ListDatasetsOutputSchema = lazySchema(() => z.object({
  datasets: z.array(DatasetToolCatalogEntrySchema).describe(
    'The datasets this caller may query. A dataset the caller may not query is absent, the same answer as one '
    + 'that does not exist',
  ),
  partial: z.literal(true).optional().describe(
    'Present, and `true`, when the dataset read was degraded and `datasets` may be incomplete; `warning` says '
    + 'why. Absent on a complete answer',
  ),
  warning: z.string().optional().describe('Why the answer is partial; present exactly when `partial` is'),
}));

// ==========================================
// 2. query_dataset
// ==========================================

/**
 * Selection members an AI may put beside `selection` instead of inside it.
 * One prescription for the family.
 */
const SELECTION_MEMBERS_AT_TOP_LEVEL = {
  name: 'SELECTION_MEMBERS_AT_TOP_LEVEL',
  keys: [
    'measures', 'dimensions', 'runtimeFilter', 'where', 'filter', 'filters', 'timeDimensions',
    'dateGranularity', 'order', 'orderBy', 'limit', 'offset', 'compareTo', 'totals', 'timezone',
  ],
  prescription: 'Selection members go inside `selection`, not beside it: '
    + '`{ datasetName, selection: { measures: [...], dimensions: [...] } }`. A filter is '
    + '`selection.runtimeFilter`.',
} as const;

/**
 * `query_dataset` input: one saved dataset by name, and a selection against it.
 */
export const QueryDatasetInputSchema = lazySchema(() => strictObject(
  {
    surface: 'the `query_dataset` input',
    history: BORN_CLOSED,
    aliases: {
      dataset: 'datasetName',
      name: 'datasetName',
    },
    guidance: {
      cube: '`query_dataset` addresses a dataset, not a cube: `datasetName`, as `list_datasets` lists it.',
      previewDrafts: '`query_dataset` reads saved datasets only and takes no `previewDrafts` flag (ADR-0149 D2).',
    },
    guidanceSets: [SELECTION_MEMBERS_AT_TOP_LEVEL],
  },
  {
    datasetName: z.string().min(1).describe(
      'The saved dataset to query, by name, as `list_datasets` lists it. A dataset that does not exist and one '
      + 'this caller may not query get the same `NOT_FOUND` answer',
    ),
    selection: DatasetSelectionSchema,
  },
));

/**
 * The source of a `query_dataset` answer, composed by the tool from the dataset
 * it resolved — never typed by the model. An answer renders its source from
 * this block (ADR-0149 D3).
 *
 * The dataset's intrinsic `filter` is deliberately NOT echoed: it can name
 * fields the caller was never admitted to read, and the 口径 it encodes is what
 * the dataset's and the measures' `description` state in words.
 */
export const DatasetProvenanceSchema = lazySchema(() => z.object({
  kind: z.literal('dataset').describe('The answer was computed from a governed dataset'),
  dataset: z.object({
    name: z.string().describe('Dataset name'),
    label: z.string().describe('Dataset label at the caller\'s locale'),
  }).describe('The dataset the answer was computed from'),
  measures: z.array(z.object({
    name: z.string().describe('Measure name'),
    label: z.string().describe('Measure label at the caller\'s locale'),
    description: z.string().optional().describe(
      'The measure\'s business definition at the caller\'s locale — the sentence that explains what the number '
      + 'includes. Absent when the measure declares none',
    ),
  })).describe('The selected measures, in selection order'),
  dimensions: z.array(z.object({
    name: z.string().describe('Dimension name'),
    label: z.string().describe('Dimension label at the caller\'s locale'),
  })).describe('The selected dimensions, in selection order'),
  runtimeFilter: FilterConditionSchema.optional().describe(
    'The caller\'s `selection.runtimeFilter`, echoed as sent; absent when none was sent. The dataset\'s own '
    + '`filter` is never echoed',
  ),
}));

/**
 * `query_dataset` output: the dataset answer the REST door serves, without the
 * executed SQL, plus `provenance`, `rowCount` and `truncated`.
 *
 * The answer's members are taken BY REFERENCE from
 * `AnalyticsResultResponseSchema`'s `data`, so a column property the REST door
 * gains reaches the tool without a second edit. `sql` is left out: the AI is
 * given no raw SQL (ADR-0021).
 */
export const QueryDatasetOutputSchema = lazySchema(() => AnalyticsResultResponseSchema.shape.data
  .omit({ sql: true })
  .extend({
    provenance: DatasetProvenanceSchema.describe('The dataset and members the answer was computed from'),
    rowCount: z.number().int().nonnegative().describe('How many rows `rows` holds'),
    truncated: z.boolean().describe(
      '`true` when more rows existed past the row cap the tool applied and were not returned',
    ),
    delegationNarrowed: z.literal(true).optional().describe(
      'Present, and `true`, when the caller acts as an agent whose authority narrows what it may read on the '
      + 'dataset\'s object; `warning` states the narrowing (ADR-0090 D10)',
    ),
    warning: z.string().optional().describe('The narrowing statement; present exactly when `delegationNarrowed` is'),
  }));

// ==========================================
// 3. JSON Schema projection
// ==========================================

/** The JSON Schemas one dataset tool's `AIToolDefinition` carries. */
export interface DatasetToolJsonSchema {
  /** `AIToolDefinition.parameters` — the input, as an author writes it. */
  readonly parameters: Record<string, unknown>;
  /** `AIToolDefinition.outputSchema` — the output, as the tool answers it. */
  readonly outputSchema: Record<string, unknown>;
}

let cachedDatasetToolJsonSchemas:
  | Readonly<Record<typeof LIST_DATASETS_TOOL_NAME | typeof QUERY_DATASET_TOOL_NAME, DatasetToolJsonSchema>>
  | undefined;

const toJsonSchema = (schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    // Neither tool has an unrepresentable construct today; a future one must
    // not throw at tool registration.
    unrepresentable: 'any',
  }) as Record<string, unknown>;

/**
 * The two dataset tools' JSON Schemas, keyed by tool name: `parameters`
 * projected from the input schema, `outputSchema` from the output schema.
 * Built on first call and memoized, so a host that never registers the tools
 * never pays for the projection.
 */
export function getDatasetToolJsonSchemas(): Readonly<
  Record<typeof LIST_DATASETS_TOOL_NAME | typeof QUERY_DATASET_TOOL_NAME, DatasetToolJsonSchema>
> {
  if (cachedDatasetToolJsonSchemas === undefined) {
    cachedDatasetToolJsonSchemas = {
      [LIST_DATASETS_TOOL_NAME]: {
        parameters: toJsonSchema(ListDatasetsInputSchema, 'input'),
        outputSchema: toJsonSchema(ListDatasetsOutputSchema, 'output'),
      },
      [QUERY_DATASET_TOOL_NAME]: {
        parameters: toJsonSchema(QueryDatasetInputSchema, 'input'),
        outputSchema: toJsonSchema(QueryDatasetOutputSchema, 'output'),
      },
    };
  }
  return cachedDatasetToolJsonSchemas;
}

export type ListDatasetsInput = z.input<typeof ListDatasetsInputSchema>;
export type DatasetTermMatchedOn = z.input<typeof DatasetTermMatchedOn>;
export type DatasetTermMatch = z.input<typeof DatasetTermMatchSchema>;
export type DatasetToolCatalogDimension = z.input<typeof DatasetToolCatalogDimensionSchema>;
export type DatasetToolCatalogMeasure = z.input<typeof DatasetToolCatalogMeasureSchema>;
export type DatasetToolCatalogEntry = z.input<typeof DatasetToolCatalogEntrySchema>;
export type ListDatasetsOutput = z.input<typeof ListDatasetsOutputSchema>;
export type QueryDatasetInput = z.input<typeof QueryDatasetInputSchema>;
export type DatasetProvenance = z.input<typeof DatasetProvenanceSchema>;
export type QueryDatasetOutput = z.input<typeof QueryDatasetOutputSchema>;
