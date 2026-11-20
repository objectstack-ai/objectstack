// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  ACTION_BODY_DOES_NOT_COMPILE,
  hostCompileFailure,
  validateActionBodyCompiles,
} from './validate-action-body-compiles.js';
import { actionBodyFunctionExpression } from './action-body-wrapper.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

/** The body the card's scenario run authored, byte for byte. */
const CARD_BODY = 'const input = ctx.input || {}; return 1;';

const scriptAction = (name: string, source: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: 'Probe',
  objectName: 'ab_ticket',
  type: 'script',
  locations: [],
  body: { language: 'js', source },
  ...extra,
});

const ticket = (actions: unknown[] = []) => ({
  name: 'ab_ticket',
  label: 'Ticket',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
  actions,
});

const compileFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === ACTION_BODY_DOES_NOT_COMPILE);

describe('action-body-does-not-compile · the wrapper is the runtime\'s', () => {
  it('compiles the body inside `(async (input, ctx) => { SOURCE })`, source on the first line', () => {
    expect(actionBodyFunctionExpression('return 1;')).toBe('(async (input, ctx) => { return 1; })');
  });

  it('refuses the card\'s body: `input` declared again is a SyntaxError in that wrapper', () => {
    const [f, ...rest] = validateActionBodyCompiles({ actions: [scriptAction('decide_approval_step', CARD_BODY)] });
    expect(rest).toEqual([]);
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(ACTION_BODY_DOES_NOT_COMPILE);
    expect(f.where).toBe('action "decide_approval_step" › body');
    expect(f.path).toBe('actions[0].body.source');
    expect(f.message).toContain('SyntaxError');
    expect(f.message).toContain("'input'");
    expect(f.message).toContain('line 1');
    expect(f.hint).toContain('`input` is already a parameter of the wrapper');
  });

  it('…while the same source compiles in the parse check\'s own wrapper, which is why that check never saw it', () => {
    // `action-body-source-unparseable` parses inside `async function __body(ctx)`, which binds no `input`.
    expect(hostCompileFailure(`async function __body(ctx) {\n${CARD_BODY}\n}`)).toBeUndefined();
  });

  it('refuses `let ctx` the same way, and names the line of body.source', () => {
    const [f] = validateActionBodyCompiles({ actions: [scriptAction('p', 'const a = 1;\n\nlet ctx = a;\nreturn ctx;')] });
    expect(f.severity).toBe('error');
    expect(f.message).toContain('line 3');
    expect(f.hint).toContain('`ctx` is already a parameter');
  });

  it('refuses a body that does not parse at all', () => {
    const [f] = validateActionBodyCompiles({ actions: [scriptAction('p', 'return {')] });
    expect(f.severity).toBe('error');
    expect(f.hint).toContain('async function whose parameters are `input` and `ctx`');
  });

  it('refuses `new.target`, which the wrapper, compiled as a script, does not allow', () => {
    expect(validateActionBodyCompiles({ actions: [scriptAction('p', 'new.target; return 1;')] })).toHaveLength(1);
  });

  it('accepts bodies that compile: `var input`, reading the params, a function named like a parameter', () => {
    const actions = [
      scriptAction('a1', 'var input = ctx.input || {}; return input;'),
      scriptAction('a2', 'const params = input || {}; return params.amount;'),
      scriptAction('a3', 'function input2() {} return await Promise.resolve(input2);'),
      scriptAction('a4', 'return { ok: true };'),
    ];
    expect(validateActionBodyCompiles({ actions })).toEqual([]);
  });

  it('reports a regular-expression pattern the host refuses as a warning, never a refusal', () => {
    const [f] = validateActionBodyCompiles({ actions: [scriptAction('p', 'return /(/.test(input.s);')] });
    expect(f.severity).toBe('warning');
    expect(f.message).toContain('regular expression');
  });

  it('never runs the body: a source that closes the wrapper early compiles and nothing in it executes', () => {
    const g = globalThis as { __actionBodyCompileProbe?: number };
    delete g.__actionBodyCompileProbe;
    const findings = validateActionBodyCompiles({
      actions: [scriptAction('p', '}); globalThis.__actionBodyCompileProbe = 1; ((x) => {')],
    });
    expect(findings).toEqual([]);
    expect(g.__actionBodyCompileProbe).toBeUndefined();
  });

  it('walks object-inline actions, a merged action once, and skips non-script and non-js bodies', () => {
    const bad = scriptAction('dup', CARD_BODY);
    const findings = validateActionBodyCompiles({
      actions: [bad, { ...scriptAction('modal', CARD_BODY), type: 'modal' }],
      objects: [ticket([bad, { ...scriptAction('other', 'x'), body: { language: 'formula', source: CARD_BODY } }])],
    });
    expect(findings.map((f) => f.path)).toEqual(['actions[0].body.source']);
  });
});

describe('action-body-does-not-compile · the doors that run it', () => {
  it('os validate, os build and os lint all refuse the card\'s body', () => {
    const stack = { objects: [ticket()], actions: [scriptAction('decide_approval_step', CARD_BODY)] };
    for (const command of ['validate', 'build', 'lint'] as const) {
      const fs = compileFindings(runAuthoringRules(command, { normalized: stack, parsed: stack }));
      expect(fs.map((f) => [f.severity, f.path]), command).toEqual([['error', 'actions[0].body.source']]);
    }
  });

  it('the runtime publish door refuses an action write carrying it, and admits one that compiles', () => {
    const refused = runRuntimeAuthoringRules({
      type: 'action',
      item: scriptAction('decide_approval_step', CARD_BODY),
      context: { objects: [ticket()] },
    });
    expect(compileFindings(refused.errors)).toHaveLength(1);
    expect(refused.rulesRun).toContain('validateActionBodyCompiles');

    const admitted = runRuntimeAuthoringRules({
      type: 'action',
      item: scriptAction('decide_approval_step', 'const params = input || {}; return 1;'),
      context: { objects: [ticket()] },
    });
    expect(compileFindings([...admitted.errors, ...admitted.advisories])).toEqual([]);
  });

  it('the object door refuses an object write whose inline action does not compile', () => {
    const r = runRuntimeAuthoringRules({ type: 'object', item: ticket([scriptAction('p', CARD_BODY)]), context: { objects: [] } });
    expect(compileFindings(r.errors)).toHaveLength(1);
  });

  it('an unrelated write is not charged with a stored action body that does not compile', () => {
    const r = runRuntimeAuthoringRules({
      type: 'object',
      item: { ...ticket(), name: 'ab_other', label: 'Other' },
      context: { objects: [ticket([scriptAction('p', CARD_BODY)])] },
    });
    expect(compileFindings(r.errors)).toEqual([]);
  });
});

describe('action-body-does-not-compile · a regular-expression literal\'s token is refused, only its pattern warns', () => {
  // Measured against the runtime's QuickJS (quickjs-emscripten, the engine quickjs-runner.ts runs a body in):
  // every case refused here is refused by QuickJS too, and both warning cases compile and run there.
  const only = (source: string) => {
    const findings = validateActionBodyCompiles({ actions: [scriptAction('p', source)] });
    expect(findings, source).toHaveLength(1);
    return findings[0];
  };

  it.each([
    ['an unterminated literal', 'return /abc;'],
    ['an unterminated literal whose class never closes', 'return /[/.test(input.s);'],
    ['a literal the body ends inside', 'const ok = /abc'],
    ['a literal broken by a line terminator', 'return /ab\nc/.test(input.s);'],
  ])('refuses %s at error, the way every other compile error is refused', (_label, source) => {
    const f = only(source);
    expect([f.rule, f.severity, f.path]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, 'error', 'actions[0].body.source']);
  });

  it.each([
    ['a repeated flag', 'return /a/gg;'],
    ['an unknown flag', 'return /a/zz;'],
    ['`u` with `v`', 'return /a/uv;'],
  ])('refuses a flag set that is not one, %s, at error', (_label, source) => {
    const f = only(source);
    expect([f.rule, f.severity]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, 'error']);
  });

  it.each([
    ['a duplicate named capture group', 'return /(?<a>x)|(?<a>y)/.test(input.s);'],
    ['a modifier group', 'return /(?i:a)/.test(input.s);'],
  ])('still only warns on %s, a pattern the runtime\'s engine accepts', (_label, source) => {
    const f = only(source);
    expect([f.rule, f.severity]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, 'warning']);
  });

  it('accepts the flags both engines take', () => {
    const actions = ['return /a/dgimsuy;', 'return /[a&&b]/v;'].map((source, i) => scriptAction(`ok${i}`, source));
    expect(validateActionBodyCompiles({ actions })).toEqual([]);
  });

  it('os validate refuses an unterminated literal, and so does the runtime publish door', () => {
    const body = 'return /abc;';
    const stack = { objects: [ticket()], actions: [scriptAction('p', body)] };
    const fs = compileFindings(runAuthoringRules('validate', { normalized: stack, parsed: stack }));
    expect(fs.map((f) => [f.severity, f.path])).toEqual([['error', 'actions[0].body.source']]);

    const refused = runRuntimeAuthoringRules({ type: 'action', item: scriptAction('p', body), context: { objects: [ticket()] } });
    expect(compileFindings(refused.errors)).toHaveLength(1);
    expect(compileFindings(refused.advisories)).toEqual([]);
  });
});
