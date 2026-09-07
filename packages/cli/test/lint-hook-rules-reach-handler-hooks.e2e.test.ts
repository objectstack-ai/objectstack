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
 *   `os validate`  parses the normalized stack WITHOUT lowering, so a
 *                  handler-authored hook carries no body there and the family
 *                  does not fire. Recorded below as a MEASUREMENT of that door,
 *                  not as a contract: an author who runs `os validate` alone is
 *                  not told. Closing it changes what `os validate` refuses and
 *                  is its own decision (see the card's report).
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

describe('#16095 — door: `os validate` (measured, NOT lowered)', () => {
  // A reading of the door as it stands, so a change to it is a change someone
  // chose: `os validate` parses the normalized stack without lowering, and the
  // handler-authored hook carries no body there. If this leg starts failing
  // because `os validate` began lowering, the intake row becomes the control
  // row — update the ledger in the file header, do not delete the pin.
  it('INTAKE — the handler-authored hook is NOT seen by the family here (exit 0, no finding)', async () => {
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.handler);
    expect(run.code, label(run)).toBe(0);
    expect(rulesIn(run)).not.toContain(READONLY_RULE);
  }, 60_000);

  it('CONTROL — the explicit body IS refused here, so the silence above is the door, not the rule', async () => {
    const run = await runCli(['validate', 'objectstack.config.ts', '--json'], dirs.body);
    expect(run.code, label(run)).toBe(1);
    expect(rulesIn(run)).toContain(READONLY_RULE);
  }, 60_000);
});
