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

  it('keeps summaryOperations (incl. a conditional roll-up) on a summary field', () => {
    // z.object STRIPS unknown keys, so before this slot existed a blueprint that
    // correctly declared { type:'summary', summaryOperations:{…filter…} } lost the
    // config at the parse waist and materialized runtime-dead (cloud#970).
    const parsed = SolutionBlueprintSchema.parse({
      summary: 'tasks',
      objects: [
        {
          name: 'project',
          fields: [
            { name: 'task_total', type: 'summary', summaryOperations: { object: 'task', field: 'id', function: 'count' } },
            {
              name: 'completed_task_count', type: 'summary',
              summaryOperations: { object: 'task', field: 'id', function: 'count', filter: { status: 'completed' } },
            },
            {
              name: 'open_task_count', type: 'summary',
              summaryOperations: { object: 'task', function: 'count', conditions: [{ field: 'status', op: 'ne', value: 'completed' }] },
            },
          ],
        },
      ],
    });
    expect(parsed.objects[0].fields[0].summaryOperations).toEqual({ object: 'task', field: 'id', function: 'count' });
    expect(parsed.objects[0].fields[1].summaryOperations?.filter).toEqual({ status: 'completed' });
    expect(parsed.objects[0].fields[2].summaryOperations?.conditions).toEqual([
      { field: 'status', op: 'ne', value: 'completed' },
    ]);
  });

  it('accepts a blueprint with no top-level `summary` — a prose one-liner must not sink a valid build', () => {
    // cloud#970: apply_blueprint parses the model's re-emitted blueprint with this
    // schema. A missing `summary` used to hard-fail with `path: "summary"`, which
    // the model read as "the summary FIELDS are invalid" and repaired by deleting
    // the roll-up fields.
    const parsed = SolutionBlueprintSchema.parse({
      objects: [{ name: 'thing', fields: [{ name: 'name', type: 'text' }] }],
    });
    expect(parsed.summary).toBeUndefined();
    expect(parsed.objects).toHaveLength(1);
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

  it('accepts gallery and gantt as first-class view kinds (not only list/form/kanban/calendar)', () => {
    // A build agent that wants a poster wall or a schedule must be able to PROPOSE
    // a gallery/gantt view directly — otherwise the closest allowed enum value
    // (list) wins and the view silently downgrades to a grid.
    const parsed = SolutionBlueprintSchema.parse({
      summary: 'events',
      objects: [{ name: 'event', fields: [{ name: 'name', type: 'text' }, { name: 'poster', type: 'image' }] }],
      views: [
        { object: 'event', name: 'poster_wall', type: 'gallery', columns: ['poster', 'name'] },
        { object: 'event', name: 'schedule', type: 'gantt', columns: ['name'] },
      ],
    });
    expect(parsed.views?.map((v) => v.type)).toEqual(['gallery', 'gantt']);
  });

  it('still rejects a missing `objects` — structure is required even though prose is not', () => {
    const { objects: _drop, ...noObjects } = validBlueprint;
    expect(() => SolutionBlueprintSchema.parse(noObjects)).toThrow();
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

  it('carries an explicit sharingModel (OWD) through the parse — user visibility intent must survive to apply', () => {
    // cloud#1466: the ADR-0090 publish gate refuses a custom object without a
    // sharingModel, and cloud stamps a deterministic default in every authoring
    // path. Before this slot existed, z.object STRIPPED the key at this waist,
    // so a propose-stage "this is personal data → private" was silently replaced
    // by the default (public_read_write) — the most expensive silence on the
    // privacy axis. Cloud's `objectBody` cast-read picks the key up from here.
    const owds = ['private', 'public_read', 'public_read_write', 'controlled_by_parent'] as const;
    for (const owd of owds) {
      const parsed = SolutionBlueprintSchema.parse({
        summary: 'hr',
        objects: [{ name: 'performance_review', sharingModel: owd, fields: [{ name: 'score', type: 'number' }] }],
      });
      expect(parsed.objects[0].sharingModel).toBe(owd);
    }
  });

  it('sharingModel is optional — omitting it defers to the platform default', () => {
    const parsed = SolutionBlueprintSchema.parse({
      summary: 's',
      objects: [{ name: 'thing', fields: [{ name: 'name', type: 'text' }] }],
    });
    expect(parsed.objects[0].sharingModel).toBeUndefined();
  });

  it('does NOT carry an undeclared sibling key — the sharingModel accept is not pass-through', () => {
    // The pin that keeps the accept above non-vacuous: this schema strips
    // undeclared keys, so "sharingModel survives the parse" is evidence the key
    // is DECLARED, only as long as an undeclared sibling provably does not
    // survive. `externalSharingModel` is a real key on the full ObjectSchema
    // (ADR-0090 D11) that the blueprint deliberately does not author.
    const parsed = SolutionBlueprintSchema.parse({
      summary: 's',
      objects: [{
        name: 'review',
        sharingModel: 'private',
        externalSharingModel: 'private',
        fields: [{ name: 'name', type: 'text' }],
      }],
    });
    expect(parsed.objects[0].sharingModel).toBe('private');
    expect('externalSharingModel' in parsed.objects[0]).toBe(false);
  });

  it('rejects a non-canonical sharingModel value (legacy aliases are not part of the vocabulary)', () => {
    // ADR-0090 D4: canonical four only. A legacy alias must fail loudly here,
    // not be carried through to fail (or worse, pass) at publish time.
    const result = SolutionBlueprintSchema.safeParse({
      summary: 's',
      objects: [{ name: 'review', sharingModel: 'read_write', fields: [{ name: 'name', type: 'text' }] }],
    });
    expect(result.success).toBe(false);
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
        sharingModel: null,
        nameField: null,
        fields: [
          { name: 'name', label: null, type: 'text', required: null, reference: null, options: null, summaryOperations: null, expression: null },
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

  it('accepts gallery/gantt view kinds in the strict mirror (the structured-output contract)', () => {
    // This is the schema the build agent's structured output is validated against,
    // so the gallery/gantt enum values MUST live here too — else the model can
    // never emit them and a requested gallery degrades to a list/grid.
    const parsed = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      views: [
        { object: 'event', name: 'wall', label: null, type: 'gallery', columns: null, groupBy: null },
        { object: 'event', name: 'plan', label: null, type: 'gantt', columns: null, groupBy: null },
      ],
    });
    expect(parsed.views?.map((v) => v.type)).toEqual(['gallery', 'gantt']);
  });

  it('requires every top-level key to be present (OpenAI strict needs all in `required`)', () => {
    const { views: _v, ...missingViews } = strictBp;
    expect(() => SolutionBlueprintStrictSchema.parse(missingViews)).toThrow();
  });

  it('requires every (nullable) field key to be present — omitting `label` throws', () => {
    const badField = {
      ...strictBp,
      objects: [
        { name: 'x', label: null, description: null, sharingModel: null, nameField: null, fields: [{ name: 'f', type: 'text', required: null, reference: null, options: null, summaryOperations: null, expression: null }] },
      ],
    };
    // `f` is missing the (nullable, required) `label` key.
    delete (badField.objects[0].fields[0] as { label?: unknown }).label;
    expect(() => SolutionBlueprintStrictSchema.parse(badField)).toThrow();
  });

  it('carries summaryOperations on a strict field, with the predicate as a flat conditions ARRAY', () => {
    // The design step's structured output is the ONLY place a conditional
    // roll-up can be designed — the aggregation is known there ("已完成任务数
    // counts only completed tasks") and roll-ups only recompute on child writes,
    // so a config bolted on after the build's sample data loaded stays empty.
    // Strict mode cannot express the canonical `filter` MAP, hence `conditions`.
    const parsed = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      objects: [
        {
          name: 'project',
          label: null,
          description: null,
          sharingModel: null,
          nameField: null,
          fields: [
            {
              name: 'task_total', label: '任务总数', type: 'summary', required: null, reference: null, options: null, expression: null,
              summaryOperations: { object: 'task', function: 'count', field: 'id', relationshipField: null, conditions: null },
            },
            {
              name: 'completed_task_count', label: '已完成任务数', type: 'summary', required: null, reference: null, options: null, expression: null,
              summaryOperations: {
                object: 'task', function: 'count', field: 'id', relationshipField: null,
                conditions: [{ field: 'status', op: 'eq', value: 'completed' }],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.objects[0].fields[0].summaryOperations).toMatchObject({ object: 'task', function: 'count' });
    expect(parsed.objects[0].fields[0].summaryOperations?.conditions).toBeNull();
    expect(parsed.objects[0].fields[1].summaryOperations?.conditions).toEqual([
      { field: 'status', op: 'eq', value: 'completed' },
    ]);
  });

  it('drops the un-strict-able seedData record (OpenAI strict cannot represent open key/value maps)', () => {
    expect('seedData' in SolutionBlueprintStrictSchema.shape).toBe(false);
  });

  it('carries sharingModel on a strict object — nullable, and REQUIRED to be present (OpenAI strict)', () => {
    // Shape pin: the strict mirror is the structured-output contract the design
    // model emits against — without the key here, the propose-stage LLM can
    // never author an OWD choice, whatever the lenient schema accepts.
    const objectShape = (SolutionBlueprintStrictSchema as any).shape.objects.element.shape;
    expect('sharingModel' in objectShape).toBe(true);

    // null is accepted (defer to the platform default)…
    const parsed = SolutionBlueprintStrictSchema.parse(strictBp);
    expect(parsed.objects[0].sharingModel).toBeNull();

    // …an explicit OWD choice is carried…
    const explicit = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      objects: [{ ...strictBp.objects[0], sharingModel: 'private' }],
    });
    expect(explicit.objects[0].sharingModel).toBe('private');

    // …and OMITTING the key throws (strict mode: every key in `required`).
    const missingKey = { ...strictBp, objects: [{ ...strictBp.objects[0] }] };
    delete (missingKey.objects[0] as { sharingModel?: unknown }).sharingModel;
    expect(() => SolutionBlueprintStrictSchema.parse(missingKey)).toThrow();
  });

  it('carries nameField on a strict object — nullable, and REQUIRED to be present (OpenAI strict)', () => {
    // Shape pin: the strict mirror is the structured-output contract the design
    // model emits against — without the key here, the propose-stage LLM can
    // never author an ADR-0079 record-title choice, whatever the lenient schema
    // accepts, and the platform auto-pick always wins.
    const objectShape = (SolutionBlueprintStrictSchema as any).shape.objects.element.shape;
    expect('nameField' in objectShape).toBe(true);

    // null is accepted (defer to the platform auto-pick)…
    const parsed = SolutionBlueprintStrictSchema.parse(strictBp);
    expect(parsed.objects[0].nameField).toBeNull();

    // …an explicit record-title choice is carried…
    const explicit = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      objects: [{ ...strictBp.objects[0], nameField: 'name' }],
    });
    expect(explicit.objects[0].nameField).toBe('name');

    // …and OMITTING the key throws (strict mode: every key in `required`).
    const missingKey = { ...strictBp, objects: [{ ...strictBp.objects[0] }] };
    delete (missingKey.objects[0] as { nameField?: unknown }).nameField;
    expect(() => SolutionBlueprintStrictSchema.parse(missingKey)).toThrow();
  });

  it('accepts a dashboard widget carrying the (nullable) measure + groupBy + condition keys', () => {
    const parsed = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      dashboards: [
        {
          name: 'overview',
          label: null,
          widgets: [
            { id: 'revenue', title: 'Total revenue', object: 'project', chart: 'metric', measure: 'amount', groupBy: null, condition: null },
            { id: 'low_stock', title: 'Low stock', object: 'project', chart: 'table', measure: null, groupBy: null, condition: { field: 'qty', op: 'lt', value: 10 } },
          ],
        },
      ],
    });
    expect(parsed.dashboards?.[0].widgets?.[0]).toMatchObject({ measure: 'amount', groupBy: null });
    expect(parsed.dashboards?.[0].widgets?.[0].condition).toBeNull();
    expect(parsed.dashboards?.[0].widgets?.[1].condition).toMatchObject({ field: 'qty', op: 'lt', value: 10 });
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

// ---------------------------------------------------------------------------
// The mirror and the lenient schema must not diverge.
//
// This pin is the actual lesson of the `formula` gap it was added with. The
// blueprint could name `type: 'formula'` (it uses the full `FieldType` enum)
// but had no `expression` key in EITHER schema — so a model could declare a
// formula field and had no way, anywhere on this surface, to say what it
// computes. It materialized runtime-dead, cloud's graph-lint correctly flagged
// `formula_without_expression`, and the prescribed fix ("set the expression")
// was unwritable in the blueprint the agent was holding. Detected, but
// unfixable on the surface that produced it.
//
// A key that exists in one schema and not the other is the same defect waiting
// to happen: the mirror is what the model may EMIT, the lenient schema is what
// downstream READS. Drift in either direction silently drops authored config.
// ---------------------------------------------------------------------------
describe('strict mirror ↔ lenient schema — key parity', () => {
  const lenientFieldKeys = () =>
    Object.keys((SolutionBlueprintSchema as any).shape.objects.element.shape.fields.element.shape).sort();
  const strictFieldKeys = () =>
    Object.keys((SolutionBlueprintStrictSchema as any).shape.objects.element.shape.fields.element.shape).sort();

  it('the field schemas carry exactly the same keys', () => {
    expect(strictFieldKeys()).toEqual(lenientFieldKeys());
  });

  it('the OBJECT schemas carry exactly the same keys', () => {
    // The `nameField` gap proved the field-level pin alone is not enough: the
    // lenient object schema carried the ADR-0079 record-title key while the
    // strict mirror did not, so the design-stage model could never author it —
    // detected by cloud lint, unfixable on the surface that produced it. There
    // are NO deliberate object-level exclusions (measured: both sides carry
    // name/label/description/fields/sharingModel/nameField); if one ever
    // becomes deliberate, list it explicitly here with its reason.
    const lenientObjectKeys = Object.keys(
      (SolutionBlueprintSchema as any).shape.objects.element.shape,
    ).sort();
    const strictObjectKeys = Object.keys(
      (SolutionBlueprintStrictSchema as any).shape.objects.element.shape,
    ).sort();
    expect(strictObjectKeys).toEqual(lenientObjectKeys);
  });

  it('carries `expression`, so a formula field can state what it computes', () => {
    // Guards the specific hole: `FieldType` includes `formula`, so this surface
    // can always NAME one. If it cannot also carry the body, every formula it
    // produces is dead on arrival.
    expect(lenientFieldKeys()).toContain('expression');
    expect(strictFieldKeys()).toContain('expression');
  });

  it('round-trips a formula field with its expression through the lenient schema', () => {
    const parsed = SolutionBlueprintSchema.parse({
      summary: 's',
      objects: [{
        name: 'invoice',
        nameField: 'title',
        fields: [
          { name: 'order_no', type: 'text' },
          { name: 'customer', type: 'text' },
          { name: 'title', type: 'formula', expression: "record.order_no + ' · ' + record.customer" },
        ],
      }],
    });
    expect(parsed.objects[0].fields[2].expression).toBe("record.order_no + ' · ' + record.customer");
  });
});
