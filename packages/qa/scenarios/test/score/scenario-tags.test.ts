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

const MEASURE = 'task_count';

/**
 * The project/tasks golden fixture, completed with every capability the table
 * judges, parsed as `os build` parses it; `edit` changes the stack before the
 * parse, so what it adds is held to the spec's shape.
 */
function richArtifact(edit?: (stack: Bag) => void): Bag {
  const fixture = DEFAULT_METADATA_EVAL_CORPUS.find((c) => c.id === 'project_with_tasks')!.fixture;
  const stack = structuredClone(fixture) as Bag;
  stack.objects[1].fields.blocked_by = { type: 'lookup', label: 'Blocked By', reference: 'task' };
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
      // the approval and the record trigger below are judged apart.
      variables: [{ name: 'recordId', type: 'text', isInput: true, objectName: 'project' }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'review', type: 'approval', label: 'Review', config: { approvers: [{ type: 'position', value: 'manager' }], behavior: 'first_response' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'review' },
        { id: 'e2', source: 'review', target: 'end', label: 'approve' },
        { id: 'e3', source: 'review', target: 'end', label: 'reject' },
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
    dimensions: [],
    measures: [{ name: MEASURE, label: 'Tasks', aggregate: 'count' }],
  }];
  stack.dashboards = [{
    name: 'project_overview',
    label: 'Overview',
    widgets: [{ id: 'tasks', title: 'Tasks', type: 'metric', dataset: 'task_metrics', values: [MEASURE] }],
  }];
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
  'access-security.field-permissions': {
    'hidden field readable': (a) => { a.permissions[0].fields['task.estimate_hours'].readable = true; },
    'no permission set': (a) => { a.permissions = []; },
  },
  'access-security.row-scope': {
    'scoped object public': (a) => { (a.objects[0] as Bag).sharingModel = 'public_read_write'; },
  },
  'approvals.approval-flow': {
    'no approval node': (a) => {
      a.flows[0].nodes = a.flows[0].nodes.filter((n: Bag) => n.type !== 'approval');
    },
    'approval bound to a missing object': (a) => { a.flows[0].variables[0].objectName = 'no_such_object'; },
    'approval bound to no object the card names': (a) => { a.flows[0].variables[0].objectName = 'sys_user'; },
  },
  'automation.record-triggered-flow': {
    'no record trigger': (a) => { a.flows[1].nodes[0].config = {}; },
    'record trigger on a missing object': (a) => { a.flows[1].nodes[0].config.objectName = 'no_such_object'; },
  },
  'dashboards.widget-measures': {
    'dangling widget measure': (a) => { a.dashboards[0].widgets[0].values = ['no_such_measure']; },
    'no dashboard': (a) => { a.dashboards = []; },
  },
};

/**
 * A defect that breaks a second capability by construction: the roll-ups read
 * their child through the master-detail, so a dangling master-detail also
 * leaves them relating to nothing.
 */
const ALSO_FAILS: Record<string, readonly string[]> = {
  'dangling master-detail target': ['records-forms.roll-up-summary'],
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
      capabilities: ['access-security.field-permissions', 'access-security.row-scope'],
      run: { ...CARD.run, personas: [{ id: 'p', role: 'Partner', hidden: { objects: ['project'] } }] },
    });
    expect(verdicts.map((v) => [v.status, v.checks.length])).toEqual([['unscored', 0], ['unscored', 0]]);
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
