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
 *
 * [ADR-0149 D3, amendment note] `list_datasets` answers a term that matched
 * nothing with `candidates`: pointers to listed members, never a match and
 * never an empty list, and an answer without the key parses as before.
 *
 * [ADR-0149 M1, amendment note] `list_datasets` may state `nextStep`: a closed
 * `decision`, the caller's `terms` it is about and a `note`, with no member
 * list of its own, so an answer keeps one list of candidates. `query_dataset`
 * may state `sourceLine`, on the tool's answer only. Each is optional, and an
 * answer without it parses as before. The two texts are string slots: no
 * wording is pinned here, because none is declared.
 */

import { describe, expect, it } from 'vitest';
import { AnalyticsResultResponseSchema, DatasetSelectionSchema } from '../api/analytics.zod';
import {
  DatasetToolCatalogEntrySchema,
  DatasetNextStepDecision,
  DatasetNextStepSchema,
  DatasetProvenanceSchema,
  DatasetTermCandidateSchema,
  DatasetTermMatchSchema,
  LIST_DATASETS_MAX_CANDIDATES_PER_TERM,
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
    expect(DatasetToolCatalogEntrySchema.safeParse(derived).success).toBe(true);
  });

  it('`membersWithheld` and `partial` are present only as `true`', () => {
    expect(DatasetToolCatalogEntrySchema.safeParse({ ...entry, membersWithheld: true }).success).toBe(true);
    expect(DatasetToolCatalogEntrySchema.safeParse({ ...entry, membersWithheld: false }).success).toBe(false);
    expect(ListDatasetsOutputSchema.safeParse({ datasets: [], partial: false }).success).toBe(false);
  });

  it('a match names its member as `<group>.<name>`', () => {
    const match = { term: 'x', matchedOn: 'name' as const };
    expect(DatasetTermMatchSchema.safeParse({ ...match, member: 'dimensions.stage' }).success).toBe(true);
    expect(DatasetTermMatchSchema.safeParse({ ...match, member: 'fields.stage' }).success).toBe(false);
    expect(DatasetTermMatchSchema.safeParse({ ...match, member: 'total_amount' }).success).toBe(false);
  });
});

describe('list_datasets candidates', () => {
  const entry = {
    name: 'billing',
    label: '开票',
    object: 'invoice',
    dimensions: [{ name: 'invoice_status', label: '发票状态', type: 'string' as const }],
    measures: [{ name: 'invoice_count', label: '发票数', aggregate: 'count' as const }],
    matches: [],
  };
  const candidates = [
    { term: 'invoice', dataset: 'billing', member: 'measures.invoice_count' },
    { term: 'invoice', dataset: 'billing', member: 'dimensions.invoice_status' },
  ];

  it('an answer carries them beside the catalogue, and the parse keeps them', () => {
    const parsed = ListDatasetsOutputSchema.parse({ datasets: [entry], candidates });
    expect(parsed.candidates).toEqual(candidates);
  });

  it('an answer without the key parses to the same value as before', () => {
    const answer = { datasets: [entry] };
    const parsed = ListDatasetsOutputSchema.parse(answer);
    expect(parsed).toEqual(answer);
    expect(Object.keys(parsed)).not.toContain('candidates');
  });

  it('no candidates is the key\'s absence: an empty list is refused', () => {
    const parsed = ListDatasetsOutputSchema.safeParse({ datasets: [entry], candidates: [] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['candidates']);
  });

  it('a candidate is a pointer: term, dataset and member, all required, and no `matchedOn`', () => {
    expect(Object.keys(DatasetTermCandidateSchema.shape).sort()).toEqual(['dataset', 'member', 'term']);
    const [candidate] = candidates;
    expect(DatasetTermCandidateSchema.safeParse(candidate).success).toBe(true);
    for (const key of ['term', 'dataset', 'member'] as const) {
      const { [key]: _omitted, ...rest } = candidate!;
      const parsed = DatasetTermCandidateSchema.safeParse(rest);
      expect(parsed.success, key).toBe(false);
      expect(parsed.error?.issues[0]?.path, key).toEqual([key]);
    }
  });

  it('names its member in the format a match does', () => {
    const pointer = { term: 'x', dataset: 'billing' };
    for (const member of ['measures.invoice_count', 'dimensions.invoice_status', 'fields.status', 'invoice_count']) {
      expect(DatasetTermCandidateSchema.safeParse({ ...pointer, member }).success, member)
        .toBe(DatasetTermMatchSchema.safeParse({ term: 'x', matchedOn: 'name', member }).success);
    }
    expect(DatasetTermCandidateSchema.safeParse({ ...pointer, member: 'fields.status' }).success).toBe(false);
    expect(DatasetTermCandidateSchema.safeParse({ ...pointer, member: 'measures.invoice_count' }).success).toBe(true);
  });

  it('the per-term cap is one exported number', () => {
    expect(LIST_DATASETS_MAX_CANDIDATES_PER_TERM).toBe(5);
  });
});

describe('list_datasets nextStep', () => {
  const entry = {
    name: 'billing',
    label: '开票',
    object: 'invoice',
    dimensions: [{ name: 'invoice_status', label: '发票状态', type: 'string' as const }],
    measures: [
      { name: 'invoice_count', label: '发票数', aggregate: 'count' as const },
      { name: 'invoice_amount', label: '开票金额', aggregate: 'sum' as const, synonyms: ['金额'] },
    ],
    matches: [{ term: '金额', member: 'measures.invoice_amount', matchedOn: 'synonym' as const }],
  };
  const candidates = [{ term: 'invoice', dataset: 'billing', member: 'measures.invoice_count' }];
  const nextStep = { decision: 'candidates_only' as const, terms: ['invoice'], note: 'a sentence the executor wrote' };

  it('the decision is one of four cases, and no other value parses', () => {
    expect(DatasetNextStepDecision.options).toEqual(['one_measure', 'several_measures', 'candidates_only', 'no_measure']);
    for (const decision of DatasetNextStepDecision.options) {
      expect(DatasetNextStepSchema.safeParse({ ...nextStep, decision }).success, decision).toBe(true);
    }
    for (const decision of ['ask', 'one_match', 'ONE_MEASURE', '', 1, null]) {
      const parsed = ListDatasetsOutputSchema.safeParse({ datasets: [entry], nextStep: { ...nextStep, decision } });
      expect(parsed.success, String(decision)).toBe(false);
      expect(parsed.error?.issues[0]?.path, String(decision)).toEqual(['nextStep', 'decision']);
    }
  });

  it('an answer carries it beside the catalogue and the candidates, and the parse keeps it', () => {
    const parsed = ListDatasetsOutputSchema.parse({ datasets: [entry], candidates, nextStep });
    expect(parsed.nextStep).toEqual(nextStep);
    expect(parsed.candidates).toEqual(candidates);
  });

  it('an answer without the key parses to the same value as before', () => {
    const answer = { datasets: [entry], candidates };
    const parsed = ListDatasetsOutputSchema.parse(answer);
    expect(parsed).toEqual(answer);
    expect(Object.keys(parsed)).not.toContain('nextStep');
  });

  it('decision, terms and note are each required, and terms and note are never empty', () => {
    for (const key of ['decision', 'terms', 'note'] as const) {
      const { [key]: _omitted, ...rest } = nextStep;
      const parsed = DatasetNextStepSchema.safeParse(rest);
      expect(parsed.success, key).toBe(false);
      expect(parsed.error?.issues[0]?.path, key).toEqual([key]);
    }
    const noTerms = DatasetNextStepSchema.safeParse({ ...nextStep, terms: [] });
    expect(noTerms.success).toBe(false);
    expect(noTerms.error?.issues[0]?.path).toEqual(['terms']);
    const noNote = DatasetNextStepSchema.safeParse({ ...nextStep, note: '' });
    expect(noNote.success).toBe(false);
    expect(noNote.error?.issues[0]?.path).toEqual(['note']);
  });

  it('holds no member list: three keys, and a term is a string, never a pointer', () => {
    expect(Object.keys(DatasetNextStepSchema.shape).sort()).toEqual(['decision', 'note', 'terms']);
    const pointer = DatasetNextStepSchema.safeParse({ ...nextStep, terms: candidates });
    expect(pointer.success).toBe(false);
    expect(pointer.error?.issues[0]?.path).toEqual(['terms', 0]);
  });

  it('an answer has one list of candidates: a list written inside nextStep is not part of the answer', () => {
    // The one place a candidate pointer is declared is the answer's `candidates`.
    expect(ListDatasetsOutputSchema.shape.candidates.unwrap().element).toBe(DatasetTermCandidateSchema);
    const other = [{ term: 'invoice', dataset: 'billing', member: 'dimensions.invoice_status' }];
    const parsed = ListDatasetsOutputSchema.parse({
      datasets: [entry],
      candidates,
      nextStep: { ...nextStep, candidates: other, matches: entry.matches },
    });
    expect(Object.keys(parsed.nextStep ?? {}).sort()).toEqual(['decision', 'note', 'terms']);
    expect(parsed.candidates).toEqual(candidates);
  });

  it('refers to the members by term: they are read from the same answer under `terms`', () => {
    const offered = ListDatasetsOutputSchema.parse({ datasets: [entry], candidates, nextStep });
    expect((offered.candidates ?? []).filter((c) => offered.nextStep?.terms.includes(c.term))).toEqual(candidates);

    const matched = ListDatasetsOutputSchema.parse({
      datasets: [entry],
      nextStep: { decision: 'one_measure', terms: ['金额'], note: 'a sentence the executor wrote' },
    });
    const measures = matched.datasets.flatMap((d) => (d.matches ?? [])
      .filter((m) => matched.nextStep?.terms.includes(m.term) && m.member.startsWith('measures.'))
      .map((m) => `${d.name}.${m.member}`));
    expect(measures).toEqual(['billing.measures.invoice_amount']);
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

  it('carries `sourceLine`, the source as one line: optional, a string, never empty', () => {
    const cited = { ...answer, sourceLine: 'a line the executor wrote' };
    expect(QueryDatasetOutputSchema.parse(cited).sourceLine).toBe('a line the executor wrote');

    const parsed = QueryDatasetOutputSchema.parse(answer);
    expect(parsed).toEqual(answer);
    expect(Object.keys(parsed)).not.toContain('sourceLine');

    for (const sourceLine of ['', 1, null, ['a line']]) {
      const refused = QueryDatasetOutputSchema.safeParse({ ...answer, sourceLine });
      expect(refused.success, JSON.stringify(sourceLine)).toBe(false);
      expect(refused.error?.issues[0]?.path, JSON.stringify(sourceLine)).toEqual(['sourceLine']);
    }
  });

  it('`sourceLine` is the tool\'s member: the REST door\'s answer does not gain it', () => {
    expect(Object.keys(QueryDatasetOutputSchema.shape)).toContain('sourceLine');
    expect(Object.keys(AnalyticsResultResponseSchema.shape.data.shape)).not.toContain('sourceLine');
    // The door's `data` is a plain object: a `sourceLine` sent there is not kept.
    const door = AnalyticsResultResponseSchema.shape.data.parse({
      rows: answer.rows, fields: answer.fields, sourceLine: 'a line the executor wrote',
    });
    expect(Object.keys(door)).not.toContain('sourceLine');
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
    const parameters = getDatasetToolJsonSchemas().query_dataset.parameters as unknown as {
      type: string; required: string[]; additionalProperties: unknown; properties: Record<string, unknown>;
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
    const outputSchema = getDatasetToolJsonSchemas().query_dataset.outputSchema as unknown as {
      required: string[]; properties: Record<string, unknown>;
    };
    expect(outputSchema.required).toEqual(expect.arrayContaining(['rows', 'fields', 'provenance', 'rowCount', 'truncated']));
    expect(Object.keys(outputSchema.properties)).not.toContain('sql');
    const catalogue = getDatasetToolJsonSchemas().list_datasets.outputSchema as { required: string[] };
    expect(catalogue.required).toEqual(['datasets']);
  });

  it('the `list_datasets` outputSchema carries `candidates`: optional, never empty, three required members', () => {
    const outputSchema = getDatasetToolJsonSchemas().list_datasets.outputSchema as unknown as {
      required: string[];
      properties: Record<string, { type?: string; minItems?: number; items?: { required?: string[] } }>;
    };
    expect(outputSchema.required).not.toContain('candidates');
    const candidates = outputSchema.properties.candidates;
    expect(candidates?.type).toBe('array');
    expect(candidates?.minItems).toBe(1);
    expect([...(candidates?.items?.required ?? [])].sort()).toEqual(['dataset', 'member', 'term']);
  });

  it('the `list_datasets` outputSchema carries `nextStep`: optional, a closed decision, terms by name, a note', () => {
    const outputSchema = getDatasetToolJsonSchemas().list_datasets.outputSchema as unknown as {
      required: string[];
      properties: Record<string, {
        type?: string;
        required?: string[];
        additionalProperties?: unknown;
        properties?: Record<string, { type?: string; enum?: string[]; minItems?: number; minLength?: number; items?: { type?: string } }>;
      }>;
    };
    expect(outputSchema.required).not.toContain('nextStep');
    const nextStep = outputSchema.properties.nextStep;
    expect(nextStep?.type).toBe('object');
    expect([...(nextStep?.required ?? [])].sort()).toEqual(['decision', 'note', 'terms']);
    expect(nextStep?.additionalProperties).toBe(false);
    expect(Object.keys(nextStep?.properties ?? {}).sort()).toEqual(['decision', 'note', 'terms']);
    expect(nextStep?.properties?.decision?.enum).toEqual(['one_measure', 'several_measures', 'candidates_only', 'no_measure']);
    expect(nextStep?.properties?.terms?.type).toBe('array');
    expect(nextStep?.properties?.terms?.minItems).toBe(1);
    expect(nextStep?.properties?.terms?.items?.type).toBe('string');
    expect(nextStep?.properties?.note?.type).toBe('string');
    expect(nextStep?.properties?.note?.minLength).toBe(1);
  });

  it('the `query_dataset` outputSchema carries `sourceLine`: optional, a non-empty string', () => {
    const outputSchema = getDatasetToolJsonSchemas().query_dataset.outputSchema as unknown as {
      required: string[]; properties: Record<string, { type?: string; minLength?: number }>;
    };
    expect(outputSchema.required).not.toContain('sourceLine');
    expect(outputSchema.properties.sourceLine?.type).toBe('string');
    expect(outputSchema.properties.sourceLine?.minLength).toBe(1);
  });
});
