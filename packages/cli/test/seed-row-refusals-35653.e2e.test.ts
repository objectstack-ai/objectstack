// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two doors (#35653, folding #35486): `os validate` and `os build` refuse a
 * config whose seed records the seed load would drop — one its own validation
 * rule refuses, one keyed on a blank field — naming the record and the rule;
 * the control config, the same records corrected, passes both. The walk and the
 * evaluator's verdicts are pinned in-process by `seed-row-refusals-35653.test.ts`;
 * this file pins that both command files make the call.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
/** A cold spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 180_000;

const stack = (records: Array<Record<string, unknown>>) => ({
  manifest: { id: 'com.example.seedrules', name: 'seedrules', version: '1.0.0', type: 'app', namespace: 'xt' },
  objects: [
    {
      name: 'xt_payment',
      label: 'Payment',
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Reference' },
        amount: { type: 'currency', label: 'Amount' },
      },
      validations: [
        { type: 'script', name: 'amount_positive', condition: 'record.amount <= 0', message: 'A payment amount must be positive.' },
      ],
    },
  ],
  data: [{ object: 'xt_payment', mode: 'upsert', records }],
});

const FIXTURES = {
  refused: stack([{ name: 'P1', amount: 25 }, { name: 'P2', amount: -10 }, { name: '', amount: 5 }]),
  control: stack([{ name: 'P1', amount: 25 }, { name: 'P2', amount: 10 }, { name: 'P3', amount: 5 }]),
} as const;

interface Run { code: number; stdout: string; stderr: string }

function runCli(command: 'validate' | 'build', cwd: string): Promise<Run> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [CLI, command, '--json'],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) =>
        done({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
  });
}

const dirs = new Map<keyof typeof FIXTURES, string>();

beforeAll(() => {
  for (const [kind, body] of Object.entries(FIXTURES) as Array<[keyof typeof FIXTURES, unknown]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-seed-row-refusals-${kind}-`));
    writeDefineStackConfig(dir, body);
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('os validate / os build refuse seed records the seed load would drop', () => {
  for (const command of ['validate', 'build'] as const) {
    it(`os ${command}: exit 1, one finding per record, naming its location, index and the refusing rule or blank field`, async () => {
      const run = await runCli(command, dirs.get('refused')!);
      expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
      const payload = JSON.parse(run.stdout) as { errors?: unknown[]; issues?: unknown[] };
      expect(payload.errors ?? payload.issues).toEqual([
        expect.objectContaining({
          rule: 'seed-row-refused-by-validation-rule',
          location: 'data[0].records[1]',
          recordIndex: 1,
          validationRule: 'amount_positive',
        }),
        expect.objectContaining({
          rule: 'seed-record-key-field-blank',
          location: 'data[0].records[2]',
          object: 'xt_payment',
          recordIndex: 2,
          field: 'name',
        }),
      ]);
    }, SPAWN_TIMEOUT_MS);

    it(`CONTROL: os ${command} passes the same records corrected`, async () => {
      const run = await runCli(command, dirs.get('control')!);
      expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    }, SPAWN_TIMEOUT_MS);
  }
});
