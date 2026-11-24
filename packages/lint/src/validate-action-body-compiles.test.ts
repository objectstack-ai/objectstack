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

  it('refuses a regular-expression pattern the runtime\'s engine refuses too, an unterminated group, at error', () => {
    const [f, ...rest] = validateActionBodyCompiles({ actions: [scriptAction('p', 'return /(/.test(input.s);')] });
    expect(rest).toEqual([]);
    expect([f.rule, f.severity, f.path]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, 'error', 'actions[0].body.source']);
    expect(f.message).toContain('Unterminated group');
    expect(f.hint).toContain('the runtime\'s engine refuses it too');
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

describe('action-body-does-not-compile · a regular-expression failure is refused, only the two dialect gaps warn', () => {
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
    ['a duplicate named capture group', 'return /(?<a>x)|(?<a>y)/.test(input.s);', '(?<a>x)|(?<a>y)'],
    ['a modifier group', 'return /(?i:a)/.test(input.s);', '(?i:a)'],
  ])('still only warns on %s, a pattern the runtime\'s engine accepts — while the host refuses it', (_label, source, pattern) => {
    // Node 22's V8 refuses both patterns and QuickJS runs both (the module note's measurement). A later V8 that
    // accepts the pattern leaves nothing to warn about, so the pin reads what THIS host does with the pattern
    // first; on a Node that still refuses it (Node 22, `.nvmrc`), the warning is required.
    const hostRefuses = (() => {
      try {
        new RegExp(pattern);
        return false;
      } catch {
        return true;
      }
    })();
    if (Number(process.versions.node.split('.')[0]) <= 22) expect(hostRefuses, `Node ${process.versions.node}`).toBe(true);
    const findings = validateActionBodyCompiles({ actions: [scriptAction('p', source)] });
    if (!hostRefuses) {
      expect(findings).toEqual([]);
      return;
    }
    expect(findings, source).toHaveLength(1);
    expect([findings[0].rule, findings[0].severity]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, 'warning']);
    expect(findings[0].message).toContain('the runtime\'s engine may accept it');
  });

  // The six pattern classes the runtime's QuickJS refuses as well as the host's V8 (quickjs-emscripten 0.32.0,
  // same wrapper text, release-sync evalCode: `expecting ')'`, `nothing to repeat`, `invalid class range`,
  // `group name not defined`, `unknown unicode property name`, `invalid repetition count`). Each is the first
  // reason V8 names for its pattern, and none is a measured dialect gap, so each is refused.
  it.each([
    ['an unterminated group', 'return /(/.test(input.s);', 'Unterminated group'],
    ['nothing to repeat', 'return /a**/.test(input.s);', 'Nothing to repeat'],
    ['a class range out of order', 'return /[b-a]/.test(input.s);', 'Range out of order in character class'],
    ['a dangling named back-reference under u', 'return /\\k<x>/u.test(input.s);', 'Invalid named capture referenced'],
    ['an unknown unicode property', 'return /\\p{Nope}/u.test(input.s);', 'Invalid property name'],
    ['an incomplete quantifier under u', 'return /a{/u.test(input.s);', 'Incomplete quantifier'],
  ])('refuses %s at error: the runtime\'s engine refuses the pattern too', (_label, source, reason) => {
    // A property name is judged against this host's Unicode tables only where they are the measured ones (17.0);
    // the `.nvmrc` Node 22 carries them, and an older host reports the unknown property as a warning.
    const property = reason === 'Invalid property name';
    if (property && Number(process.versions.node.split('.')[0]) === 22 && process.env.CI) {
      expect(Number.parseFloat(String(process.versions.unicode)), 'CI host Unicode tables').toBeGreaterThanOrEqual(17);
    }
    const f = only(source);
    const severity = property && !(Number.parseFloat(String(process.versions.unicode)) >= 17) ? 'warning' : 'error';
    expect([f.rule, f.severity, f.path]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, severity, 'actions[0].body.source']);
    expect(f.message).toContain(reason);
    if (severity === 'error') expect(f.hint).toContain('the runtime\'s engine refuses it too');
  });

  // A Unicode property name is judged by name: V8 resolves it against its own list and this host's Unicode tables,
  // QuickJS against its own. Every name in quickjs-emscripten 0.32.0's tables, in every key form, under `u` and `v`,
  // bare and in a class, was compiled in the action wrapper on both engines (Node 22.23.5, Unicode 17.0): these
  // twelve spellings are the only ones V8 refuses and QuickJS compiles. The list was measured on Unicode 17.0
  // tables; a host with older tables judges every refused name a warning, which this pin reads first.
  const measuredTables = Number.parseFloat(String(process.versions.unicode)) >= 17;

  it.each([
    'IDS_Unary_Operator', 'IDSU', 'Modifier_Combining_Mark', 'MCM',
    'sc=Katakana_Or_Hiragana', 'sc=Hrkt', 'Script=Katakana_Or_Hiragana', 'Script=Hrkt',
    'scx=Katakana_Or_Hiragana', 'scx=Hrkt', 'Script_Extensions=Katakana_Or_Hiragana', 'Script_Extensions=Hrkt',
  ])('only warns on the property %s, which this host refuses and the runtime\'s engine runs', (name) => {
    const hostRefuses = (() => {
      try {
        new RegExp(`\\p{${name}}`, 'u');
        return false;
      } catch {
        return true;
      }
    })();
    if (Number(process.versions.node.split('.')[0]) <= 22) expect(hostRefuses, `Node ${process.versions.node}`).toBe(true);
    for (const source of [`return /\\p{${name}}/u.test(input.s);`, `return /[\\P{${name}}a]/v.test(input.s);`]) {
      const findings = validateActionBodyCompiles({ actions: [scriptAction('p', source)] });
      if (!hostRefuses) {
        expect(findings, source).toEqual([]);
        continue;
      }
      expect(findings.map((f) => [f.rule, f.severity]), source).toEqual([[ACTION_BODY_DOES_NOT_COMPILE, 'warning']]);
    }
  });

  it('refuses a property name neither engine knows beside one only the runtime\'s engine knows', () => {
    const f = only('return /\\p{IDSU}\\p{Nope}/u.test(input.s);');
    expect([f.rule, f.severity]).toEqual([ACTION_BODY_DOES_NOT_COMPILE, measuredTables ? 'error' : 'warning']);
  });

  it('accepts the flags both engines take', () => {
    const actions = ['return /a/dgimsuy;', 'return /[a&&b]/v;'].map((source, i) => scriptAction(`ok${i}`, source));
    expect(validateActionBodyCompiles({ actions })).toEqual([]);
  });

  it('os validate refuses a pattern QuickJS refuses too, and so does the runtime publish door', () => {
    const body = 'return /a**/.test(input.s);';
    const stack = { objects: [ticket()], actions: [scriptAction('p', body)] };
    const fs = compileFindings(runAuthoringRules('validate', { normalized: stack, parsed: stack }));
    expect(fs.map((f) => [f.severity, f.path])).toEqual([['error', 'actions[0].body.source']]);

    const refused = runRuntimeAuthoringRules({ type: 'action', item: scriptAction('p', body), context: { objects: [ticket()] } });
    expect(compileFindings(refused.errors)).toHaveLength(1);
    expect(compileFindings(refused.advisories)).toEqual([]);
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
