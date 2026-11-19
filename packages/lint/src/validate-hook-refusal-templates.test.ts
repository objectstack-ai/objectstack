// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33214] A hook refusal sentence over declared `params` is compiled as the
 * template it is: logic, an unknown formatter, an empty hole and a `currency`
 * formatter with no code are errors — at `objectstack validate` / `compile`
 * (the stack expression pass) and at the publish gate's `hook` write.
 */

import { describe, it, expect } from 'vitest';
import { actionRefusalTemplateIssues, hookRefusalTemplateIssues } from './validate-hook-refusal-templates.js';
import { validateStackExpressions } from './validate-expressions.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

const hook = (refusals: Record<string, unknown>) => ({
  name: 'plan_gate',
  object: 'plan',
  events: ['beforeUpdate'],
  handler: 'planGate',
  refusals,
});

const entry = (message: string, extra: Record<string, unknown> = {}) => ({
  VALIDATION_FAILED: { message, params: ['state', 'amount'], ...extra },
});

const issuesOf = (message: string, extra?: Record<string, unknown>) =>
  hookRefusalTemplateIssues({ hooks: [hook(entry(message, extra))] });

describe('hook refusal templates over declared params (#33214)', () => {
  it.each([
    'The plan is {{ state }}.',
    'Over by {{ amount | number:2 }}.',
    'Paid {{ amount | currency:EUR }}.',
    'Plain text with no hole.',
  ])('accepts %j', (message) => {
    expect(issuesOf(message)).toEqual([]);
  });

  it.each([
    ['an unknown formatter', 'The plan is {{ state | shout }}.'],
    ['logic', 'The plan is {{ state + 1 }}.'],
    ['an empty hole', 'The plan is {{ }}.'],
  ])('refuses %s as an error, naming the hook and the sentence', (_label, message) => {
    const issues = issuesOf(message);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0]!.where).toBe("hook 'plan_gate' refusals.VALIDATION_FAILED.message");
  });

  it('refuses a currency formatter with no code, naming the spelling that names one', () => {
    const issues = issuesOf('Paid {{ amount | currency }}.');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', source: '{{ amount | currency }}' });
    expect(issues[0]!.message).toContain('{{ amount | currency:EUR }}');
  });

  it('judges each reason sentence at its own path', () => {
    const issues = issuesOf('Fine {{ state }}.', { reasons: { plan_locked: { message: 'Locked {{ state | shout }}.' } } });
    expect(issues.map((i) => i.where)).toEqual(["hook 'plan_gate' refusals.VALIDATION_FAILED.reasons.plan_locked.message"]);
  });

  it('reads no entry that declares no params — the parse refuses every hole there', () => {
    expect(hookRefusalTemplateIssues({ hooks: [hook({ X: { message: 'Paid {{ amount | currency }}.' } })] })).toEqual([]);
  });

  it('is part of the stack expression pass `objectstack validate` and `compile` run', () => {
    const issues = validateStackExpressions({ hooks: [hook(entry('The plan is {{ state | shout }}.'))] } as never);
    expect(issues.some((i) => i.where === "hook 'plan_gate' refusals.VALIDATION_FAILED.message" && i.severity === 'error')).toBe(true);
  });

  it('refuses a `hook` write at the publish gate', () => {
    const result = runRuntimeAuthoringRules({
      type: 'hook',
      item: hook(entry('Paid {{ amount | currency }}.')),
      context: { objects: [] },
    });
    const finding = result.errors.find((e) => String(e.message).includes('{{ amount | currency:EUR }}'));
    expect(finding, JSON.stringify(result.errors)).toBeDefined();
    expect(finding!.severity).toBe('error');
  });
});

describe('hook text templates over declared params (#34374)', () => {
  const textHook = (texts: Record<string, unknown>) => ({
    name: 'lead_follow_up',
    object: 'crm_lead',
    events: ['afterUpdate'],
    handler: 'leadFollowUp',
    texts,
  });
  const textIssues = (message: string, params: string[] | null = ['lead']) =>
    hookRefusalTemplateIssues({ hooks: [textHook({ follow_up_subject: params ? { message, params } : { message } })] });

  it.each([
    'Follow up: {{ lead }}',
    'Follow up: {{ lead | upper }}',
    'Worth {{ lead | currency:EUR }}',
    'Plain text with no hole.',
  ])('CONTROL: accepts %j', (message) => {
    expect(textIssues(message)).toEqual([]);
  });

  it.each([
    ['an unknown formatter', 'Follow up: {{ lead | shout }}'],
    ['logic', 'Follow up: {{ lead + 1 }}'],
    ['an empty hole', 'Follow up: {{ }}'],
  ])('refuses %s as an error at texts.<key>.message', (_label, message) => {
    const issues = textIssues(message);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0]!.where).toBe("hook 'lead_follow_up' texts.follow_up_subject.message");
  });

  it('refuses a currency formatter with no code, naming the spelling that names one', () => {
    const issues = textIssues('Worth {{ lead | currency }}');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', source: '{{ lead | currency }}' });
    expect(issues[0]!.message).toContain('{{ lead | currency:EUR }}');
  });

  it('reads no text that declares no params — the parse refuses every hole there', () => {
    expect(textIssues('Follow up: {{ lead | shout }}', null)).toEqual([]);
  });

  it('judges a text beside the same hook\'s refusals, each at its own path', () => {
    const issues = hookRefusalTemplateIssues({
      hooks: [{
        ...textHook({ follow_up_subject: { message: 'Follow up: {{ lead | shout }}', params: ['lead'] } }),
        refusals: { VALIDATION_FAILED: { message: 'The plan is {{ state | shout }}.', params: ['state'] } },
      }],
    });
    expect(issues.map((i) => i.where).sort()).toEqual([
      "hook 'lead_follow_up' refusals.VALIDATION_FAILED.message",
      "hook 'lead_follow_up' texts.follow_up_subject.message",
    ]);
  });

  it('is part of the stack expression pass `objectstack validate` and `compile` run', () => {
    const issues = validateStackExpressions({
      hooks: [textHook({ follow_up_subject: { message: 'Follow up: {{ lead | shout }}', params: ['lead'] } })],
    } as never);
    expect(issues.some((i) => i.where === "hook 'lead_follow_up' texts.follow_up_subject.message" && i.severity === 'error')).toBe(true);
  });

  it('refuses a `hook` write at the publish gate, and passes the CONTROL', () => {
    const gate = (message: string) => runRuntimeAuthoringRules({
      type: 'hook',
      item: textHook({ follow_up_subject: { message, params: ['lead'] } }),
      context: { objects: [] },
    });
    const refused = gate('Worth {{ lead | currency }}');
    const finding = refused.errors.find((e) => String(e.message).includes('{{ lead | currency:EUR }}'));
    expect(finding, JSON.stringify(refused.errors)).toBeDefined();
    expect(finding!.severity).toBe('error');
    const control = gate('Worth {{ lead | currency:EUR }}');
    expect(control.errors.filter((e) => String(e.message).includes('currency'))).toEqual([]);
  });
});

describe('action refusal templates over declared params (#34273)', () => {
  const action = (refusals: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    name: 'submit_signoff',
    label: 'Submit',
    type: 'script',
    body: { language: 'js', source: 'return 1;' },
    refusals,
    ...extra,
  });
  const stackWith = (message: string, extra: Record<string, unknown> = {}) => ({
    objects: [{ name: 'crm_invoice', actions: [action(entry(message, extra))] }],
  });
  const actionIssues = (message: string, extra?: Record<string, unknown>) =>
    actionRefusalTemplateIssues(stackWith(message, extra), { actions: true, objects: true });

  it.each([
    'The invoice is {{ state }}.',
    'Over by {{ amount | number:2 }}.',
    'Paid {{ amount | currency:EUR }}.',
    'Plain text with no hole.',
  ])('CONTROL: accepts %j', (message) => {
    expect(actionIssues(message)).toEqual([]);
  });

  it.each([
    ['an unknown formatter', 'The invoice is {{ state | shout }}.'],
    ['logic', 'The invoice is {{ state + 1 }}.'],
    ['an empty hole', 'The invoice is {{ }}.'],
  ])('refuses %s as an error, naming the object, the action and the sentence', (_label, message) => {
    const issues = actionIssues(message);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0]!.where).toBe("object 'crm_invoice' · action 'submit_signoff' refusals.VALIDATION_FAILED.message");
  });

  it('refuses a currency formatter with no code, in the action\'s words', () => {
    const issues = actionIssues('Paid {{ amount | currency }}.');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('which an action sentence does not carry');
    expect(issues[0]!.message).toContain('{{ amount | currency:EUR }}');
  });

  it('judges each reason sentence at its own path', () => {
    const issues = actionIssues('Fine {{ state }}.', { reasons: { closed: { message: 'Closed {{ state | shout }}.' } } });
    expect(issues.map((i) => i.where))
      .toEqual(["object 'crm_invoice' · action 'submit_signoff' refusals.VALIDATION_FAILED.reasons.closed.message"]);
  });

  it('judges a top-level action once, even when its object declares it too', () => {
    const bound = { ...action(entry('{{ state | shout }}')), objectName: 'crm_invoice' };
    const issues = actionRefusalTemplateIssues(
      { actions: [bound], objects: [{ name: 'crm_invoice', actions: [bound] }] },
      { actions: true, objects: true },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toBe("stack · action 'submit_signoff' refusals.VALIDATION_FAILED.message");
  });

  it('is part of the stack expression pass `objectstack validate` and `compile` run', () => {
    const issues = validateStackExpressions(stackWith('The invoice is {{ state | shout }}.') as never);
    expect(issues.some((i) => i.where.endsWith("action 'submit_signoff' refusals.VALIDATION_FAILED.message") && i.severity === 'error'))
      .toBe(true);
  });

  it('refuses an `action` write at the publish gate, and passes the CONTROL', () => {
    const gate = (message: string) =>
      runRuntimeAuthoringRules({ type: 'action', item: action(entry(message)), context: { objects: [] } })
        .errors.filter((e) => String(e.where ?? '').includes('refusals.'));
    const refused = gate('Paid {{ amount | currency }}.');
    expect(refused.some((e) => String(e.message).includes('{{ amount | currency:EUR }}')), JSON.stringify(refused)).toBe(true);
    expect(gate('Paid {{ amount | currency:EUR }}.')).toEqual([]);
  });
});

describe('action text templates over declared params (#34374 PR2)', () => {
  const action = (texts: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    name: 'send_email',
    label: 'Send email',
    type: 'script',
    body: { language: 'js', source: "return ctx.text('email_subject', { subject: input.subject });" },
    texts,
    ...extra,
  });
  const text = (message: string, params: string[] | undefined = ['subject']) => ({
    email_subject: params ? { message, params } : { message },
  });
  const stackWith = (message: string, params?: string[] | undefined) => ({
    objects: [{ name: 'crm_contact', actions: [action(text(message, params))] }],
  });
  const actionIssues = (message: string, params?: string[]) =>
    actionRefusalTemplateIssues(stackWith(message, params), { actions: true, objects: true });

  it.each([
    'Email: {{ subject }}',
    'Email: {{ subject | upper }}',
    'Paid {{ subject | currency:EUR }}',
  ])('CONTROL: accepts %j', (message) => {
    expect(actionIssues(message)).toEqual([]);
  });

  it.each([
    ['an unknown formatter', 'Email: {{ subject | shout }}'],
    ['logic', 'Email: {{ subject + 1 }}'],
    ['an empty hole', 'Email: {{ }}'],
  ])('refuses %s as an error at texts.<key>.message, naming the object and the action', (_label, message) => {
    const issues = actionIssues(message);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0]!.where).toBe("object 'crm_contact' · action 'send_email' texts.email_subject.message");
  });

  it('refuses a currency formatter with no code, naming the code spelling', () => {
    const issues = actionIssues('Paid {{ subject | currency }}');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('{{ subject | currency:EUR }}');
  });

  it('a text with no params is not read here (the parse refuses every hole in it)', () => {
    const issues = actionRefusalTemplateIssues(
      { actions: [action({ email_subject: { message: 'Email {{ subject | shout }}' } })] },
      { actions: true, objects: true },
    );
    expect(issues).toEqual([]);
  });

  it('judges a text and a refusal on one action, each at its own path', () => {
    const both = action(text('Email: {{ subject | shout }}'), {
      refusals: { NOT_SENT: { message: 'Not sent {{ reason | shout }}.', params: ['reason'] } },
    });
    const issues = actionRefusalTemplateIssues({ actions: [both] }, { actions: true, objects: true });
    expect(issues.map((i) => i.where).sort()).toEqual([
      "stack · action 'send_email' refusals.NOT_SENT.message",
      "stack · action 'send_email' texts.email_subject.message",
    ]);
  });

  it('is part of the stack expression pass `objectstack validate` and `compile` run', () => {
    const issues = validateStackExpressions(stackWith('Email: {{ subject | shout }}') as never);
    expect(issues.some((i) => i.where.endsWith("action 'send_email' texts.email_subject.message") && i.severity === 'error'))
      .toBe(true);
  });

  it('refuses an `action` write at the publish gate, and passes the CONTROL', () => {
    const gate = (message: string) =>
      runRuntimeAuthoringRules({ type: 'action', item: action(text(message)), context: { objects: [] } })
        .errors.filter((e) => String(e.where ?? '').includes('texts.'));
    const refused = gate('Paid {{ subject | currency }}');
    expect(refused.some((e) => String(e.message).includes('{{ subject | currency:EUR }}')), JSON.stringify(refused)).toBe(true);
    expect(gate('Paid {{ subject | currency:EUR }}')).toEqual([]);
  });
});
