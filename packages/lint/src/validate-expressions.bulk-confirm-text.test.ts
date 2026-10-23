// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #24798 (ruling B) — a bulk action's `confirmText` is an ADR-0032 `template`
// slot over the closed scope `bulkConfirmTemplateRoots(def)` declares (`count`
// and the def's params by name). `validateStackExpressions` — the rule
// `objectstack validate`, `objectstack compile` and the runtime publish gate
// all run — judges it through the template judge's closed-scope entry, then
// compiles it as a template. Every finding is a WARNING: each of these
// sentences parsed before the slot was typed, so a refusal is a narrowing no
// conversion carries, and it is its own change, not this one.
//
// The gate half drives the REAL dispatch (`runRuntimeAuthoringRules`) with the
// three shapes a view write carries — the container's `list`, the flattened
// list overlay and the ViewItem record — because a `runtimeTypes` widening
// whose walk reads none of them is a no-op that reads as coverage.

import { describe, expect, it } from 'vitest';

import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

const objects = [{ name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } }];

const updateTier = (confirmText: unknown) => ({
  name: 'update_tier',
  label: 'Update Tier',
  operation: 'update',
  confirmText,
  params: [{ name: 'tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }] }],
});

const stackWith = (confirmText: unknown) => ({
  objects,
  views: [{ name: 'crm_account', object: 'crm_account', list: { type: 'grid', columns: ['name'], bulkActionDefs: [updateTier(confirmText)] } }],
});

const confirmIssues = (stack: Record<string, unknown>) =>
  validateStackExpressions(stack).filter((i) => i.where.includes('confirmText'));

describe('validateStackExpressions — a bulk confirmText is judged as the template slot it is (#24798)', () => {
  it('passes the HotCRM sentences, a formatter, plain text — bare or as the parsed envelope', () => {
    for (const text of [
      'Update tier on {{count}} account(s) to {{tier}}?',
      '将 {{count}} 个客户的等级更新为 {{tier}}？',
      'Delete {{ count | number }} account(s)?',
      'Set these labels on every selected project?',
    ]) {
      expect(confirmIssues(stackWith(text)), text).toEqual([]);
      expect(confirmIssues(stackWith({ dialect: 'template', source: text })), text).toEqual([]);
    }
  });

  it('warns on a hole over an unbound root, naming it and the roots the def binds', () => {
    const [issue, ...rest] = confirmIssues(stackWith('Move {{count}} to {{ owner }}?'));
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe('warning');
    expect(issue!.where).toBe("view 'crm_account' · list · bulkActionDefs[0] 'update_tier' confirmText");
    expect(issue!.message).toContain('binds only `count`, `tier`');
    expect(issue!.message).toContain('`{{ owner }}`');
    expect(issue!.source).toBe('Move {{count}} to {{ owner }}?');
  });

  it('warns on a single-brace token, prescribing its `{{ }}` spelling', () => {
    const [issue] = confirmIssues(stackWith('Update {count} account(s) to {tier}?'));
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toContain('Write `Update {count} account(s) to {tier}?` as `Update {{ count }} account(s) to {{ tier }}?`.');
  });

  it('warns on a hole holding logic or an unknown formatter — the template compile step', () => {
    for (const text of ['{{ count * 2 }} rows', '{{ count | shout }} rows']) {
      const issues = confirmIssues(stackWith(text));
      expect(issues.length, text).toBeGreaterThan(0);
      expect(issues.every((i) => i.severity === 'warning'), text).toBe(true);
    }
  });

  it('warns on a blank sentence, which the parse still accepts in 18.x', () => {
    const [issue] = confirmIssues(stackWith('  '));
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toMatch(/^A bulk action's `confirmText` is blank/);
  });

  it('raises no error at all: every bulk confirmText finding is a warning', () => {
    const stack = stackWith('{x} {{ y }} {{ count * 2 }}');
    expect(validateStackExpressions(stack).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('judges an object\'s own listViews, and a def with no confirmText not at all', () => {
    const stack = {
      objects: [{ ...objects[0], listViews: { all: { type: 'grid', columns: ['name'], bulkActionDefs: [updateTier('{{ x }}'), { name: 'del', operation: 'delete' }] } } }],
    };
    const issues = confirmIssues(stack);
    expect(issues.map((i) => i.where)).toEqual(["object 'crm_account' · listViews.all · bulkActionDefs[0] 'update_tier' confirmText"]);
    // The object write runs the pass over the object's own body too.
    expect(runStackExpressionPasses(stack, { runtimeWriteType: 'object' }).filter((i) => i.where.includes('confirmText'))).toHaveLength(1);
  });

  it('on a view write runs that pass alone', () => {
    const stack = { ...stackWith('{{ x }}'), flows: [{ name: 'f', nodes: [{ id: 'n', type: 'notify', config: { title: '{bad}' } }] }] };
    const issues = runStackExpressionPasses(stack, { runtimeWriteType: 'view' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toContain('confirmText');
  });
});

describe('the runtime publish gate on a view write — an advisory, never a refusal, in 18.x (#24798)', () => {
  const gate = (item: unknown) => runRuntimeAuthoringRules({ type: 'view', item, context: { objects } });
  const advisoriesOn = (item: unknown) => {
    const { errors, advisories } = gate(item);
    return { errors: errors.filter((f) => f.where.includes('confirmText')), advisories: advisories.filter((f) => f.where.includes('confirmText')) };
  };
  const shapes: Array<[string, (confirmText: unknown) => unknown]> = [
    ['a container\'s list', (c) => stackWith(c).views[0]],
    ['the flattened list overlay', (c) => ({ name: 'crm_account.tier', object: 'crm_account', viewKind: 'list', type: 'grid', columns: ['name'], bulkActionDefs: [updateTier(c)] })],
    ['the ViewItem record', (c) => ({ name: 'crm_account.tier', object: 'crm_account', viewKind: 'list', config: { type: 'grid', columns: ['name'], bulkActionDefs: [updateTier(c)] } })],
  ];

  for (const [label, item] of shapes) {
    it(`names an unbound hole on ${label} as an advisory`, () => {
      const { errors, advisories } = advisoriesOn(item('Move {{count}} to {{ owner }}?'));
      expect(errors).toEqual([]);
      expect(advisories, label).toHaveLength(1);
      expect(advisories[0]!.message).toContain('`{{ owner }}`');
    });

    it(`control: the HotCRM sentence on ${label} draws nothing`, () => {
      expect(advisoriesOn(item('Update tier on {{count}} account(s) to {{tier}}?'))).toEqual({ errors: [], advisories: [] });
    });
  }
});
