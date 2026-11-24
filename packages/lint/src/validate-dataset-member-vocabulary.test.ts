// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0149 D1 — a dataset measure or dimension that declares neither
// `synonyms` nor a `description` is advised, once per member, at every
// authoring door: the three CLI commands and the runtime publish door for a
// `dataset` write. Never a refusal.

import { describe, expect, it } from 'vitest';

import { DatasetSchema } from '@objectstack/spec/ui';

import { AUTHORING_RULES, runAuthoringRules, type AuthoringCommand } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import {
  DATASET_MEMBER_NO_VOCABULARY,
  validateDatasetMemberVocabulary,
} from './validate-dataset-member-vocabulary.js';

const OBJECTS = [
  {
    name: 'acme_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: {
      status: { type: 'select', label: 'Status' },
      issued_on: { type: 'date', label: 'Issued' },
      total: { type: 'currency', label: 'Total' },
    },
  },
];

/** Every member carries both keys: the complete form the reference app ships. */
const completeDataset = () => ({
  name: 'acme_invoice_metrics',
  label: 'Invoice Metrics',
  object: 'acme_invoice',
  dimensions: [
    {
      name: 'status',
      label: 'Status',
      field: 'status',
      type: 'string',
      description: 'Where the invoice stands: draft, sent or paid.',
      synonyms: ['invoice status', '发票状态'],
    },
    {
      name: 'issued_on',
      label: 'Issued',
      field: 'issued_on',
      type: 'date',
      description: 'The date the invoice was issued, grouped by calendar month.',
      synonyms: ['issue date', '开票日期'],
    },
  ],
  measures: [
    {
      name: 'invoice_count',
      label: 'Invoices',
      aggregate: 'count',
      description: 'How many invoices there are, in every status.',
      synonyms: ['number of invoices', '发票数'],
    },
    {
      name: 'total_amount',
      label: 'Total Amount',
      aggregate: 'sum',
      field: 'total',
      description: 'The sum of the invoice totals, in every status.',
      synonyms: ['revenue', 'billed amount', '开票金额'],
    },
  ],
});

/** The same dataset with both vocabulary keys removed from every member. */
const strippedDataset = () => {
  const dataset = completeDataset();
  const strip = (member: Record<string, unknown>) => {
    const { description: _description, synonyms: _synonyms, ...rest } = member;
    return rest;
  };
  return { ...dataset, dimensions: dataset.dimensions.map(strip), measures: dataset.measures.map(strip) };
};

const run = (...datasets: unknown[]) => validateDatasetMemberVocabulary({ objects: OBJECTS, datasets });

describe('dataset member vocabulary · the rule', () => {
  it('is silent on a dataset whose every member declares synonyms and a description', () => {
    expect(DatasetSchema.safeParse(completeDataset()).success).toBe(true);
    expect(run(completeDataset())).toEqual([]);
  });

  it('reports one finding per member of a dataset stripped of both keys, naming the dataset and the member', () => {
    expect(DatasetSchema.safeParse(strippedDataset()).success).toBe(true);
    const findings = run(strippedDataset());
    expect(findings.map((f) => [f.rule, f.severity, f.path, f.where])).toEqual([
      [DATASET_MEMBER_NO_VOCABULARY, 'warning', 'datasets[0].dimensions[0]', 'dataset "acme_invoice_metrics" dimension "status"'],
      [DATASET_MEMBER_NO_VOCABULARY, 'warning', 'datasets[0].dimensions[1]', 'dataset "acme_invoice_metrics" dimension "issued_on"'],
      [DATASET_MEMBER_NO_VOCABULARY, 'warning', 'datasets[0].measures[0]', 'dataset "acme_invoice_metrics" measure "invoice_count"'],
      [DATASET_MEMBER_NO_VOCABULARY, 'warning', 'datasets[0].measures[1]', 'dataset "acme_invoice_metrics" measure "total_amount"'],
    ]);
    for (const f of findings) {
      // `where` names the dataset and the member (pinned above); the sentence
      // and the fix both name the two keys.
      expect(f.message).toContain('`synonyms`');
      expect(f.message).toContain('`description`');
      expect(f.hint).toContain('`synonyms`');
      expect(f.hint).toContain('`description`');
    }
  });

  it('is silent on a member with only synonyms, and on a member with only a description', () => {
    const dataset = strippedDataset();
    const findings = run({
      ...dataset,
      dimensions: [
        { ...dataset.dimensions[0], synonyms: ['invoice status'] },
        { ...dataset.dimensions[1], description: 'The date the invoice was issued.' },
      ],
      measures: [
        { ...dataset.measures[0], description: { en: 'How many invoices there are.', 'zh-CN': '发票的数量。' } },
        dataset.measures[1],
      ],
    });
    // Three members carry one key each; the fourth carries neither.
    expect(findings.map((f) => f.path)).toEqual(['datasets[0].measures[1]']);
  });

  it('reads an empty list, a blank string and an empty locale map as not declared', () => {
    const dataset = strippedDataset();
    const findings = run({
      ...dataset,
      dimensions: [
        { ...dataset.dimensions[0], synonyms: [] },
        { ...dataset.dimensions[1], description: '   ' },
      ],
      measures: [
        { ...dataset.measures[0], description: {} },
        { ...dataset.measures[1], synonyms: [], description: { en: '' } },
      ],
    });
    expect(findings).toHaveLength(4);
  });

  it('judges each dataset by its own members and locates a map-shaped collection by name', () => {
    const complete = completeDataset();
    const stripped = { ...strippedDataset(), name: 'acme_bare_metrics' };
    expect(run(complete, stripped).map((f) => f.path)).toEqual([
      'datasets[1].dimensions[0]',
      'datasets[1].dimensions[1]',
      'datasets[1].measures[0]',
      'datasets[1].measures[1]',
    ]);
    const { name: _name, ...keyed } = stripped;
    const byName = validateDatasetMemberVocabulary({ datasets: { acme_bare_metrics: keyed } });
    expect(byName.map((f) => f.path)[0]).toBe('datasets.acme_bare_metrics.dimensions[0]');
    expect(byName[0].where).toBe('dataset "acme_bare_metrics" dimension "status"');
  });

  it('tolerates a stack with no datasets and a dataset with no members', () => {
    expect(validateDatasetMemberVocabulary({})).toEqual([]);
    expect(run({ name: 'acme_empty', label: 'Empty', object: 'acme_invoice' })).toEqual([]);
    expect(run({ name: 'acme_empty', label: 'Empty', object: 'acme_invoice', dimensions: [], measures: [] })).toEqual([]);
  });
});

describe('dataset member vocabulary · the doors', () => {
  it('is registered advisory, on all three commands and on the publish door for a dataset write', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateDatasetMemberVocabulary');
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe('advisory');
    expect([...entry!.commands].sort()).toEqual(['build', 'lint', 'validate']);
    expect(entry!.surfaces).toContain('runtime-publish');
    expect(entry!.runtimeTypes).toEqual(['dataset']);
    expect(runtimeAuthoringRulesFor('dataset').map((r) => r.name)).toContain('validateDatasetMemberVocabulary');
    expect(runtimeAuthoringRulesFor('dashboard').map((r) => r.name)).not.toContain('validateDatasetMemberVocabulary');
  });

  it.each<AuthoringCommand>(['validate', 'build', 'lint'])('`os %s` reports it as a warning, one per bare member', (command) => {
    const stack = { objects: OBJECTS, datasets: [strippedDataset()] };
    const own = runAuthoringRules(command, { normalized: stack, parsed: stack }).filter(
      (f) => f.rule === DATASET_MEMBER_NO_VOCABULARY,
    );
    expect(own).toHaveLength(4);
    expect(own.every((f) => f.severity === 'warning')).toBe(true);

    const clean = { objects: OBJECTS, datasets: [completeDataset()] };
    expect(
      runAuthoringRules(command, { normalized: clean, parsed: clean }).filter((f) => f.rule === DATASET_MEMBER_NO_VOCABULARY),
    ).toEqual([]);
  });

  it('the publish door advises a dataset write and never refuses it for this rule', () => {
    const gate = (item: unknown, datasets: unknown[] = []) =>
      runRuntimeAuthoringRules({ type: 'dataset', item, context: { objects: OBJECTS, datasets } });

    const bare = gate(strippedDataset());
    expect(bare.errors).toEqual([]);
    const advised = bare.advisories.filter((f) => f.rule === DATASET_MEMBER_NO_VOCABULARY);
    expect(advised.map((f) => f.where)).toEqual([
      'dataset "acme_invoice_metrics" dimension "status"',
      'dataset "acme_invoice_metrics" dimension "issued_on"',
      'dataset "acme_invoice_metrics" measure "invoice_count"',
      'dataset "acme_invoice_metrics" measure "total_amount"',
    ]);
    expect(bare.rulesRun).toContain('validateDatasetMemberVocabulary');

    const complete = gate(completeDataset());
    expect(complete.errors).toEqual([]);
    expect(complete.advisories.filter((f) => f.rule === DATASET_MEMBER_NO_VOCABULARY)).toEqual([]);

    // A stored sibling with bare members is somebody else's condition: writing
    // a complete dataset beside it reports nothing for the sibling.
    const besideBareSibling = gate(completeDataset(), [{ ...strippedDataset(), name: 'acme_other_metrics' }]);
    expect(besideBareSibling.advisories.filter((f) => f.rule === DATASET_MEMBER_NO_VOCABULARY)).toEqual([]);
  });

  it('has an `os explain` entry under its own id', () => {
    expect(explainRule(DATASET_MEMBER_NO_VOCABULARY)?.rule).toBe(DATASET_MEMBER_NO_VOCABULARY);
  });
});
