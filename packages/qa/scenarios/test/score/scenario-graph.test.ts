// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

import { DEFAULT_METADATA_EVAL_CORPUS } from '../../../../cli/src/lint/corpus.js';
import { artifactToEvalGraph } from '../../src/score/scenario-graph.js';
import { scoreGraph } from '../../src/score/scenario-score.js';

type Bag = Record<string, any>;

const manifest = { id: 'com.example.library', namespace: 'library', version: '1.0.0', name: 'Library', type: 'app' };

const objects = [
  {
    name: 'loan',
    label: 'Loan',
    fields: {
      book: { type: 'lookup', label: 'Book', reference: 'book' },
      // As `Field.user()` writes it: the carrier states the type's fixed target.
      borrower: { type: 'user', label: 'Borrower', reference: 'sys_user' },
      status: {
        type: 'select',
        label: 'Status',
        required: true,
        options: [{ label: 'Out', value: 'out' }, { label: 'Back', value: 'back' }],
      },
    },
  },
  { name: 'book', label: 'Book', fields: { title: { type: 'text', label: 'Title', required: true } } },
];
const datasets = [{
  name: 'loan_metrics',
  label: 'Loan Metrics',
  object: 'loan',
  dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
  measures: [{ name: 'loan_count', label: 'Loans', aggregate: 'count' }],
}];
const dashboards = [{
  name: 'library_overview',
  label: 'Overview',
  widgets: [{ id: 'by_status', title: 'By status', type: 'bar', dataset: 'loan_metrics', dimensions: ['status'], values: ['loan_count'] }],
}];
const apps = [{
  name: 'library',
  label: 'Library',
  navigation: [
    { id: 'nav_home', type: 'dashboard', label: 'Home', dashboardName: 'library_overview' },
    {
      id: 'nav_data',
      type: 'group',
      label: 'Data',
      children: [
        { id: 'nav_loan', type: 'object', label: 'Loans', objectName: 'loan' },
        { id: 'nav_book', type: 'object', label: 'Books', objectName: 'book' },
        { id: 'nav_users', type: 'object', label: 'Users', objectName: 'sys_user' },
        { id: 'nav_gone', type: 'object', label: 'Gone', objectName: 'member' },
      ],
    },
    { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://example.com' },
  ],
}];

const EXPECTED_GRAPH = {
  objects: [
    {
      name: 'loan',
      fields: [
        { name: 'book', type: 'lookup', reference: 'book' },
        { name: 'borrower', type: 'user' },
        { name: 'status', type: 'select', required: true, options: [{ value: 'out', label: 'Out' }, { value: 'back', label: 'Back' }] },
      ],
    },
    { name: 'book', fields: [{ name: 'title', type: 'text', required: true }] },
  ],
  dashboards: [{ name: 'library_overview', widgets: [{ dataset: 'loan_metrics', measure: 'loan_count' }] }],
  apps: [{
    name: 'library',
    nav: [
      { target: 'library_overview', resolves: true },
      { target: 'loan', resolves: true },
      { target: 'book', resolves: true },
      { target: 'sys_user', resolves: true },
      { target: 'member', resolves: false },
    ],
  }],
  datasets: [{ name: 'loan_metrics', measures: ['loan_count'] }],
};

/** The stack parsed as `os build` parses it, round-tripped through JSON as the artifact file is. */
function parsedArtifact(stack: Bag): Bag {
  const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(stack));
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return JSON.parse(JSON.stringify(parsed.data)) as Bag;
}

describe('artifactToEvalGraph', () => {
  it('reads a single-package artifact: fields, options, authored references, nested nav, widget measures', () => {
    const artifact = parsedArtifact({ manifest, objects, datasets, dashboards, apps });
    // The artifact carries `user`'s fixed target; the graph still leaves it out.
    expect(artifact.objects[0].fields.borrower.reference).toBe('sys_user');
    expect(artifactToEvalGraph(artifact)).toEqual(EXPECTED_GRAPH);
  });

  it('reads a multi-package artifact whose collections live only under packages[] (ADR-0130 option B)', () => {
    const artifact = {
      manifest,
      packages: [
        { manifest: { id: 'com.example.library.core', name: 'core', version: '1.0.0', type: 'app', objects } },
        {
          manifest: {
            id: 'com.example.library.ui',
            name: 'ui',
            version: '1.0.0',
            type: 'app',
            dependencies: { 'com.example.library.core': '1.0.0' },
            datasets,
            dashboards,
            apps,
          },
        },
      ],
    };
    expect(artifact).not.toHaveProperty('objects');
    expect(artifactToEvalGraph(artifact)).toEqual(EXPECTED_GRAPH);
  });

  it('prefers the top-level collection over packages[] when the artifact carries both (the additive shape)', () => {
    const artifact = {
      manifest,
      objects: [objects[1]],
      packages: [{ manifest: { id: 'com.example.library.core', name: 'core', version: '1.0.0', type: 'app', objects } }],
    };
    expect(artifactToEvalGraph(artifact).objects.map((o) => o.name)).toEqual(['book']);
  });

  it('reads every golden corpus build', () => {
    for (const c of DEFAULT_METADATA_EVAL_CORPUS) {
      const graph = artifactToEvalGraph(parsedArtifact(c.fixture as Bag));
      expect(graph.objects.length, c.id).toBe((c.fixture as Bag).objects.length);
      expect(graph.objects.flatMap((o) => o.fields).some((f) => f.reference), c.id).toBe(true);
    }
  });

  it('refuses an object with no name, and fields that are not a name-keyed record', () => {
    expect(() => artifactToEvalGraph({ objects: [{ fields: {} }] })).toThrow(TypeError);
    expect(() => artifactToEvalGraph({ objects: [{ name: 'a', fields: [{ name: 'x', type: 'text' }] }] }))
      .toThrow(/not a name-keyed record/);
  });
});

describe('artifactToEvalGraph — objectExtensions merged as the registry serves them (QA scenario round 1)', () => {
  const channel = (n: number) => ({
    type: 'select',
    label: 'Channel',
    options: Array.from({ length: n }, (_, i) => ({ label: `C${i}`, value: `c${i}` })),
  });

  it('a field declared only through an extension is a field of the build, and the select check reads it', () => {
    const artifact = parsedArtifact({ manifest, objects, objectExtensions: [{ extend: 'loan', fields: { channel: channel(2) } }] });
    const loan = artifactToEvalGraph(artifact).objects.find((o) => o.name === 'loan')!;
    expect(loan.fields.map((f) => f.name)).toEqual(['book', 'borrower', 'status', 'channel']);
    const graph = artifactToEvalGraph(artifact);
    const select = scoreGraph(graph, { objects: ['loan'], selectFields: [{ object: 'loan', field: 'channel', minOptions: 2 }] }).checks.find((c) => c.check.startsWith('select:'));
    expect(select).toEqual({ check: 'select:loan.channel>=2opts', pass: true, detail: 'has 2' });
  });

  it('applies extensions in ascending priority, a later field of one name replacing the earlier, and none for an object the build does not declare', () => {
    const artifact = {
      objects,
      objectExtensions: [
        { extend: 'loan', priority: 300, fields: { channel: channel(4) } },
        { extend: 'loan', priority: 100, fields: { channel: channel(1) } },
        { extend: 'loan', fields: { channel: channel(3) } },
        { extend: 'sys_user', fields: { nickname: { type: 'text', label: 'Nickname' } } },
        { extend: 'book', label: 'Title' },
      ],
    };
    const graph = artifactToEvalGraph(artifact);
    expect(graph.objects.find((o) => o.name === 'loan')!.fields.find((f) => f.name === 'channel')!.options).toHaveLength(4);
    expect(graph.objects.map((o) => o.name)).toEqual(['loan', 'book']);
    expect(graph.objects.find((o) => o.name === 'book')!.fields.map((f) => f.name)).toEqual(['title']);
  });

  it('refuses an extension that names no object, and fields that are not a name-keyed record', () => {
    expect(() => artifactToEvalGraph({ objects, objectExtensions: [{ fields: {} }] })).toThrow(/no `extend`/);
    expect(() => artifactToEvalGraph({ objects, objectExtensions: [{ extend: 'loan', fields: [] }] })).toThrow(/not a name-keyed record/);
  });
});
