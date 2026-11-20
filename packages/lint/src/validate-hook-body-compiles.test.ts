// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  HOOK_BODY_DOES_NOT_COMPILE,
  JOB_BODY_DOES_NOT_COMPILE,
  validateHookAndJobBodyCompiles,
} from './validate-hook-body-compiles.js';
import { hostCompileFailure } from './validate-action-body-compiles.js';
import { hookBodyFunctionExpression } from './action-body-wrapper.js';
import { HOOK_BODY_SOURCE_UNPARSEABLE, validateHookBodyWrites } from './validate-hook-body-writes.js';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { explainRule } from './rule-explanations.js';

/** The two bodies the claim measured: 0 TypeScript parse diagnostics, refused by the host in the `(ctx)` wrapper. */
const REDECLARED_CTX = 'const ctx = ctx.input || {}; return 1;';
const REDECLARED_LOCAL = 'let x = 1; let x = 2;';

const hook = (name: string, source: string, extra: Record<string, unknown> = {}) => ({
  name,
  object: 'hb_ticket',
  events: ['beforeInsert'],
  body: { language: 'js', source },
  ...extra,
});

const job = (name: string, source: string, extra: Record<string, unknown> = {}) => ({
  name,
  schedule: { type: 'interval', intervalMs: 60_000 },
  body: { language: 'js', source, capabilities: ['api.read'] },
  ...extra,
});

const ticket = {
  name: 'hb_ticket',
  label: 'Ticket',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
};

const compileFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === HOOK_BODY_DOES_NOT_COMPILE || f.rule === JOB_BODY_DOES_NOT_COMPILE);

describe('hook-body-does-not-compile / job-body-does-not-compile · the wrapper is the runtime\'s', () => {
  it('compiles the body inside `(async (ctx) => { SOURCE })`, source on the first line', () => {
    expect(hookBodyFunctionExpression('return 1;')).toBe('(async (ctx) => { return 1; })');
  });

  it('refuses an uncompilable hook: `ctx` declared again is a SyntaxError in that wrapper', () => {
    const [f, ...rest] = validateHookAndJobBodyCompiles({ hooks: [hook('stamp_owner', REDECLARED_CTX)] });
    expect(rest).toEqual([]);
    expect([f.rule, f.severity, f.where, f.path]).toEqual([
      HOOK_BODY_DOES_NOT_COMPILE,
      'error',
      'hook "stamp_owner" › body',
      'hooks[0].body.source',
    ]);
    expect(f.message).toContain("SyntaxError: Identifier 'ctx' has already been declared");
    expect(f.message).toContain('line 1');
    expect(f.hint).toContain('`ctx` is already the parameter of the wrapper');
  });

  it('refuses an uncompilable job the same way, under its own id and path', () => {
    const [f, ...rest] = validateHookAndJobBodyCompiles({ jobs: [job('nightly_close', 'const a = 1;\n\n' + REDECLARED_LOCAL)] });
    expect(rest).toEqual([]);
    expect([f.rule, f.severity, f.where, f.path]).toEqual([
      JOB_BODY_DOES_NOT_COMPILE,
      'error',
      'job "nightly_close" › body',
      'jobs[0].body.source',
    ]);
    expect(f.message).toContain("Identifier 'x' has already been declared");
    expect(f.message).toContain('line 3');
    expect(f.hint).toContain('async function whose parameter is `ctx`');
  });

  it('…while the parse check on the same bodies reports nothing, which is why it never saw them', () => {
    // `hook-body-source-unparseable` parses with the TypeScript parser, which reports no early error.
    const parsed = validateHookBodyWrites({
      objects: [ticket],
      hooks: [hook('a', REDECLARED_CTX), hook('b', REDECLARED_LOCAL)],
    });
    expect(parsed.filter((f) => f.rule === HOOK_BODY_SOURCE_UNPARSEABLE)).toEqual([]);
    expect(hostCompileFailure(hookBodyFunctionExpression(REDECLARED_LOCAL))?.error).toContain('already been declared');
  });

  it('takes the action rule\'s severity split: a regular-expression pattern warns, its token is refused', () => {
    const fs = validateHookAndJobBodyCompiles({
      hooks: [hook('h1', 'return /(?<a>x)|(?<a>y)/.test(ctx.input.s);'), hook('h2', 'return /abc;')],
      jobs: [job('j1', 'return /a/gg;')],
    });
    expect(fs.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [HOOK_BODY_DOES_NOT_COMPILE, 'warning', 'hooks[0].body.source'],
      [HOOK_BODY_DOES_NOT_COMPILE, 'error', 'hooks[1].body.source'],
      [JOB_BODY_DOES_NOT_COMPILE, 'error', 'jobs[0].body.source'],
    ]);
  });

  it('accepts bodies that compile, and skips L1 expression bodies and bodiless entries', () => {
    const fs = validateHookAndJobBodyCompiles({
      hooks: [
        hook('ok1', 'var ctx2 = ctx; if (ctx.input.email) ctx.input.email = ctx.input.email.toLowerCase();'),
        hook('ok2', 'const input = ctx.input || {}; return input;'),
        hook('l1', REDECLARED_CTX, { body: { language: 'expression', source: REDECLARED_CTX } }),
        { name: 'handler_only', object: 'hb_ticket', events: ['beforeInsert'], handler: 'stampOwner' },
      ],
      jobs: [job('ok3', 'const rows = await ctx.api.object("hb_ticket").find({}); return { outcome: "ok", rows };')],
    });
    expect(fs).toEqual([]);
  });

  it('locates a hook lowered from an inline handler at the key the author wrote', () => {
    const lowered = hook('lowered', REDECLARED_LOCAL, { handler: 'hooks.lowered' });
    const [f] = validateHookAndJobBodyCompiles({ hooks: [lowered] }, { loweredHookRefs: new Set(['hooks.lowered']) });
    expect(f.path).toBe('hooks[0].handler');
    expect(f.message).toContain('lowered from the inline handler');
  });

  it('never runs the body: a source that closes the wrapper early compiles and nothing in it executes', () => {
    const g = globalThis as { __hookBodyCompileProbe?: number };
    delete g.__hookBodyCompileProbe;
    const fs = validateHookAndJobBodyCompiles({
      hooks: [hook('p', '}); globalThis.__hookBodyCompileProbe = 1; ((ctx) => {')],
    });
    expect(fs).toEqual([]);
    expect(g.__hookBodyCompileProbe).toBeUndefined();
  });

  it('os explain has a page for each id', () => {
    expect(explainRule(HOOK_BODY_DOES_NOT_COMPILE)).toBeDefined();
    expect(explainRule(JOB_BODY_DOES_NOT_COMPILE)).toBeDefined();
  });
});

describe('hook-body-does-not-compile / job-body-does-not-compile · the doors that run it', () => {
  it('os validate, os build and os lint all refuse the uncompilable hook and the uncompilable job', () => {
    const stack = { objects: [ticket], hooks: [hook('stamp_owner', REDECLARED_CTX)], jobs: [job('nightly_close', REDECLARED_LOCAL)] };
    for (const command of ['validate', 'build', 'lint'] as const) {
      const fs = compileFindings(runAuthoringRules(command, { normalized: stack, parsed: stack }));
      expect(fs.map((f) => [f.rule, f.severity, f.path]), command).toEqual([
        [HOOK_BODY_DOES_NOT_COMPILE, 'error', 'hooks[0].body.source'],
        [JOB_BODY_DOES_NOT_COMPILE, 'error', 'jobs[0].body.source'],
      ]);
    }
  });

  it('the runtime publish door refuses a hook write carrying it, and admits one that compiles', () => {
    const refused = runRuntimeAuthoringRules({ type: 'hook', item: hook('stamp_owner', REDECLARED_CTX), context: { objects: [ticket] } });
    expect(compileFindings(refused.errors).map((f) => [f.rule, f.severity])).toEqual([[HOOK_BODY_DOES_NOT_COMPILE, 'error']]);
    expect(refused.rulesRun).toContain('validateHookAndJobBodyCompiles');

    const admitted = runRuntimeAuthoringRules({
      type: 'hook',
      item: hook('stamp_owner', 'const input = ctx.input || {}; return input;'),
      context: { objects: [ticket] },
    });
    expect(compileFindings([...admitted.errors, ...admitted.advisories])).toEqual([]);
    expect(admitted.rulesRun).toContain('validateHookAndJobBodyCompiles');
  });
});
