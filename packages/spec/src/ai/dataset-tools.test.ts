// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D2] The `list_datasets` / `query_dataset` inputs and outputs, and
 * their JSON Schema projection.
 *
 * What is pinned: both inputs are closed and point the spellings the ADR names
 * at the canonical key; `query_dataset`'s `selection` IS
 * `DatasetSelectionSchema` (one declaration, no private dialect), so the
 * selection's own aliases and guidance apply inside it; the query output takes
 * the dataset answer's members by reference and leaves out `sql`; the
 * projection is what an `AIToolDefinition` carries, built once.
 */

import { describe, expect, it } from 'vitest';
import { AnalyticsResultResponseSchema, DatasetSelectionSchema } from '../api/analytics.zod';
import {
  DatasetCatalogEntrySchema,
  DatasetProvenanceSchema,
  DatasetTermMatchSchema,
  LIST_DATASETS_TOOL_NAME,
  ListDatasetsInputSchema,
  ListDatasetsOutputSchema,
  QUERY_DATASET_TOOL_NAME,
  QueryDatasetInputSchema,
  QueryDatasetOutputSchema,
  getDatasetToolJsonSchemas,
} from './dataset-tools.zod';

const firstMessage = (parsed: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  parsed.error?.issues[0]?.message ?? '';

const provenance = {
  kind: 'dataset' as const,
  dataset: { name: 'sales_analysis', label: '销售分析' },
  measures: [{ name: 'total_amount', label: '营收', description: '已赢单金额合计' }],
  dimensions: [{ name: 'stage', label: '阶段' }],
};

describe('tool names', () => {
  it('are spelled in the list_objects / query_records family', () => {
    expect(LIST_DATASETS_TOOL_NAME).toBe('list_datasets');
    expect(QUERY_DATASET_TOOL_NAME).toBe('query_dataset');
  });
});

describe('list_datasets input', () => {
  it('takes nothing, or the candidate terms', () => {
    expect(ListDatasetsInputSchema.safeParse({}).success).toBe(true);
    expect(ListDatasetsInputSchema.parse({ terms: ['营收', 'stage'] })).toEqual({ terms: ['营收', 'stage'] });
  });

  it('refuses an empty term', () => {
    expect(ListDatasetsInputSchema.safeParse({ terms: [''] }).success).toBe(false);
  });

  it.each(['query', 'q', 'keywords', 'search'])('points `%s` at `terms`', (written) => {
    const parsed = ListDatasetsInputSchema.safeParse({ [written]: ['营收'] });
    expect(parsed.success).toBe(false);
    expect(firstMessage(parsed)).toContain(`\`${written}\` → \`terms\``);
  });
});

describe('query_dataset input', () => {
  const selection = { measures: ['total_amount'], dimensions: ['stage'] };

  it('takes a saved dataset by name and a selection', () => {
    expect(QueryDatasetInputSchema.parse({ datasetName: 'sales_analysis', selection }))
      .toEqual({ datasetName: 'sales_analysis', selection });
  });

  it('`selection` is DatasetSelectionSchema itself, not a copy', () => {
    expect(QueryDatasetInputSchema.shape.selection).toBe(DatasetSelectionSchema);
  });

  it('the selection\'s own aliases apply inside it', () => {
    const parsed = QueryDatasetInputSchema.safeParse({
      datasetName: 'sales_analysis',
      selection: { ...selection, where: { stage: 'won' } },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['selection']);
    expect(firstMessage(parsed)).toContain('`where` → `runtimeFilter`');
  });

  it('requires both members, and a non-empty dataset name', () => {
    expect(QueryDatasetInputSchema.safeParse({ selection }).success).toBe(false);
    expect(QueryDatasetInputSchema.safeParse({ datasetName: 'sales_analysis' }).success).toBe(false);
    expect(QueryDatasetInputSchema.safeParse({ datasetName: '', selection }).success).toBe(false);
  });

  it.each(['dataset', 'name'])('points `%s` at `datasetName`', (written) => {
    const parsed = QueryDatasetInputSchema.safeParse({ [written]: 'sales_analysis', selection });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message).join('\n'))
      .toContain(`\`${written}\` → \`datasetName\``);
  });

  it('refuses `previewDrafts` and `cube` with the reason', () => {
    const drafts = QueryDatasetInputSchema.safeParse({ datasetName: 'sales_analysis', selection, previewDrafts: true });
    expect(firstMessage(drafts)).toContain('reads saved datasets only');
    const cube = QueryDatasetInputSchema.safeParse({ datasetName: 'sales_analysis', selection, cube: 'opportunity' });
    expect(firstMessage(cube)).toContain('addresses a dataset, not a cube');
  });

  it('a selection member written beside `selection` is pointed inside it, once per message', () => {
    const parsed = QueryDatasetInputSchema.safeParse({
      datasetName: 'sales_analysis',
      selection,
      measures: ['total_amount'],
      filter: { stage: 'won' },
    });
    expect(parsed.success).toBe(false);
    const message = firstMessage(parsed);
    expect(message).toContain('Selection members go inside `selection`');
    expect(message.split('Selection members go inside').length - 1).toBe(1);
  });
});

describe('list_datasets output', () => {
  const entry = {
    name: 'sales_analysis',
    label: '销售分析',
    object: 'opportunity',
    dimensions: [{ name: 'stage', label: '阶段', type: 'string' as const, synonyms: ['销售阶段'] }],
    measures: [{ name: 'total_amount', label: '营收', aggregate: 'sum' as const, synonyms: ['收入', 'revenue'] }],
    matches: [{ term: '收入', member: 'measures.total_amount', matchedOn: 'synonym' as const }],
  };

  it('parses a catalogue entry with matches, and a degraded answer', () => {
    expect(ListDatasetsOutputSchema.safeParse({ datasets: [entry] }).success).toBe(true);
    expect(ListDatasetsOutputSchema.safeParse({ datasets: [], partial: true, warning: 'metadata read degraded' }).success)
      .toBe(true);
  });

  it('a derived measure carries no aggregate', () => {
    const derived = { ...entry, measures: [{ name: 'win_rate', label: '赢率', format: '0.0%' }] };
    expect(DatasetCatalogEntrySchema.safeParse(derived).success).toBe(true);
  });

  it('`membersWithheld` and `partial` are present only as `true`', () => {
    expect(DatasetCatalogEntrySchema.safeParse({ ...entry, membersWithheld: true }).success).toBe(true);
    expect(DatasetCatalogEntrySchema.safeParse({ ...entry, membersWithheld: false }).success).toBe(false);
    expect(ListDatasetsOutputSchema.safeParse({ datasets: [], partial: false }).success).toBe(false);
  });

  it('a match names its member as `<group>.<name>`', () => {
    const match = { term: 'x', matchedOn: 'name' as const };
    expect(DatasetTermMatchSchema.safeParse({ ...match, member: 'dimensions.stage' }).success).toBe(true);
    expect(DatasetTermMatchSchema.safeParse({ ...match, member: 'fields.stage' }).success).toBe(false);
    expect(DatasetTermMatchSchema.safeParse({ ...match, member: 'total_amount' }).success).toBe(false);
  });
});

describe('query_dataset output', () => {
  const answer = {
    rows: [{ stage: 'Won', total_amount: 1200 }],
    fields: [{ name: 'stage', type: 'string' }, { name: 'total_amount', type: 'number', label: '营收' }],
    object: 'opportunity',
    provenance,
    rowCount: 1,
    truncated: false,
  };

  it('parses the dataset answer plus provenance, rowCount and truncated', () => {
    expect(QueryDatasetOutputSchema.safeParse(answer).success).toBe(true);
    expect(QueryDatasetOutputSchema.safeParse({ ...answer, truncated: undefined }).success).toBe(false);
    expect(QueryDatasetOutputSchema.safeParse({ ...answer, rowCount: -1 }).success).toBe(false);
  });

  it('takes the answer\'s members by reference and leaves out `sql`', () => {
    const door = AnalyticsResultResponseSchema.shape.data.shape;
    const tool = QueryDatasetOutputSchema.shape;
    expect(Object.keys(tool)).not.toContain('sql');
    for (const key of Object.keys(door).filter((k) => k !== 'sql')) {
      expect(tool[key as keyof typeof tool], key).toBe(door[key as keyof typeof door]);
    }
  });

  it('carries a delegation narrowing as `query_records` does', () => {
    const narrowed = { ...answer, delegationNarrowed: true, warning: 'Acting for an agent: narrowed to own records.' };
    expect(QueryDatasetOutputSchema.safeParse(narrowed).success).toBe(true);
  });

  it('provenance is a dataset source, echoing the caller\'s runtime filter only', () => {
    expect(DatasetProvenanceSchema.safeParse({ ...provenance, runtimeFilter: { stage: 'won' } }).success).toBe(true);
    expect(DatasetProvenanceSchema.safeParse({ ...provenance, kind: 'object' }).success).toBe(false);
    expect(Object.keys(DatasetProvenanceSchema.shape)).not.toContain('filter');
  });
});

describe('JSON Schema projection', () => {
  it('projects both tools once, keyed by tool name', () => {
    const first = getDatasetToolJsonSchemas();
    expect(Object.keys(first).sort()).toEqual(['list_datasets', 'query_dataset']);
    expect(getDatasetToolJsonSchemas()).toBe(first);
  });

  it('`parameters` is the closed input an AIToolDefinition carries', () => {
    const { parameters } = getDatasetToolJsonSchemas().query_dataset as {
      parameters: { type: string; required: string[]; additionalProperties: unknown; properties: Record<string, unknown> };
    };
    expect(parameters.type).toBe('object');
    expect(parameters.required.sort()).toEqual(['datasetName', 'selection']);
    expect(parameters.additionalProperties).toBe(false);
    expect(Object.keys(parameters.properties).sort()).toEqual(['datasetName', 'selection']);

    const list = getDatasetToolJsonSchemas().list_datasets.parameters as { required?: string[]; additionalProperties: unknown };
    expect(list.required ?? []).toEqual([]);
    expect(list.additionalProperties).toBe(false);
  });

  it('`outputSchema` carries provenance and no SQL', () => {
    const { outputSchema } = getDatasetToolJsonSchemas().query_dataset as {
      outputSchema: { required: string[]; properties: Record<string, unknown> };
    };
    expect(outputSchema.required).toEqual(expect.arrayContaining(['rows', 'fields', 'provenance', 'rowCount', 'truncated']));
    expect(Object.keys(outputSchema.properties)).not.toContain('sql');
    const catalogue = getDatasetToolJsonSchemas().list_datasets.outputSchema as { required: string[] };
    expect(catalogue.required).toEqual(['datasets']);
  });
});
