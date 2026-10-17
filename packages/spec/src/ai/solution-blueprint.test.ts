// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  BlueprintViewSchema,
  SolutionBlueprintSchema,
  SolutionBlueprintStrictSchema,
  defineSolutionBlueprint,
  type SolutionBlueprint,
} from './solution-blueprint.zod';
import { ViewFilterRuleSchema } from '../ui/view.zod';
import { SortItemSchema } from '../shared/enums.zod';

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
    // survive. `publicSharing` is a real key on the full ObjectSchema (the
    // share-link policy) that the blueprint deliberately does not author.
    const parsed = SolutionBlueprintSchema.parse({
      summary: 's',
      objects: [{
        name: 'review',
        sharingModel: 'private',
        publicSharing: { enabled: true },
        fields: [{ name: 'name', type: 'text' }],
      }],
    });
    expect(parsed.objects[0].sharingModel).toBe('private');
    expect('publicSharing' in parsed.objects[0]).toBe(false);
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

  describe('view filters + sort (a view named by a condition carries the condition)', () => {
    const taskObject = {
      name: 'task',
      fields: [
        { name: 'title', type: 'text' as const },
        { name: 'status', type: 'select' as const },
        { name: 'due_date', type: 'date' as const },
      ],
    };
    const overdueRules = [
      { field: 'due_date', operator: 'less_than' as const, value: '{today}' },
      { field: 'status', operator: 'not_equals' as const, value: 'completed' },
    ];
    /** The first issue of a failed lenient parse, as `{ path, code }`. */
    const firstIssue = (input: unknown) => {
      const result = SolutionBlueprintSchema.safeParse(input);
      expect(result.success).toBe(false);
      const issue = result.success ? undefined : result.error.issues[0];
      return { path: issue?.path, code: issue?.code };
    };

    it('carries a view\'s filters and sort through the parse — z.object would strip an undeclared key', () => {
      const parsed = SolutionBlueprintSchema.parse({
        summary: 's',
        objects: [taskObject],
        views: [{
          object: 'task', name: 'overdue_tasks', label: '逾期任务', columns: ['title', 'due_date'],
          filters: overdueRules,
          sort: [{ field: 'due_date', order: 'asc' }],
        }],
      });
      expect(parsed.views?.[0].filters).toEqual(overdueRules);
      expect(parsed.views?.[0].sort).toEqual([{ field: 'due_date', order: 'asc' }]);
    });

    it('keeps both keys optional — a view over every record omits them', () => {
      const parsed = SolutionBlueprintSchema.parse({
        summary: 's',
        objects: [taskObject],
        views: [{ object: 'task', name: 'all_tasks' }],
      });
      expect(parsed.views?.[0].filters).toBeUndefined();
      expect(parsed.views?.[0].sort).toBeUndefined();
    });

    it('declares no new format: `filters` IS ViewFilterRuleSchema and `sort` IS the shared SortItemSchema', () => {
      // Identity, not shape: a copy would agree today and drift on the next
      // edit of the ListView rule, which is the dialect this key must not fork.
      const shape = (BlueprintViewSchema as any).shape;
      expect(shape.filters.unwrap().element).toBe(ViewFilterRuleSchema);
      expect(shape.sort.unwrap().element).toBe(SortItemSchema);
    });

    it('refuses an operator outside the view-filter vocabulary, at the rule\'s own path', () => {
      expect(firstIssue({
        summary: 's',
        objects: [taskObject],
        views: [{ object: 'task', name: 'overdue_tasks', filters: [{ field: 'due_date', operator: 'older_than', value: '{today}' }] }],
      })).toEqual({ path: ['views', 0, 'filters', 0, 'operator'], code: 'invalid_value' });
    });

    it('refuses the list-view rule\'s value-shape violations too (the rule is reused, refinement included)', () => {
      // The strict mirror cannot express this coupling in JSON Schema; the
      // lenient parse `apply_blueprint` runs is where it is refused.
      expect(firstIssue({
        summary: 's',
        objects: [taskObject],
        views: [{ object: 'task', name: 'open_or_new', filters: [{ field: 'status', operator: 'in', value: 'open' }] }],
      })).toEqual({ path: ['views', 0, 'filters', 0, 'value'], code: 'custom' });
    });

    it('refuses a sort order outside asc / desc, at the entry\'s own path', () => {
      expect(firstIssue({
        summary: 's',
        objects: [taskObject],
        views: [{ object: 'task', name: 'by_due', sort: [{ field: 'due_date', order: 'descending' }] }],
      })).toEqual({ path: ['views', 0, 'sort', 0, 'order'], code: 'invalid_value' });
    });

    it('refuses a bare-string sort clause — the array is the only spelling, as on ListView', () => {
      expect(firstIssue({
        summary: 's',
        objects: [taskObject],
        views: [{ object: 'task', name: 'by_due', sort: 'due_date desc' }],
      })).toEqual({ path: ['views', 0, 'sort'], code: 'invalid_type' });
    });
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
        { object: 'event', name: 'wall', label: null, type: 'gallery', columns: null, groupBy: null, filters: null, sort: null },
        { object: 'event', name: 'plan', label: null, type: 'gantt', columns: null, groupBy: null, filters: null, sort: null },
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

  it('carries viewName on a strict nav item — nullable, and REQUIRED to be present (OpenAI strict)', () => {
    // cloud#2150 shape pin. This mirror is the design step's output contract,
    // so a `viewName` that exists only in the lenient schema is a fix on no
    // path the product actually runs: `propose_blueprint` could never author a
    // board entry, and `apply_blueprint` would accept a key nothing emits.
    const navShape = (SolutionBlueprintStrictSchema as any).shape.app.unwrap().shape.nav.unwrap().element.shape;
    expect('viewName' in navShape).toBe(true);

    // null is accepted (the entry opens the object's default list)…
    const bare = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      app: { name: 'ticketing', label: null, icon: null, nav: [
        { type: 'object', target: 'ticket', label: '工单列表', icon: 'list', viewName: null },
      ] },
    });
    expect(bare.app?.nav?.[0].viewName).toBeNull();

    // …and the whole point of the card: list AND board for ONE object, told
    // apart by the view each entry opens rather than by decoration.
    const board = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      app: { name: 'ticketing', label: null, icon: null, nav: [
        { type: 'object', target: 'ticket', label: '工单列表', icon: 'list', viewName: null },
        { type: 'object', target: 'ticket', label: '工单看板', icon: 'kanban', viewName: 'ticket_status_board' },
      ] },
    });
    expect(board.app?.nav?.map((n) => n.viewName)).toEqual([null, 'ticket_status_board']);

    // …and OMITTING the key throws (strict mode: every key in `required`).
    const missingKey = {
      ...strictBp,
      app: { name: 'ticketing', label: null, icon: null, nav: [{ type: 'object', target: 'ticket', label: null, icon: null }] },
    };
    expect(() => SolutionBlueprintStrictSchema.parse(missingKey)).toThrow();
  });

  it('accepts the QUALIFIED <object>.<view> spelling too — the applier normalizes, the mirror must not refuse', () => {
    // `viewName` is deliberately un-regexed on BOTH sides: a view answers to a
    // bare key and to the `<object>.<key>` name its staged record carries.
    // Constraining it here would make one of the two legal to generate and
    // illegal to apply (cloud#1967).
    const parsed = SolutionBlueprintStrictSchema.parse({
      ...strictBp,
      app: { name: 'ticketing', label: null, icon: null, nav: [
        { type: 'object', target: 'ticket', label: '工单看板', icon: 'kanban', viewName: 'ticket.ticket_status_board' },
      ] },
    });
    expect(parsed.app?.nav?.[0].viewName).toBe('ticket.ticket_status_board');
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

  describe('view filters + sort (the model states a view\'s filter or says null)', () => {
    const strictView = {
      object: 'task', name: 'overdue_tasks', label: '逾期任务', type: 'list', columns: ['title', 'due_date'], groupBy: null,
    };
    /** The first issue of a failed strict parse, as `{ path, code }`. */
    const firstIssue = (input: unknown) => {
      const result = SolutionBlueprintStrictSchema.safeParse(input);
      expect(result.success).toBe(false);
      const issue = result.success ? undefined : result.error.issues[0];
      return { path: issue?.path, code: issue?.code };
    };

    it('carries a view\'s filters and sort — the filter its name promises is expressible in the structured output', () => {
      const filters = [
        { field: 'due_date', operator: 'less_than', value: '{today}' },
        { field: 'status', operator: 'not_equals', value: 'completed' },
        { field: 'status', operator: 'in', value: ['open', 'blocked'] },
        { field: 'archived_at', operator: 'is_null', value: null },
      ];
      const parsed = SolutionBlueprintStrictSchema.parse({
        ...strictBp,
        views: [{ ...strictView, filters, sort: [{ field: 'due_date', order: 'asc' }] }],
      });
      expect(parsed.views?.[0].filters).toEqual(filters);
      expect(parsed.views?.[0].sort).toEqual([{ field: 'due_date', order: 'asc' }]);
    });

    it('accepts null for both keys — a view over every record, in the platform default order', () => {
      const parsed = SolutionBlueprintStrictSchema.parse({
        ...strictBp,
        views: [{ ...strictView, name: 'all_tasks', filters: null, sort: null }],
      });
      expect(parsed.views?.[0].filters).toBeNull();
      expect(parsed.views?.[0].sort).toBeNull();
    });

    it('requires both keys to be present (OpenAI strict: every key in `required`)', () => {
      expect(firstIssue({ ...strictBp, views: [{ ...strictView, sort: null }] }))
        .toEqual({ path: ['views', 0, 'filters'], code: 'invalid_type' });
      expect(firstIssue({ ...strictBp, views: [{ ...strictView, filters: null }] }))
        .toEqual({ path: ['views', 0, 'sort'], code: 'invalid_type' });
    });

    it('requires a rule\'s `value` key to be present — null is the unary operators\' spelling', () => {
      expect(firstIssue({
        ...strictBp,
        views: [{ ...strictView, filters: [{ field: 'archived_at', operator: 'is_null' }], sort: null }],
      })).toEqual({ path: ['views', 0, 'filters', 0, 'value'], code: 'invalid_type' });
    });

    it('takes the canonical operator vocabulary only — a legacy shorthand is not a word the model may emit', () => {
      expect(firstIssue({
        ...strictBp,
        views: [{ ...strictView, filters: [{ field: 'status', operator: 'eq', value: 'open' }], sort: null }],
      })).toEqual({ path: ['views', 0, 'filters', 0, 'operator'], code: 'invalid_value' });
    });

    it('refuses a sort order outside asc / desc', () => {
      expect(firstIssue({
        ...strictBp,
        views: [{ ...strictView, filters: null, sort: [{ field: 'due_date', order: 'descending' }] }],
      })).toEqual({ path: ['views', 0, 'sort', 0, 'order'], code: 'invalid_value' });
    });
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

  it('the NAV ITEM schemas carry exactly the same keys', () => {
    // Widened for cloud#2150, the third time the same gap was found one level
    // further out (fields → objects → nav items). The nav item is where "which
    // VIEW does this menu entry open" lives; with `viewName` on one side only,
    // the design step could not author a board entry (mirror missing) or the
    // applier would drop one it was handed (lenient missing). There are NO
    // deliberate nav-level exclusions; if one ever becomes deliberate, list it
    // explicitly here with its reason.
    const lenientNavKeys = Object.keys(
      (SolutionBlueprintSchema as any).shape.app.unwrap().shape.nav.unwrap().element.shape,
    ).sort();
    const strictNavKeys = Object.keys(
      (SolutionBlueprintStrictSchema as any).shape.app.unwrap().shape.nav.unwrap().element.shape,
    ).sort();
    expect(strictNavKeys).toEqual(lenientNavKeys);
  });

  const lenientViewShape = () => (SolutionBlueprintSchema as any).shape.views.unwrap().element.shape;
  const strictViewShape = () => (SolutionBlueprintStrictSchema as any).shape.views.unwrap().element.shape;

  it('the VIEW schemas carry exactly the same keys', () => {
    // Widened with `filters` / `sort`, the fourth level of the same gap
    // (fields → objects → nav items → views). The view is where "WHICH records
    // does this view show" lives; with the key on the lenient side only, the
    // design step could never state the filter its view's name promises, and the
    // applier would accept a filter no proposal can contain. There are NO
    // deliberate view-level exclusions (measured: both sides carry
    // object/name/label/type/columns/groupBy/filters/sort); if one ever becomes
    // deliberate, list it explicitly here with its reason.
    expect(Object.keys(strictViewShape()).sort()).toEqual(Object.keys(lenientViewShape()).sort());
    expect(Object.keys(lenientViewShape())).toEqual(expect.arrayContaining(['filters', 'sort']));
  });

  it('the view FILTER RULE and SORT ENTRY shapes carry exactly the same keys', () => {
    // One level down, for the same reason the field pin sits under the object
    // pin: the strict mirror re-declares these two shapes inline (strict mode
    // cannot take the lenient rule's preprocess / refinement), so a key added to
    // `ViewFilterRuleSchema` or `SortItemSchema` would otherwise be one the
    // model can never emit. No deliberate exclusions at either level.
    const keysOf = (arraySchema: any) => Object.keys(arraySchema.unwrap().element.shape).sort();
    expect(keysOf(strictViewShape().filters)).toEqual(keysOf(lenientViewShape().filters));
    expect(keysOf(strictViewShape().sort)).toEqual(keysOf(lenientViewShape().sort));
  });

  it('the strict filter rule offers exactly the view-filter operator vocabulary the lenient rule accepts', () => {
    // Value parity for the one enum the VALUE-parity walker below cannot see
    // (it indexes string patterns): the lenient operator is an enum behind a
    // preprocess, the strict one the same enum without it. A canonical operator
    // missing here is one the model cannot choose; an extra one, a rule the
    // applier refuses.
    const strictOperators = strictViewShape().filters.unwrap().element.shape.operator.options;
    const lenientOperators = lenientViewShape().filters.unwrap().element.shape.operator.def.out.options;
    expect([...strictOperators].sort()).toEqual([...lenientOperators].sort());
    const strictOrders = strictViewShape().sort.unwrap().element.shape.order.options;
    const lenientOrders = lenientViewShape().sort.unwrap().element.shape.order.options;
    expect([...strictOrders].sort()).toEqual([...lenientOrders].sort());
  });

  it('carries `viewName`, so a menu entry can say WHICH view it opens', () => {
    // Guards the specific hole (cloud#2150): this surface can always author a
    // kanban view AND a nav entry, so without a way to bind the two the model's
    // only remaining move is a duplicate entry distinguished by label alone —
    // which is what shipped, silently, to users.
    const lenientNavKeys = Object.keys(
      (SolutionBlueprintSchema as any).shape.app.unwrap().shape.nav.unwrap().element.shape,
    );
    const strictNavKeys = Object.keys(
      (SolutionBlueprintStrictSchema as any).shape.app.unwrap().shape.nav.unwrap().element.shape,
    );
    expect(lenientNavKeys).toContain('viewName');
    expect(strictNavKeys).toContain('viewName');
  });

  it('states ONE `label` rule on both sides: the empty spelling inherits, a written label is verbatim', () => {
    // cloud#2021. The lenient describe said what an absent label means; the
    // strict mirror — the describe the design model actually reads — said only
    // "or null", so nothing on the generating side told the model that null is
    // the choice that follows a rename of the target. Each side spells "empty"
    // its own way (`absent` / `null`) and "written" its own way (`present` /
    // `a string`); what each spelling MEANS must be the same text on both.
    const navLabelDescribe = (schema: any): string =>
      schema.shape.app.unwrap().shape.nav.unwrap().element.shape.label.description;
    const rule = (describe: string) => ({
      empty: describe.match(/\b(?:absent|null) ⇒ ([^;]+);/)?.[1],
      written: describe.match(/\b(?:present|a string) ⇒ ([^.]+)\./)?.[1],
    });
    const lenient = rule(navLabelDescribe(SolutionBlueprintSchema));
    const strict = rule(navLabelDescribe(SolutionBlueprintStrictSchema));
    expect(strict.empty).toBeDefined();
    expect(strict.written).toBeDefined();
    expect(strict).toEqual(lenient);
  });

  it('round-trips a list + board pair on ONE object through the lenient schema', () => {
    const parsed = SolutionBlueprintSchema.parse({
      summary: 's',
      objects: [{ name: 'ticket', fields: [{ name: 'title', type: 'text' }, { name: 'status', type: 'select' }] }],
      views: [{ object: 'ticket', name: 'ticket_status_board', type: 'kanban', groupBy: 'status' }],
      app: {
        name: 'ticket_management',
        nav: [
          { type: 'object', target: 'ticket', label: '工单列表', icon: 'list' },
          { type: 'object', target: 'ticket', label: '工单看板', icon: 'kanban', viewName: 'ticket_status_board' },
        ],
      },
    });
    // The negative control rides along: the entry that named no view keeps
    // carrying none, so the default-list behaviour is untouched.
    expect(parsed.app?.nav?.map((n) => n.viewName)).toEqual([undefined, 'ticket_status_board']);
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

// ---------------------------------------------------------------------------
// VALUE parity — the twin of the key-parity gate above (cloud#1967).
//
// The key gate pins WHICH keys each side carries. Nothing pinned the
// CONSTRAINTS on those keys, and they had drifted: every identifier in the
// lenient schema carried `.regex(SNAKE_CASE)`, the strict mirror carried none.
// So the model could legally GENERATE `1_49` for a select option value (from a
// 「1-49人」 label) and `apply_blueprint` — which validates against the LENIENT
// schema — then rejected the very blueprint the user had approved:
//   objects.0.fields.2.options.0.value: Invalid string: must match pattern
//   /^[a-z_][a-z0-9_]*$/
// Nothing was staged, the approval became a no-op, and the build landed only
// because the model happened to retry with a repaired blueprint the user never
// saw. Two declarations of one contract, disagreeing about values.
// ---------------------------------------------------------------------------
describe('strict mirror ↔ lenient schema — VALUE parity', () => {
  /** The regex a zod string leaf enforces, or null when it enforces none. */
  const patternOf = (schema: any): string | null => {
    const checks = schema?.def?.checks;
    if (!Array.isArray(checks)) return null;
    for (const c of checks) {
      const p = c?._zod?.def?.pattern;
      if (p) return String(p);
    }
    return null;
  };

  /**
   * Index every string leaf reachable from `schema` by its authoring path,
   * mapping it to the pattern it enforces. Wrapper nodes (optional / nullable /
   * default / lazy) are transparent so the lenient `.optional()` and the strict
   * `.nullable()` spelling of the same key land on the SAME path.
   */
  const indexPatterns = (schema: any): Map<string, string | null> => {
    const out = new Map<string, string | null>();
    const seen = new Set<unknown>();
    const walk = (node: any, path: string, depth: number): void => {
      if (!node || depth > 12) return;
      const def = node.def;
      if (!def) return;
      switch (def.type) {
        case 'optional':
        case 'nullable':
        case 'default':
        case 'prefault':
        case 'nonoptional':
        case 'readonly':
          return walk(def.innerType, path, depth + 1);
        case 'lazy':
          return walk(def.getter(), path, depth + 1);
        case 'array':
          return walk(def.element, `${path}[]`, depth + 1);
        case 'object': {
          if (seen.has(def.shape)) return;
          seen.add(def.shape);
          for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
            walk(child, path ? `${path}.${key}` : key, depth + 1);
          }
          return;
        }
        case 'string':
          out.set(path, patternOf(node));
          return;
        default:
          return; // unions / enums / records / numbers carry no identifier pattern
      }
    };
    walk(schema, '', 0);
    return out;
  };

  it('every identifier the applier constrains is constrained the same way in the model-facing mirror', () => {
    const lenient = indexPatterns(SolutionBlueprintSchema);
    const strict = indexPatterns(SolutionBlueprintStrictSchema);
    // Only paths BOTH sides carry are comparable — the key-parity gate above
    // owns "which keys exist"; this one owns "what values they accept".
    const drift = [...lenient.entries()]
      .filter(([path]) => strict.has(path))
      .filter(([path, pattern]) => strict.get(path) !== pattern)
      .map(([path, pattern]) => `${path}: lenient ${pattern ?? 'none'} vs strict ${strict.get(path) ?? 'none'}`);
    expect(drift).toEqual([]);
  });

  it('the model cannot emit the leading-digit option value the applier rejects', () => {
    // The exact value from the live run: a 「1-49人」 company-size band.
    const optionsWithLeadingDigit = [
      { label: '1-49人', value: '1_49' },
      { label: '50-199人', value: '50_199' },
    ];
    const lenient = SolutionBlueprintSchema.safeParse({
      summary: 's',
      objects: [{
        name: 'customer',
        fields: [{ name: 'company_size', type: 'select', options: optionsWithLeadingDigit }],
      }],
    });
    expect(lenient.success).toBe(false);

    const strict = SolutionBlueprintStrictSchema.safeParse({
      summary: 's',
      assumptions: [],
      questions: null,
      objects: [{
        name: 'customer',
        label: null,
        description: null,
        sharingModel: null,
        nameField: null,
        fields: [{
          name: 'company_size',
          label: null,
          type: 'select',
          required: null,
          reference: null,
          options: optionsWithLeadingDigit,
          summaryOperations: null,
          expression: null,
        }],
      }],
      views: null,
      dashboards: null,
      app: null,
    });
    // Before cloud#1967 this parse SUCCEEDED — the proposal was legal to
    // generate and illegal to apply.
    expect(strict.success).toBe(false);
  });
});
