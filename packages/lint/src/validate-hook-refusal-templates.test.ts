// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33214] A hook refusal sentence over declared `params` is compiled as the
 * template it is: logic, an unknown formatter, an empty hole and a `currency`
 * formatter with no code are errors — at `objectstack validate` / `compile`
 * (the stack expression pass) and at the publish gate's `hook` write.
 */

import { describe, it, expect } from 'vitest';
import { hookRefusalTemplateIssues } from './validate-hook-refusal-templates.js';
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
