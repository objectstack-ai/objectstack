// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — what `os test` PRINTS and how it EXITS, for suite/scenario names and
 * `--tags`, measured on a real child process against a real HTTP target.
 *
 * Before: the suite heading was the file's basename and each scenario line
 * was its `id`, so the `name`s an author wrote were parsed and shown nowhere;
 * and `--tags` was an unknown-flag error. The selection's semantics are held
 * by `qa-tags-selection.test.ts`; this file holds the wiring those unit pins
 * cannot see — the flag reaching the selection, the names reaching stdout,
 * and the exit status a CI step reads.
 *
 * The fixture is built so each run's EXIT STATUS is itself evidence: the
 * unfiltered run (the control) includes a scenario that fails on purpose and
 * exits 1, and `--tags smoke` exits 0 only if that scenario was really left
 * out — not run, and not merely hidden from the report.
 *
 * A real child process, because `process.exit(1)` inside a vitest worker is
 * not an exit status. Spawned through `bin/run-dev.js` + tsx so the suite does
 * not depend on `packages/cli/dist`. The target is a stub `node:http` server
 * in this process: the runner's HTTP adapter is what is exercised, and no
 * ObjectStack server is booted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';

/** oclif + tsx cold start; a healthy run here is a few seconds. */
const RUN_TIMEOUT_MS = 120_000;

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
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; a signalled child is never read as 0.
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** One `api_call` step against the stub's health route, asserting `data.status`. */
function healthStep(expectedStatus: string) {
  return {
    name: `status is ${expectedStatus}`,
    action: { type: 'api_call', target: '/api/v1/health', payload: { method: 'GET' } },
    assertions: [{ field: 'data.status', operator: 'equals', expectedValue: expectedStatus }],
  };
}

const SUITE = {
  name: 'Accounts smoke',
  scenarios: [
    { id: 'acct-health', name: 'The server answers its health probe', tags: ['smoke'], steps: [healthStep('ok')] },
    { id: 'acct-regression', name: 'A regression-only check', tags: ['regression'], steps: [healthStep('ok')] },
    { id: 'acct-untagged', name: 'An untagged check', steps: [healthStep('ok')] },
    {
      id: 'acct-failing',
      name: 'A check that fails on purpose',
      description: 'Asserts a status the stub never returns.',
      tags: ['regression'],
      steps: [healthStep('degraded')],
    },
  ],
};

const PATTERN = 'qa/*.test.json';

let dir: string;
let server: Server;
let unfiltered: Run;
let smoke: Run;
let regression: Run;
let noMatch: Run;
let noMatchStrict: Run;
let malformed: Run;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, data: { status: 'ok' }, path: req.url }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dir = mkdtempSync(join(tmpdir(), 'os-qa-names-tags-'));
  mkdirSync(join(dir, 'qa'));
  writeFileSync(join(dir, 'qa', 'accounts.test.json'), JSON.stringify(SUITE), 'utf-8');

  const base = ['test', PATTERN, '--url', url];
  [unfiltered, smoke, regression, noMatch, noMatchStrict, malformed] = await Promise.all([
    runCli(base, dir),
    runCli([...base, '--tags', 'smoke'], dir),
    runCli([...base, '--tags', 'regression'], dir),
    runCli([...base, '--tags', 'nomatch'], dir),
    runCli([...base, '--tags', 'nomatch', '--fail-on-empty'], dir),
    runCli([...base, '--tags', 'smoke,'], dir),
  ]);
}, RUN_TIMEOUT_MS * 2);

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(dir, { recursive: true, force: true });
});

describe('`os test` prints the names the author wrote', () => {
  it('heads the suite with its name and file', () => {
    expect(unfiltered.stdout).toContain('📄 Running suite: Accounts smoke (accounts.test.json)');
  });

  it('prints each scenario by name, with its id beside it', () => {
    expect(unfiltered.stdout).toContain('✅ Scenario: The server answers its health probe [acct-health]');
    expect(unfiltered.stdout).toContain('❌ Scenario: A check that fails on purpose [acct-failing]');
  });

  it("prints a failed scenario's description", () => {
    expect(unfiltered.stdout).toContain('Asserts a status the stub never returns.');
  });
});

describe('`os test --tags`', () => {
  it('CONTROL — without --tags every scenario runs, the failing one included, and the run exits 1', () => {
    for (const id of ['acct-health', 'acct-regression', 'acct-untagged', 'acct-failing']) {
      expect(unfiltered.stdout).toContain(`[${id}]`);
    }
    expect(unfiltered.stdout).not.toContain('deselected');
    expect(unfiltered.stdout).toContain('FAILED: 1 scenarios failed. 3 passed.');
    expect(unfiltered.code).toBe(1);
  });

  it('--tags smoke runs only the smoke scenario and exits 0 — the failing one never ran', () => {
    expect(smoke.stdout).toContain('[acct-health]');
    for (const id of ['acct-regression', 'acct-untagged', 'acct-failing']) {
      expect(smoke.stdout).not.toContain(`[${id}]`);
    }
    expect(smoke.stdout).toContain('--tags smoke selected 1 of 4 scenarios; 3 deselected (not run, not counted as passed).');
    expect(smoke.stdout).toContain('SUCCESS: All 1 scenarios passed.');
    expect(smoke.code).toBe(0);
  });

  it('--tags regression runs both regression scenarios and fails on the failing one', () => {
    expect(regression.stdout).toContain('[acct-regression]');
    expect(regression.stdout).toContain('[acct-failing]');
    expect(regression.stdout).not.toContain('[acct-health]');
    expect(regression.stdout).toContain('FAILED: 1 scenarios failed. 1 passed.');
    expect(regression.code).toBe(1);
  });

  it('a selection that matches nothing exits 0 by default, and 1 under --fail-on-empty', () => {
    expect(`${noMatch.stdout}${noMatch.stderr}`).toContain('No scenario matched --tags nomatch.');
    expect(noMatch.stdout).not.toContain('SUCCESS');
    expect(noMatch.code).toBe(0);
    expect(noMatchStrict.code).toBe(1);
  });

  it('a malformed list is refused before anything runs', () => {
    expect(malformed.code).not.toBe(0);
    expect(malformed.stderr).toContain('empty tag name');
    expect(malformed.stdout).not.toContain('Running suite');
  });
});
