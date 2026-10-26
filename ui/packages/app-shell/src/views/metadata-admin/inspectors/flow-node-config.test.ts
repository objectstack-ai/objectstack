// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  fieldsForNodeType,
  mergeServerFlowFields,
  isFieldVisible,
  getFieldValue,
  configKeyOf,
  type FlowConfigField,
} from './flow-node-config';

describe('start node trigger-field gating (#5)', () => {
  const fields = fieldsForNodeType('start');
  const objectName = fields.find((f) => f.id === 'objectName')!;
  const condition = fields.find((f) => f.id === 'condition')!;

  it('hides Object on a screen / manual start (no record trigger); Entry condition stays (objectui#12780)', () => {
    // The engine evaluates the start condition on every run, a manual
    // `execute()` included, so it is in effect with no trigger at all.
    const node = { id: 'start', type: 'start' }; // no config.triggerType
    expect(isFieldVisible(objectName, node, fields)).toBe(false);
    expect(isFieldVisible(condition, node, fields)).toBe(true);
  });

  it('shows them once a record trigger is picked', () => {
    const node = { id: 'start', type: 'start', config: { triggerType: 'record-after-update' } };
    expect(isFieldVisible(objectName, node, fields)).toBe(true);
    expect(isFieldVisible(condition, node, fields)).toBe(true);
  });

  it('offers a "created or updated" (record-after-write) option and shows the record fields for it (#3427)', () => {
    const triggerType = fields.find((f) => f.id === 'triggerType')!;
    expect(triggerType.options?.some((o) => o.value === 'record-after-write')).toBe(true);
    const node = { id: 'start', type: 'start', config: { triggerType: 'record-after-write' } };
    expect(isFieldVisible(objectName, node, fields)).toBe(true);
    expect(isFieldVisible(condition, node, fields)).toBe(true);
  });

  it('does NOT offer the never-firing `record-change` bare-noun option (#3427)', () => {
    // The runtime routes `record-change` to the record-change trigger, which maps
    // it to no hook — it never fires. Removed so the designer can't author a
    // silently-dead flow; the `os validate` lint flags any hand-written one.
    const triggerType = fields.find((f) => f.id === 'triggerType')!;
    expect(triggerType.options?.some((o) => o.value === 'record-change')).toBe(false);
  });

  it('shows Entry condition, not Object, for a schedule trigger (objectui#12780)', () => {
    // The schedule binding never reads `config.objectName`.
    const node = { id: 'start', type: 'start', config: { triggerType: 'schedule' } };
    expect(isFieldVisible(objectName, node, fields)).toBe(false);
    expect(isFieldVisible(condition, node, fields)).toBe(true);
  });

  it('hides for a manual / autolaunched trigger', () => {
    const node = { id: 'start', type: 'start', config: { triggerType: 'manual' } };
    expect(isFieldVisible(objectName, node, fields)).toBe(false);
  });

  it('never hides a field that already holds a value (non-destructive)', () => {
    const node = { id: 'start', type: 'start', config: { objectName: 'crm_lead' } }; // no triggerType
    expect(isFieldVisible(objectName, node, fields)).toBe(true);
  });
});

describe('scheduled trigger — canonical config.schedule (not flat config.cron)', () => {
  const fields = fieldsForNodeType('start');
  const expr = fields.find((f) => f.id === 'schedule.expression')!;

  it('replaces the dead flat `config.cron` field with a `config.schedule.expression` field', () => {
    // The old "Cron schedule" field wrote config.cron, which resolveTriggerBinding /
    // normalizeSchedule never read — so those scheduled flows silently never bound.
    expect(fields.find((f) => f.id === 'cron')).toBeUndefined();
    expect(expr).toBeDefined();
    expect(expr.path).toEqual(['config', 'schedule', 'expression']);
    expect(configKeyOf(expr)).toBe('schedule'); // owns the whole block (kept out of Advanced JSON)
  });

  it('reads the cron out of an object-shaped config.schedule (no "[object Object]")', () => {
    const node = {
      id: 'start',
      type: 'start',
      config: { triggerType: 'schedule', schedule: { type: 'cron', expression: '0 8 * * *' } },
    };
    expect(getFieldValue(node, expr)).toBe('0 8 * * *');
  });

  it('surfaces a legacy flat config.cron via fallbackPath (so it migrates on edit)', () => {
    const node = { id: 'start', type: 'start', config: { triggerType: 'schedule', cron: '0 7 * * *' } };
    expect(expr.fallbackPath).toEqual(['config', 'cron']);
    expect(getFieldValue(node, expr)).toBe('0 7 * * *');
  });

  it('shows for schedule and time_relative triggers, hides for record triggers', () => {
    const at = (tt: string) => ({ id: 'start', type: 'start', config: { triggerType: tt } });
    expect(isFieldVisible(expr, at('schedule'), fields)).toBe(true);
    expect(isFieldVisible(expr, at('time_relative'), fields)).toBe(true);
    expect(isFieldVisible(expr, at('record-after-update'), fields)).toBe(false);
  });

  it('drops the raw text field on config.schedule (which rendered an object as "[object Object]")', () => {
    expect(
      fields.find((f) => f.path.length === 2 && f.path[0] === 'config' && f.path[1] === 'schedule'),
    ).toBeUndefined();
  });
});

describe('time-relative trigger fields (#1874)', () => {
  const fields = fieldsForNodeType('start');
  const triggerType = fields.find((f) => f.id === 'triggerType')!;
  const trFields = [
    'timeRelative.object',
    'timeRelative.dateField',
    'timeRelative.withinDays',
    'timeRelative.offsetDays',
    'timeRelative.filter',
    'timeRelative.maxRecords',
  ].map((id) => fields.find((f) => f.id === id)!);

  it('offers a time_relative option on the trigger select', () => {
    expect(triggerType.options?.some((o) => o.value === 'time_relative')).toBe(true);
  });

  it('maps each descriptor field to the right kind under the nested config.timeRelative block', () => {
    const byId = Object.fromEntries(trFields.map((f) => [f.id, f]));
    expect(byId['timeRelative.object'].kind).toBe('reference');
    expect(byId['timeRelative.dateField'].kind).toBe('text');
    expect(byId['timeRelative.withinDays'].kind).toBe('number');
    // Offset days is a number[] — a numberList so the designer emits numbers, not
    // strings (the backend schema is strict `z.array(z.number())`).
    expect(byId['timeRelative.offsetDays'].kind).toBe('numberList');
    expect(byId['timeRelative.filter'].kind).toBe('keyValue');
    expect(byId['timeRelative.maxRecords'].kind).toBe('number');
  });

  it('shows the descriptor fields only for a time_relative trigger', () => {
    const trNode = { id: 'start', type: 'start', config: { triggerType: 'time_relative' } };
    const schedNode = { id: 'start', type: 'start', config: { triggerType: 'schedule' } };
    for (const f of trFields) {
      expect(isFieldVisible(f, trNode, fields)).toBe(true);
      expect(isFieldVisible(f, schedNode, fields)).toBe(false);
    }
  });

  it('claims the whole config.timeRelative block so it never leaks to Advanced JSON', () => {
    for (const f of trFields) expect(configKeyOf(f)).toBe('timeRelative');
  });
});

describe('approval node config (ADR-0044)', () => {
  const fields = fieldsForNodeType('approval');

  it('surfaces maxRevisions as a number field (offline / fallback parity with the server schema)', () => {
    const maxRevisions = fields.find((f) => f.id === 'maxRevisions');
    expect(maxRevisions).toBeDefined();
    expect(maxRevisions!.kind).toBe('number');
    expect(maxRevisions!.path).toEqual(['config', 'maxRevisions']);
    // Always visible (no showWhen gating) so the guard is discoverable.
    expect(isFieldVisible(maxRevisions!, { id: 'a', type: 'approval' }, fields)).toBe(true);
  });
});


describe('wait node loose-config fallback (ADR-0044 showcase parity)', () => {
  const fields = fieldsForNodeType('wait');
  const eventType = fields.find((f) => f.id === 'waitEventConfig.eventType')!;
  const signalName = fields.find((f) => f.id === 'waitEventConfig.signalName')!;

  it('reads the canonical waitEventConfig shape', () => {
    const node = { id: 'w', type: 'wait', waitEventConfig: { eventType: 'signal', signalName: 'x' } };
    expect(getFieldValue(node, eventType)).toBe('signal');
    expect(getFieldValue(node, signalName)).toBe('x');
  });

  it('falls back to a loose config shape the engine also accepts', () => {
    // showcase_budget_approval authors the wait node as `config: { eventType, signalName }`.
    const node = { id: 'w', type: 'wait', config: { eventType: 'signal', signalName: 'budget_revision' } };
    expect(getFieldValue(node, eventType)).toBe('signal');
    expect(getFieldValue(node, signalName)).toBe('budget_revision');
    // The dependent field reveals because its controller resolves via the fallback.
    expect(isFieldVisible(signalName, node, fields)).toBe(true);
  });

  it('prefers the canonical path when both shapes are present', () => {
    const node = { id: 'w', type: 'wait', waitEventConfig: { eventType: 'timer' }, config: { eventType: 'signal' } };
    expect(getFieldValue(node, eventType)).toBe('timer');
  });
});

describe('loop / map collection is a plain expression field — no template mark (objectui#12390)', () => {
  // objectui#12390 — the single-brace `'template'` mark is retired with its
  // dialect. A value-slot collection (a `map`'s, a `loop`'s with a `body`)
  // renders the ledger's control, and a body-less loop's renders as the
  // expression field it is (the bare name); the analysis passes ask the spec's
  // ledger which of the two a stored collection is.
  for (const type of ['loop', 'map']) {
    it(`${type}.collection is an expression field with no refMode override`, () => {
      const collection = fieldsForNodeType(type).find((f) => f.id === 'collection')!;
      expect(collection.kind).toBe('expression');
      expect(collection.refMode).toBeUndefined();
    });
  }

  it('leaves genuine CEL predicates (start / decision condition) in bare-expression mode', () => {
    const startCond = fieldsForNodeType('start').find((f) => f.id === 'condition')!;
    expect(startCond.kind).toBe('expression');
    expect(startCond.refMode).toBeUndefined();
    const decisionCond = fieldsForNodeType('decision').find((f) => f.id === 'condition')!;
    expect(decisionCond.kind).toBe('expression');
    expect(decisionCond.refMode).toBeUndefined();
  });
});

describe('script node — the form authors what the executor runs (framework#4278, #4343)', () => {
  const fields = fieldsForNodeType('script');

  it('authors the function path — the only thing the node does', () => {
    for (const id of ['function', 'inputs', 'outputVariable']) {
      const f = fields.find((x) => x.id === id);
      expect(f, `script.${id} must be authorable`).toBeDefined();
      expect(f!.path).toEqual(['config', id]);
      // Unconditional now: there is no action type left to gate them behind.
      expect(f!.showWhen).toBeUndefined();
      expect(isFieldVisible(f!, { id: 's', type: 'script' }, fields)).toBe(true);
    }
    expect(fields.find((f) => f.id === 'inputs')!.kind).toBe('keyValue');
  });

  it('offers nothing else under config — the retired branches are not authorable', () => {
    // framework#4343: `actionType`'s built-in side effects were logger-backed
    // stubs that delivered nothing, inline `script` was never executed, and any
    // other action type was a second spelling of `function`.
    const offered = fields
      .filter((f) => f.path[0] === 'config' && f.showWhen?.field !== '__legacy__')
      .map((f) => f.id);
    expect(offered).toEqual(['function', 'inputs', 'outputVariable']);
  });

  it('drops the dead plural outputVariables field (declared-but-unread — nothing ever bound it)', () => {
    expect(fields.find((f) => f.id === 'outputVariables')).toBeUndefined();
  });

  it.each(['actionType', 'template', 'recipients', 'variables', 'script'])(
    'keeps retired `%s` render-only: hidden for new nodes, visible when stored',
    (id) => {
      const field = fields.find((f) => f.id === id)!;
      expect(field, `script.${id} must still render stored values`).toBeDefined();
      expect(field.showWhen).toEqual({ field: '__legacy__', equals: [] });
      expect(isFieldVisible(field, { id: 's', type: 'script' }, fields)).toBe(false);
      expect(
        isFieldVisible(field, { id: 's', type: 'script', config: { [id]: 'stored' } }, fields),
      ).toBe(true);
    },
  );

  it('a stored legacy email node still renders everything it carries', () => {
    // Stored values are never hidden — the rule that already covered the
    // `code` / `sms` / `notification` action types #3099 dropped.
    const node = { id: 's', type: 'script', config: { actionType: 'email', template: 'notify_owner' } };
    for (const id of ['actionType', 'template']) {
      expect(isFieldVisible(fields.find((f) => f.id === id)!, node, fields), id).toBe(true);
    }
  });
});

describe('notify node — first-class static config editor (#1895)', () => {
  const fields = fieldsForNodeType('notify');
  const ids = fields.map((f) => f.id);

  it('surfaces the core notify config fields (was empty — no static editor before)', () => {
    expect(fields.length).toBeGreaterThan(0);
    expect(ids).toEqual(
      expect.arrayContaining(['recipients', 'title', 'message', 'channels', 'topic', 'severity']),
    );
  });

  it('models recipients as the recipient picker, channels as stringList and message as textarea', () => {
    // objectui#11788 — recipients are picked (field / user / team / email), not typed.
    expect(fields.find((f) => f.id === 'recipients')!.kind).toBe('recipients');
    expect(fields.find((f) => f.id === 'channels')!.kind).toBe('stringList');
    expect(fields.find((f) => f.id === 'message')!.kind).toBe('textarea');
  });

  it('writes each field under node.config (matching the built-in node descriptor)', () => {
    for (const f of fields) {
      expect(f.path[0]).toBe('config');
    }
    expect(fields.find((f) => f.id === 'title')!.path).toEqual(['config', 'title']);
  });

  it('offers the descriptor severity levels', () => {
    const severity = fields.find((f) => f.id === 'severity')!;
    expect(severity.kind).toBe('select');
    expect(severity.options!.map((o) => o.value)).toEqual(['info', 'warning', 'critical']);
  });
});

/**
 * A published `configSchema` describes `node.config` and nothing else, so it must
 * not be allowed to delete the editors for a node's spec-structured SIBLING
 * blocks (framework#4045).
 *
 * This is a real incident, not a hypothetical: `connector_action` shipped a
 * descriptor whose `configSchema` declared `connectorId` / `actionId` / `input`
 * as CONFIG keys. Against a live backend the generated form replaced this
 * table's `connectorConfig.*` group — connector and action pickers included —
 * so an author configuring a connector node in Studio wrote the trio to
 * `node.config`, which the executor never reads, and the node refused to
 * dispatch with "connectorConfig.connectorId and .actionId are required".
 * framework#4210 retired that schema; these tests are what stop the next
 * mis-rooted schema from doing the same to `wait` or `boundary_event`, whose
 * whole contract lives in a sibling block.
 */
describe('server configSchema ↔ hand-written field merge (framework#4045)', () => {
  const serverConnectorFields: FlowConfigField[] = [
    { id: 'connectorId', path: ['config', 'connectorId'], label: 'Connector', kind: 'text' },
    { id: 'actionId', path: ['config', 'actionId'], label: 'Action', kind: 'text' },
    { id: 'input', path: ['config', 'input'], label: 'Input', kind: 'keyValue' },
  ];

  it('with no published schema, the hand-written group is used whole', () => {
    expect(mergeServerFlowFields(null, 'connector_action')).toEqual(fieldsForNodeType('connector_action'));
    expect(mergeServerFlowFields(undefined, 'wait')).toEqual(fieldsForNodeType('wait'));
  });

  it('the exact incident: a config-rooted connector schema cannot delete the connectorConfig pickers', () => {
    const merged = mergeServerFlowFields(serverConnectorFields, 'connector_action');

    // The structured editors survive, with their reference pickers intact.
    const connectorId = merged.find((f) => f.path.join('.') === 'connectorConfig.connectorId');
    const actionId = merged.find((f) => f.path.join('.') === 'connectorConfig.actionId');
    expect(connectorId, 'connectorConfig.connectorId must survive a published schema').toBeDefined();
    expect(actionId, 'connectorConfig.actionId must survive a published schema').toBeDefined();
    expect(connectorId!.kind).toBe('reference');
    expect(actionId!.ref?.kind).toBe('connector-action');

    // And the server's mis-rooted duplicates do NOT ALSO appear — two editors for
    // one value, one of them writing where nothing reads, is the same bug wearing
    // a different hat.
    expect(merged.filter((f) => f.path.join('.') === 'config.connectorId')).toEqual([]);
    expect(merged.filter((f) => f.path.join('.') === 'config.actionId')).toEqual([]);
    expect(merged.filter((f) => f.path.join('.') === 'config.input')).toEqual([]);
  });

  it('every node type with a sibling-block or top-level field keeps it under any schema', () => {
    // The latent blast radius, enumerated: if a schema is ever published for one
    // of these, this is what a plain replacement would have silently dropped.
    const serverFields: FlowConfigField[] = [
      { id: 'whatever', path: ['config', 'whatever'], label: 'Whatever', kind: 'text' },
    ];
    for (const type of ['connector_action', 'wait', 'boundary_event', 'subflow', 'script', 'http']) {
      const nonConfig = fieldsForNodeType(type).filter((f) => f.path[0] !== 'config');
      expect(nonConfig.length, `${type} should have sibling/top-level fields to protect`).toBeGreaterThan(0);
      const merged = mergeServerFlowFields(serverFields, type);
      for (const f of nonConfig) {
        expect(
          merged.some((m) => m.path.join('.') === f.path.join('.')),
          `${type}: ${f.path.join('.')} was dropped by the published schema`,
        ).toBe(true);
      }
    }
  });

  it('the server still owns the config-rooted fields', () => {
    // The other direction: the engine is the authority on what the executor
    // reads, so its config fields replace the hand-written ones rather than
    // merging with them — a stale client key must not linger.
    const merged = mergeServerFlowFields(
      [{ id: 'brandNew', path: ['config', 'brandNew'], label: 'Brand new', kind: 'text' }],
      'http',
    );
    expect(merged.some((f) => f.path.join('.') === 'config.brandNew')).toBe(true);
    // `url` is in the hand-written http group but not in this schema.
    expect(merged.some((f) => f.path.join('.') === 'config.url')).toBe(false);
    // …while the top-level timeoutMs, which no configSchema can describe, stays.
    expect(merged.some((f) => f.path.join('.') === 'timeoutMs')).toBe(true);
  });
});
