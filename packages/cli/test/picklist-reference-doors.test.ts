// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `picklist` kind through the three authoring doors, over the real CLI.
 *
 * Three facts, each read off a real `os` process:
 *
 *   1. A stack declaring a picklist and a select field that names it validates,
 *      builds and lints with no refusal — and the artifact `os build` writes
 *      carries the list and the reference as authored.
 *   2. A field whose `picklist` names no picklist the stack declares is REFUSED
 *      by `os validate`, naming the field and the list it names; `os build`
 *      refuses the same stack and writes no artifact. Before this, both doors
 *      exited 0 and the misspelt reference shipped.
 *   3. `os lint`'s R8 (`field/select-missing-options`) does not report the
 *      picklist-bound field — it names its options source.
 *
 * The walk and both verdicts are pinned in `src/utils/picklist-references.test.ts`
 * and R8 in `@objectstack/lint`; this file holds the DOORS to them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded. */
const RUN_TIMEOUT_MS = 180_000;

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
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** The last line of stdout that parses as a JSON object — the `--json` document. */
function jsonOf(run: Run): Record<string, unknown> {
  const text = run.stdout.trim();
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON document on stdout:\n${run.stdout}\n--- stderr ---\n${run.stderr}`);
  return JSON.parse(text.slice(start)) as Record<string, unknown>;
}

const stack = (picklist: string) => ({
  manifest: { id: 'com.example.pickdoor', name: 'pickdoor', version: '1.0.0', type: 'app', namespace: 'pickdoor' },
  picklists: [{
    name: 'industry',
    label: 'Industry',
    options: [
      { label: 'Technology', value: 'technology' },
      { label: 'Finance', value: 'finance' },
    ],
  }],
  objects: [{
    name: 'pickdoor_account',
    label: 'Account',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name' },
      industry: { type: 'select', label: 'Industry', picklist },
    },
  }],
  apps: [{ name: 'pickdoor_app', label: 'Pick Door' }],
});

let okDir: string;
let danglingDir: string;

beforeAll(() => {
  okDir = mkdtempSync(join(tmpdir(), 'os-picklist-ok-'));
  writeDefineStackConfig(okDir, stack('industry'));
  danglingDir = mkdtempSync(join(tmpdir(), 'os-picklist-dangling-'));
  writeDefineStackConfig(danglingDir, stack('industy'));
});

afterAll(() => {
  for (const dir of [okDir, danglingDir]) if (dir) rmSync(dir, { recursive: true, force: true });
});

const picklistRules = (list: unknown): string[] =>
  (Array.isArray(list) ? list : [])
    .map((w) => (w && typeof w === 'object' ? (w as { rule?: unknown }).rule : undefined))
    .filter((r): r is string => typeof r === 'string' && r.startsWith('picklist-reference-'));

describe('a stack with a picklist and a field naming it passes all three doors', () => {
  it('os validate accepts it, with no picklist-reference finding', async () => {
    const run = await runCli(['validate', '--json'], okDir);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const doc = jsonOf(run);
    expect(doc.valid).toBe(true);
    expect(picklistRules(doc.warnings)).toEqual([]);
  }, RUN_TIMEOUT_MS);

  it('os build writes the artifact, carrying the list and the reference as authored', async () => {
    const out = join(okDir, 'dist', 'objectstack.json');
    const run = await runCli(['build', '--json', '-o', out], okDir);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(picklistRules(jsonOf(run).warnings)).toEqual([]);
    const artifact = JSON.parse(readFileSync(out, 'utf8')) as {
      picklists?: Array<{ name?: string }>;
      objects?: Array<{ fields?: Record<string, { picklist?: string }> }>;
    };
    expect(artifact.picklists?.map((p) => p.name)).toEqual(['industry']);
    expect(artifact.objects?.[0]?.fields?.industry?.picklist).toBe('industry');
  }, RUN_TIMEOUT_MS);

  it('os lint reports no error, and R8 does not report the picklist-bound field', async () => {
    const run = await runCli(['lint', '--json'], okDir);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const doc = jsonOf(run);
    expect(doc.errors).toBe(0);
    const issues = (doc.issues as Array<{ rule?: string }>) ?? [];
    expect(issues.map((i) => i.rule)).not.toContain('field/select-missing-options');
  }, RUN_TIMEOUT_MS);
});

describe('a field naming a picklist the stack does not declare is refused', () => {
  it('os validate refuses it, naming the field and the missing list', async () => {
    const run = await runCli(['validate', '--json'], danglingDir);
    expect(run.code, run.stdout + run.stderr).toBe(1);
    const doc = jsonOf(run);
    expect(doc.valid).toBe(false);
    const errors = doc.errors as Array<{ rule?: string; where?: string; message?: string; path?: string }>;
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('picklist-reference-unknown');
    expect(errors[0].where).toContain('pickdoor_account.industry');
    expect(errors[0].message).toContain("'industy'");
    expect(errors[0].path).toBe('objects[0].fields.industry.picklist');
  }, RUN_TIMEOUT_MS);

  it('the text face says so too, with the same exit status', async () => {
    const run = await runCli(['validate'], danglingDir);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('pickdoor_account.industry');
    expect(run.stdout).toContain("'industy'");
  }, RUN_TIMEOUT_MS);

  it('os build refuses the same stack and writes no artifact', async () => {
    const out = join(danglingDir, 'dist', 'objectstack.json');
    const run = await runCli(['build', '--json', '-o', out], danglingDir);
    expect(run.code, run.stdout + run.stderr).toBe(1);
    const errors = jsonOf(run).errors as Array<{ rule?: string }>;
    expect(errors.map((e) => e.rule)).toEqual(['picklist-reference-unknown']);
    expect(existsSync(out)).toBe(false);
  }, RUN_TIMEOUT_MS);
});
