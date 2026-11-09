// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  LIST_DATASETS_TOOL_NAME,
  ListDatasetsInputSchema,
  QUERY_DATASET_TOOL_NAME,
  QueryDatasetInputSchema,
  getDatasetToolJsonSchemas,
  type DatasetProvenance,
  type DatasetToolCatalogDimension,
  type DatasetToolCatalogEntry,
  type DatasetToolCatalogMeasure,
  type ListDatasetsOutput,
  type QueryDatasetOutput,
} from '@objectstack/spec/ai';
import type { AIToolDefinition, AnalyticsResult, DatasetSelection } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { DatasetSchema, resolveI18nLabel, type Dataset } from '@objectstack/spec/ui';
import { fieldsFromZodIssues } from '@objectstack/types';
import type { AnalyticsService } from './analytics-service.js';
import { datasetDimensionCubeType } from './dataset-compiler.js';
import { matchDatasetTerms } from './dataset-term-matcher.js';

/**
 * The dataset AI tools — `list_datasets` and `query_dataset` — defined once,
 * with one executor (ADR-0149 D2–D4).
 *
 * ## One definition, two transports
 *
 * {@link getDatasetToolDefinitions} is the pair of `AIToolDefinition`s: the
 * names, the descriptions that carry the D3 selection rule to the model, and
 * the JSON Schemas projected from the spec's tool I/O schemas
 * (`@objectstack/spec/ai`, `dataset-tools.zod.ts`). {@link createDatasetTools}
 * binds the executor to a host. The product AI's registry registers the
 * definitions and delegates to `execute`; MCP's bridge members call
 * `listDatasets` / `queryDataset` with the principal they bind. Neither owns
 * a copy of the shape or of the executor.
 *
 * ## No gate added, none bypassed (D4)
 *
 * `query_dataset` reaches data ONLY through `AnalyticsService.queryDataset`
 * with the caller's `ExecutionContext`: no engine, no driver, no SQL here.
 * The catalogue asks `AnalyticsService.admitDatasetCatalogEntry`, which asks
 * the gates every query of the dataset passes, through the service's own
 * methods. The tools REFUSE on a service whose admission hooks are not the
 * plugin-wired set ({@link AnalyticsService.hasPluginWiredAdmission}): built
 * by hand without them, the exposure gate warns once and passes and the read
 * admission returns silently — answers no caller may be served on another's
 * behalf.
 *
 * ## Provenance the model cannot invent (D3)
 *
 * `provenance` is composed here, after the query ran, from the dataset the
 * tool resolved and the selection the service answered. Nothing in it is read
 * from the model's input except the selection's own member names (which the
 * service just judged) and its `runtimeFilter`, echoed as sent. The input is a
 * strict object, so a `provenance` (or any other key) the model puts beside
 * `datasetName` / `selection` is refused, never merged.
 */

/** `query_dataset`'s row cap when the host sets none — `query_records`' default. */
export const DATASET_TOOL_DEFAULT_MAX_ROWS = 50;

const LIST_DATASETS_DESCRIPTION =
  'List the governed business datasets this caller may query: each dataset\'s dimensions (what an answer can be '
  + 'grouped by) and measures (the numbers it can answer), with their business definitions and synonyms. Pass '
  + '`terms` — the business words lifted from the question — and each dataset reports which of them equal a '
  + 'member\'s name, label or synonym (`matches`). Selection rule: one match on a measure wins, so answer through '
  + '`query_dataset` with that dataset and measure, and cite the answer\'s `provenance` as its source. Several '
  + 'matches (two datasets or two members answer to the word): ask the user which one is meant, listing each '
  + 'candidate\'s label, dataset label and description; never pick one. No match: fall back to the object query '
  + 'tools and say in the answer that no governed metric was used (非指标口径); when the object you fall back to '
  + 'is a listed dataset\'s `object`, add one line naming that dataset and its measures. A dimension match alone '
  + 'picks a grouping, not a number: a measure must still match. `membersWithheld` means some members exist that '
  + 'this caller may not see.';

const QUERY_DATASET_DESCRIPTION =
  'Run a selection (measures, optional dimensions, filter, time window, order, limit) against one saved business '
  + 'dataset, by the name `list_datasets` lists, under the caller\'s permissions. Answers the rows plus '
  + '`provenance` naming the dataset and the measures used — render the answer\'s source from `provenance` '
  + '(e.g. 「指标：营收（数据集：销售分析）」), and explain a number with its measure\'s description. A dataset that '
  + 'does not exist and one this caller may not query both answer NOT_FOUND. Rows are capped; `truncated` says '
  + 'more existed.';

let cachedDefinitions: readonly AIToolDefinition[] | undefined;

/**
 * The two dataset tools' `AIToolDefinition`s — `list_datasets` first, then
 * `query_dataset`. Static: they depend on no host, so a registry may list
 * them before any executor is bound. Built on first call and memoized.
 */
export function getDatasetToolDefinitions(): readonly AIToolDefinition[] {
  if (cachedDefinitions === undefined) {
    const schemas = getDatasetToolJsonSchemas();
    cachedDefinitions = Object.freeze([
      Object.freeze({
        name: LIST_DATASETS_TOOL_NAME,
        label: 'List datasets',
        description: LIST_DATASETS_DESCRIPTION,
        parameters: schemas[LIST_DATASETS_TOOL_NAME].parameters,
        outputSchema: schemas[LIST_DATASETS_TOOL_NAME].outputSchema,
      }),
      Object.freeze({
        name: QUERY_DATASET_TOOL_NAME,
        label: 'Query dataset',
        description: QUERY_DATASET_DESCRIPTION,
        parameters: schemas[QUERY_DATASET_TOOL_NAME].parameters,
        outputSchema: schemas[QUERY_DATASET_TOOL_NAME].outputSchema,
      }),
    ]);
  }
  return cachedDefinitions;
}

/**
 * The saved datasets of the caller's environment, as the host read them.
 *
 * The array form is a complete read. The object form carries `partial: true`
 * and a `warning` when the read was degraded (the `list_objects` shape), and
 * the tools say so instead of presenting a short list as the whole catalogue.
 */
export type DatasetToolSource =
  | readonly unknown[]
  | { readonly items: readonly unknown[]; readonly partial?: true; readonly warning?: string };

/** The ADR-0090 D10 narrowing probe, in `McpDataBridge.diagnoseDelegation`'s shape. */
export type DatasetToolDelegationProbe = (
  object: string,
  context: ExecutionContext | undefined,
) => Promise<{ narrowed: boolean; statement?: string } | undefined>;

/** What {@link createDatasetTools} binds the executor to. */
export interface DatasetToolsDeps {
  /**
   * The analytics service the host registered as `'analytics'`. The tools
   * serve only from an {@link AnalyticsService} whose admission hooks are the
   * plugin-wired set ({@link AnalyticsService.datasetTools} binds it to
   * itself); anything else (absent, another implementation, a
   * hand-built service without the hooks) is refused at every call. Read per
   * call, so a getter resolving the kernel's service lazily is fine.
   */
  readonly analytics: unknown | (() => unknown);
  /**
   * The saved `dataset` items of the caller's environment — the same
   * `getMetaItems({ type: 'dataset' })` read the REST door resolves
   * `datasetName` from — localized at the metadata boundary for the caller's
   * locale, as the REST door localizes a saved dataset. Read decorations
   * (`_diagnostics`, …) may be left on; the tools strip them. A throw is a
   * degraded read: `list_datasets` answers `partial`, `query_dataset` 503.
   */
  readonly loadDatasets: (context: ExecutionContext | undefined) => Promise<DatasetToolSource>;
  /** `query_dataset`'s row cap — the bridge's `maxQueryLimit`. Default {@link DATASET_TOOL_DEFAULT_MAX_ROWS}. */
  readonly maxQueryLimit?: number;
  /**
   * The bridge's ADR-0090 D10 probe for the dataset's base object. Optional:
   * without it the answer carries no narrowing statement, as `query_records`
   * on a bridge that omits it. A throw is read as "cannot say".
   */
  readonly diagnoseDelegation?: DatasetToolDelegationProbe;
}

/** A tool call in the `ToolCallPart` shape's two members the executor reads. */
export interface DatasetToolCall {
  readonly toolName: string;
  readonly input: unknown;
}

/** The bound executor. Every method refuses by THROWING an ADR-0112-shaped error (`code` + `status`). */
export interface DatasetTools {
  /** {@link getDatasetToolDefinitions}. */
  readonly definitions: readonly AIToolDefinition[];
  /** Dispatch a call by `toolName` — the registry face. An unknown name is refused `NOT_FOUND` / 404. */
  execute(call: DatasetToolCall, context?: ExecutionContext): Promise<ListDatasetsOutput | QueryDatasetOutput>;
  /** `list_datasets`. */
  listDatasets(input: unknown, context?: ExecutionContext): Promise<ListDatasetsOutput>;
  /** `query_dataset`. */
  queryDataset(input: unknown, context?: ExecutionContext): Promise<QueryDatasetOutput>;
}

type ToolRefusal = Error & { code: string; status: number; details?: unknown };

function refusal(code: string, status: number, message: string, details?: unknown): ToolRefusal {
  const err = new Error(message) as ToolRefusal;
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

/**
 * [ADR-0149 D4] The plugin-wired service, or the refusal. `SERVICE_UNAVAILABLE`
 * / 503: nothing about the caller's request is wrong — the deployment cannot
 * serve this tool with every gate live, and saying so is the honest answer.
 */
function wiredService(analytics: DatasetToolsDeps['analytics']): AnalyticsService {
  const service = (typeof analytics === 'function' ? (analytics as () => unknown)() : analytics) as
    | Partial<AnalyticsService>
    | null
    | undefined;
  if (
    typeof service?.hasPluginWiredAdmission === 'function'
    && typeof service.admitDatasetCatalogEntry === 'function'
    && typeof service.queryDataset === 'function'
    && service.hasPluginWiredAdmission()
  ) {
    return service as AnalyticsService;
  }
  throw refusal(
    'SERVICE_UNAVAILABLE',
    503,
    'The dataset tools are not available on this deployment: they serve only from the analytics service '
      + 'AnalyticsServicePlugin registers, whose exposure, object-read and field-read gates are all wired. '
      + 'Register AnalyticsServicePlugin rather than a hand-built AnalyticsService.',
  );
}

function inputRefusal(tool: string, issues: unknown, input: unknown): ToolRefusal {
  const fields = fieldsFromZodIssues(
    issues as Array<{ path: Array<string | number | symbol>; code: string; message: string }>,
    input,
  ).map((f) => (f.field === '(body)' ? { ...f, field: '(input)' } : f));
  const message = `Invalid ${tool} input: ${fields.map((f) => `${f.field}: ${f.message}`).join('; ')}`;
  return refusal('VALIDATION_FAILED', 400, message, { fields });
}

interface LoadedDatasets {
  readonly datasets: Dataset[];
  readonly partial: boolean;
  readonly warning?: string;
}

/** A label at the caller's locale; `fallback` when it resolves to nothing. */
function text(label: unknown, locale: string | undefined, fallback: string): string;
function text(label: unknown, locale: string | undefined): string | undefined;
function text(label: unknown, locale: string | undefined, fallback?: string): string | undefined {
  if (label == null) return fallback;
  try {
    return resolveI18nLabel(label as Parameters<typeof resolveI18nLabel>[0], locale) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Create the dataset tools' executor over a host's service and metadata. */
export function createDatasetTools(deps: DatasetToolsDeps): DatasetTools {
  const maxRows = typeof deps.maxQueryLimit === 'number' && deps.maxQueryLimit > 0
    ? Math.floor(deps.maxQueryLimit)
    : DATASET_TOOL_DEFAULT_MAX_ROWS;

  /**
   * The saved datasets, each stripped of read decorations and parsed as the
   * REST door parses a saved dataset; one that fails the parse is left out (a
   * query of it would be refused for every caller) and the service log says so.
   */
  async function load(service: AnalyticsService, context: ExecutionContext | undefined): Promise<LoadedDatasets> {
    const source = await deps.loadDatasets(context);
    const items = Array.isArray(source) ? source : (source as { items?: readonly unknown[] }).items ?? [];
    const degraded = !Array.isArray(source) && (source as { partial?: unknown }).partial === true;
    const datasets: Dataset[] = [];
    for (const item of items) {
      const parsed = DatasetSchema.safeParse(stripReadDecorations(item));
      if (parsed.success) datasets.push(parsed.data as Dataset);
      else service.reportDatasetCatalogDefect(datasetItemName(item), parsed.error.message);
    }
    return {
      datasets,
      partial: degraded,
      ...(degraded ? { warning: String((source as { warning?: unknown }).warning ?? 'The dataset read was degraded.') } : {}),
    };
  }

  async function listDatasets(input: unknown, context?: ExecutionContext): Promise<ListDatasetsOutput> {
    const service = wiredService(deps.analytics);
    const parsed = ListDatasetsInputSchema.safeParse(input ?? {});
    if (!parsed.success) throw inputRefusal(LIST_DATASETS_TOOL_NAME, parsed.error.issues, input);
    const terms = parsed.data.terms;

    let loaded: LoadedDatasets;
    try {
      loaded = await load(service, context);
    } catch (e) {
      // The #6504 shape: never a count that is not a fact.
      return {
        datasets: [],
        partial: true,
        warning: `The dataset catalogue could not be read: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const locale = context?.locale;
    const entries: DatasetToolCatalogEntry[] = [];
    let unresolved = false;
    for (const dataset of loaded.datasets) {
      const admission = await service.admitDatasetCatalogEntry(dataset, context);
      if (admission.unresolved) unresolved = true;
      if (!admission.admitted) continue;
      const dimensions = (dataset.dimensions ?? []).filter((d) => admission.dimensions.has(d.name));
      const measures = (dataset.measures ?? []).filter((m) => admission.measures.has(m.name));
      const entry: DatasetToolCatalogEntry = {
        name: dataset.name,
        label: text(dataset.label, locale, dataset.name),
        ...optional('description', text(dataset.description, locale)),
        object: dataset.object,
        ...(admission.withheld ? { membersWithheld: true as const } : {}),
        dimensions: dimensions.map((d): DatasetToolCatalogDimension => ({
          name: d.name,
          label: text(d.label, locale, d.name),
          ...optional('description', text(d.description, locale)),
          type: datasetDimensionCubeType(d),
          ...(d.synonyms && d.synonyms.length > 0 ? { synonyms: [...d.synonyms] } : {}),
        } as DatasetToolCatalogDimension)),
        measures: measures.map((m): DatasetToolCatalogMeasure => ({
          name: m.name,
          label: text(m.label, locale, m.name),
          ...optional('description', text(m.description, locale)),
          ...(m.derived || !m.aggregate ? {} : { aggregate: m.aggregate }),
          ...optional('format', typeof m.format === 'string' ? m.format : undefined),
          ...optional('polarity', m.polarity),
          ...(m.synonyms && m.synonyms.length > 0 ? { synonyms: [...m.synonyms] } : {}),
        } as DatasetToolCatalogMeasure)),
      };
      if (terms !== undefined) entry.matches = matchDatasetTerms(terms, { dimensions, measures });
      entries.push(entry);
    }

    const warnings: string[] = [];
    if (loaded.partial && loaded.warning) warnings.push(loaded.warning);
    if (unresolved) {
      warnings.push('Some datasets or members could not be checked against this caller\'s permissions and are left out.');
    }
    return {
      datasets: entries,
      ...(warnings.length > 0 ? { partial: true as const, warning: warnings.join(' ') } : {}),
    };
  }

  async function queryDataset(input: unknown, context?: ExecutionContext): Promise<QueryDatasetOutput> {
    const service = wiredService(deps.analytics);
    const parsed = QueryDatasetInputSchema.safeParse(input);
    if (!parsed.success) throw inputRefusal(QUERY_DATASET_TOOL_NAME, parsed.error.issues, input);
    // Validation only, as the REST door: what reaches the service is the
    // caller's own selection, never a parse output.
    const raw = input as { datasetName: string; selection: DatasetSelection };
    const datasetName = raw.datasetName;

    let loaded: LoadedDatasets;
    try {
      loaded = await load(service, context);
    } catch (e) {
      throw refusal(
        'SERVICE_UNAVAILABLE',
        503,
        `The dataset "${datasetName}" could not be resolved: the dataset read failed `
          + `(${e instanceof Error ? e.message : String(e)}). This is a server-side fault, not a missing dataset.`,
      );
    }
    const notFound = () => refusal('NOT_FOUND', 404, `Dataset "${datasetName}" not found.`);
    const dataset = loaded.datasets.find((d) => d.name === datasetName);
    if (!dataset) throw notFound();
    // Resolved exactly as `list_datasets` lists it: a dataset the caller may
    // not query is absent, one answer for missing and hidden (ADR-0149 D2).
    const admission = await service.admitDatasetCatalogEntry(dataset, context);
    if (!admission.admitted) {
      if (admission.unresolved) {
        throw refusal(
          'SERVICE_UNAVAILABLE',
          503,
          `Read access to the dataset "${datasetName}" could not be determined, so the query was not run. `
            + 'This is a server-side fault, not a permission denial.',
        );
      }
      throw notFound();
    }

    // The row cap: the caller's own `limit` when it is within the cap, the cap
    // otherwise; one row past it is asked for, so `truncated` is a fact.
    const cap = typeof raw.selection.limit === 'number' && raw.selection.limit >= 0 && raw.selection.limit < maxRows
      ? raw.selection.limit
      : maxRows;
    const selection: DatasetSelection = { ...raw.selection, limit: cap + 1 };
    const answer: AnalyticsResult = await service.queryDataset(dataset, selection, context);

    const rows = Array.isArray(answer.rows) ? answer.rows : [];
    const truncated = rows.length > cap;
    const served = truncated ? rows.slice(0, cap) : rows;
    const { sql: _sql, ...rest } = answer as AnalyticsResult & { sql?: unknown };

    let narrowing: { narrowed: boolean; statement?: string } | undefined;
    if (deps.diagnoseDelegation) {
      narrowing = await deps.diagnoseDelegation(dataset.object, context).catch(() => undefined);
    }

    return {
      ...rest,
      rows: served,
      // Composed last, so nothing the answer carries can stand in for them.
      provenance: composeProvenance(dataset, raw.selection, context?.locale),
      rowCount: served.length,
      truncated,
      ...(narrowing?.narrowed && narrowing.statement
        ? { delegationNarrowed: true as const, warning: narrowing.statement }
        : {}),
    } as QueryDatasetOutput;
  }

  return {
    definitions: getDatasetToolDefinitions(),
    async execute(call, context) {
      if (call.toolName === LIST_DATASETS_TOOL_NAME) return listDatasets(call.input, context);
      if (call.toolName === QUERY_DATASET_TOOL_NAME) return queryDataset(call.input, context);
      throw refusal('NOT_FOUND', 404, `Unknown dataset tool "${call.toolName}".`);
    },
    listDatasets,
    queryDataset,
  };
}

/**
 * [ADR-0149 D3] The answer's source, from the dataset the tool resolved and
 * the selection the service answered: the dataset's name and label, each
 * selected measure's name, label and description, each selected dimension
 * (the `dimensions` list, then a `timeDimensions` entry's dimension not
 * already named), and the caller's `runtimeFilter` as sent. The dataset's own
 * `filter` is never echoed.
 */
function composeProvenance(
  dataset: Dataset,
  selection: DatasetSelection,
  locale: string | undefined,
): DatasetProvenance {
  const measureByName = new Map((dataset.measures ?? []).map((m) => [m.name, m]));
  const dimensionByName = new Map((dataset.dimensions ?? []).map((d) => [d.name, d]));
  const dimensionNames: string[] = [];
  for (const name of selection.dimensions ?? []) {
    if (typeof name === 'string' && !dimensionNames.includes(name)) dimensionNames.push(name);
  }
  for (const td of (selection as { timeDimensions?: Array<{ dimension?: unknown }> }).timeDimensions ?? []) {
    const name = td?.dimension;
    if (typeof name === 'string' && dimensionByName.has(name) && !dimensionNames.includes(name)) dimensionNames.push(name);
  }
  return {
    kind: 'dataset',
    dataset: { name: dataset.name, label: text(dataset.label, locale, dataset.name) },
    measures: (selection.measures ?? []).map((name) => {
      const m = measureByName.get(name);
      return {
        name,
        label: text(m?.label, locale, name),
        ...optional('description', text(m?.description, locale)),
      };
    }),
    dimensions: dimensionNames.map((name) => ({
      name,
      label: text(dimensionByName.get(name)?.label, locale, name),
    })),
    ...(selection.runtimeFilter !== undefined ? { runtimeFilter: selection.runtimeFilter } : {}),
  } as DatasetProvenance;
}

/** A saved item's `name` for the server log, or a placeholder. */
function datasetItemName(item: unknown): string {
  const name = (item as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && name !== '' ? name : '(unnamed dataset)';
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
