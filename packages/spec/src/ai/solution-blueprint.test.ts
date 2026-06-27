// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  SolutionBlueprintSchema,
  SolutionBlueprintStrictSchema,
  defineSolutionBlueprint,
  type SolutionBlueprint,
} from './solution-blueprint.zod';

const validBlueprint: SolutionBlueprint = {
  summary: 'A simple project tracker',
  assumptions: ['Projects own many tasks', 'Tasks have a status'],
  objects: [
    {
      name: 'project',
      label: 'Project',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'due_date', type: 'date' },
      ],
    },
    {
      name: 'task',
      label: 'Task',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'status', type: 'select', options: [{ label: 'Open', value: 'open' }, { label: 'Done', value: 'done' }] },
        { name: 'project_id', type: 'lookup', reference: 'project' },
      ],
    },
  ],
  views: [
    { object: 'task', name: 'open_tasks', label: 'Open Tasks', type: 'list', columns: ['title', 'status'] },
  ],
};

describe('SolutionBlueprintSchema', () => {
  it('parses a valid blueprint', () => {
    const parsed = SolutionBlueprintSchema.parse(validBlueprint);
    expect(parsed.objects).toHaveLength(2);
    expect(parsed.objects[1].fields[2]).toMatchObject({ type: 'lookup', reference: 'project' });
    expect(parsed.views?.[0].type).toBe('list');
  });

  it('defaults assumptions to an empty array and view type to list', () => {
    const parsed = SolutionBlueprintSchema.parse({
      summary: 'minimal',
      objects: [{ name: 'thing', fields: [{ name: 'name', type: 'text' }] }],
      views: [{ object: 'thing', name: 'all_things', columns: ['name'] }],
    });
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.views?.[0].type).toBe('list');
  });

  it('rejects a missing summary', () => {
    const { summary: _drop, ...noSummary } = validBlueprint;
    expect(() => SolutionBlueprintSchema.parse(noSummary)).toThrow();
  });

  it('rejects an invalid field type', () => {
    expect(() =>
      SolutionBlueprintSchema.parse({
        summary: 'bad',
        objects: [{ name: 'x', fields: [{ name: 'f', type: 'not_a_real_type' }] }],
      }),
    ).toThrow();
  });

  it('rejects a non-snake_case object name', () => {
    expect(() =>
      SolutionBlueprintSchema.parse({
        summary: 'bad',
        objects: [{ name: 'MyObject', fields: [{ name: 'f', type: 'text' }] }],
      }),
    ).toThrow();
  });

  it('rejects more than 2 clarifying questions', () => {
    expect(() =>
      SolutionBlueprintSchema.parse({
        summary: 'too many questions',
        objects: [{ name: 'x', fields: [{ name: 'f', type: 'text' }] }],
        questions: ['a?', 'b?', 'c?'],
      }),
    ).toThrow();
  });

  it('defineSolutionBlueprint validates and returns the parsed value', () => {
    const bp = defineSolutionBlueprint(validBlueprint);
    expect(bp.summary).toBe('A simple project tracker');
  });

  it('accepts an optional app with explicit nav', () => {
    const parsed = SolutionBlueprintSchema.parse({
      ...validBlueprint,
      app: {
        name: 'project_mgmt',
        label: 'Project Management',
        icon: 'kanban',
        nav: [
          { type: 'object', target: 'project', label: 'Projects' },
          { type: 'object', target: 'task' },
          { type: 'dashboard', target: 'overview' },
        ],
      },
    });
    expect(parsed.app?.name).toBe('project_mgmt');
    expect(parsed.app?.nav).toHaveLength(3);
    expect(parsed.app?.nav?.[1].type).toBe('object'); // default applied
  });

  it('allows an app with no nav (auto-surfaced at apply time)', () => {
    const parsed = SolutionBlueprintSchema.parse({
      ...validBlueprint,
      app: { name: 'pm', label: 'PM' },
    });
    expect(parsed.app?.nav).toBeUndefined();
  });

  it('app is optional', () => {
    expect(SolutionBlueprintSchema.parse(validBlueprint).app).toBeUndefined();
  });

  it('rejects a non-snake_case app name', () => {
    expect(() =>
      SolutionBlueprintSchema.parse({ ...validBlueprint, app: { name: 'MyApp' } }),
    ).toThrow();
  });

  it('rejects an invalid nav item type', () => {
    expect(() =>
      SolutionBlueprintSchema.parse({
        ...validBlueprint,
        app: { name: 'pm', nav: [{ type: 'flow', target: 'project' }] },
      }),
    ).toThrow();
  });

  it('accepts dashboard widgets that name an explicit measure + groupBy', () => {
    const parsed = SolutionBlueprintSchema.parse({
      ...validBlueprint,
      dashboards: [
        {
          name: 'overview',
          widgets: [
            { id: 'revenue', title: 'Total revenue', object: 'task', chart: 'metric', measure: 'amount' },
            { id: 'by_status', title: 'By status', object: 'task', chart: 'bar', measure: 'count', groupBy: 'status' },
          ],
        },
      ],
    });
    expect(parsed.dashboards?.[0].widgets?.[0]).toMatchObject({ measure: 'amount' });
    expect(parsed.dashboards?.[0].widgets?.[1]).toMatchObject({ measure: 'count', groupBy: 'status' });
  });

  it('allows a dashboard widget to omit measure + groupBy (builder infers them)', () => {
    const parsed = SolutionBlueprintSchema.parse({
      ...validBlueprint,
      dashboards: [{ name: 'overview', widgets: [{ id: 'w1', title: 'Tasks', object: 'task', chart: 'metric' }] }],
    });
    expect(parsed.dashboards?.[0].widgets?.[0].measure).toBeUndefined();
    expect(parsed.dashboards?.[0].widgets?.[0].groupBy).toBeUndefined();
  });

  it('rejects a non-snake_case widget measure / groupBy', () => {
    expect(() =>
      SolutionBlueprintSchema.parse({
        ...validBlueprint,
        dashboards: [{ name: 'd', widgets: [{ id: 'w', object: 'task', chart: 'bar', groupBy: 'By Status' }] }],
      }),
    ).toThrow();
  });
});

// The strict mirror is what `generateObject` sends to OpenAI: every property
// must be present in `required` (optional → nullable), and no open `z.record`
// (seedData dropped). A live run proved the lenient schema's optional fields
// made OpenAI strict structured outputs reject the request.
describe('SolutionBlueprintStrictSchema (OpenAI strict mirror)', () => {
  const strictBp = {
    summary: 's',
    assumptions: [],
    questions: null,
    objects: [
      {
        name: 'project',
        label: null,
        description: null,
        fields: [
          { name: 'name', label: null, type: 'text', required: null, reference: null, options: null },
        ],
      },
    ],
    views: null,
    dashboards: null,
    app: null,
  };

  it('accepts a blueprint with null for every optional field', () => {
    const parsed = SolutionBlueprintStrictSchema.parse(strictBp);
    expect(parsed.objects[0].fields[0].type).toBe('text');
    expect(parsed.views).toBeNull();
    expect(parsed.app).toBeNull();
  });

  it('requires every top-level key to be present (OpenAI strict needs all in `required`)', () => {
    const { views: _v, ...missingViews } = strictBp;
    expect(() => SolutionBlueprintStrictSchema.parse(missingViews)).toThrow();
  });

  it('requires every (nullable) field key to be present — omitting `label` throws', () => {
    const badField = {
      ...strictBp,
      objects: [
        { name: 'x', label: null, description: null, fields: [{ name: 'f', type: 'text', required: null, reference: null, options: null }] },
      ],
    };
    // `f` is missing the (nullable, required) `label` key.
    expect(() => SolutionBlueprintStrictSchema.parse(badField)).toThrow();
  });

  it('drops the un-strict-able seedData record (OpenAI strict cannot represent open key/value maps)', () => {
    expect('seedData' in SolutionBlueprintStrictSchema.shape).toBe(false);
  });

  it('accepts a dashboard widget carrying the (nullable) measure + groupBy keys', () => {
    const parsed = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      dashboards: [
        {
          name: 'overview',
          label: null,
          widgets: [
            { id: 'revenue', title: 'Total revenue', object: 'project', chart: 'metric', measure: 'amount', groupBy: null },
            { id: 'w2', title: null, object: null, chart: null, measure: null, groupBy: null },
          ],
        },
      ],
    });
    expect(parsed.dashboards?.[0].widgets?.[0]).toMatchObject({ measure: 'amount', groupBy: null });
    expect(parsed.dashboards?.[0].widgets?.[1].measure).toBeNull();
  });

  it('requires the (nullable) measure + groupBy widget keys to be present (OpenAI strict)', () => {
    const missingKeys = {
      ...strictBp,
      // widget omits `measure` and `groupBy` — strict mode needs every key in `required`.
      dashboards: [{ name: 'd', label: null, widgets: [{ id: 'w', title: null, object: null, chart: null }] }],
    };
    expect(() => SolutionBlueprintStrictSchema.parse(missingKeys)).toThrow();
  });
});
