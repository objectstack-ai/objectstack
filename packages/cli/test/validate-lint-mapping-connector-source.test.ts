// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21127] `os validate` and `os lint` judge a stack whose mapping authors
 * `connectorSource` — they do not crash on it.
 *
 * ## The defect, measured before the fix
 *
 * `mapping.connectorSource` was re-graded `live` in the liveness ledger (the
 * connector sync executor reads every key) with its `authorWarn: true` kept.
 * The author-side liveness lint picks the verdict it shows from a warned row's
 * status and throws its ledger-integrity error on `live`, by design — so on
 * this fixture both commands exited 1 and the whole answer was
 * `lintLivenessProperties: ledger entry has unrecognised status "live" …`. The
 * row carries no warning now, and `check:liveness` refuses a warned `live` row.
 *
 * ## The control
 *
 * A `planned` row with `authorWarn` is the legal shape, and it still warns at
 * the same door: the second fixture also authors `object.externalSharingModel`
 * (`planned` + `authorWarn` in tree), and `os lint` reports it under
 * `liveness-planned-property` — still exit 0, because a liveness finding is
 * advisory.
 *
 * The CLI runs through `bin/run-dev.js` (source, via tsx); `@objectstack/lint`
 * resolves through `exports` to `dist/`, and both read the ledger JSON the spec
 * package ships under `liveness/`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');
/** A cold `tsx` spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;

/** The lint's ledger-integrity error — the whole answer both doors gave before the fix. */
const SENTINEL = 'ledger entry has unrecognised status';

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

/** The card's fixture: one object, one mapping that authors the pull binding. */
function stack(objectExtra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifest: { id: 'com.example.fx-connector-source', name: 'fx', version: '0.1.0', type: 'app', namespace: 'fx' },
    objects: [
      {
        name: 'fx_account',
        label: 'Account',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name' }, external_id: { type: 'text', label: 'External ID' } },
        ...objectExtra,
      },
    ],
    mappings: [
      {
        name: 'fx_account_pull',
        label: 'Account pull',
        sourceFormat: 'json',
        targetObject: 'fx_account',
        mode: 'upsert',
        fieldMapping: [
          { source: 'id', target: 'external_id', transform: 'none' },
          { source: 'name', target: 'name', transform: 'none' },
        ],
        connectorSource: { connector: 'crm_api', action: 'request' },
      },
    ],
  };
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-lint-connector-source-'));
  const make = (label: string, s: Record<string, unknown>) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(s));
    linkSpec(dir);
    dirs[label] = dir;
  };
  make('card', stack());
  make('control', stack({ externalSharingModel: 'private' }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('#21127 — a stack authoring `mapping.connectorSource` validates and lints', () => {
  it('`os validate --json` exits 0 and calls the stack valid', async () => {
    const run = await runCli(['validate', '--json'], dirs.card);
    const payload = payloadOf(run, 'validate');
    expect(`${run.stdout}${run.stderr}`).not.toContain(SENTINEL);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(payload.valid).toBe(true);
  }, SPAWN_TIMEOUT_MS);

  it('`os lint --json` exits 0, passes, and says nothing about the live binding', async () => {
    const run = await runCli(['lint', '--json'], dirs.card);
    const payload = payloadOf(run, 'lint');
    expect(`${run.stdout}${run.stderr}`).not.toContain(SENTINEL);
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(payload.passed).toBe(true);
    const issues = (payload.issues ?? []) as Array<{ rule: string; message: string }>;
    expect(issues.filter((i) => i.message.includes('connectorSource'))).toEqual([]);
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL: a `planned` row with `authorWarn` still warns at the same door', async () => {
    const run = await runCli(['lint', '--json'], dirs.control);
    const payload = payloadOf(run, 'lint (control)');
    expect(run.code, `${run.stdout}\n${run.stderr}`).toBe(0);
    const issues = (payload.issues ?? []) as Array<{ rule: string; message: string; severity: string }>;
    const planned = issues.filter((i) => i.rule === 'liveness-planned-property');
    expect(planned.map((i) => i.message).join(' | '), JSON.stringify(issues)).toContain('externalSharingModel');
    expect(planned.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues.filter((i) => i.message.includes('connectorSource'))).toEqual([]);
  }, SPAWN_TIMEOUT_MS);
});
