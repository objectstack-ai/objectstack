// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `validateNotifyTemplateVariables`: a `notify` node that sends an email
 * template without a variable the template declares `required` is advised at
 * validation (ruling record 6845318122, letter B). Only what the metadata
 * decides is judged: a CEL value envelope is computed per run, and a template
 * the stack does not declare is not judged at all.
 */
import { describe, expect, it } from 'vitest';

import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import {
  NOTIFY_TEMPLATE_VARIABLE_MISSING,
  validateNotifyTemplateVariables,
} from './validate-notify-template-variables.js';

const cel = (source: string) => ({ dialect: 'cel', source });

const taskDone = (locale = 'en-US', variables: unknown[] = [
  { name: 'task.title', type: 'string', required: true },
  { name: 'project.name', type: 'string', required: false },
]) => ({
  name: 'crm.task_done',
  label: 'Task Done',
  locale,
  subject: 'Task done: {{task.title}}',
  bodyText: 'The task {{task.title}} on {{project.name}} was marked done.',
  variables,
});

const notify = (config: Record<string, unknown>) => ({ id: 'tell_owner', type: 'notify', label: 'Notify Owner', config });

const flowWith = (...nodes: unknown[]) => ({
  name: 'task_closed',
  label: 'Task closed',
  type: 'autolaunched',
  nodes: [{ id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-updated' } }, ...nodes],
  edges: [],
});

const stackWith = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  emailTemplates: [taskDone()],
  flows: [flowWith(notify({ recipients: cel('record.owner_id'), template: 'crm.task_done', ...config }))],
  ...extra,
});

describe('the rule, on the stack', () => {
  it('a node that supplies every required variable draws nothing — by envelope or by literal', () => {
    expect(validateNotifyTemplateVariables(stackWith({ templateData: { task: cel('record') } }))).toEqual([]);
    expect(validateNotifyTemplateVariables(stackWith({ templateData: { task: { title: 'Ship it' } } }))).toEqual([]);
    expect(validateNotifyTemplateVariables(stackWith({ templateData: { task: { title: cel('record.title') } } }))).toEqual([]);
  });

  it('⭐ warns on a node whose templateData does not supply a required variable', () => {
    const findings = validateNotifyTemplateVariables(stackWith({ templateData: { project: cel('record.project') } }));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('warning');
    expect(f.rule).toBe(NOTIFY_TEMPLATE_VARIABLE_MISSING);
    expect(f.where).toBe('flow "task_closed" › node "Notify Owner"');
    expect(f.path).toBe('flows[0].nodes[1].config.templateData');
    expect(f.message).toContain("'crm.task_done'");
    expect(f.message).toContain('`task.title`');
    expect(f.message).toContain('MISSING_VARIABLES');
    expect(f.hint).toContain('A default is literal text; to read another variable, compute it in the flow');
  });

  it('a node with no templateData at all is judged too, located at its `template`', () => {
    const [f] = validateNotifyTemplateVariables(stackWith({}));
    expect(f.rule).toBe(NOTIFY_TEMPLATE_VARIABLE_MISSING);
    expect(f.path).toBe('flows[0].nodes[1].config.template');
  });

  it('⭐ a dotted templateData KEY is one name, not a path — it does not supply the required path, and the hint says so', () => {
    const [f] = validateNotifyTemplateVariables(stackWith({ templateData: { 'task.title': cel('record.title') } }));
    expect(f.rule).toBe(NOTIFY_TEMPLATE_VARIABLE_MISSING);
    expect(f.hint).toContain("the key 'task.title' is never read as `task.title`");
    expect(f.hint).toContain('pass `task` with an object value');
  });

  it('a literal that provably lacks the path, or holds null, does not supply it', () => {
    expect(validateNotifyTemplateVariables(stackWith({ templateData: { task: { name: 'x' } } }))).toHaveLength(1);
    expect(validateNotifyTemplateVariables(stackWith({ templateData: { task: 'flat text' } }))).toHaveLength(1);
    expect(validateNotifyTemplateVariables(stackWith({ templateData: { task: { title: null } } }))).toHaveLength(1);
  });

  it('a variable the default context supplies is not missing: appName, baseUrl, and the stack\'s own defaultTemplateContext keys', () => {
    const vars = [{ name: 'appName', required: true }, { name: 'baseUrl', required: true }, { name: 'support_email', required: true }];
    const stack = {
      emailTemplates: [taskDone('en-US', vars)],
      flows: [flowWith(notify({ recipients: cel('record.owner_id'), template: 'crm.task_done' }))],
    };
    expect(validateNotifyTemplateVariables(stack).map((f) => f.message)).toEqual([expect.stringContaining('`support_email`')]);
    expect(validateNotifyTemplateVariables({ ...stack, email: { defaultTemplateContext: { support_email: 'help@example.com' } } }))
      .toEqual([]);
  });

  it('names the locale members that require it when they disagree', () => {
    const stack = stackWith({ templateData: { project: cel('record.project') } }, {
      emailTemplates: [taskDone('en-US'), taskDone('zh-CN', [{ name: 'task.title', required: false }])],
    });
    const [f] = validateNotifyTemplateVariables(stack);
    expect(f.message).toContain('`task.title` (required by its en-US member)');
  });

  it('does not judge a template the stack does not declare, nor an inline-content node', () => {
    expect(validateNotifyTemplateVariables(stackWith({ template: 'auth.password_reset' }))).toEqual([]);
    expect(validateNotifyTemplateVariables({
      emailTemplates: [taskDone()],
      flows: [flowWith(notify({ recipients: cel('record.owner_id'), title: 'Hi', message: 'Done' }))],
    })).toEqual([]);
  });

  it('judges a notify node nested in a region', () => {
    const tryCatch = {
      id: 'guard',
      type: 'try_catch',
      label: 'Guard',
      config: {
        try: { nodes: [notify({ recipients: cel('record.owner_id'), template: 'crm.task_done' })], edges: [] },
        catch: { nodes: [], edges: [] },
      },
    };
    const findings = validateNotifyTemplateVariables({ emailTemplates: [taskDone()], flows: [flowWith(tryCatch)] });
    expect(findings.map((f) => f.rule)).toEqual([NOTIFY_TEMPLATE_VARIABLE_MISSING]);
    expect(findings[0].where).toContain('Guard');
  });

  it('is silent on a stack with no flows, and on malformed input', () => {
    expect(validateNotifyTemplateVariables({})).toEqual([]);
    expect(validateNotifyTemplateVariables({ flows: [null, 3] as never, emailTemplates: 'x' as never })).toEqual([]);
    expect(validateNotifyTemplateVariables(stackWith({ templateData: 'not a map' }))).toEqual([]);
  });
});

describe('the doors', () => {
  it('is an advisory entry on every command, off the publish door with its reason', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateNotifyTemplateVariables');
    expect(entry?.tier).toBe('advisory');
    expect(entry?.commands).toEqual([...AUTHORING_COMMANDS]);
    expect(entry?.surfaces).toEqual(['cli']);
    expect(entry?.surfaceReason).toBeTruthy();
  });

  it.each(AUTHORING_COMMANDS)('`os %s` advises it as a warning', (command) => {
    const stack = stackWith({ templateData: { project: cel('record.project') } });
    const findings = runAuthoringRules(command, { normalized: stack, parsed: stack })
      .filter((f) => f.rule === NOTIFY_TEMPLATE_VARIABLE_MISSING);
    expect(findings.map((f) => [f.severity, f.path])).toEqual([['warning', 'flows[0].nodes[1].config.templateData']]);
  });
});
