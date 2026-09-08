// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16095 — which authoring commands can SEE a hook authored as an inline
 * `handler` function, measured over the real CLI, one door per leg, with a
 * control beside every leg.
 *
 * The family (`hook-api-update-readonly-*`, `hook-body-*`) opens on
 * `body.language === 'js'`. Whether a handler-authored hook reaches it is a
 * property of the DOOR — what each command hands the rule registry — not of
 * the rule, so a claim measured through one command says nothing about the
 * others (#16109's lesson, applied here). The doors:
 *
 *   `os build`     lowers inline handlers to a metadata body BEFORE the parse
 *                  (`lowerCallables`) and judges the lowered stack — the family
 *                  reached handler-authored hooks here all along.
 *   `os lint`      used to judge the un-lowered normalized stack; since #16095
 *                  `lintConfig` hands the registry's `parsed` tier the same
 *                  lowered view `os build` judges. This file's RED leg.
 *   `os validate`  used to parse the normalized stack WITHOUT lowering, so a
 *                  handler-authored hook carried no body there and the family
 *                  did not fire — measured here under #16095 as a reading of
 *                  that door, not a contract, because closing it changes what
 *                  `os validate` refuses. #16544 closed it: `validate.ts` now
 *                  runs the same `lowerCallables` pass between its pre-parse
 *                  unknown-key lints and its parse, so this file's THIRD red
 *                  leg. The control beside it fired before and fires after; a
 *                  handler-authored hook the family has nothing to say about
 *                  still passes, so the door refuses only what `os build`
 *                  already refused.
 *
 * The fixture is the card's own: a readonly `is_escalated` written through
 * `ctx.api.object('crm_case').update(…)` from an `afterUpdate` hook — the write
 * the engine strips on a non-system context while the call reports success.
 * The control authors the identical statement as an explicit `body`, which
 * fired on every door before this change.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const READONLY_RULE = 'hook-api-update-readonly-field';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

const OBJECT = `{
    name: 'crm_case',
    label: 'Case',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
      is_escalated: { type: 'boolean', label: 'Escalated', readonly: true },
    },
  }`;

/** INTAKE: the reference app's shape — an inline handler, no `body`. */
const CONFIG_HANDLER = `
export default {
  manifest: { id: 'com.example.reach_handler', name: 'reach_handler', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'escalate',
    object: 'crm_case',
    events: ['afterUpdate'],
    handler: async (ctx: any) => {
      await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });
    },
  }],
};
`;

/** CONTROL: the identical statement authored as an explicit `body`. */
const CONFIG_BODY = `
export default {
  manifest: { id: 'com.example.reach_body', name: 'reach_body', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'escalate',
    object: 'crm_case',
    events: ['afterUpdate'],
    body: {
      language: 'js',
      source: "await ctx.api.object('crm_case').update({ id: ctx.input.id, is_escalated: true });",
    },
  }],
};
`;

/**
 * NEGATIVE CONTROL for #16544: handler-authored like the intake, but the write
 * lands on a declared, writable field — nothing in the family objects. This is
 * the leg that proves the door now refuses only what `os build` already
 * refused: a stack that validated green before #16544 validates green after.
 */
const CONFIG_HANDLER_OK = `
export default {
  manifest: { id: 'com.example.reach_handler_ok', name: 'reach_handler_ok', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  hooks: [{
    name: 'retitle',
    object: 'crm_case',
    events: ['afterUpdate'],
    handler: async (ctx: any) => {
      await ctx.api.object('crm_case').update({ id: ctx.input.id, title: 'seen' });
    },
  }],
};
`;

/**
 * THE WIDENING LIMB (#16544 contract review) — the axis the hook legs above
 * cannot see. `ActionSchema.target` is `z.string()`, and `normalizeStackInput`
 * never touches function values, so a plain-object config with an inline
 * action `target` callable hit `invalid_type` at the parse: `os validate`
 * REFUSED it before #16544 (exit 1) while `os build`, which lowers before it
 * parses, always accepted it. The same `lowerCallables` pass now rewrites the
 * callable to a ref string plus `body` on this door too, so `os validate`
 * ACCEPTS it — an accepted-set relaxation on a published command, declared in
 * the changeset and pinned here beside the hook legs. Both slots
 * `lowerActionCallable` handles (`actions[*]`, `objects[*].actions[*]`).
 */
const CONFIG_ACTION_TARGET = `
export default {
  manifest: { id: 'com.example.reach_action_target', name: 'reach_action_target', version: '1.0.0', type: 'app' },
  objects: [{
    name: 'crm_case',
    label: 'Case',
    sharingModel: 'private',
    fields: {
      title: { type: 'text', label: 'Title' },
    },
    actions: [{
      name: 'ping_case',
      label: 'Ping case',
      target: async (ctx: any) => {
        return { ok: true, id: ctx.input.id };
      },
    }],
  }],
  actions: [{
    name: 'ping_global',
    label: 'Ping',
    target: async (ctx: any) => {
      return { ok: true, id: ctx.input.id };
    },
  }],
};
`;

/**
 * THE THIRD LIMB (#16544 re-review) — a nameless `functions` ARRAY entry.
 * `stack.zod.ts` requires `name: z.string()` on the array form, and
 * `normalizeStackInput` never touches `functions`, so `[{ handler: fn }]`
 * failed the `functions` union at the parse on the un-lowered stack (exit 1)
 * while `lowerBody` names it `anon_fn` before `os build`'s parse. The same
 * pass now names it here too, so `os validate` accepts it. The `functions`
 * MAP forms parse either way (not a limb); `hooks[*].handler` accepts a
 * function un-lowered (not a limb).
 */
const CONFIG_FUNCTIONS_NAMELESS = `
export default {
  manifest: { id: 'com.example.reach_functions_nameless', name: 'reach_functions_nameless', version: '1.0.0', type: 'app' },
  objects: [${OBJECT}],
  functions: [{
    handler: async (ctx: any) => {
      return { ok: true, id: ctx.input.id };
    },
  }],
};
`;

const dirs: Record<string, string> = {};

function project(key: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), `os-reach-${key}-`));
  writeFileSync(join(dir, 'objectstack.config.ts'), source);
  dirs[key] = dir;
  return dir;
}

beforeAll(() => {
  project('handler', CONFIG_HANDLER);
  project('body', CONFIG_BODY);
  project('handlerOk', CONFIG_HANDLER_OK);
  project('actionTarget', CONFIG_ACTION_TARGET);
  project('functionsNameless', CONFIG_FUNCTIONS_NAMELESS);
});

afterAll(() => {
  for (const dir of Object.values(dirs)) rmSync(dir, { recursive: true, force: true });
});

/** Rule ids named anywhere in a `--json` payload's issue/finding lists. */
function rulesIn(run: Run): string[] {
  const json = JSON.parse(run.stdout);
  const lists: unknown[] = [json.issues, json.errors, json.warnings, json.findings].filter(Array.isArray);
  const ids: string[] = [];
  for (const list of lists) {
    for (const entry of list as Array<Record<string, unknown>>) {
      if (typeof entry?.rule === 'string') ids.push(entry.rule);
    }
  }
  return ids;
}

const label = (run: Run) => `exit ${run.code}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;

describe('#16095 — door: `os lint`', () => {
  it('INTAKE — a handler-authored hook writing a readonly field is refused (error, exit 1)', async () => {
    const run = await runCli(['lint', 'objectstack.config.ts', '--json'], dirs.handler);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 60_000);

  it('CONTROL — the same statement as an explicit body is refused identically', async () => {
    const run = await runCli(['lint', 'objectstack.config.ts', '--json'], dirs.body);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 60_000);
});

describe('#16095 — door: `os build` (the door that never had the gap)', () => {
  it('INTAKE — the lowered handler is refused at build, exit 1 — unchanged by this card', async () => {
    const run = await runCli(['build', 'objectstack.config.ts', '--json'], dirs.handler);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 90_000);

  it('CONTROL — the explicit body is refused at build identically', async () => {
    const run = await runCli(['build', 'objectstack.config.ts', '--json'], dirs.body);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 90_000);
});

describe('#16544 — door: `os validate` (lowers since #16544; measured NOT lowered under #16095)', () => {
  // Under #16095 this leg pinned the door as it stood — exit 0, no finding —
  // so that a change to it would be a change someone chose. #16544 chose it:
  // `validate.ts` runs the same `lowerCallables` pass `os build` runs, between
  // its pre-parse unknown-key lints and its parse, so the handler-authored hook
  // carries a body here too. The intake row is now a RED row. The control
  // beside it is unchanged — it fired before this change and fires after — so
  // a red here is still a reading about the door, never about the rule.
  it('INTAKE — the handler-authored hook IS refused here (error, exit 1) — the red-first leg of #16544', async () => {
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.handler);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 60_000);

  it('CONTROL — the explicit body is refused here, before and after, so the intake reading is about the door', async () => {
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.body);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 60_000);

  it('NEGATIVE CONTROL — a handler-authored hook the family has nothing to say about still passes (exit 0)', async () => {
    // The lowered stack must PARSE (`handler: '<ref>'` beside the extracted
    // `body`) and the family must stay silent on a legitimate write, or the
    // door would have started refusing stacks `os build` ships. Read the exit
    // and the absence of the rule together: a parse failure also exits 1.
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.handlerOk);
    expect(run.code, label(run)).toBe(0);
    expect(rulesIn(run)).not.toContain(READONLY_RULE);
  }, 60_000);
});

describe('#16544 — the WIDENING limb: an inline action `target` callable is now ACCEPTED by `os validate`', () => {
  // Measured red-first on the same BASE/HEAD pair as the hook legs: on BASE
  // this leg fails with `invalid_type` at `actions.0.target` and
  // `objects.0.actions.0.target` (expected string, received function) and
  // exit 1; on HEAD the lowered stack parses and the run exits 0. The build
  // leg beside it is the parity reading: `os build` accepted this config on
  // both sides, which is the intent — and the reason this is a declared
  // relaxation rather than a narrowing.
  it('INTAKE — `os validate` accepts the inline action target (exit 0, valid, no invalid_type)', async () => {
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.actionTarget);
    expect(run.code, label(run)).toBe(0);
    const json = JSON.parse(run.stdout);
    expect(json.valid, label(run)).toBe(true);
    const codes = (Array.isArray(json.errors) ? json.errors : []).map((e: { code?: unknown }) => e?.code);
    expect(codes).not.toContain('invalid_type');
  }, 60_000);

  it('PARITY — `os build` accepts the same config (it lowered before its parse all along)', async () => {
    const run = await runCli(['build', 'objectstack.config.ts', '--json'], dirs.actionTarget);
    expect(run.code, label(run)).toBe(0);
  }, 90_000);

  it('INTAKE — a nameless `functions` array entry is accepted too (the pass names it `anon_fn`; exit 0, valid)', async () => {
    // Red-first on the same BASE/HEAD pair: on BASE the `functions` union
    // refuses the entry (no `name`) and the run exits 1; on HEAD it parses.
    // `os build` accepted it on both sides, as for the action leg above.
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.functionsNameless);
    expect(run.code, label(run)).toBe(0);
    expect(JSON.parse(run.stdout).valid, label(run)).toBe(true);
  }, 60_000);
});
