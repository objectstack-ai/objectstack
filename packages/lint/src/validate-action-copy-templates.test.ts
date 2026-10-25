// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #24814 (ruling A) — an action's person-facing copy is an ADR-0032 `template`
// slot over the closed scope the console's runner binds: `confirmText` over
// `record` (and `params` beside static values), `successMessage` over `result`
// and `record`, `errorMessage` over nothing. `validateStackExpressions` — the
// rule `objectstack validate`, `objectstack compile` and the runtime publish
// gate all run — judges every sentence through the template judge's
// closed-scope entry, then compiles it as a template. Every finding is an
// ERROR (#25680), so the publish gate refuses the write; one stays a WARNING,
// a `${…}` token the console's runner still fills in a sentence with no
// `{{ }}` hole (`ACTION_COPY_DOLLAR_TRANSITION_ROOTS`). So a pin here asserts
// the severity per finding and, at the publish gate, which channel it rides.
//
// The gate half drives the REAL dispatch (`runRuntimeAuthoringRules`) with a
// page write and an action write, because a `runtimeTypes` widening whose
// walk reads nothing is a no-op that reads as coverage.

import { describe, expect, it } from 'vitest';

import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

const objects = [{ name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }];

const invite = (patch: Record<string, unknown>) => ({
  name: 'invite',
  label: 'Invite',
  type: 'api',
  target: '/api/v1/invite',
  objectName: 'crm_account',
  ...patch,
});

const copyIssues = (stack: Record<string, unknown>) =>
  validateStackExpressions(stack).filter((i) => /confirmText|successMessage|errorMessage/.test(i.where));

const pageWith = (components: unknown[]) => ({
  name: 'account_home',
  type: 'record',
  object: 'crm_account',
  regions: [{ name: 'main', components }],
});

describe('validateStackExpressions — a registered action\'s copy is judged as the template slot it is (#24814)', () => {
  it('passes plain text and holes over bound roots — bare, as the envelope, or in a locale map', () => {
    for (const patch of [
      { confirmText: 'Invite {{ record.name }}?' },
      { successMessage: 'Invitation sent to {{ result.email }}' },
      { successMessage: 'Sent to {{ result.email }} for {{ record.name | upper }}' },
      { successMessage: { dialect: 'template', source: 'Sent to {{ result.email }}' } },
      { successMessage: { en: 'Sent to {{ result.email }}', 'zh-CN': '已发送至 {{ result.email }}' } },
      { confirmText: 'Invite this contact?', successMessage: 'Invitation sent' },
    ]) {
      expect(copyIssues({ objects, actions: [invite(patch)] }), JSON.stringify(patch)).toEqual([]);
    }
  });

  it('names a `${…}` token the runner still fills with a WARNING prescribing its `{{ }}` hole, never `${{ … }}`', () => {
    const [issue, ...rest] = copyIssues({ objects, actions: [invite({ successMessage: 'Invitation sent to ${result.email}' })] });
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe('warning');
    expect(issue!.where).toBe("stack · action 'invite' successMessage");
    expect(issue!.message).toContain('Write `Invitation sent to ${result.email}` as `Invitation sent to {{ result.email }}`.');
    expect(issue!.message).not.toContain('${{');
    const [confirm] = copyIssues({ objects, actions: [invite({ confirmText: 'Invite ${record.name}?' })] });
    expect(confirm!.severity).toBe('warning');
  });

  it('refuses a `${…}` token the runner shows raw — off its transitional roots, beside a `{{ }}` hole, or beside a `{x}`', () => {
    for (const patch of [
      // `composeSuccessMessage` substitutes `${result.*}` alone.
      { successMessage: 'Sent for ${record.name}' },
      // A sentence with a `{{ }}` hole is filled by the template engine alone.
      { successMessage: 'Sent to {{ result.email }} at ${result.at}' },
      // The `${…}` evaluator does not bind the static `params`.
      { confirmText: 'Run for ${params.tier}?', params: { tier: 'gold' } },
      { confirmText: 'Invite ${record.name} as {role}?' },
    ]) {
      const issues = copyIssues({ objects, actions: [invite(patch)] });
      expect(issues.length, JSON.stringify(patch)).toBe(1);
      expect(issues[0]!.severity, JSON.stringify(patch)).toBe('error');
      expect(issues[0]!.message).not.toMatch(/A warning, not a refusal/);
    }
  });

  it('refuses a hole over a root the runner does not bind — `result` in a confirmText', () => {
    const [issue] = copyIssues({ objects, actions: [invite({ confirmText: 'Send to {{ result.email }}?' })] });
    expect(issue!.severity).toBe('error');
    expect(issue!.message).toContain("An action's `confirmText` binds only `record`");
    expect(issue!.message).toContain('`{{ result.email }}`');
  });

  it('judges each value of a locale map at its own location', () => {
    const issues = copyIssues({ objects, actions: [invite({ successMessage: { en: 'Sent', 'zh-CN': '已发送 {result.email}' } })] });
    expect(issues.map((i) => [i.where, i.severity])).toEqual([["stack · action 'invite' successMessage.zh-CN", 'error']]);
  });

  it('refuses a single-brace token, logic in a hole, an unknown formatter and a blank sentence — all errors', () => {
    for (const successMessage of ['{result.email} sent', '{{ result.count * 2 }} sent', '{{ result.email | shout }}', '', '  ']) {
      const issues = copyIssues({ objects, actions: [invite({ successMessage })] });
      expect(issues.length, successMessage).toBeGreaterThan(0);
      expect(issues.every((i) => i.severity === 'error'), successMessage).toBe(true);
    }
  });

  it('judges an object\'s own actions on an object write, once when also declared top-level', () => {
    const action = invite({ confirmText: 'Invite ${record.name}?' });
    const stack = { objects: [{ ...objects[0], actions: [action] }], actions: [action] };
    expect(copyIssues(stack)).toHaveLength(1);
    const onObjectWrite = runStackExpressionPasses({ objects: stack.objects }, { runtimeWriteType: 'object' })
      .filter((i) => i.where.includes('confirmText'));
    expect(onObjectWrite.map((i) => i.where)).toEqual(["object 'crm_account' · action 'invite' confirmText"]);
  });

  it('control: ActionSchema\'s errorMessage is not in the family — a `${…}` there draws nothing', () => {
    expect(copyIssues({ objects, actions: [invite({ errorMessage: 'Failed for ${record.name}' })] })).toEqual([]);
  });
});

describe('validateStackExpressions — a page action row\'s copy (#24814)', () => {
  it('judges an action:button\'s three keys, binding `params` only beside static values', () => {
    const button = (properties: Record<string, unknown>) => ({ type: 'action:button', properties: { label: 'Run', actionType: 'script', target: 'run', ...properties } });
    const issues = copyIssues({
      objects,
      pages: [pageWith([
        button({ confirmText: 'Run for {{ params.tier }}?', params: { tier: 'gold' } }),
        button({ confirmText: 'Run for {{ params.tier }}?', params: [{ name: 'tier', type: 'text' }] }),
        button({ errorMessage: 'Failed for {{ record.name }}' }),
        button({ successMessage: 'Done', errorMessage: 'Could not run' }),
      ])],
    });
    expect(issues.map((i) => i.where)).toEqual([
      "page 'account_home'.regions[0].components[1] (action:button) · confirmText",
      "page 'account_home'.regions[0].components[2] (action:button) · errorMessage",
    ]);
    expect(issues[0]!.message).toContain("binds only `record`, so a hole over any other root");
    expect(issues[1]!.message).toContain('binds no root, so it fills no hole');
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('refuses a `${…}` token in an errorMessage: the runner shows it as written', () => {
    const issues = copyIssues({
      objects,
      pages: [pageWith([{ type: 'action:button', properties: { label: 'Run', actionType: 'script', target: 'run', errorMessage: 'Failed for ${record.name}' } }])],
    });
    expect(issues.map((i) => [i.where, i.severity])).toEqual([
      ["page 'account_home'.regions[0].components[0] (action:button) · errorMessage", 'error'],
    ]);
  });

  it('judges each action:group / action:menu member, an action:icon, and an inline `properties.action`', () => {
    const issues = copyIssues({
      objects,
      pages: [pageWith([
        { type: 'action:group', properties: { actions: [{ name: 'a', type: 'script', target: 'a', confirmText: 'Run ${record.name}?' }] } },
        { type: 'action:menu', properties: { actions: [{ name: 'b', type: 'script', target: 'b', successMessage: '{count} done' }] } },
        { type: 'action:icon', properties: { label: 'X', actionType: 'script', target: 'x', confirmText: '' } },
        { type: 'element:button', properties: { label: 'Go', action: { type: 'script', target: 'go', successMessage: 'Went to ${result.url}' } } },
      ])],
    });
    expect(issues.map((i) => i.where)).toEqual([
      "page 'account_home'.regions[0].components[0] (action:group) · actions[0] confirmText",
      "page 'account_home'.regions[0].components[1] (action:menu) · actions[0] successMessage",
      "page 'account_home'.regions[0].components[2] (action:icon) · confirmText",
      "page 'account_home'.regions[0].components[3] (element:button) · action successMessage",
    ]);
    expect(issues[0]!.message).toContain('as `Run {{ record.name }}?`');
    expect(issues[2]!.message).toMatch(/^An action's `confirmText` is blank/);
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'error', 'error', 'warning']);
  });

  it('on a page write runs that pass alone', () => {
    const stack = {
      objects,
      pages: [pageWith([{ type: 'action:button', properties: { label: 'Run', actionType: 'script', target: 'run', confirmText: '{{ x }}' } }])],
      flows: [{ name: 'f', nodes: [{ id: 'n', type: 'notify', config: { title: '{bad}' } }] }],
    };
    const issues = runStackExpressionPasses(stack, { runtimeWriteType: 'page' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toContain('confirmText');
  });
});

describe('the runtime publish gate — a refusal, but for the runner\'s transitional `${…}` (#24814, #25680)', () => {
  const findings = (type: string, item: unknown) => {
    const { errors, advisories } = runRuntimeAuthoringRules({ type, item, context: { objects } });
    const copy = (f: { where: string }) => /confirmText|successMessage|errorMessage/.test(f.where);
    return { errors: errors.filter(copy), advisories: advisories.filter(copy) };
  };
  const row = (properties: Record<string, unknown>) =>
    pageWith([{ type: 'action:button', properties: { label: 'Run', actionType: 'script', target: 'run', ...properties } }]);

  it('a page write carrying a single-brace, an unbound or a blank confirmText answers one error and no advisory', () => {
    for (const confirmText of ['Delete {record.name}?', 'Delete {{ result.name }}?', '']) {
      const { errors, advisories } = findings('page', row({ confirmText }));
      expect(errors, confirmText).toHaveLength(1);
      expect(errors[0]!.where, confirmText).toContain('confirmText');
      expect(advisories, confirmText).toEqual([]);
    }
  });

  it('an action and an object write carrying an unbound successMessage answer one error', () => {
    const action = invite({ successMessage: 'Sent to {{ owner.email }}' });
    expect(findings('action', action).errors).toHaveLength(1);
    expect(findings('object', { ...objects[0], actions: [action] }).errors).toHaveLength(1);
  });

  it('a page write carrying a transitional `${…}` confirmText answers one advisory and no error', () => {
    const { errors, advisories } = findings('page', row({ confirmText: 'Delete ${record.name}?' }));
    expect(errors).toEqual([]);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]!.message).toContain('as `Delete {{ record.name }}?`');
  });

  it('an action write carrying a `${result.*}` successMessage answers one advisory and no error', () => {
    const { errors, advisories } = findings('action', invite({ successMessage: 'Invitation sent to ${result.email}' }));
    expect(errors).toEqual([]);
    expect(advisories).toHaveLength(1);
  });

  it('control: the converted platform sentence draws nothing', () => {
    expect(findings('action', invite({ successMessage: 'Invitation sent to {{ result.email }}' }))).toEqual({ errors: [], advisories: [] });
  });
});
