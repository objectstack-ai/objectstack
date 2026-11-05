// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The structural scorers, and the discrimination self-test the scenario
 * library needs from them: a scorer that gives a degraded build the same score
 * as the intact one cannot tell builds apart (cloud#2146 measured exactly that
 * — 1.00 on every golden journey).
 *
 * The builds are the five golden stacks of the `os lint --eval` corpus, each
 * completed with an app (nav over every object and the dashboard), a dataset
 * and a dashboard, then PARSED by the spec — the step `os build` runs before it
 * writes `dist/objectstack.json` — and read back through
 * `artifactToEvalGraph`. Each degradation is one defect written into that
 * parsed artifact, the way a faulty producer would leave it.
 */

import { describe, expect, it } from 'vitest';

import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

import { DEFAULT_METADATA_EVAL_CORPUS } from './corpus.js';
import { artifactToEvalGraph } from './scenario-graph.js';
import {
  deriveShape,
  scoreGraph,
  scoreGraphShape,
  type EvalGraph,
  type ScenarioExpectation,
} from './scenario-score.js';

type Bag = Record<string, any>;

const MEASURE = 'record_count';

/** A corpus fixture completed with an app, a dataset and a dashboard, parsed as `os build` parses it. */
function goldenArtifact(fixture: unknown): Bag {
  const stack = structuredClone(fixture) as Bag;
  const objectNames = (stack.objects as Bag[]).map((o) => o.name as string);
  const first = objectNames[0]!;
  const dashboard = `${first}_overview`;
  stack.datasets = [{
    name: `${first}_metrics`,
    label: 'Metrics',
    object: first,
    dimensions: [],
    measures: [{ name: MEASURE, label: 'Records', aggregate: 'count' }],
  }];
  stack.dashboards = [{
    name: dashboard,
    label: 'Overview',
    widgets: [{ id: 'records', title: 'Records', type: 'metric', dataset: `${first}_metrics`, values: [MEASURE] }],
  }];
  stack.apps = [{
    name: `${first}_app`,
    label: 'App',
    navigation: [
      { id: 'nav_dashboard', type: 'dashboard', label: 'Overview', dashboardName: dashboard },
      {
        id: 'nav_data',
        type: 'group',
        label: 'Data',
        children: objectNames.map((name) => ({ id: `nav_${name}`, type: 'object', label: name, objectName: name })),
      },
    ],
  }];
  const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(stack));
  if (!parsed.success) {
    throw new Error(`golden fixture does not parse: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  // Round-trip through JSON: the artifact is read from a file.
  return JSON.parse(JSON.stringify(parsed.data)) as Bag;
}

/** The expectation the golden build itself meets, by name. */
function expectationOf(graph: EvalGraph): ScenarioExpectation {
  return {
    objects: graph.objects.map((o) => o.name),
    minFieldsPerObject: Math.min(...graph.objects.map((o) => o.fields.length)),
    selectFields: graph.objects.flatMap((o) =>
      o.fields.filter((f) => f.type === 'select').map((f) => ({ object: o.name, field: f.name, minOptions: 2 })),
    ),
    lookups: graph.objects.flatMap((o) =>
      o.fields.filter((f) => f.reference).map((f) => ({ object: o.name, field: f.name, to: f.reference! })),
    ),
    dashboards: (graph.dashboards ?? []).map((d) => d.name),
    appNavTargets: [...graph.objects.map((o) => o.name), ...(graph.dashboards ?? []).map((d) => d.name)],
  };
}

const REFERENCE_TYPES = new Set(['lookup', 'master_detail']);

/** One defect per variant, written into a copy of the parsed artifact; `null` when the build has nothing to degrade. */
const DEGRADATIONS: Record<string, (artifact: Bag) => Bag | null> = {
  'missing lookup': (a) => {
    for (const o of a.objects as Bag[]) {
      const name = Object.keys(o.fields).find((k) => REFERENCE_TYPES.has(o.fields[k].type));
      if (name) {
        delete o.fields[name];
        return a;
      }
    }
    return null;
  },
  'optionless select': (a) => {
    for (const o of a.objects as Bag[]) {
      const field = Object.values(o.fields as Bag).find((f: Bag) => f.type === 'select') as Bag | undefined;
      if (field) {
        field.options = [];
        return a;
      }
    }
    return null;
  },
  'dangling nav target': (a) => {
    const item = (a.apps[0].navigation as Bag[])[1]!.children[0] as Bag;
    item.objectName = `${item.objectName}_missing`;
    return a;
  },
  'dangling dashboard measure': (a) => {
    a.dashboards[0].widgets[0].values = ['no_such_measure'];
    return a;
  },
  'dangling dashboard dataset': (a) => {
    a.dashboards[0].widgets[0].dataset = 'no_such_dataset';
    return a;
  },
};

const scoreBoth = (graph: EvalGraph, exp: ScenarioExpectation) => ({
  exact: scoreGraph(graph, exp),
  shape: scoreGraphShape(graph, deriveShape(exp)),
});

describe('scenario scorer — discrimination self-test over the golden corpus', () => {
  const builds = DEFAULT_METADATA_EVAL_CORPUS.map((c) => {
    const artifact = goldenArtifact(c.fixture);
    const graph = artifactToEvalGraph(artifact);
    return { id: c.id, artifact, graph, expect: expectationOf(graph) };
  });

  it('reads all five golden builds, each carrying the members every degradation needs', () => {
    expect(builds.map((b) => b.id)).toEqual([
      'invoice_with_line_items',
      'project_with_tasks',
      'blog_post_with_comments',
      'expense_report_with_lines',
      'crm_account_with_contacts',
    ]);
    for (const b of builds) {
      expect(b.expect.lookups!.length, b.id).toBeGreaterThan(0);
      expect(b.graph.apps![0]!.nav!.length, b.id).toBe(b.graph.objects.length + 1);
      expect(b.graph.dashboards![0]!.widgets, b.id).toEqual([{ dataset: expect.any(String), measure: MEASURE }]);
    }
  });

  it('scores every intact golden build 1 on both scorers, with no check vacuous', () => {
    for (const b of builds) {
      const { exact, shape } = scoreBoth(b.graph, b.expect);
      expect(exact.checks.filter((c) => !c.pass), b.id).toEqual([]);
      expect(shape.checks.filter((c) => !c.pass), b.id).toEqual([]);
      expect(exact.score, b.id).toBe(1);
      expect(shape.score, b.id).toBe(1);
      expect(exact.total, b.id).toBeGreaterThan(5);
      expect(shape.total, b.id).toBeGreaterThan(5);
    }
  });

  for (const [variant, degrade] of Object.entries(DEGRADATIONS)) {
    it(`scores a build with a ${variant} strictly lower than the intact build, on both scorers`, () => {
      let exercised = 0;
      for (const b of builds) {
        const degraded = degrade(structuredClone(b.artifact));
        if (!degraded) continue;
        exercised++;
        const intact = scoreBoth(b.graph, b.expect);
        const after = scoreBoth(artifactToEvalGraph(degraded), b.expect);
        expect(after.exact.score, `${b.id} exact`).toBeLessThan(intact.exact.score);
        expect(after.shape.score, `${b.id} shape`).toBeLessThan(intact.shape.score);
      }
      // `blog_post_with_comments` declares no select — the one build an
      // optionless-select variant cannot be written into.
      expect(exercised).toBe(variant === 'optionless select' ? 4 : 5);
    });
  }
});

describe('scoreGraph — exact names', () => {
  const graph: EvalGraph = {
    objects: [
      { name: 'loan', fields: [{ name: 'book', type: 'lookup', reference: 'book' }, { name: 'status', type: 'select', options: [{ value: 'out' }, { value: 'back' }] }] },
      { name: 'book', fields: [{ name: 'title', type: 'text' }] },
    ],
    dashboards: [{ name: 'overview' }],
    apps: [{ name: 'library', nav: [{ target: 'loan', resolves: true }, { target: 'book', resolves: true }] }],
  };
  const exp: ScenarioExpectation = {
    objects: ['loan', 'book'],
    minFieldsPerObject: 1,
    selectFields: [{ object: 'loan', field: 'status', minOptions: 2 }],
    lookups: [{ object: 'loan', field: 'book', to: 'book' }],
    dashboards: ['overview'],
    appNavTargets: ['loan', 'book'],
  };

  it('passes every check on a graph that meets the expectation', () => {
    const r = scoreGraph(graph, exp);
    expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    expect(r.score).toBe(1);
  });

  it('fails a renamed object and the checks that hang off it, by name', () => {
    const r = scoreGraph({ ...graph, objects: [{ name: 'borrow_record', fields: graph.objects[0]!.fields }, graph.objects[1]!] }, exp);
    expect(r.checks.filter((c) => !c.pass).map((c) => c.check)).toEqual([
      'object:loan',
      'select:loan.status>=2opts',
      'lookup:loan.book->book',
    ]);
  });

  it('fails a lookup pointing at the wrong object', () => {
    const r = scoreGraph(graph, { ...exp, lookups: [{ object: 'loan', field: 'book', to: 'member' }] });
    expect(r.checks.find((c) => c.check === 'lookup:loan.book->member')).toMatchObject({ pass: false, detail: 'ref=book' });
  });

  it('fails an expected nav target no app navigates to, even when the object exists', () => {
    const r = scoreGraph({ ...graph, apps: [{ name: 'library', nav: [{ target: 'loan', resolves: true }] }] }, exp);
    expect(r.checks.filter((c) => !c.pass).map((c) => c.check)).toEqual(['nav:book->exists']);
  });

  it('scores 1 with no checks raised', () => {
    expect(scoreGraph({ objects: [] }, { objects: [] })).toEqual({ score: 1, total: 0, passed: 0, checks: [] });
  });
});

describe('scoreGraphShape — names do not matter, structure does', () => {
  it('passes a correct build whose names differ from the scenario', () => {
    const exp: ScenarioExpectation = { objects: ['loan', 'book'], lookups: [{ object: 'loan', field: 'book', to: 'book' }], appNavTargets: ['loan'] };
    const graph: EvalGraph = {
      objects: [
        { name: 'borrow_record', fields: [{ name: 'volume', type: 'master_detail', reference: 'volume' }] },
        { name: 'volume', fields: [{ name: 'title', type: 'text' }] },
      ],
      apps: [{ name: 'library', nav: [{ target: 'borrow_record', resolves: true }, { target: 'volume', resolves: true }] }],
    };
    expect(scoreGraph(graph, exp).score).toBeLessThan(1);
    expect(scoreGraphShape(graph, deriveShape(exp)).score).toBe(1);
  });

  it('scores every spec reference type and resolves platform objects, labelled with the field type', () => {
    const graph: EvalGraph = {
      objects: [{
        name: 'node',
        fields: [
          { name: 'parent', type: 'tree', reference: 'node' },
          { name: 'owner_team', type: 'master_detail', reference: 'team' },
          { name: 'creator', type: 'lookup', reference: 'sys_user' },
        ],
      }],
    };
    const r = scoreGraphShape(graph, { minObjects: 1, minLookups: 3 });
    expect(r.checks.map((c) => [c.check, c.pass])).toEqual([
      ['objects>=1', true],
      ['relationships>=3', true],
      ['tree:node.parent->resolves', true],
      ['master_detail:node.owner_team->resolves', false],
      ['lookup:node.creator->resolves', true],
    ]);
  });

  it('derives the shape from the name-coupled expectation', () => {
    expect(deriveShape({
      objects: ['a', 'b'],
      minFieldsPerObject: 3,
      lookups: [{ object: 'a', field: 'b', to: 'b' }],
      dashboards: ['d'],
      appNavTargets: ['a'],
    })).toEqual({ minObjects: 2, minFieldsPerObject: 3, minLookups: 1, minDashboards: 1, requireAppCoveringObjects: true });
    expect(deriveShape({ objects: [] })).toEqual({
      minObjects: 0,
      minFieldsPerObject: undefined,
      minLookups: 0,
      minDashboards: 0,
      requireAppCoveringObjects: false,
    });
  });

  it('fails an app that leaves an object out of its nav', () => {
    const graph: EvalGraph = {
      objects: [{ name: 'a', fields: [] }, { name: 'b', fields: [] }],
      apps: [{ name: 'app', nav: [{ target: 'a', resolves: true }] }],
    };
    const r = scoreGraphShape(graph, { minObjects: 2, requireAppCoveringObjects: true });
    expect(r.checks.filter((c) => !c.pass).map((c) => c.check)).toEqual(['nav-covers:b']);
  });
});
