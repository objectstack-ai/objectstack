// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { explainRule } from './rule-explanations.js';

import {
  SANDBOX_API_WRITE_METHODS,
  bodyApiWriteCalls,
  validateActionBodyCapabilities,
} from './validate-action-body-capabilities.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

import { ACTION_BODY_WRITE_CAPABILITY_UNDECLARED } from './validate-action-body-capabilities.js';
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, '../../runtime/src/sandbox/quickjs-runner.ts');

const TASK = {
  name: 'pr_task',
  label: 'Task',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' }, done: { type: 'boolean', label: 'Done' } },
};

const action = (source: string, capabilities?: string[], extra: Record<string, unknown> = {}) => ({
  name: 'pr_close',
  label: 'Close',
  objectName: 'pr_task',
  type: 'script',
  locations: ['record_page'],
  body: { language: 'js', source, ...(capabilities ? { capabilities } : {}) },
  ...extra,
});

describe('validateActionBodyCapabilities (#35143)', () => {
  it('the write set is the sandbox runner’s `api.write` leaves, exactly', () => {
    const runner = readFileSync(RUNNER, 'utf8');
    const m = /const WRITE = \[([^\]]*)\] as const;/.exec(runner);
    expect(m, 'the runner no longer declares `const WRITE = [...]`').not.toBeNull();
    const declared = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect([...SANDBOX_API_WRITE_METHODS].sort()).toEqual(declared.sort());
  });

  it('refuses a body that writes through ctx.api with no api.write grant', () => {
    const findings = validateActionBodyCapabilities({
      actions: [action("await ctx.api.object('pr_task').update({ id: ctx.recordId, done: true });", ['api.read'])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: ACTION_BODY_WRITE_CAPABILITY_UNDECLARED,
      where: 'action "pr_close" › body',
      path: 'actions[0].body.capabilities',
    });
    expect(findings[0].message).toContain("'api.write'");
    expect(findings[0].hint).toContain("Add 'api.write'");
  });

  it('refuses when capabilities is absent (the spec default is none)', () => {
    expect(
      validateActionBodyCapabilities({ actions: [action("await ctx.api.object('pr_task').insert({ name: 'x' });")] }),
    ).toHaveLength(1);
  });

  it('passes the same body once api.write is granted', () => {
    expect(
      validateActionBodyCapabilities({
        actions: [action("await ctx.api.object('pr_task').update({ id: ctx.recordId, done: true });", ['api.write'])],
      }),
    ).toEqual([]);
  });

  it('reads an inline action on an object', () => {
    const findings = validateActionBodyCapabilities({
      objects: [{ ...TASK, actions: [action("await ctx.api.object('pr_task').delete({ id: ctx.recordId });", [])] }],
    });
    expect(findings.map((f) => f.path)).toEqual(['objects[0].actions[0].body.capabilities']);
  });

  it('does not read a non-script action or an expression body', () => {
    expect(
      validateActionBodyCapabilities({
        actions: [
          action("await ctx.api.object('pr_task').insert({});", [], { type: 'flow', target: 'x' }),
          { ...action('1'), body: { language: 'expression', source: "ctx.api.object('pr_task').insert({})" } },
        ],
      }),
    ).toEqual([]);
  });

  describe('which calls are read', () => {
    it.each([
      ['direct', "await ctx.api.object('a').insert({});", ['insert']],
      ['optional chain', "await ctx?.api?.object('a')?.upsert({});", ['upsert']],
      ['optional chain after ctx.api', "await ctx.api?.object('a')?.upsert({});", ['upsert']],
      ['the Many leaves', "await ctx.api.object('a').updateMany({}, {}); await ctx.api.object('a').deleteMany({});", ['updateMany', 'deleteMany']],
      ['a dynamic object name', 'await ctx.api.object(name).update({ id });', ['update']],
      ['an alias of ctx.api', "const api = ctx.api; await api.object('a').update({});", ['update']],
      ['a typed alias', "const api = ctx.api as HookApi | undefined; await api?.object('a').update({});", ['update']],
      ['a destructured alias', "const { api } = ctx; await api.object('a').delete({});", ['delete']],
      ['a renamed destructure', "const { api: a } = ctx; await a.object('x').insert({});", ['insert']],
      ['a bound handle', "const repo = ctx.api.object('a');\nawait repo.update({ id: 1 });", ['update']],
      ['reads only', "await ctx.api.object('a').find({}); await ctx.api.object('a').count({});", []],
      ['a write spelled in a string', "const s = \"ctx.api.object('a').insert({})\"; return s;", []],
      ['a write spelled in a template literal', 'return `ctx.api.object(x).update({})`;', []],
      ['a write in a comment', "// await ctx.api.object('a').insert({});\nreturn 1;", []],
      ['a block comment', "/* ctx.api.object('a').delete({}) */ return 1;", []],
      ['a reassigned alias', "let api = ctx.api; api = other; await api.object('a').insert({});", []],
      ['an alias declared twice', "const api = ctx.api; function f() { const api = x; return api.object('a').insert({}); }", []],
      ['an alias of ctx.api.sudo()', "const api = ctx.api.sudo(); await api.object('a').insert({});", []],
      ['another receiver', "await other.api.object('a').insert({});", []],
    ])('%s', (_label, source, expected) => {
      expect(bodyApiWriteCalls(source)).toEqual(expected);
    });
  });
});

describe('validateActionBodyCapabilities at the runtime publish door (#35143)', () => {
  it('is dispatched for action and object writes', () => {
    expect(runtimeAuthoringRulesFor('action').map((r) => r.name)).toContain('validateActionBodyCapabilities');
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateActionBodyCapabilities');
  });

  it('refuses an action write whose body writes with no api.write grant, and passes it granted', () => {
    const refused = runRuntimeAuthoringRules({
      type: 'action',
      item: action("await ctx.api.object('pr_task').update({ id: ctx.recordId, done: true });", []),
      context: { objects: [TASK] },
    });
    expect(refused.errors.map((e) => [e.rule, e.severity, e.path])).toEqual([
      [ACTION_BODY_WRITE_CAPABILITY_UNDECLARED, 'error', 'actions[0].body.capabilities'],
    ]);

    const granted = runRuntimeAuthoringRules({
      type: 'action',
      item: action("await ctx.api.object('pr_task').update({ id: ctx.recordId, done: true });", ['api.write']),
      context: { objects: [TASK] },
    });
    expect(granted.errors).toEqual([]);
    expect(granted.rulesRun).toContain('validateActionBodyCapabilities');
  });

  it('refuses an object write that adds an inline action with the same body', () => {
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: { ...TASK, actions: [action("await ctx.api.object('pr_task').insert({ name: 'x' });", [])] },
      context: { objects: [] },
    });
    // The object door locates an object write by name.
    expect(result.errors.filter((e) => e.rule === ACTION_BODY_WRITE_CAPABILITY_UNDECLARED).map((e) => e.path)).toEqual([
      'objects.pr_task.actions[0].body.capabilities',
    ]);
  });
});

describe('`os explain action-body-write-capability-undeclared` (#35143)', () => {
  it('has an entry that names the remedy', () => {
    const entry = explainRule('action-body-write-capability-undeclared');
    expect(entry?.rule).toBe('action-body-write-capability-undeclared');
    expect(entry?.paragraphs.join('\n')).toContain('api.write');
  });
});
