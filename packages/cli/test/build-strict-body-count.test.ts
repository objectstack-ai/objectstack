// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22839] `objectstack build --strict-body` counts callables, and its
 * `--json` `issues` lists callables only.
 *
 * ## The defect, measured before the fix
 *
 * `compile.ts` built `issues` as the body-extraction warnings plus one
 * placeholder row whenever `count - bodyExtracted > 0`. The placeholder's
 * origin was `<aggregate>` and its reason "N callable(s) lowered to handler ref
 * but produced no body". The header then printed `issues.length` as the number
 * of callables. With one refused handler it printed "2 callable(s) lack a
 * metadata body", and with four it printed 5. `--json` carried the placeholder
 * as a fifth entry beside four real callables.
 *
 * `issues` is now `lowerCallables`' `bodylessCallables`: one row per callable
 * that ships with no body, each once. `test/lower-callables.test.ts` pins that
 * list over the shapes where the old arithmetic and the warnings disagree.
 * This file pins the door: the header's number, and the `--json` list, on the
 * real command.
 *
 * The CLI runs through `bin/run-dev.js` (source, via tsx). Its dependencies
 * resolve through `exports` to `dist/`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
/** A cold `tsx` spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;

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

function payloadOf(run: Run, label: string): Record<string, any> {
  try {
    return JSON.parse(run.stdout) as Record<string, any>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** The header the text face prints, with its number captured. */
const HEADER = /--strict-body: (\d+) callable\(s\) lack a metadata body/;

/** One bullet per listed row: `  • <origin>: <reason>`. */
function bulletOrigins(out: string): string[] {
  return [...out.matchAll(/^ {2}• ((?:hook|action|function) '[^']+'):/gm)].map((m) => m[1]);
}

/** A hook the extractor refuses: its handler names the module-scope `slugOf`. */
const refusedHook = (i: number) =>
  `{ name: 'sbc_refused_${i}', object: 'sbc_doc', events: ['beforeInsert'], ` +
  `handler: async (ctx) => { ctx.input.title = slugOf(ctx.input.title); } }`;

/** A hook the extractor lowers to a body: parameters and globals only. */
const cleanHook = `{ name: 'sbc_clean', object: 'sbc_doc', events: ['beforeInsert'], ` +
  `handler: async (ctx) => { ctx.input.title = String(ctx.input.title).trim(); } }`;

function config(hooks: string[], extra = ''): string {
  return (
    `const slugOf = (s) => String(s).toLowerCase();\n` +
    defineStackSourceFromLiteral(`{
  manifest: { id: 'com.example.sbc', name: 'sbc', version: '1.0.0', type: 'app', namespace: 'sbc' },
  objects: [{ name: 'sbc_doc', label: 'Doc', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } }],
  hooks: [${hooks.join(', ')}],${extra}
}`)
  );
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-build-strict-body-count-'));
  const make = (label: string, source: string) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    linkSpec(dir);
    dirs[label] = dir;
  };
  make('zero', config([cleanHook]));
  make('one', config([refusedHook(1), cleanHook]));
  make('four', config([1, 2, 3, 4].map(refusedHook)));
  // A `functions` entry has no `body` slot, so it never leaves an extraction
  // warning. It must still be counted, and named, exactly once.
  make('with-function', config([refusedHook(1)], `\n  functions: { sbc_score: (input) => 1 },`));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#22839] os build --strict-body — the header counts callables, and `issues` lists callables only', () => {
  it('CONTROL — no callable lacks a body: exit 0 and no header', async () => {
    const run = await runCli(['build', '--strict-body'], dirs.zero);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(`${run.stdout}${run.stderr}`).not.toMatch(HEADER);
  }, SPAWN_TIMEOUT_MS);

  it.each([
    ['one', 1],
    ['four', 4],
  ] as const)('%s refused handler(s) → the header reads %i and lists that many hooks', async (label, n) => {
    const run = await runCli(['build', '--strict-body'], dirs[label]);
    const out = `${run.stdout}${run.stderr}`;
    expect(run.code, out).toBe(1);
    expect(out.match(HEADER)?.[1], out).toBe(String(n));
    expect(bulletOrigins(out)).toEqual(Array.from({ length: n }, (_, i) => `hook 'sbc_refused_${i + 1}'`));
    expect(out).not.toContain('<aggregate>');
  }, SPAWN_TIMEOUT_MS);

  it.each([
    ['one', 1],
    ['four', 4],
  ] as const)('%s refused handler(s) → `--json` `issues` has %i entries, each a hook', async (label, n) => {
    const run = await runCli(['build', '--json', '--strict-body'], dirs[label]);
    const payload = payloadOf(run, `${label} --json`);
    expect(run.code).toBe(1);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('strict-body: missing body');
    expect((payload.issues as Array<{ origin: string }>).map((i) => i.origin)).toEqual(
      Array.from({ length: n }, (_, i) => `hook 'sbc_refused_${i + 1}'`),
    );
    // Each entry is the extractor's refusal, so the refusal's own fields ride along.
    for (const issue of payload.issues as Array<Record<string, unknown>>) {
      expect(issue.kind).toBe('free-identifiers');
      expect(issue.freeIdentifiers).toEqual(['slugOf']);
    }
  }, SPAWN_TIMEOUT_MS);

  it('a `functions` entry, which leaves no warning, is counted and named once beside the refused hook', async () => {
    const run = await runCli(['build', '--json', '--strict-body'], dirs['with-function']);
    const payload = payloadOf(run, 'with-function --json');
    expect(run.code).toBe(1);
    expect((payload.issues as Array<{ origin: string }>).map((i) => i.origin)).toEqual([
      "hook 'sbc_refused_1'",
      "function 'sbc_score'",
    ]);
  }, SPAWN_TIMEOUT_MS);
});
