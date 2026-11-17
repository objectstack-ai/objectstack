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
 * business vocabulary, which of the caller's words matched which member, and,
 * for a word that matched nothing, the members offered as `candidates`; with
 * them `nextStep`, which case of the selection rule those words are in),
 * and `query_dataset` runs a `DatasetSelection` against one saved dataset and
 * answers rows plus a `provenance` block naming the dataset and the measures
 * used, with `sourceLine`, that source as one finished line. The shapes are
 * declared here once and projected to the JSON Schema an
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
 * admission and member withholding, the term matcher, the rule that finds a
 * zero-match term's candidates and the row cap
 * (`selection.limit` held to the bridge's `maxQueryLimit`) belong to
 * `@objectstack/service-analytics` (card #31589); the MCP registration under
 * `data:read` to `@objectstack/mcp` (card #31590). The tool descriptions, which
 * carry the ADR-0149 D3 selection rule to the model, are written by the
 * executor: AI guidance text does not enter the spec (ADR-0149 M1, ruled A).
 * The two sentences an answer carries, `nextStep.note` and `sourceLine`, are
 * the executor's in the same way (card #34919): the spec declares a string
 * slot for each and fixes no wording (the amendment note under M1).
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
 * How many candidates `list_datasets` lists for one term, at most
 * ({@link ListDatasetsOutputSchema}'s `candidates`).
 *
 * Exported so the executor that fills the list and a client that reads it use
 * the one number. Declared ahead of the schema on purpose: under
 * `OS_EAGER_SCHEMAS=1` (`gen:schema`) the factory runs at module evaluation.
 */
export const LIST_DATASETS_MAX_CANDIDATES_PER_TERM = 5;

/**
 * One member offered as a possible reading of a term that matched nothing: an
 * entry of {@link ListDatasetsOutputSchema}'s `candidates` (ADR-0149 D3, the
 * amendment note under its rules).
 *
 * A candidate is NOT a match. A match ({@link DatasetTermMatchSchema}) says
 * the term equals one of the member's words after normalization, and D3 rule
 * 2 lets one match win. A candidate says only that the platform offers the
 * member for a clarifying question; what counts as a match is unchanged, and
 * a term has candidates only when it has no match anywhere in the answer.
 *
 * The entry is a pointer, `{ term, dataset, member }`, and carries no
 * `matchedOn`: that key states an equality a candidate does not have. It
 * carries no word the term was found near either. D3 rule 1 lets a substring,
 * a stem or an embedding neighbour be offered, an embedding neighbour is near
 * no single word of the member, and the rule that finds candidates is the
 * executor's, so the shape does not presume it. The label, dataset label and
 * description a clarifying question lists (D3 rule 3) are read from the
 * `datasets` entry the pointer names, in the same answer.
 *
 * `member` is {@link DatasetTermMatchSchema}'s `member` BY REFERENCE under its
 * own description: one member-reference format, declared once.
 */
export const DatasetTermCandidateSchema = lazySchema(() => z.object({
  term: z.string().describe(
    'The caller\'s term, as sent in `terms`: one that matched no member of any listed dataset',
  ),
  dataset: z.string().describe(
    'The dataset the offered member belongs to, by name: an entry of `datasets` in the same answer, and what '
    + '`query_dataset` takes as `datasetName`',
  ),
  member: DatasetTermMatchSchema.shape.member.describe(
    'The member offered, as `measures.<name>` or `dimensions.<name>`: a member that dataset\'s entry lists. The '
    + 'term does not equal any of its words after normalization',
  ),
}));

/**
 * Which case of the ADR-0149 D3 selection rule a term is in: the `decision`
 * of {@link DatasetNextStepSchema}.
 *
 * D3 selects a MEASURE, so the values count measures. A term that equals a
 * dimension and no measure is in `no_measure`: a grouping is not a number
 * (rule 5).
 *
 * - `one_measure`: the term equals exactly one measure (rule 2).
 * - `several_measures`: it equals more than one measure, in one dataset or in
 *   several (rule 3).
 * - `candidates_only`: it matched no member and has entries in `candidates`
 *   (the amendment note under the rules).
 * - `no_measure`: it equals no measure and has no entry in `candidates`
 *   (rule 4).
 *
 * The set is closed: a value outside it does not parse, and a fifth case is a
 * change to this enum, never a free string.
 *
 * Each value names what the platform FOUND, in the words of the members it
 * found it in, and none names what a reader then does. What follows from a
 * case is D3's to say, and the text that carries it to a model is the
 * executor's (M1). Were the rule for a case re-ruled (M2 names its own
 * revisits), the four findings would still be these four.
 */
export const DatasetNextStepDecision = z.enum(['one_measure', 'several_measures', 'candidates_only', 'no_measure']);

/**
 * `list_datasets`' reading of the caller's terms under the ADR-0149 D3
 * selection rule: {@link ListDatasetsOutputSchema}'s `nextStep` (ADR-0149 M1,
 * the amendment note under it).
 *
 * Three members: the case (`decision`), the terms it is about (`terms`) and
 * the case in words (`note`).
 *
 * It holds NO member list. The members a decision rests on are already in the
 * answer: a match is an entry of a dataset's `matches`
 * ({@link DatasetTermMatchSchema}), a candidate is an entry of `candidates`
 * ({@link DatasetTermCandidateSchema}), and both carry the caller's `term`.
 * `terms` is that same key, so the reference is by term and no
 * `{ dataset, member }` pointer is declared a second time: an answer has one
 * list of candidates, and `nextStep` holds no second one that could disagree
 * with it.
 *
 * The caller's terms can be in different cases (one equals a measure, another
 * has only candidates). Which case one answer reports is the executor's rule;
 * the shape says which terms the reported case is about.
 *
 * What a schema cannot refuse is the executor's to hold, as it is for
 * `candidates`: that `decision` is the case the named terms are in, and that
 * every term named was sent.
 */
export const DatasetNextStepSchema = lazySchema(() => z.object({
  decision: DatasetNextStepDecision.describe(
    'Which case of the ADR-0149 D3 selection rule each term in `terms` is in, computed by the platform from this '
    + 'answer\'s `matches` and `candidates`. `one_measure`: the term equals exactly one measure. '
    + '`several_measures`: it equals more than one measure, in one dataset or in several. `candidates_only`: it '
    + 'matched no member and has entries in `candidates`. `no_measure`: it equals no measure and has no entry in '
    + '`candidates`. A dimension the term equals is not counted',
  ),
  terms: z.array(z.string()).min(1).describe(
    'The caller\'s terms the decision is about, each as sent in the tool\'s `terms` input. This is the reference to '
    + 'the members the decision rests on, which `nextStep` does not list: they are the entries carrying one of '
    + 'these terms in the same answer, in a dataset\'s `matches` (those whose `member` is a measure) for '
    + '`one_measure` and `several_measures`, and in `candidates` for `candidates_only`. `no_measure` rests on no '
    + 'member',
  ),
  note: z.string().min(1).describe(
    'The decision in words: finished text in the caller\'s locale, composed by the tool from this answer and never '
    + 'typed by the model. The wording is the executor\'s; the schema declares the slot and fixes no text '
    + '(ADR-0149 M1)',
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
  candidates: z.array(DatasetTermCandidateSchema).min(1).optional().describe(
    'Members offered as possible readings of a term that matched no member of any listed dataset, for a '
    + 'clarifying question. A candidate is not a match: its term has no entry in any dataset\'s `matches`. The '
    + 'platform selects none: the list carries no score, and its order is the listing order stated here, not a '
    + 'ranking. Every candidate is a member this caller may read, listed in `datasets`. Terms in the order sent; '
    + 'for one term, datasets in the order listed, and each dataset\'s measures before its dimensions, as its '
    + `entry lists them; at most ${LIST_DATASETS_MAX_CANDIDATES_PER_TERM} per term, the first in that order. `
    + 'Present only when `terms` were sent and a term that matched nothing has a candidate; absent otherwise, '
    + 'never an empty list. A term with a match has no candidate',
  ),
  nextStep: DatasetNextStepSchema.optional().describe(
    'Which case of the ADR-0149 D3 selection rule the caller\'s `terms` are in, as the platform computed it from '
    + 'this answer\'s own `matches` and `candidates`: the case, the terms it is about and the case in words. It adds '
    + 'no match and no candidate and lists no member: the members it rests on are read from `matches` and '
    + '`candidates` under its `terms`. Present only when `terms` were sent',
  ),
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
 *
 * `sourceLine` is declared in the `.extend` below, beside `provenance`: a
 * member of the tool's answer only. `AnalyticsResultResponseSchema` is not
 * edited, so the REST door's answer and every other reader of it are what
 * they were.
 */
export const QueryDatasetOutputSchema = lazySchema(() => AnalyticsResultResponseSchema.shape.data
  .omit({ sql: true })
  .extend({
    provenance: DatasetProvenanceSchema.describe('The dataset and members the answer was computed from'),
    sourceLine: z.string().min(1).optional().describe(
      'The answer\'s source as one finished line, in the caller\'s locale: composed by the tool from `provenance` '
      + 'after the query ran, never typed by the model. `provenance` stays the structured source and this is the '
      + 'same source in words. The wording is the executor\'s; the schema declares the slot and fixes no text '
      + '(ADR-0149 M1). Absent when the tool composed none, never an empty string',
    ),
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
export type DatasetTermCandidate = z.input<typeof DatasetTermCandidateSchema>;
export type DatasetNextStepDecision = z.input<typeof DatasetNextStepDecision>;
export type DatasetNextStep = z.input<typeof DatasetNextStepSchema>;
export type DatasetToolCatalogDimension = z.input<typeof DatasetToolCatalogDimensionSchema>;
export type DatasetToolCatalogMeasure = z.input<typeof DatasetToolCatalogMeasureSchema>;
export type DatasetToolCatalogEntry = z.input<typeof DatasetToolCatalogEntrySchema>;
export type ListDatasetsOutput = z.input<typeof ListDatasetsOutputSchema>;
export type QueryDatasetInput = z.input<typeof QueryDatasetInputSchema>;
export type DatasetProvenance = z.input<typeof DatasetProvenanceSchema>;
export type QueryDatasetOutput = z.input<typeof QueryDatasetOutputSchema>;
