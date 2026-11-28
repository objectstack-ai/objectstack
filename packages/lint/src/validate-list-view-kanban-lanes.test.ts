// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#28018] `kanban.lanes`, judged against the bound object: every entry is an
// inline option of `groupByField`, and no value is listed twice. The spec
// states each entry's grammar and that the list is not empty; it cannot see the
// object, so these two verdicts live beside the one that judges `groupByField`.

import { describe, expect, it } from 'vitest';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';
import {
  validateListViewFieldRefs,
  LIST_VIEW_FIELD_UNKNOWN,
  LIST_VIEW_KANBAN_LANE_UNKNOWN,
  LIST_VIEW_KANBAN_LANE_REPEATED,
  LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL,
} from './validate-list-view-field-refs.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { explainRule } from './rule-explanations.js';

type AnyRec = Record<string, unknown>;

const STATUS_OPTIONS = [
  { label: 'Not Started', value: 'not_started' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Waiting', value: 'waiting' },
  { label: 'Completed', value: 'completed' },
];

const OBJECTS = [
  {
    name: 'crm_task',
    label: 'Task',
    fields: {
      subject: { type: 'text', label: 'Subject' },
      status: { type: 'select', label: 'Status', options: STATUS_OPTIONS },
      industry: { type: 'select', label: 'Industry', picklist: 'industry' },
      is_completed: { type: 'boolean', label: 'Completed' },
    },
  },
];

/** The HotCRM task board: the view keeps completed tasks out, so it leaves the Completed lane off. */
const TASK_BOARD: AnyRec = {
  name: 'task_board',
  type: 'kanban',
  data: { provider: 'object', object: 'crm_task' },
  columns: ['subject'],
  filter: [{ field: 'is_completed', operator: 'equals', value: false }],
  kanban: {
    groupByField: 'status',
    columns: ['subject'],
    lanes: ['not_started', 'in_progress', 'waiting'],
  },
};

function board(kanban: AnyRec): AnyRec {
  return { ...TASK_BOARD, kanban: { ...(TASK_BOARD.kanban as AnyRec), ...kanban } };
}

function stackWith(listView: AnyRec, objects: unknown = OBJECTS): AnyRec {
  return { name: 'probe', objects, views: [{ name: 'crm_task', object: 'crm_task', list: listView }] };
}

const laneFindings = (listView: AnyRec, objects?: unknown) =>
  validateListViewFieldRefs(stackWith(listView, objects)).filter(
    (f) => f.rule === LIST_VIEW_KANBAN_LANE_UNKNOWN || f.rule === LIST_VIEW_KANBAN_LANE_REPEATED,
  );

describe('#28018 — kanban.lanes judged against the group field', () => {
  it('a lane list naming options of the group field is silent, in any order and any subset', () => {
    expect(validateListViewFieldRefs(stackWith(TASK_BOARD))).toEqual([]);
    expect(laneFindings(board({ lanes: ['completed', 'not_started'] }))).toEqual([]);
  });

  it('a lane that is not an option is an error at its own entry, naming the nearest option', () => {
    const findings = laneFindings(board({ lanes: ['not_started', 'inprogress', 'waiting'] }));
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [LIST_VIEW_KANBAN_LANE_UNKNOWN, 'error', 'views[0].list.kanban.lanes[1]'],
    ]);
    expect(findings[0].message).toContain('"crm_task.status"');
    expect(findings[0].message).toContain('Did you mean "in_progress"?');
  });

  it('an option LABEL in place of its stored value is not an option', () => {
    // The spec refuses this spelling by grammar; `os lint` judges the raw
    // input without parsing, so the object-aware verdict must name it too.
    const findings = laneFindings(board({ lanes: ['In Progress'] }));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [LIST_VIEW_KANBAN_LANE_UNKNOWN, 'views[0].list.kanban.lanes[0]'],
    ]);
  });

  it('a value listed twice is an error at the second entry — judged with no field map at all', () => {
    const repeated = board({ lanes: ['waiting', 'in_progress', 'waiting'] });
    const expected = [[LIST_VIEW_KANBAN_LANE_REPEATED, 'error', 'views[0].list.kanban.lanes[2]']];
    expect(laneFindings(repeated).map((f) => [f.rule, f.severity, f.path])).toEqual(expected);
    // No object universe: every field position switches off, this verdict does not.
    expect(laneFindings(repeated, []).map((f) => [f.rule, f.severity, f.path])).toEqual(expected);
  });

  it.each([
    ['a shared picklist', 'industry', ['anything_at_all']],
    ['a boolean (no options: its lanes are values)', 'is_completed', ['yes']],
  ])('a group field whose options come from %s is not judged', (_label, groupByField, lanes) => {
    expect(laneFindings(board({ groupByField, lanes }))).toEqual([]);
  });

  it('a groupByField naming no field is reported once, at groupByField, and its lanes are not judged', () => {
    const findings = validateListViewFieldRefs(stackWith(board({ groupByField: 'statuss', lanes: ['nope_lane'] })));
    expect(findings.map((f) => [f.rule, f.path])).toEqual([
      [LIST_VIEW_FIELD_UNKNOWN, 'views[0].list.kanban.groupByField'],
    ]);
  });

  for (const command of ['validate', 'build'] as const) {
    it(`a lane that is not an option fails \`${command}\``, () => {
      const normalized = stackWith(board({ lanes: ['inprogress'] }));
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized }));
      expect(errors.map((f) => f.rule)).toContain(LIST_VIEW_KANBAN_LANE_UNKNOWN);
    });
  }

  it('reaches the runtime save door through the reference-integrity suite', () => {
    const findings = validateReferenceIntegrity(
      stackWith(board({ lanes: ['inprogress', 'waiting', 'waiting'] })),
      { runtimeWriteType: 'view' },
    );
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain(LIST_VIEW_KANBAN_LANE_UNKNOWN);
    expect(rules).toContain(LIST_VIEW_KANBAN_LANE_REPEATED);
  });

  it('`os explain` carries the reasoning for both ids, and each verdict and fix is one short line', () => {
    for (const rule of [LIST_VIEW_KANBAN_LANE_UNKNOWN, LIST_VIEW_KANBAN_LANE_REPEATED]) {
      expect(explainRule(rule), `no \`os explain\` entry for ${rule}`).toBeDefined();
    }
    const unknown = explainRule(LIST_VIEW_KANBAN_LANE_UNKNOWN)!.paragraphs.join('\n');
    for (const fact of ['`Uncategorized`', '`picklist`', 'filter the view']) {
      expect(unknown, fact).toContain(fact);
    }
    const fired = validateListViewFieldRefs(stackWith(board({ lanes: ['inprogress', 'waiting', 'waiting'] })));
    expect(fired).toHaveLength(2);
    for (const f of fired) {
      for (const line of [f.message, f.hint]) {
        expect(line).not.toContain('\n');
        expect(line.length, line).toBeLessThanOrEqual(200);
      }
    }
  });
});

describe('#35143 — a board grouped by a field with no lanes of its own', () => {
  const GROUP_OBJECTS = [
    {
      name: 'crm_task',
      label: 'Task',
      fields: {
        subject: { type: 'text', label: 'Subject' },
        status: { type: 'select', label: 'Status', options: STATUS_OPTIONS },
        stage: { type: 'radio', label: 'Stage', options: STATUS_OPTIONS },
        is_completed: { type: 'boolean', label: 'Completed' },
        owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
        amount: { type: 'number', label: 'Amount' },
        due_date: { type: 'date', label: 'Due' },
        tags: { type: 'multiselect', label: 'Tags', options: STATUS_OPTIONS },
        watchers: { type: 'lookup', label: 'Watchers', reference: 'sys_user', multiple: true },
      },
    },
  ];
  const groupedBy = (groupByField: string, type = 'kanban'): AnyRec => ({
    ...TASK_BOARD,
    type,
    kanban: { groupByField, columns: ['subject'] },
  });
  const groupFindings = (listView: AnyRec) =>
    validateListViewFieldRefs(stackWith(listView, GROUP_OBJECTS)).filter(
      (f) => f.rule === LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL,
    );

  it.each(['status', 'stage', 'is_completed', 'owner'])('a board grouped by `%s` (a fixed set of lanes) is silent', (field) => {
    expect(groupFindings(groupedBy(field))).toEqual([]);
  });

  it.each([
    ['amount', 'number', 'distinct value'],
    ['due_date', 'date', 'distinct value'],
    ['subject', 'text', 'distinct value'],
    ['tags', 'multiselect', 'multi-valued'],
    ['watchers', 'lookup', 'multi-valued'],
  ])('a board grouped by `%s` (a %s field) is a warning at groupByField that names the fix', (field, type, phrase) => {
    const findings = groupFindings(groupedBy(field));
    expect(findings.map((f) => [f.severity, f.path])).toEqual([['warning', 'views[0].list.kanban.groupByField']]);
    expect(findings[0].message).toContain(`\`${type}\``);
    expect(findings[0].message).toContain(phrase);
    expect(findings[0].hint).toContain('`select`');
    for (const line of [findings[0].message, findings[0].hint]) expect(line.length, line).toBeLessThanOrEqual(200);
  });

  it('a kanban block on a non-kanban view, a dotted and an unknown group field are not judged', () => {
    expect(groupFindings(groupedBy('amount', 'grid'))).toEqual([]);
    expect(groupFindings(groupedBy('owner.name'))).toEqual([]);
    expect(groupFindings(groupedBy('nothing_here'))).toEqual([]);
  });

  for (const command of ['validate', 'build'] as const) {
    it(`is advisory on \`${command}\`: reported, never an error`, () => {
      const findings = runAuthoringRules(command, { normalized: stackWith(groupedBy('amount'), GROUP_OBJECTS) });
      const { errors, advisories } = splitBySeverity(findings);
      expect(advisories.map((f) => f.rule)).toContain(LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL);
      expect(errors.map((f) => f.rule)).not.toContain(LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL);
    });
  }

  it('rides the runtime `view` door as an advisory, and is silent once grouped by a select', () => {
    const item = { name: 'crm_task', object: 'crm_task', list: groupedBy('amount') };
    const lit = runRuntimeAuthoringRules({ type: 'view', item, context: { objects: GROUP_OBJECTS } });
    expect(lit.errors).toEqual([]);
    expect(lit.advisories.map((f) => f.rule)).toEqual([LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL]);
    const fixed = runRuntimeAuthoringRules({
      type: 'view',
      item: { ...item, list: groupedBy('status') },
      context: { objects: GROUP_OBJECTS },
    });
    expect(fixed.advisories.map((f) => f.rule)).not.toContain(LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL);
  });

  it('`os explain` carries the reasoning', () => {
    const text = explainRule(LIST_VIEW_KANBAN_GROUP_FIELD_UNCATEGORICAL)!.paragraphs.join('\n');
    for (const fact of ['`select`', 'multi-valued', 'dragged']) expect(text, fact).toContain(fact);
  });
});
