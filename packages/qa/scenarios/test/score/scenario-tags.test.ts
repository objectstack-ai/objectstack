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
import { formatRefusal, loadScenarioFile, loadScenarios, readCapabilityAreas } from '../../src/loader.js';
import {
  CAPABILITY_TAG_CHECKS,
  gradeCapabilityTags,
  gradePersonaGrants,
  personaGrantNeeds,
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
  // Over-gating: the card has the agent set a task's status at once.
  'action:task.set_task_status->not-confirm-gated': (a) => { a.actions[0].ai.requiresConfirmation = true; },
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
    expect(intact.agentActions).toHaveLength(6);
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
      ['action:task.set_task_status->not-confirm-gated', false],
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

  describe("a scoped detail of a master the persona reads in full, narrowed by the detail's own read policy", () => {
    // The gallery build's shape: the detail is controlled by its parent, the
    // master is `public_read` (every persona reads it), and the persona's set
    // also carries a read policy on the detail itself. The engine ANDs that
    // policy with the master-derived filter, so the detail is kept to the
    // persona's rows.
    const contractor = { ...CARD.run.personas[0]!, scope: [{ object: 'task', field: 'project.owner', value: 'u_kim' }] };
    const card = { ...CARD, run: { ...CARD.run, personas: [contractor, CARD.run.personas[1]!] } };
    const ownTasks = { name: 'own_tasks', object: 'task', operation: 'all', using: 'project in current_user.my_project_ids' };
    const openMaster = (detailPolicies: Bag[]) =>
      richArtifact((stack) => {
        stack.objects[0].sharingModel = 'public_read';
        stack.permissions[0].rowLevelSecurity = detailPolicies;
      });
    const enforced = (a: Bag) => rowTags(a, card)['access-security.row-level-security']!.checks;

    it('passes: a detail policy that lowers to a filter and admits only some rows', () => {
      expect(readArtifactFacts(openMaster([])).objects.get('task')?.sharingModel).toBe('controlled_by_parent');
      expect(enforced(openMaster([ownTasks]))).toEqual([
        { check: 'row-level-security:task->enforced', pass: true, detail: 'enforced for pm_contractor' },
      ]);
    });

    it('still fails with no detail policy, or one that admits every row: the master is followed', () => {
      for (const policies of [[], [{ ...ownTasks, using: 'true' }], [ownTasks, { ...ownTasks, name: 'all_tasks', using: 'true' }]]) {
        expect(enforced(openMaster(policies)), JSON.stringify(policies)).toEqual([
          { check: 'row-level-security:task->enforced', pass: false, detail: 'no read policy on pm_contractor narrows project' },
        ]);
      }
    });

    it('still fails with a detail policy that does not lower to a filter, beside one that does', () => {
      for (const policies of [[{ ...ownTasks, using: 'size(name) > 2' }], [ownTasks, { ...ownTasks, name: 'long_tasks', using: 'size(name) > 2' }]]) {
        const dead = String(policies[policies.length - 1]!.name);
        expect(enforced(openMaster(policies)), JSON.stringify(policies)).toEqual([{
          check: 'row-level-security:task->enforced',
          pass: false,
          detail: `the read policy ${dead} on pm_contractor does not lower to a filter on task, so it matches no row`,
        }]);
      }
    });
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

  // Every open card models approvals as data (an approval step object, or an
  // approver and decision date on the record, graded as data writes), so none
  // declares an `approvals.*` tag: those rows judge the engine's Approval node,
  // whose history no seed row can preload (docs/qa/scenarios/README.md, "Build
  // checks trace to the prompt"). The rows stay for a card that exercises the
  // engine.
  const ENGINE_ROWS = ROWS_ADDED.filter((t) => t.startsWith('approvals.'));

  it('has a row for each of the seven, and each but the approval-engine rows is declared by a card', () => {
    for (const tag of ROWS_ADDED) {
      expect(ALL_TAGS, tag).toContain(tag);
      if (!ENGINE_ROWS.includes(tag)) expect(cards.some((c) => c.card.capabilities.includes(tag)), tag).toBe(true);
    }
    expect(ENGINE_ROWS).toEqual(['approvals.multi-step-approval', 'approvals.dynamic-approver-routing']);
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

describe('persona grants — what the card has each persona read and write, against its permission set', () => {
  const card = (id: string): ScenarioArtifactCard => {
    const { card: loaded, refusals } = loadScenarioFile(resolve(SCENARIOS_DIR, `${id}.json`), { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
    if (!loaded) throw new Error(refusals.map(formatRefusal).join('\n'));
    return loaded.card;
  };
  // project_with_tasks: the contractor answers task questions and creates,
  // updates and deletes tasks; the client viewer hides `task` and is refused
  // closing one (PERMISSION_DENIED).
  const PROJECT = card('project_with_tasks');
  const ALL_TASK_VERBS = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
  /** The rich build with the two persona sets, named bare (no namespace): `edit` adjusts them before the parse. */
  const artifact = (sets: Record<string, Bag>, edit?: (stack: Bag) => void) =>
    richArtifact((stack) => {
      stack.permissions = Object.entries(sets).map(([name, set]) => ({ name, label: name, ...set }));
      edit?.(stack);
    });
  const built = (sets: Record<string, Bag>, edit?: (stack: Bag) => void) => readArtifactFacts(artifact(sets, edit));
  const verdicts = (facts: ReturnType<typeof readArtifactFacts>, c: ScenarioArtifactCard = PROJECT, namespace?: string) =>
    gradePersonaGrants(facts, c, namespace === undefined ? {} : { namespace }).map((r) => [r.check, r.notMeasured === undefined ? r.pass : 'not-measured']);
  const GRANTED = { contractor: { objects: { project: { allowRead: true }, task: ALL_TASK_VERBS } }, client_viewer: { objects: { project: { allowRead: true } } } };

  it('derives one need per persona × object × verb from the card alone, and nothing from a question about an object the persona hides', () => {
    expect(personaGrantNeeds(PROJECT).map((n) => [n.persona, n.object, n.verb, n.requiredBy.length > 0 ? 'needed' : 'refused'])).toEqual([
      ['contractor', 'task', 'read', 'needed'],
      ['contractor', 'task', 'create', 'needed'],
      ['contractor', 'task', 'update', 'needed'],
      ['contractor', 'task', 'delete', 'needed'],
      ['client_viewer', 'task', 'update', 'refused'],
    ]);
    // `task_without_title` is refused VALIDATION_FAILED: it implies nothing, so `create` is needed by `add_task` alone.
    expect(personaGrantNeeds(PROJECT).find((n) => n.verb === 'create')!.requiredBy).toEqual(['operation add_task']);
  });

  it('a grant present: every check passes, but a delete of a detail row, which the master gate decides', () => {
    // `task` is a `controlled_by_parent` detail: the platform hands its
    // owner-only delete floor to the master's gate, which the artifact cannot
    // judge without the master row.
    expect(verdicts(built(GRANTED))).toEqual([
      ['persona-grant:contractor:task:read', true],
      ['persona-grant:contractor:task:create', true],
      ['persona-grant:contractor:task:update', true],
      ['persona-grant:contractor:task:delete', 'not-measured'],
      ['persona-grant:client_viewer:task:update', true],
    ]);
  });

  const READ_ONLY = { ...GRANTED, contractor: { objects: { project: { allowRead: true }, task: { allowRead: true } } } };
  const withoutAction = (name: string) => (stack: Bag) => {
    stack.actions = (stack.actions as Bag[]).filter((x) => x.name !== name);
  };

  it('a grant missing: the read-only contractor of the first live run fails each write the card gives it', () => {
    const readOnly = built(READ_ONLY, withoutAction('delete_task'));
    expect(verdicts(readOnly)).toEqual([
      ['persona-grant:contractor:task:read', true],
      ['persona-grant:contractor:task:create', false],
      ['persona-grant:contractor:task:update', false],
      ['persona-grant:contractor:task:delete', false],
      ['persona-grant:client_viewer:task:update', true],
    ]);
    expect(gradePersonaGrants(readOnly, PROJECT).find((c) => c.check.endsWith(':create'))!.detail).toBe(
      'contractor grants no create on task, which operation add_task needs',
    );
  });

  it("a write the card has wait on confirmation, withheld and routed through the build's confirm-gated card action: not measured, named, never a pass", () => {
    // The rich build declares the card's set_task_status (not confirm-gated)
    // and delete_task (confirm-gated). `start_qa` is applied: it stays measured
    // against the grant whatever actions the build adds. The card's only
    // waiting delete is the ambiguous `drop_relaunch_task`, so this case reads
    // the card without `drop_packing` (a named single delete, applied): the
    // card designs delete_task as the waiting delete's route.
    const WAITING: ScenarioArtifactCard = { ...PROJECT, run: { ...PROJECT.run, operations: PROJECT.run.operations!.filter((o) => o.id !== 'drop_packing') } };
    const facts = built(READ_ONLY);
    // The waiting delete is the card's last operation, so its grant reads after the client viewer's.
    expect(verdicts(facts, WAITING).slice(1)).toEqual([
      ['persona-grant:contractor:task:create', false],
      ['persona-grant:contractor:task:update', false],
      ['persona-grant:client_viewer:task:update', true],
      ['persona-grant:contractor:task:delete', 'not-measured'],
    ]);
    expect(gradePersonaGrants(facts, WAITING).find((c) => c.check === 'persona-grant:contractor:task:delete')!.notMeasured).toBe(
      'contractor grants no delete on task, and the build declares the card\'s confirm-gated agent action delete_task there, a door that writes as the platform: whether operation drop_relaunch_task goes through it is the run\'s to observe',
    );
    const s = scoreScenarioArtifact(artifact(READ_ONLY), WAITING);
    const g = scoreScenarioArtifact(artifact(GRANTED), WAITING);
    // Both builds leave the delete to the run (here the route, there the master gate on the detail).
    expect([s.total, s.passed]).toEqual([g.total, g.passed - 2]);
    // The card's action without `confirm` is no designed route: the check is measured.
    const unconfirmed: ScenarioArtifactCard = {
      ...WAITING,
      run: { ...WAITING.run, agentActions: WAITING.run.agentActions!.map((a) => ({ ...a, confirm: false })) },
    };
    expect(verdicts(facts, unconfirmed)[4]).toEqual(['persona-grant:contractor:task:delete', false]);
    // A delete the card applies outright is measured, even beside the confirm-gated action: the card as it
    // ships applies `drop_packing` (the maintainer's 2026-11-16 ruling), so its contractor must hold the grant.
    expect(PROJECT.run.operations!.find((o) => o.id === 'drop_packing')!.outcome.kind).toBe('applied');
    expect(verdicts(facts)[3]).toEqual(['persona-grant:contractor:task:delete', false]);
  });

  it("an applied write the card routes through its own action (`via`), withheld and the action declared: not measured, named, never a pass", () => {
    // The card names set_task_status (not confirm-gated) as start_qa's route,
    // the shape of a manager deciding an approval step through the card's
    // decide action. The rich build declares set_task_status.
    const ROUTED: ScenarioArtifactCard = {
      ...PROJECT,
      run: { ...PROJECT.run, operations: PROJECT.run.operations!.map((o) => (o.id === 'start_qa' ? { ...o, via: 'set_task_status' } : o)) },
    };
    const UPDATE = 'persona-grant:contractor:task:update';
    const facts = built(READ_ONLY);
    expect(verdicts(facts, ROUTED).find(([c]) => c === UPDATE)).toEqual([UPDATE, 'not-measured']);
    expect(gradePersonaGrants(facts, ROUTED).find((c) => c.check === UPDATE)!.notMeasured).toBe(
      "contractor grants no update on task, and the build declares the card's agent action each write names as its route (`via`) or its confirm-gated one, a door that writes as the platform: whether operation start_qa through set_task_status goes through it is the run's to observe",
    );
    // Counted in neither figure: one check fewer than the same build scored on the card without `via`.
    const routed = scoreScenarioArtifact(artifact(READ_ONLY), ROUTED);
    const plain = scoreScenarioArtifact(artifact(READ_ONLY), PROJECT);
    expect([routed.total, routed.passed]).toEqual([plain.total - 1, plain.passed]);
    // A set that grants the verb still passes, as without `via`.
    expect(verdicts(built(GRANTED), ROUTED).find(([c]) => c === UPDATE)).toEqual([UPDATE, true]);
    // The build does not declare the named action: measured, and the withheld grant fails.
    expect(verdicts(built(READ_ONLY, withoutAction('set_task_status')), ROUTED).find(([c]) => c === UPDATE)).toEqual([UPDATE, false]);
    // Without `via` the same write stays measured (the card as it ships).
    expect(verdicts(facts).find(([c]) => c === UPDATE)).toEqual([UPDATE, false]);
    // A second write of the same verb that names no route keeps the grant measured.
    const { via: _route, ...unrouted } = ROUTED.run.operations!.find((o) => o.id === 'start_qa')!;
    const MIXED: ScenarioArtifactCard = {
      ...ROUTED,
      run: { ...ROUTED.run, operations: [...ROUTED.run.operations!, { ...unrouted, id: 'start_qa_again' }] },
    };
    expect(verdicts(facts, MIXED).find(([c]) => c === UPDATE)).toEqual([UPDATE, false]);
  });

  it('edit and delete are read ∧ grant, as the enforcement door folds them', () => {
    const writeOnly = built({ ...GRANTED, contractor: { objects: { task: { allowCreate: true, allowEdit: true, allowDelete: true } } } }, (stack) => {
      // The authoring schema refuses a write grant without read; a stored set may still carry one.
      stack.permissions[0].objects.task.allowRead = true;
      withoutAction('delete_task')(stack);
    });
    writeOnly.permissionSets[0]!.objects = { task: { allowCreate: true, allowEdit: true, allowDelete: true } };
    expect(verdicts(writeOnly).slice(0, 4)).toEqual([
      ['persona-grant:contractor:task:read', false],
      ['persona-grant:contractor:task:create', true],
      ['persona-grant:contractor:task:update', false],
      ['persona-grant:contractor:task:delete', false],
    ]);
  });

  describe('a grant the card refuses', () => {
    const refused = (viewer: Bag, edit?: (stack: Bag) => void) =>
      verdicts(built({ ...GRANTED, client_viewer: viewer }, edit)).find(([c]) => c === 'persona-grant:client_viewer:task:update')![1];
    const EDITS_TASKS = { project: { allowRead: true }, task: { allowRead: true, allowEdit: true } };

    it('passes when the set grants no update on the object', () => {
      expect(refused({ objects: { project: { allowRead: true } } })).toBe(true);
      expect(refused({ objects: { project: { allowRead: true }, task: { allowRead: true } } })).toBe(true);
    });

    it('fails when the set grants the update and nothing in it refuses the write', () => {
      expect(refused({ objects: EDITS_TASKS })).toBe(false);
    });

    it('passes when the set locks a field the write names (the same 403 the field-level write step answers)', () => {
      expect(refused({ objects: EDITS_TASKS, fields: { 'task.status': { readable: true, editable: false } } })).toBe(true);
      // A lock on a field the write does not name refuses nothing.
      expect(refused({ objects: EDITS_TASKS, fields: { 'task.title': { readable: true, editable: false } } })).toBe(false);
      // Modify All votes every field editable, so the lock is overridden.
      expect(refused({ objects: { project: { allowRead: true }, task: { allowRead: true, modifyAllRecords: true } }, fields: { 'task.status': { readable: true, editable: false } } })).toBe(false);
    });

    it('is not measured when only a row rule could refuse it, and counts in neither figure', () => {
      const viewer = {
        objects: EDITS_TASKS,
        rowLevelSecurity: [{ name: 'own_tasks', object: 'task', operation: 'update', using: 'owner == current_user.id' }],
      };
      expect(refused(viewer)).toBe('not-measured');
      expect(refused({ ...viewer, rowLevelSecurity: [{ ...viewer.rowLevelSecurity[0], operation: 'select' }] })).toBe(false);
      expect(refused({ objects: EDITS_TASKS, fields: { 'task.status': { readable: true, editable: false, when: "record.status == 'done'" } } })).toBe('not-measured');

      const withRow = artifact({ ...GRANTED, client_viewer: viewer });
      const without = artifact({ ...GRANTED, client_viewer: { objects: EDITS_TASKS } });
      const a = scoreScenarioArtifact(withRow, PROJECT);
      const b = scoreScenarioArtifact(without, PROJECT);
      expect([a.total, a.passed]).toEqual([b.total - 1, b.passed]);
    });

    it('a write refused on one row and applied on another: the needed check alone, never an absence the card contradicts', () => {
      // requisition_to_receipt: the department manager approves level one
      // (applied) and is refused the finance level (PERMISSION_DENIED) on
      // the same object and verb.
      const req = card('requisition_to_receipt');
      const n = personaGrantNeeds(req).find((x) => x.persona === 'dept_manager' && x.object === 'approval_step' && x.verb === 'update')!;
      expect([n.requiredBy, n.refusedBy.map((r) => r.operation)]).toEqual([['operation manager_approves_level_one'], ['manager_approves_finance_level']]);
      const facts = readArtifactFacts({ permissions: [{ name: 'dept_manager', objects: { approval_step: { allowRead: true, allowEdit: true } } }] });
      const c = gradePersonaGrants(facts, req).find((x) => x.check === 'persona-grant:dept_manager:approval_step:update')!;
      expect([c.pass, c.detail]).toEqual([true, 'dept_manager grants it; manager_approves_finance_level is refused by a row or a field, not the grant']);
    });
  });

  it("reads the platform's fold: a '*' wildcard covers a public object and not a private one", () => {
    const wildcard = { ...GRANTED, contractor: { objects: { '*': ALL_TASK_VERBS } } };
    // The detail's delete is the master gate's (see 'a grant present'): not measured, whatever covers the grant.
    expect(verdicts(built(wildcard)).slice(0, 4).map(([, v]) => v)).toEqual([true, true, true, 'not-measured']);
    const privateTask = built(wildcard, (stack) => {
      (stack.objects as Bag[]).find((o) => o.name === 'task')!.access = { default: 'private' };
      withoutAction('delete_task')(stack);
    });
    expect(verdicts(privateTask).slice(0, 4).map(([, v]) => v)).toEqual([false, false, false, false]);
  });

  it("judges the persona's own set by its name in the namespace, and fails every check of a persona whose set the build does not declare", () => {
    const facts = built(GRANTED);
    expect(verdicts(facts, PROJECT, 'demoproject').map(([, v]) => v)).toEqual([false, false, false, false, false]);
    expect(gradePersonaGrants(facts, PROJECT, { namespace: 'demoproject' })[0]!.detail).toBe('the build declares no permission set demoproject_contractor');
    const renamed = built({ demoproject_contractor: GRANTED.contractor, demoproject_client_viewer: GRANTED.client_viewer });
    expect(verdicts(renamed, PROJECT, 'demoproject').map(([, v]) => v)).toEqual([true, true, true, 'not-measured', true]);
  });

  it('counts in the card score, and a card pick without questions or operations derives none', () => {
    const facts = built(GRANTED);
    const s = scoreScenarioArtifact(artifact(GRANTED), PROJECT);
    expect(s.personaGrants.map((c) => c.check)).toEqual(gradePersonaGrants(facts, PROJECT).map((c) => c.check));
    const { questions: _q, operations: _o, ...run } = PROJECT.run;
    expect(gradePersonaGrants(facts, { ...PROJECT, run })).toEqual([]);
    expect(scoreScenarioArtifact(richArtifact(), CARD).personaGrants).toEqual([]);
  });
});

describe("persona grants — a delete the set grants, read against the platform's owner-only delete floor", () => {
  // leave_balances: the hr_officer deletes withdrawn requests LR-0100
  // (`delete_withdrawn_request`, applied) and LR-0003 (waiting on
  // confirmation). Both are seed rows no persona owns: the runner loads them as
  // the admin's. The platform's `owner_only_deletes` floor refuses a delete of a
  // row the caller did not create, and only the sharing service's delete
  // `allow` (ownership, Modify All, a write depth of `org`) on an object it
  // enforces on lifts it (plugin-security `platform-ownership-policies.ts`,
  // plugin-sharing `SharingService.checkDelete`).
  const { card: loaded, refusals } = loadScenarioFile(resolve(SCENARIOS_DIR, 'leave_balances.json'), { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });
  if (!loaded) throw new Error(refusals.map(formatRefusal).join('\n'));
  const LEAVE = loaded.card;
  const DELETE = 'persona-grant:hr_officer:leave_request:delete';
  const facts = (opts: { entry?: Bag; sharingModel?: string; ownership?: string; rowLevelSecurity?: Bag[]; actions?: Bag[] } = {}) =>
    readArtifactFacts({
      objects: [
        {
          name: 'leave_request',
          label: 'Leave Request',
          sharingModel: opts.sharingModel ?? 'private',
          ...(opts.ownership ? { ownership: opts.ownership } : {}),
          fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
          ...(opts.actions ? { actions: opts.actions } : {}),
        },
      ],
      permissions: [
        {
          name: 'hr_officer',
          label: 'HR officer',
          objects: { leave_request: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, ...opts.entry } },
          ...(opts.rowLevelSecurity ? { rowLevelSecurity: opts.rowLevelSecurity } : {}),
        },
      ],
    });
  const grade = (f: ReturnType<typeof readArtifactFacts>, c: ScenarioArtifactCard = LEAVE) => gradePersonaGrants(f, c).find((x) => x.check === DELETE)!;
  const state = (r: { pass: boolean; notMeasured?: string }) => (r.notMeasured === undefined ? r.pass : 'not-measured');

  it('the card deletes rows the admin owns, as the hr_officer', () => {
    const ops = LEAVE.run.operations!.filter((o) => o.kind === 'delete' && o.actingAs === 'hr_officer');
    expect(ops.map((o) => [o.id, o.target])).toEqual([['delete_withdrawn_request', 'lr_100'], ['delete_zoes_withdrawn_request', 'lr_003']]);
  });

  it('⛔ allowDelete without Modify All fails: the floor refuses a delete of a row the persona does not own', () => {
    const r = grade(facts());
    expect(state(r)).toBe(false);
    expect(r.detail).toContain('lr_100');
    expect(r.detail).toContain('lr_003');
  });

  it('Modify All, or a write depth of org, lifts the floor on an object the sharing service enforces on', () => {
    expect(state(grade(facts({ entry: { modifyAllRecords: true } })))).toBe(true);
    expect(state(grade(facts({ entry: { writeScope: 'org' } })))).toBe(true);
  });

  it('⛔ on a public org-wide default, or with no record owner, nothing lifts it: the sharing service abstains, Modify All included', () => {
    expect(state(grade(facts({ sharingModel: 'public_read_write', entry: { modifyAllRecords: true } })))).toBe(false);
    expect(state(grade(facts({ ownership: 'none', entry: { modifyAllRecords: true } })))).toBe(false);
  });

  it('an authored delete policy beside the floor, or a detail whose master gate decides, leaves the write to the run', () => {
    const policy = { name: 'hr_deletes_withdrawn', object: 'leave_request', operation: 'delete', using: "status == 'withdrawn'" };
    expect(state(grade(facts({ rowLevelSecurity: [policy] })))).toBe('not-measured');
    expect(state(grade(facts({ rowLevelSecurity: [{ ...policy, operation: 'select' }] })))).toBe(false);
    expect(state(grade(facts({ sharingModel: 'controlled_by_parent' })))).toBe('not-measured');
  });

  it("the waiting delete routed through the card's confirm-gated action the build declares is the run's; the applied one stays measured", () => {
    const action = { name: 'delete_leave_request', label: 'Delete', type: 'script', target: 'delete_leave_request', ai: { exposed: true, requiresConfirmation: true } };
    const WAITING: ScenarioArtifactCard = { ...LEAVE, run: { ...LEAVE.run, operations: LEAVE.run.operations!.filter((o) => o.id !== 'delete_withdrawn_request') } };
    expect(state(grade(facts({ actions: [action] }), WAITING))).toBe('not-measured');
    expect(state(grade(facts({ actions: [action] })))).toBe(false);
  });

  it('a row the persona owns passes on the grant: ownership is the sharing service\'s own allow', () => {
    // A card copy whose hr_officer is the person LR-0100 names (e04), so the runner loads the row as theirs.
    const persona = LEAVE.run.personas.find((p) => p.id === 'hr_officer')!;
    const OWNER: ScenarioArtifactCard = {
      ...LEAVE,
      run: {
        ...LEAVE.run,
        personas: LEAVE.run.personas.map((p) => (p === persona ? { ...p, record: { object: 'employee', id: 'e04' } } : p)),
        operations: LEAVE.run.operations!.filter((o) => o.id !== 'delete_zoes_withdrawn_request'),
      },
    };
    expect(state(grade(facts(), OWNER))).toBe(true);
  });
});
