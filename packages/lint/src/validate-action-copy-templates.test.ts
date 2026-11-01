// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #24814 (ruling A) — an action's person-facing copy is an ADR-0032 `template`
// slot over the closed scope the console's runner binds: `confirmText` over
// `record` (and `params` beside static values), `successMessage` over `result`
// and `record`, `errorMessage` over nothing. `validateStackExpressions` — the
// rule `objectstack validate`, `objectstack compile` and the runtime publish
// gate all run — judges every sentence through the template judge's
// closed-scope entry, then compiles it as a template. Every finding is an
// ERROR (#25680), so the publish gate refuses the write — a `${…}` token in a
// sentence with no `{{ }}` hole included (#25709): the console's runner shows
// it as written, so no finding rides the advisory channel any more. So a pin
// here asserts the severity per finding and, at the publish gate, that the
// finding rides the error channel and never the advisory one.
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

  it('refuses a holeless `${…}` sentence — the runner shows it as written — prescribing its `{{ }}` hole, never `${{ … }}`', () => {
    const [issue, ...rest] = copyIssues({ objects, actions: [invite({ successMessage: 'Invitation sent to ${result.email}' })] });
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe('error');
    expect(issue!.where).toBe("stack · action 'invite' successMessage");
    expect(issue!.message).toContain('Write `Invitation sent to ${result.email}` as `Invitation sent to {{ result.email }}`.');
    expect(issue!.message).not.toContain('${{');
    expect(issue!.message).not.toMatch(/A warning, not a refusal/);
    const confirms = copyIssues({ objects, actions: [invite({ confirmText: 'Invite ${record.name}?' })] });
    expect(confirms.map((i) => [i.where, i.severity])).toEqual([["stack · action 'invite' confirmText", 'error']]);
    expect(confirms[0]!.message).toContain('as `Invite {{ record.name }}?`');
  });

  it('refuses a `${…}` token in every other shape too — off the record/result roots, beside a `{{ }}` hole, or beside a `{x}`', () => {
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
    expect(issues.map((i) => i.severity)).toEqual(['error', 'error', 'error', 'error']);
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

describe('the runtime publish gate — every finding a refusal, a holeless `${…}` included (#24814, #25680, #25709)', () => {
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

  it('a page write carrying a holeless `${record.*}` confirmText answers one error and no advisory', () => {
    const { errors, advisories } = findings('page', row({ confirmText: 'Delete ${record.name}?' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.where).toContain('confirmText');
    expect(errors[0]!.message).toContain('as `Delete {{ record.name }}?`');
    expect(advisories).toEqual([]);
  });

  it('an action write carrying a holeless `${result.*}` successMessage answers one error and no advisory', () => {
    const { errors, advisories } = findings('action', invite({ successMessage: 'Invitation sent to ${result.email}' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.where).toContain('successMessage');
    expect(errors[0]!.message).toContain('as `Invitation sent to {{ result.email }}`');
    expect(advisories).toEqual([]);
  });

  it('control: the converted platform sentence draws nothing', () => {
    expect(findings('action', invite({ successMessage: 'Invitation sent to {{ result.email }}' }))).toEqual({ errors: [], advisories: [] });
  });
});

// #27948 (ruling A, step 2) — the param dialog's `description`, each
// `params[].helpText` and each `outcomeMessages` entry joined the family: the
// dialog copy over `confirmText`'s roots (`record`; a registered action's
// `params` is the input list, which binds nothing), an outcome over
// `successMessage`'s (`result`, `record`). The doors refuse a `${…}` token
// there exactly as in the other keys, prescribing the `{{ }}` hole.
describe('validateStackExpressions — description, params[].helpText and outcomeMessages are template slots (#27948)', () => {
  const newSlotIssues = (stack: Record<string, unknown>) =>
    validateStackExpressions(stack).filter((i) => /description|helpText|outcomeMessages/.test(i.where));
  const withParam = (helpText: unknown) => ({ params: [{ name: 'reason', type: 'text', helpText }] });

  it('passes plain text and holes over bound roots — bare, as the envelope, or in a locale map', () => {
    for (const patch of [
      { description: 'Resend the invitation to {{ record.email }}?' },
      { description: { dialect: 'template', source: 'Pause {{ record.name }}?' } },
      { description: { en: 'Pause {{ record.name }}?', 'zh-CN': '暂停 {{ record.name }}？' } },
      { description: "Choose the role for {{ record.user_id.name | default:'this member' }}." },
      withParam('Why pause {{ record.name }}?'),
      withParam('Plain hint'),
      { outcomeMessages: { sent: 'Invitation sent to {{ result.email }}', kept: 'Kept {{ record.name }}' } },
      { outcomeMessages: { sent: { en: 'Sent to {{ result.email }}', 'zh-CN': '已发送至 {{ result.email }}' } } },
    ]) {
      expect(newSlotIssues({ objects, actions: [invite(patch)] }), JSON.stringify(patch)).toEqual([]);
    }
  });

  it('refuses a `${…}` token in each, as an error at its own path, prescribing the `{{ }}` hole', () => {
    const issues = newSlotIssues({
      objects,
      actions: [invite({
        description: 'Resend the invitation to ${record.email}?',
        params: [{ name: 'reason', type: 'text', helpText: 'Why ${record.name}?' }],
        outcomeMessages: { sent: 'Invitation sent to ${result.email}', kept: { en: 'Kept', 'zh-CN': '保留 ${record.name}' } },
      })],
    });
    expect(issues.map((i) => [i.where, i.severity])).toEqual([
      ["stack · action 'invite' description", 'error'],
      ["stack · action 'invite' outcomeMessages.sent", 'error'],
      ["stack · action 'invite' outcomeMessages.kept.zh-CN", 'error'],
      ["stack · action 'invite' params[0].helpText", 'error'],
    ]);
    expect(issues[0]!.message).toContain("An action's `description`");
    expect(issues[0]!.message).toContain('as `Resend the invitation to {{ record.email }}?`');
    expect(issues[1]!.message).toContain("An action's `outcomeMessages` entry");
    expect(issues[1]!.message).toContain('as `Invitation sent to {{ result.email }}`');
    expect(issues[3]!.message).toContain("An action param's `helpText`");
    expect(issues[3]!.message).toContain('as `Why {{ record.name }}?`');
  });

  it('binds what the runner binds: `result` is refused in the dialog copy, accepted in an outcome', () => {
    const issues = newSlotIssues({
      objects,
      actions: [invite({ description: 'Sent to {{ result.email }}', ...withParam('{{ result.email }}'), outcomeMessages: { sent: '{{ result.email }}' } })],
    });
    expect(issues.map((i) => i.where)).toEqual([
      "stack · action 'invite' description",
      "stack · action 'invite' params[0].helpText",
    ]);
  });

  it('refuses a blank sentence, a single-brace token and an unknown formatter', () => {
    const issues = newSlotIssues({
      objects,
      actions: [invite({ description: ' ', ...withParam('Why {record.name}?'), outcomeMessages: { sent: '{{ result.email | shout }}' } })],
    });
    expect(issues.map((i) => i.where)).toEqual([
      "stack · action 'invite' description",
      "stack · action 'invite' outcomeMessages.sent",
      "stack · action 'invite' params[0].helpText",
    ]);
    expect(issues[0]!.message).toContain('is blank');
  });

  it('judges an inline `properties.action` param helpText; an object\'s own action on an object write', () => {
    const page = pageWith([{
      type: 'element:button',
      properties: { action: { type: 'script', target: 'run', params: [{ name: 'reason', type: 'text', helpText: 'Why ${record.name}?' }] } },
    }]);
    const pageIssues = runStackExpressionPasses({ objects, pages: [page] }, { runtimeWriteType: 'page' })
      .filter((i) => /helpText/.test(i.where));
    expect(pageIssues).toHaveLength(1);
    expect(pageIssues[0]!.where).toContain('· action params[0].helpText');

    const onObjectWrite = newSlotIssues({ objects: [{ ...objects[0], actions: [invite({ description: 'Hi ${record.name}' })] }] });
    expect(onObjectWrite.map((i) => i.where)).toEqual(["object 'crm_account' · action 'invite' description"]);
  });

  it('the publish gate answers each `${…}` with one error and no advisory', () => {
    const gate = (item: unknown) => {
      const { errors, advisories } = runRuntimeAuthoringRules({ type: 'action', item, context: { objects } });
      const copy = (f: { where: string }) => /description|helpText|outcomeMessages/.test(f.where);
      return { errors: errors.filter(copy), advisories: advisories.filter(copy) };
    };
    for (const patch of [
      { description: 'Resend to ${record.email}?' },
      withParam('Why ${record.name}?'),
      { outcomeMessages: { sent: 'Invitation sent to ${result.email}' } },
    ]) {
      const { errors, advisories } = gate(invite(patch));
      expect(errors, JSON.stringify(patch)).toHaveLength(1);
      expect(advisories, JSON.stringify(patch)).toEqual([]);
    }
    expect(gate(invite({ outcomeMessages: { sent: 'Invitation sent to {{ result.email }}' } }))).toEqual({ errors: [], advisories: [] });
  });
});
