// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 70 — spawns the real producer once per single-cause fixture: three `os verify` spawns, one per (flags, fixture) pair, already in one beforeAll (`--json` and `--unique-scopes --json` on the app, `--unique-scopes --json` on the control); slowest CI reading 49.91 s (run 40424746941) of the three scheduled CI runs after the oclif test manifest (PR #26256: 40392443783, 40424746941, 40447801748), x 1.25, rounded up

/**
 * PIN — `os verify --unique-scopes` runs the unique-scope family and counts
 * what it finds in the exit status.
 *
 * ## What is pinned
 *
 *   - without the flag the run is what it was: no `uniqueScopes` key in the
 *     `--json` document, and the exit status reads CRUD only;
 *   - with the flag, each declared scope (`true`, `'organization'`,
 *     `'global'`, and the `'organization'` the spec states for an autonumber
 *     that authors none) is `proven` within the install's one organization,
 *     the cross-organization leg is reported NOT RUN on this boot with the
 *     flag that runs it, `hardFailures` stays 0 and the run exits 0;
 *   - with the flag, on the same metadata plus a hook that answers a duplicate
 *     `code` with an uncoded throw instead of letting the constraint refuse it,
 *     the field is reported `failed`, `hardFailures` counts it and the run
 *     exits 1.
 *
 * The third case is a FAULT, not a contradiction, and that is the most this
 * door can show: every config `os verify` loads is `defineStack`-built and
 * boots a fresh database, so no metadata makes a same-organization duplicate
 * land, and the cross-organization leg needs `--multi-tenant`, whose runtime
 * package no framework package may declare. The contradiction controls live
 * beside the family, in `packages/verify/src/unique-scope.test.ts`.
 *
 * Spawned rather than run in-process: the exit status is the contract a CI
 * gate reads, and only a real process has one.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, childEnv } from './helpers/serve-process.js';
import { defineStackSource, defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const MANIFEST = {
  id: 'com.example.verify-unique-scopes',
  namespace: 'vus',
  version: '1.0.0',
  name: 'Verify Unique Scopes',
  type: 'app',
  engines: { protocol: '^18' },
};

const OBJECTS = [
  {
    name: 'vus_account',
    label: 'Account',
    pluralLabel: 'Accounts',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name', required: true, unique: true },
      code: { type: 'text', label: 'Code', unique: 'organization' },
      ext_id: { type: 'text', label: 'External id', unique: 'global' },
      number: { type: 'autonumber', label: 'Number' },
    },
  },
];

/** The same app, plus a hook that crashes on a duplicate `code` before the constraint can refuse it. */
const CONTROL_SOURCE = `{
  manifest: ${JSON.stringify({ ...MANIFEST, id: 'com.example.verify-unique-scopes-control' })},
  objects: ${JSON.stringify(OBJECTS)},
  hooks: [
    {
      name: 'vus_account_crashes_on_a_duplicate_code',
      object: 'vus_account',
      events: ['beforeInsert'],
      handler: async (ctx) => {
        if (typeof ctx.input.code !== 'string') return;
        const held = await ctx.api.object('vus_account').find({ where: { code: ctx.input.code } });
        if (held.length > 0) throw new Error('lookup table corrupted');
      },
    },
  ],
}`;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Doc {
  hardFailures?: number;
  uniqueScopes?: {
    boot: { posture?: string; legs: { within: string; across: string }; acrossNotRun?: string };
    results: Array<{ object: string; field: string; declared?: unknown; status: string; doors: string[] }>;
    summary: { proven: number; failed: number; contradicted: number; hardFailures: number };
  };
}

function runCli(dir: string, args: string[]): Run {
  // Through tsx, so the child runs this checkout's `src/`.
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const docOf = (run: Run): Doc => JSON.parse(run.stdout) as Doc;

describe('os verify --unique-scopes', () => {
  let root: string;
  let plain: Run;
  let proven: Run;
  let control: Run;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'os-verify-unique-scopes-'));
    const app = join(root, 'app');
    const controlApp = join(root, 'control');
    for (const [dir, source] of [
      [app, defineStackSource({ manifest: MANIFEST, objects: OBJECTS })],
      [controlApp, defineStackSourceFromLiteral(CONTROL_SOURCE)],
    ] as const) {
      mkdirSync(dir);
      writeFileSync(join(dir, 'objectstack.config.mjs'), source);
      linkSpec(dir);
    }
    plain = runCli(app, ['verify', '--json']);
    proven = runCli(app, ['verify', '--unique-scopes', '--json']);
    control = runCli(controlApp, ['verify', '--unique-scopes', '--json']);
  }, 480_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('leaves the run unchanged without the flag', () => {
    expect(plain.status, `${plain.stdout}\n${plain.stderr}`).toBe(0);
    const doc = docOf(plain);
    expect('uniqueScopes' in doc).toBe(false);
    expect(doc.hardFailures).toBe(0);
  });

  it('proves each declared scope within the one organization, names the leg it cannot run, and exits 0', () => {
    expect(proven.status, `${proven.stdout}\n${proven.stderr}`).toBe(0);
    const doc = docOf(proven);
    expect(doc.uniqueScopes?.boot).toMatchObject({ posture: 'single', legs: { within: 'run', across: 'not-run' } });
    expect(doc.uniqueScopes?.boot.acrossNotRun).toMatch(/--multi-tenant/);
    expect(doc.uniqueScopes?.results).toEqual([
      expect.objectContaining({ object: 'vus_account', field: 'name', declared: true, status: 'proven', doors: ['rest', 'system'] }),
      expect.objectContaining({ object: 'vus_account', field: 'code', declared: 'organization', status: 'proven' }),
      expect.objectContaining({ object: 'vus_account', field: 'ext_id', declared: 'global', status: 'proven' }),
      expect.objectContaining({ object: 'vus_account', field: 'number', declared: 'organization', status: 'proven', doors: ['system'] }),
    ]);
    expect(doc.uniqueScopes?.summary).toMatchObject({ proven: 4, contradicted: 0, failed: 0, hardFailures: 0 });
    expect(doc.hardFailures).toBe(0);
  });

  it('counts a door that faults on a duplicate, and exits 1', () => {
    expect(control.status, `${control.stdout}\n${control.stderr}`).toBe(1);
    const doc = docOf(control);
    expect(doc.uniqueScopes?.results).toEqual([
      expect.objectContaining({ field: 'name', status: 'proven' }),
      expect.objectContaining({ field: 'code', status: 'failed' }),
      expect.objectContaining({ field: 'ext_id', status: 'proven' }),
      expect.objectContaining({ field: 'number', status: 'proven' }),
    ]);
    expect(doc.uniqueScopes?.summary).toMatchObject({ proven: 3, failed: 1, hardFailures: 1 });
    expect(doc.hardFailures).toBe(1);
  });
});
