// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The capability-tag checks and the agent-action exposure check, each held to
 * DISCRIMINATE: one rich build carries every capability the closed table can
 * judge, every row passes on it, and each degradation — one defect written into
 * a copy of the parsed artifact, the way a faulty producer would leave it —
 * fails exactly the tag (or action check) it targets and scores the card
 * strictly lower. A check that cannot tell those builds apart is the
 * "every build scores 1.00" blind spot of cloud#2146.
 */

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';

import { DEFAULT_METADATA_EVAL_CORPUS } from '../../../../cli/src/lint/corpus.js';
import { formatRefusal, loadScenarios, readCapabilityAreas } from '../../src/loader.js';
import {
  CAPABILITY_TAG_CHECKS,
  gradeCapabilityTags,
  readArtifactFacts,
  scoreScenarioArtifact,
  type ScenarioArtifactCard,
} from '../../src/score/scenario-tags.js';

type Bag = Record<string, any>;

const HERE = dirname(fileURLToPath(import.meta.url));
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');
const SCENARIOS_DIR = resolve(HERE, '../../../../../docs/qa/scenarios');

const MEASURE = 'task_count';

/**
 * The project/tasks golden fixture, completed with every capability the table
 * judges, parsed as `os build` parses it; `edit` changes the stack before the
 * parse, so what it adds is held to the spec's shape.
 */
function richArtifact(edit?: (stack: Bag) => void): Bag {
  const fixture = DEFAULT_METADATA_EVAL_CORPUS.find((c) => c.id === 'project_with_tasks')!.fixture;
  const stack = structuredClone(fixture) as Bag;
  stack.objects[0].fields.sponsor = { type: 'user', label: 'Sponsor' };
  stack.objects[1].fields.blocked_by = { type: 'lookup', label: 'Blocked By', reference: 'task' };
  stack.objects[1].fields.estimate_days = { type: 'formula', label: 'Estimate (days)', expression: 'record.estimate_hours / 8', returnType: 'number' };
  stack.objects[1].validations = [
    { name: 'estimate_not_negative', type: 'script', condition: 'record.estimate_hours < 0', message: 'An estimate cannot be negative.' },
  ];
  stack.permissions = [{
    name: 'pm_contractor',
    label: 'Contractor',
    objects: { project: { allowRead: true }, task: { allowRead: true } },
    fields: { 'task.estimate_hours': { readable: false, editable: false } },
  }];
  stack.flows = [
    {
      name: 'project_approval',
      label: 'Project Approval',
      type: 'autolaunched',
      status: 'active',
      // Started on a project record (an action of type flow), not by a trigger:
      // the approval and the record trigger below are judged apart. Two steps:
      // the project's sponsor (a user field of the record), then a manager.
      variables: [{ name: 'recordId', type: 'text', isInput: true, objectName: 'project' }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'field', value: 'sponsor' }], behavior: 'first_response' } },
        { id: 'sign_off', type: 'approval', label: 'Sign-off', config: { approvers: [{ type: 'position', value: 'manager' }], behavior: 'first_response' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'sign_off', label: 'approve' },
        { id: 'e3', source: 'review', target: 'end', label: 'reject' },
        { id: 'e4', source: 'sign_off', target: 'end', label: 'approve' },
        { id: 'e5', source: 'sign_off', target: 'end', label: 'reject' },
      ],
    },
    {
      name: 'task_created',
      label: 'Task Created',
      type: 'autolaunched',
      status: 'active',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-after-create' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    },
  ];
  stack.datasets = [{
    name: 'task_metrics',
    label: 'Task Metrics',
    object: 'task',
    dimensions: [{ name: 'status', label: 'Status', field: 'status' }],
    measures: [{ name: MEASURE, label: 'Tasks', aggregate: 'count' }],
  }];
  stack.dashboards = [{
    name: 'project_overview',
    label: 'Overview',
    widgets: [{ id: 'tasks', title: 'Tasks', type: 'metric', dataset: 'task_metrics', values: [MEASURE] }],
  }];
  stack.reports = [{ name: 'tasks_by_status', label: 'Tasks by Status', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: [MEASURE] }];
  stack.actions = [
    { name: 'set_task_status', label: 'Set Status', objectName: 'task', type: 'script', target: 'set_task_status', ai: { exposed: true, description: 'Move one task of a project to another workflow status.' } },
    { name: 'delete_task', label: 'Delete Task', objectName: 'task', type: 'script', target: 'delete_task', ai: { exposed: true, description: 'Delete one task of a project; irreversible, so ask the user first.', requiresConfirmation: true } },
  ];
  stack.requires = ['automation', 'triggers'];
  edit?.(stack);
  const parsed = ObjectStackDefinitionSchema.safeParse(normalizeStackInput(stack));
  if (!parsed.success) {
    throw new Error(`rich fixture does not parse: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return JSON.parse(JSON.stringify(parsed.data)) as Bag;
}

const ALL_TAGS = Object.keys(CAPABILITY_TAG_CHECKS);

const CARD: ScenarioArtifactCard = {
  expect: { objects: ['project', 'task'], minFieldsPerObject: 2, lookups: [{ object: 'task', field: 'project', to: 'project' }] },
  capabilities: ALL_TAGS,
  run: {
    personas: [
      {
        id: 'contractor',
        role: 'Contractor',
        hidden: { fields: [{ object: 'task', field: 'estimate_hours' }] },
        scope: [{ object: 'project', field: 'owner', value: 'u_kim' }],
      },
      { id: 'manager', role: 'Manager', hidden: { objects: ['project'] } },
    ],
    agentActions: [
      { name: 'set_task_status', object: 'task', summary: 'Move a task to another status.', confirm: false },
      { name: 'delete_task', object: 'task', summary: 'Delete a task; irreversible.', confirm: true },
    ],
  },
};

const field = (a: Bag, object: string, name: string): Bag => (a.objects as Bag[]).find((o) => o.name === object)!.fields[name];

/** One defect each, keyed by the tag it must fail. */
const TAG_DEGRADATIONS: Record<string, Record<string, (a: Bag) => void>> = {
  'records-forms.lookup': {
    'no lookup field': (a) => { delete (a.objects[1] as Bag).fields.blocked_by; },
    'dangling lookup target': (a) => { field(a, 'task', 'blocked_by').reference = 'no_such_object'; },
  },
  'records-forms.master-detail-inline-edit': {
    'master-detail not edited inline': (a) => { delete field(a, 'task', 'project').inlineEdit; },
    'dangling master-detail target': (a) => { field(a, 'task', 'project').reference = 'no_such_object'; },
  },
  'records-forms.roll-up-summary': {
    'no roll-up': (a) => {
      delete (a.objects[0] as Bag).fields.task_count;
      delete (a.objects[0] as Bag).fields.total_estimate;
    },
    'roll-up over a missing child': (a) => { field(a, 'project', 'total_estimate').summaryOperations.object = 'no_such_object'; },
    'roll-up over a missing child field': (a) => { field(a, 'project', 'total_estimate').summaryOperations.field = 'no_such_field'; },
  },
  'records-forms.select-options': {
    'optionless select': (a) => { field(a, 'task', 'status').options = []; },
  },
  'records-forms.formula-field': {
    'no computed field': (a) => { delete (a.objects[1] as Bag).fields.estimate_days; },
    'formula that does not compile': (a) => { field(a, 'task', 'estimate_days').expression.source = 'record.estimate_hours /'; },
    'formula over a field its object lacks': (a) => { field(a, 'task', 'estimate_days').expression.source = 'record.no_such_field / 8'; },
  },
  'records-forms.validation-rule': {
    'no validation rule': (a) => { delete (a.objects[1] as Bag).validations; },
    'rule that does not compile': (a) => { a.objects[1].validations[0].condition.source = 'record.estimate_hours <'; },
    'rule over a field its object lacks': (a) => { a.objects[1].validations[0].condition.source = 'record.no_such_field < 0'; },
    'advisory rule only': (a) => { a.objects[1].validations[0].severity = 'warning'; },
    'inactive rule only': (a) => { a.objects[1].validations[0].active = false; },
  },
  'access-security.field-permissions': {
    'hidden field readable': (a) => { a.permissions[0].fields['task.estimate_hours'].readable = true; },
    'no permission set': (a) => { a.permissions = []; },
  },
  'access-security.row-scope': {
    'scoped object public': (a) => { (a.objects[0] as Bag).sharingModel = 'public_read_write'; },
  },
  'access-security.row-level-security': {
    'scoped object readable by all, no read policy': (a) => { (a.objects[0] as Bag).sharingModel = 'public_read'; },
  },
  'approvals.approval-flow': {
    'no approval node': (a) => {
      a.flows[0].nodes = a.flows[0].nodes.filter((n: Bag) => n.type !== 'approval');
    },
    'approval bound to a missing object': (a) => { a.flows[0].variables[0].objectName = 'no_such_object'; },
    'approval bound to no object the card names': (a) => { a.flows[0].variables[0].objectName = 'sys_user'; },
  },
  'approvals.multi-step-approval': {
    'one approval step': (a) => {
      a.flows[0].nodes = a.flows[0].nodes.filter((n: Bag) => n.id !== 'sign_off');
      a.flows[0].edges = [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'end', label: 'approve' },
        { id: 'e3', source: 'review', target: 'end', label: 'reject' },
      ];
    },
    'second approval on the reject branch': (a) => {
      a.flows[0].edges.find((e: Bag) => e.id === 'e2').target = 'end';
      a.flows[0].edges.find((e: Bag) => e.id === 'e3').target = 'sign_off';
    },
  },
  'approvals.dynamic-approver-routing': {
    'fixed approver': (a) => { a.flows[0].nodes[1].config.approvers = [{ type: 'user', value: 'u_kim' }]; },
    'field approver over a field that holds no user': (a) => { a.flows[0].nodes[1].config.approvers[0].value = 'name'; },
    'field approver over a field the object lacks': (a) => { a.flows[0].nodes[1].config.approvers[0].value = 'no_such_field'; },
  },
  'automation.record-triggered-flow': {
    'no record trigger': (a) => { a.flows[1].nodes[0].config = {}; },
    'record trigger on a missing object': (a) => { a.flows[1].nodes[0].config.objectName = 'no_such_object'; },
  },
  'dashboards.widget-measures': {
    'dangling widget measure': (a) => { a.dashboards[0].widgets[0].values = ['no_such_measure']; },
    'no dashboard': (a) => { a.dashboards = []; },
  },
  'dashboards.report': {
    'no report': (a) => { a.reports = []; },
    'report over a dataset the build lacks': (a) => { a.reports[0].dataset = 'no_such_dataset'; },
    'report selecting a measure its dataset lacks': (a) => { a.reports[0].values = ['no_such_measure']; },
    'report on no object the card names': (a) => { a.datasets[0].object = 'sys_user'; },
  },
  'ai.agent-actions': {
    'declared action not exposed': (a) => { a.actions[0].ai.exposed = false; },
  },
};

/**
 * A defect that breaks a second capability by construction: the roll-ups read
 * their child through the master-detail, so a dangling master-detail also
 * leaves them relating to nothing; the steps and the record-routed approver
 * are the approval flow's own, so a flow with no approval, or bound away from
 * the card's objects, takes them along; and an object every persona reads in
 * full keeps no row to anyone, under either row tag.
 */
const ALSO_FAILS: Record<string, readonly string[]> = {
  'dangling master-detail target': ['records-forms.roll-up-summary'],
  'no approval node': ['approvals.multi-step-approval', 'approvals.dynamic-approver-routing'],
  'approval bound to a missing object': ['approvals.multi-step-approval', 'approvals.dynamic-approver-routing'],
  'approval bound to no object the card names': ['approvals.multi-step-approval', 'approvals.dynamic-approver-routing'],
  'scoped object public': ['access-security.row-level-security'],
  'scoped object readable by all, no read policy': ['access-security.row-scope'],
};

/** One defect each, keyed by the action check it must fail. */
const ACTION_DEGRADATIONS: Record<string, (a: Bag) => void> = {
  'action:task.delete_task->exists': (a) => { a.actions = a.actions.filter((x: Bag) => x.name !== 'delete_task'); },
  'action:task.set_task_status->ai-exposed': (a) => { a.actions[0].ai.exposed = false; },
  'action:task.delete_task->confirm-gated': (a) => { delete a.actions[1].ai.requiresConfirmation; },
};

describe('the closed tag table', () => {
  it('names only checklist areas — the closed set the card loader reads from the tree', () => {
    const areas = new Set(readdirSync(AREAS_DIR).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length)));
    expect(areas.size).toBeGreaterThan(0);
    for (const tag of ALL_TAGS) expect(areas.has(tag.slice(0, tag.indexOf('.'))), tag).toBe(true);
  });

  it('reports a tag with no row unscored, never a pass, and counts it nowhere', () => {
    const artifact = richArtifact();
    const card = { ...CARD, capabilities: ['ai.ask-data', 'approvals.anything-else'] };
    const s = scoreScenarioArtifact(artifact, card);
    expect(s.tags.map((t) => t.status)).toEqual(['unscored', 'unscored']);
    expect(s.unscored).toEqual([
      { tag: 'ai.ask-data', reason: 'no check in the closed tag table' },
      { tag: 'approvals.anything-else', reason: 'no check in the closed tag table' },
    ]);
    // Not an area prefix: `approvals.approval-flow` passes on this build, yet a
    // sibling tag in its area is still unscored.
    const withRow = scoreScenarioArtifact(artifact, { ...CARD, capabilities: [] });
    expect(s.total).toBe(withRow.total);
  });

  it('reports a row with nothing in the card to judge unscored, not a pass', () => {
    const verdicts = gradeCapabilityTags(readArtifactFacts(richArtifact()), {
      ...CARD,
      capabilities: ['access-security.field-permissions', 'access-security.row-scope', 'access-security.row-level-security', 'ai.agent-actions'],
      run: { personas: [{ id: 'p', role: 'Partner', hidden: { objects: ['project'] } }] },
    });
    expect(verdicts.map((v) => [v.status, v.checks.length])).toEqual([['unscored', 0], ['unscored', 0], ['unscored', 0], ['unscored', 0]]);
  });
});

describe('capability tags — discrimination over a rich build', () => {
  const intact = scoreScenarioArtifact(richArtifact(), CARD);

  it('passes every row of the table, and every agent action, on the intact build', () => {
    expect(intact.tags.map((t) => [t.tag, t.status])).toEqual(ALL_TAGS.map((t) => [t, 'pass']));
    expect(intact.agentActions.every((c) => c.pass)).toBe(true);
    expect(intact.agentActions).toHaveLength(5);
    expect(intact.score).toBe(1);
  });

  for (const [tag, variants] of Object.entries(TAG_DEGRADATIONS)) {
    for (const [name, degrade] of Object.entries(variants)) {
      it(`${tag}: ${name} fails that tag (and only what it breaks) and scores lower`, () => {
        const artifact = richArtifact();
        degrade(artifact);
        const s = scoreScenarioArtifact(artifact, CARD);
        const failed = s.tags.filter((t) => t.status !== 'pass').map((t) => t.tag);
        expect(failed.sort()).toEqual([tag, ...(ALSO_FAILS[name] ?? [])].sort());
        expect(s.score!).toBeLessThan(intact.score!);
      });
    }
  }

  it('has a degradation for every row of the table', () => {
    expect(Object.keys(TAG_DEGRADATIONS).sort()).toEqual([...ALL_TAGS].sort());
  });
});

describe('row scope — a public object narrowed for the persona by a read policy on its permission set', () => {
  // The faithful build of the first live run (card #30883, corrected in
  // 6682060124): the object stays `public_read`, and the persona's own
  // permission set carries a `select` policy whose `using` ANDs into its reads.
  const ownProjects = { name: 'own_projects', object: 'project', operation: 'select', using: 'owner == current_user.id' };
  const narrowed = () =>
    richArtifact((stack) => {
      stack.objects[0].sharingModel = 'public_read';
      stack.permissions[0].rowLevelSecurity = [ownProjects];
    });
  const rowScope = (a: Bag, namespace?: string) =>
    gradeCapabilityTags(readArtifactFacts(a), { ...CARD, capabilities: ['access-security.row-scope'] }, namespace === undefined ? {} : { namespace })[0]!;

  it("passes when the persona's set (`<namespace>_<persona>`) carries the policy, and the spec keeps it through the parse", () => {
    const a = narrowed();
    expect(a.permissions[0].rowLevelSecurity).toEqual([expect.objectContaining(ownProjects)]);
    expect(rowScope(a, 'pm')).toEqual({
      tag: 'access-security.row-scope',
      status: 'pass',
      checks: [{ check: 'row-scope:project->scoped', pass: true, detail: 'sharingModel public_read; narrowed by a read policy on pm_contractor' }],
    });
  });

  it('a private object passes with no policy at all (control: the sharing model alone still scopes)', () => {
    expect(rowScope(richArtifact(), 'pm').status).toBe('pass');
  });

  const breaks: Record<string, (a: Bag) => void> = {
    'no policy': (a) => { delete a.permissions[0].rowLevelSecurity; },
    'the policy is disabled': (a) => { a.permissions[0].rowLevelSecurity[0].enabled = false; },
    'the policy narrows writes only': (a) => { a.permissions[0].rowLevelSecurity[0].operation = 'update'; },
    'the policy is on another object': (a) => { a.permissions[0].rowLevelSecurity[0].object = 'task'; },
    'the policy applies only to a position the persona does not hold': (a) => { a.permissions[0].rowLevelSecurity[0].positions = ['manager']; },
    'a sibling read policy admits every row': (a) => { a.permissions[0].rowLevelSecurity.push({ name: 'all_projects', object: '*', operation: 'all', using: 'true', enabled: true }); },
    "the policy sits on a set that is not the persona's": (a) => { a.permissions[0].name = 'pm_manager'; },
  };
  for (const [name, degrade] of Object.entries(breaks)) {
    it(`fails when ${name}`, () => {
      const a = narrowed();
      degrade(a);
      const v = rowScope(a, 'pm');
      expect(v.status).toBe('fail');
      expect(v.checks[0]!.detail).toMatch(/^sharingModel public_read, and no read policy narrows it on pm_contractor$/);
    });
  }

  it('reads the set by the bare persona id when no namespace is given (so `pm_contractor` is not it)', () => {
    expect(rowScope(narrowed()).status).toBe('fail');
  });
});

describe('agent actions — a declared action the build does not expose fails', () => {
  for (const [target, degrade] of Object.entries(ACTION_DEGRADATIONS)) {
    it(`${target} fails on its own defect`, () => {
      const artifact = richArtifact();
      degrade(artifact);
      const s = scoreScenarioArtifact(artifact, CARD);
      expect(s.agentActions.find((c) => c.check === target)?.pass).toBe(false);
      expect(s.score!).toBeLessThan(1);
    });
  }

  it('fails every check of an action the build lacks — none is skipped', () => {
    const artifact = richArtifact();
    artifact.actions = [];
    const s = scoreScenarioArtifact(artifact, CARD);
    expect(s.agentActions.map((c) => [c.check, c.pass])).toEqual([
      ['action:task.set_task_status->exists', false],
      ['action:task.set_task_status->ai-exposed', false],
      ['action:task.delete_task->exists', false],
      ['action:task.delete_task->ai-exposed', false],
      ['action:task.delete_task->confirm-gated', false],
    ]);
  });

  it('reads the declared confirmation flag, not the delete-mode listing heuristic', () => {
    const artifact = richArtifact();
    delete artifact.actions[1].ai.requiresConfirmation;
    artifact.actions[1].mode = 'delete';
    const s = scoreScenarioArtifact(artifact, CARD);
    expect(s.agentActions.find((c) => c.check === 'action:task.delete_task->confirm-gated')?.pass).toBe(false);
  });

  it('finds an action written on its object, and lets it win over a standalone one of the same name', () => {
    const artifact = richArtifact();
    const task = (artifact.objects as Bag[]).find((o) => o.name === 'task')!;
    task.actions = [structuredClone(artifact.actions[1])];
    artifact.actions[1].ai.exposed = false;
    const s = scoreScenarioArtifact(artifact, CARD);
    expect(s.agentActions.find((c) => c.check === 'action:task.delete_task->ai-exposed')?.pass).toBe(true);
  });
});

/** One tag's verdict over an artifact, for the per-row suites below. */
const grade = (a: Bag, tag: string, card: ScenarioArtifactCard = CARD, namespace?: string) =>
  gradeCapabilityTags(readArtifactFacts(a), { ...card, capabilities: [tag] }, namespace === undefined ? {} : { namespace })[0]!;
const pairs = (v: { checks: Array<{ check: string; pass: boolean }> }) => v.checks.map((c) => [c.check, c.pass]);

describe('formula field — a computed field whose expression compiles', () => {
  const formula = (a: Bag) => grade(a, 'records-forms.formula-field');

  it('judges each computed field by the validator `os build` runs', () => {
    expect(pairs(formula(richArtifact()))).toEqual([['computed-field-exists', true], ['formula:task.estimate_days->compiles', true]]);
  });

  it('counts a stored field computed from an `expression` (the kind a roll-up can sum), held to compile the same way', () => {
    const a = richArtifact((stack) => {
      delete stack.objects[1].fields.estimate_days;
      stack.objects[1].fields.estimate_cost = { type: 'number', label: 'Estimate Cost', expression: 'record.estimate_hours * 100' };
    });
    expect(pairs(formula(a))).toEqual([['computed-field-exists', true], ['formula:task.estimate_cost->compiles', true]]);
    a.objects[1].fields.estimate_cost.expression.source = 'record.estimate_hours *';
    expect(formula(a).status).toBe('fail');
  });

  it('reads one hop through a reference, and refuses two (the formula read path preloads one)', () => {
    const hop = (source: string) => formula(richArtifact((stack) => {
      stack.objects[1].fields.estimate_days = { type: 'formula', label: 'Project', expression: source, returnType: 'text' };
    }));
    expect(hop('record.project.name').status).toBe('pass');
    const two = hop('record.project.sponsor.name');
    expect(two.status).toBe('fail');
    expect(two.checks[1]!.detail).toMatch(/hop/);
  });

  it('fails a `formula` field with no expression, never compiles it vacuously', () => {
    const a = richArtifact();
    delete field(a, 'task', 'estimate_days').expression;
    expect(formula(a).checks[1]).toEqual({ check: 'formula:task.estimate_days->compiles', pass: false, detail: 'declares no expression' });
  });
});

describe('validation rule — a refusing rule on an object the card names, every predicate compiling', () => {
  const rule = (a: Bag, card: ScenarioArtifactCard = CARD) => grade(a, 'records-forms.validation-rule', card);

  it('passes on the intact build', () => {
    expect(pairs(rule(richArtifact()))).toEqual([
      ['validation:task.estimate_not_negative->compiles', true],
      ['validation-rule-binds-expected-object', true],
    ]);
  });

  it('fails when the only refusing rule is on an object the card does not name', () => {
    const v = rule(richArtifact(), { ...CARD, expect: { ...CARD.expect, objects: ['project'] } });
    expect(pairs(v)).toEqual([
      ['validation:task.estimate_not_negative->compiles', true],
      ['validation-rule-binds-expected-object', false],
    ]);
  });

  it("judges a conditional rule's `when` and the predicates of the rule in its `then`", () => {
    const a = richArtifact((stack) => {
      stack.objects[1].validations.push({
        name: 'done_needs_estimate',
        type: 'conditional',
        when: "record.status == 'done'",
        message: 'A done task needs an estimate.',
        then: { name: 'estimate_set', type: 'script', condition: 'record.estimate_hours == null', message: 'Set the estimate.' },
      });
    });
    expect(rule(a).status).toBe('pass');
    a.objects[1].validations[1].then.condition.source = 'record.no_such_field == null';
    expect(pairs(rule(a))).toEqual([
      ['validation:task.estimate_not_negative->compiles', true],
      ['validation:task.done_needs_estimate->compiles', false],
      ['validation-rule-binds-expected-object', true],
    ]);
  });

  it('counts a rule with no predicate (a state machine) toward the binding, with nothing to compile', () => {
    const a = richArtifact((stack) => {
      stack.objects[1].validations = [
        { name: 'status_flow', type: 'state_machine', field: 'status', transitions: { todo: ['in_progress'], in_progress: ['done'] }, message: 'One step at a time.' },
      ];
    });
    expect(pairs(rule(a))).toEqual([['validation-rule-binds-expected-object', true]]);
  });
});

describe('multi-step approval — a second Approval node after the first approves', () => {
  const steps = (a: Bag) => grade(a, 'approvals.multi-step-approval');

  it('names the two steps on the intact build', () => {
    expect(steps(richArtifact()).checks).toEqual([
      { check: 'multi-step-approval-binds-expected-object', pass: true, detail: 'project_approval on project: review then sign_off' },
    ]);
  });

  it('follows a decision between the two steps', () => {
    const a = richArtifact();
    a.flows[0].nodes.push({ id: 'route', type: 'decision', label: 'Route' });
    a.flows[0].edges.find((e: Bag) => e.id === 'e2').target = 'route';
    a.flows[0].edges.push({ id: 'e6', source: 'route', target: 'sign_off' }, { id: 'e7', source: 'route', target: 'end' });
    expect(steps(a).status).toBe('pass');
  });

  it('walks every out-edge of an Approval node when none is labelled `approve`, as the engine does', () => {
    const a = richArtifact();
    delete a.flows[0].edges.find((e: Bag) => e.id === 'e2').label;
    expect(steps(a).status).toBe('pass');
  });

  it('does not count two Approval nodes on alternative branches', () => {
    const a = richArtifact();
    a.flows[0].edges = [
      { id: 'e1', source: 'start', target: 'review' },
      { id: 'e2', source: 'start', target: 'sign_off' },
      { id: 'e3', source: 'review', target: 'end' },
      { id: 'e4', source: 'sign_off', target: 'end' },
    ];
    expect(steps(a).status).toBe('fail');
  });
});

describe('dynamic approver routing — an approver read off the request record', () => {
  const routing = (a: Bag) => grade(a, 'approvals.dynamic-approver-routing');
  const withApprover = (approver: Bag) => {
    const a = richArtifact();
    a.flows[0].nodes[1].config.approvers = [approver];
    return a;
  };

  it('passes on the intact build: a field approver over a user field of the bound object', () => {
    expect(routing(richArtifact()).checks).toEqual([
      { check: 'approver:project_approval.review[0]->routes', pass: true, detail: 'field sponsor' },
      { check: 'dynamic-approver-binds-expected-object', pass: true, detail: '1 approver(s) read off the request record' },
    ]);
  });

  it("accepts a manager approver: the manager of the record's owner (injected `owner_id`), or of the user a field it names holds", () => {
    expect(routing(withApprover({ type: 'manager' })).status).toBe('pass');
    expect(routing(withApprover({ type: 'manager', value: 'sponsor' })).status).toBe('pass');
    expect(routing(withApprover({ type: 'manager', value: 'status' })).checks[0]!.detail).toBe('project.status holds no user');
  });

  it('accepts an expression over `current` / `trigger` / `vars`, and refuses one that reads `record` or does not parse', () => {
    expect(routing(withApprover({ type: 'expression', value: 'current.sponsor' })).status).toBe('pass');
    expect(routing(withApprover({ type: 'expression', value: 'record.sponsor' })).checks[0]!.detail).toMatch(/^reads record, and an approver expression reads only current, trigger, vars$/);
    expect(routing(withApprover({ type: 'expression', value: 'current.sponsor ==' })).checks[0]!.detail).toMatch(/^does not parse as CEL/);
  });

  it('counts no fixed approver: the same slate for every request', () => {
    for (const fixed of [
      { type: 'user', value: 'u_kim' },
      { type: 'position', value: 'manager' },
      { type: 'team', value: 'team_a' },
      { type: 'department', value: 'dept_a' },
      { type: 'queue', value: 'triage' },
      { type: 'org_membership_level', value: 'admin' },
      { type: 'role', value: 'admin' },
    ]) {
      expect(pairs(routing(withApprover(fixed))), fixed.type).toEqual([['dynamic-approver-binds-expected-object', false]]);
    }
  });
});

describe('row-level security — each scoped persona kept to its rows by a route that enforces', () => {
  const ownProjects = { name: 'own_projects', object: 'project', operation: 'select', using: 'owner == current_user.id' };
  const ROW_TAGS = ['access-security.row-scope', 'access-security.row-level-security'];
  const rowTags = (a: Bag, card: ScenarioArtifactCard = CARD) =>
    Object.fromEntries(gradeCapabilityTags(readArtifactFacts(a), { ...card, capabilities: ROW_TAGS }, { namespace: 'pm' }).map((v) => [v.tag, v]));
  const narrowed = (using = ownProjects.using) =>
    richArtifact((stack) => {
      stack.objects[0].sharingModel = 'public_read';
      stack.permissions[0].rowLevelSecurity = [{ ...ownProjects, using }];
    });

  it("passes on row-scope's routes when they enforce: a policy that lowers to a filter, or a private object", () => {
    for (const a of [narrowed(), richArtifact()]) {
      const t = rowTags(a);
      expect([t[ROW_TAGS[0]!]!.status, t[ROW_TAGS[1]!]!.status]).toEqual(['pass', 'pass']);
    }
    expect(rowTags(narrowed())['access-security.row-level-security']!.checks).toEqual([
      { check: 'row-level-security:project->enforced', pass: true, detail: 'enforced for pm_contractor' },
    ]);
  });

  it('fails where row-scope passes: a read policy that does not lower to a filter matches no row, on a public or a private object', () => {
    for (const a of [narrowed('size(name) > 2'), richArtifact((stack) => { stack.permissions[0].rowLevelSecurity = [{ ...ownProjects, using: 'size(name) > 2' }]; })]) {
      const t = rowTags(a);
      expect(t['access-security.row-scope']!.status).toBe('pass');
      expect(t['access-security.row-level-security']!.checks).toEqual([{
        check: 'row-level-security:project->enforced',
        pass: false,
        detail: 'the read policy own_projects on pm_contractor does not lower to a filter on project, so it matches no row',
      }]);
    }
  });

  it('fails where row-scope passes: a scoped detail whose master the persona reads in full', () => {
    const contractor = { ...CARD.run.personas[0]!, scope: [{ object: 'task', field: 'project.owner', value: 'u_kim' }] };
    const card = { ...CARD, run: { ...CARD.run, personas: [contractor, CARD.run.personas[1]!] } };
    expect(rowTags(richArtifact(), card)['access-security.row-level-security']!.status).toBe('pass');
    const open = richArtifact((stack) => { stack.objects[0].sharingModel = 'public_read'; });
    const t = rowTags(open, card);
    expect(t['access-security.row-scope']!.status).toBe('pass');
    expect(t['access-security.row-level-security']!.checks).toEqual([
      { check: 'row-level-security:task->enforced', pass: false, detail: 'no read policy on pm_contractor narrows project' },
    ]);
    expect(rowTags(narrowed(), card)['access-security.row-level-security']!.status).toBe('pass');
  });
});

describe('report — a report whose dataset binds an object the card names', () => {
  const report = (a: Bag) => grade(a, 'dashboards.report');

  it('passes on the intact build', () => {
    expect(pairs(report(richArtifact()))).toEqual([['report:tasks_by_status->resolves', true], ['report-binds-expected-object', true]]);
  });

  it("draws a joined report through each block's dataset", () => {
    const joined = (block: Bag) => richArtifact((stack) => {
      stack.reports = [{ name: 'task_blocks', label: 'Task Blocks', type: 'joined', blocks: [{ name: 'by_status', ...block }] }];
    });
    expect(report(joined({ dataset: 'task_metrics', rows: ['status'], values: [MEASURE] })).status).toBe('pass');
    expect(report(joined({ dataset: 'task_metrics', rows: ['no_such_dimension'], values: [MEASURE] })).checks[0]).toEqual({
      check: 'report:task_blocks->resolves',
      pass: false,
      detail: 'dataset task_metrics has no dimension no_such_dimension',
    });
  });

  it('fails a report that binds no dataset', () => {
    const a = richArtifact();
    delete a.reports[0].dataset;
    expect(pairs(report(a))).toEqual([['report:tasks_by_status->resolves', false], ['report-binds-expected-object', false]]);
  });
});

describe('agent actions — the tag', () => {
  it("carries exactly the agent-action checks, so the tag's verdict names each action that fails", () => {
    const s = scoreScenarioArtifact(richArtifact(), CARD);
    expect(s.tags.find((t) => t.tag === 'ai.agent-actions')!.checks).toEqual(s.agentActions);
  });
});

describe('the library — every tag a mid-tier card declares that this table now judges is scored', () => {
  const ROWS_ADDED = [
    'records-forms.formula-field',
    'records-forms.validation-rule',
    'approvals.multi-step-approval',
    'approvals.dynamic-approver-routing',
    'access-security.row-level-security',
    'dashboards.report',
    'ai.agent-actions',
  ];
  const MID_TIER = ['asset_lifecycle', 'leave_balances', 'order_to_cash', 'requisition_to_receipt', 'service_desk', 'travel_expense'];
  const { cards, refusals } = loadScenarios(SCENARIOS_DIR, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });

  it('loads the library, the six mid-tier cards among it', () => {
    expect(refusals.map(formatRefusal)).toEqual([]);
    expect(cards.map((c) => c.card.id)).toEqual(expect.arrayContaining(MID_TIER));
  });

  it('has a row for each of the seven, and each is declared by a card', () => {
    for (const tag of ROWS_ADDED) {
      expect(ALL_TAGS, tag).toContain(tag);
      expect(cards.some((c) => c.card.capabilities.includes(tag)), tag).toBe(true);
    }
  });

  it('scores each one on every card that declares it: an empty build fails it, never "unscored"', () => {
    const empty = readArtifactFacts({});
    const declaring = cards.filter((c) => c.card.capabilities.some((t) => ROWS_ADDED.includes(t)));
    expect(declaring.map((c) => c.card.id).sort()).toEqual(expect.arrayContaining(MID_TIER));
    for (const { card } of declaring) {
      const verdicts = gradeCapabilityTags(empty, card).filter((v) => ROWS_ADDED.includes(v.tag));
      expect(verdicts.length, card.id).toBeGreaterThan(0);
      expect(verdicts.map((v) => [v.tag, v.status]), card.id).toEqual(verdicts.map((v) => [v.tag, 'fail']));
    }
  });
});

describe('a multi-package artifact (collections only under packages[])', () => {
  it('scores exactly as the single-package one', () => {
    const artifact = richArtifact();
    const { manifest, ...collections } = artifact;
    const option = { manifest, packages: [{ manifest: { ...manifest, ...collections } }] };
    const single = scoreScenarioArtifact(artifact, CARD);
    const multi = scoreScenarioArtifact(option, CARD);
    expect(multi.tags).toEqual(single.tags);
    expect(multi.agentActions).toEqual(single.agentActions);
    expect(multi.score).toBe(single.score);
  });
});
