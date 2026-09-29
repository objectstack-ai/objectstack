// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — what `os test` PRINTS and how it EXITS when a scenario's `requires`
 * does not hold (the `qa-runner` family's `requires` key, ruled B), measured on
 * a real child process against a real HTTP target.
 *
 * Before: `requires` was declared and checked by nothing — a scenario naming a
 * service or a variable the run lacked ran anyway and reported whatever its
 * steps happened to produce, PASSED included. Now core's TestRunner judges it
 * before the first step and `os test` reports an unmet scenario as SKIPPED
 * with its reason, counted apart and never as passed. The runner's judgement is
 * held by `packages/core/src/qa/runner.test.ts`; this file holds the wiring
 * those unit pins cannot see — the discovery document reaching the judgement
 * through the adapter's one probe, the runner reading THIS process's
 * environment, the reason reaching stdout, and the exit status a CI step reads.
 *
 * The fixture is built so each run's EXIT STATUS is itself evidence: every
 * gated scenario asserts a health status the stub never returns, so it can
 * only exit 0 if the scenario was really skipped — not run, and not merely
 * hidden from the report.
 *
 * A real child process, because `process.exit(1)` inside a vitest worker is
 * not an exit status. Spawned through `bin/run-dev.js` + tsx so the suite does
 * not depend on `packages/cli/dist`. The target is a stub `node:http` server
 * in this process that answers discovery the way both real producers do; no
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

/** The variable the `params`-gated scenario needs — test-only, so `OS_TEST_*`. */
const PARAM = 'OS_TEST_QA_REQUIRES_PROBE_TOKEN';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      // The variable is REMOVED unless the run sets it, so an operator's shell
      // cannot decide what the unset-variable run measures.
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1', [PARAM]: undefined, ...env }) },
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

/** The discovery `services` map the stub serves — both halves of availability matter. */
const SERVICES = {
  data: { enabled: true, status: 'available', route: '/api/v1/data' },
  auth: { enabled: true, status: 'available', route: '/api/v1/auth' },
  ai: { enabled: false, status: 'unavailable', message: 'No implementation ships in the open framework' },
  metadata: { enabled: true, status: 'degraded', route: '/api/v1/meta' },
};

const MIXED = {
  name: 'Requires probe',
  scenarios: [
    { id: 'plain', name: 'No requirements', steps: [healthStep('ok')] },
    { id: 'svc-met', name: 'Needs data', requires: { services: ['data'] }, steps: [healthStep('ok')] },
    // Would FAIL if it ran: the stub never answers `degraded`.
    { id: 'svc-unmet', name: 'Needs ai', requires: { services: ['ai'] }, steps: [healthStep('degraded')] },
    { id: 'param-gated', name: 'Needs a token', requires: { params: [PARAM] }, steps: [healthStep('ok')] },
  ],
};

const ALL_SKIPPED = {
  name: 'Nothing here can run',
  scenarios: [
    { id: 'ai-1', name: 'Needs ai', requires: { services: ['ai'] }, steps: [healthStep('degraded')] },
    { id: 'meta-1', name: 'Needs metadata available', requires: { services: ['metadata'] }, steps: [healthStep('degraded')] },
  ],
};

let dir: string;
let server: Server;
let discoveryHits = 0;
let unset: Run;
let withParam: Run;
let allSkipped: Run;
let allSkippedStrict: Run;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/v1/discovery') {
      discoveryHits += 1;
      res.end(JSON.stringify({ version: 'v1', routes: { data: '/api/v1/data' }, services: SERVICES }));
      return;
    }
    res.end(JSON.stringify({ success: true, data: { status: 'ok' }, path: req.url }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  dir = mkdtempSync(join(tmpdir(), 'os-qa-requires-'));
  mkdirSync(join(dir, 'qa'));
  mkdirSync(join(dir, 'qa-skip'));
  writeFileSync(join(dir, 'qa', 'requires.test.json'), JSON.stringify(MIXED), 'utf-8');
  writeFileSync(join(dir, 'qa-skip', 'skip.test.json'), JSON.stringify(ALL_SKIPPED), 'utf-8');

  const mixed = ['test', 'qa/*.test.json', '--url', url];
  const skip = ['test', 'qa-skip/*.test.json', '--url', url];
  [unset, withParam, allSkipped, allSkippedStrict] = await Promise.all([
    runCli(mixed, dir),
    runCli(mixed, dir, { [PARAM]: 'tok' }),
    runCli(skip, dir),
    runCli([...skip, '--fail-on-empty'], dir),
  ]);
}, RUN_TIMEOUT_MS * 2);

afterAll(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  rmSync(dir, { recursive: true, force: true });
});

describe('`os test` — an unmet `requires` SKIPS the scenario, with its reason', () => {
  it('CONTROL — a scenario without requirements and one whose service the target serves both run', () => {
    expect(unset.stdout).toContain('✅ Scenario: No requirements [plain]');
    expect(unset.stdout).toContain('✅ Scenario: Needs data [svc-met]');
  });

  it('an unmet `services` entry skips, naming the service and the services the target declares available', () => {
    expect(unset.stdout).toContain('⏭️  Scenario: Needs ai [svc-unmet] (skipped)');
    expect(unset.stdout).toMatch(
      /Skipped: requires\.services 'ai' is not available on the target \(enabled: false, status: unavailable\)\. The target declares available: auth, data\./,
    );
    // It never ran: its step would have failed, and nothing did.
    expect(unset.stdout).not.toContain('❌');
  });

  it('an unmet `params` entry skips naming the variable; set in the `os test` process, the scenario runs', () => {
    expect(unset.stdout).toContain('⏭️  Scenario: Needs a token [param-gated] (skipped)');
    expect(unset.stdout).toContain(`Skipped: requires.params '${PARAM}' is not set`);
    expect(withParam.stdout).toContain('✅ Scenario: Needs a token [param-gated]');
  });

  it('skipped scenarios are counted apart and never as passed; skips alone exit 0', () => {
    expect(unset.stdout).toContain('SUCCESS: 2 scenarios passed. 2 skipped (not run, not counted as passed).');
    expect(unset.code).toBe(0);
    expect(withParam.stdout).toContain('SUCCESS: 3 scenarios passed. 1 skipped (not run, not counted as passed).');
    expect(withParam.code).toBe(0);
  });

  it('the judgement rides the ONE discovery probe per run — never one per scenario', () => {
    // Four runs, each requiring a service in at least one scenario: one probe each.
    expect(discoveryHits).toBe(4);
  });
});

describe('`os test` — a run in which every scenario was skipped is not a pass', () => {
  it('prints no SUCCESS, says nothing ran, and exits 0 by default', () => {
    expect(allSkipped.stdout).not.toContain('SUCCESS');
    expect(`${allSkipped.stdout}${allSkipped.stderr}`).toContain(
      'No scenario ran: all 2 selected scenarios were skipped on unmet requirements.',
    );
    expect(allSkipped.code).toBe(0);
  });

  it('exits 1 under --fail-on-empty', () => {
    expect(allSkippedStrict.stdout).not.toContain('SUCCESS');
    expect(allSkippedStrict.stderr).toContain('--fail-on-empty');
    expect(allSkippedStrict.code).toBe(1);
  });
});
