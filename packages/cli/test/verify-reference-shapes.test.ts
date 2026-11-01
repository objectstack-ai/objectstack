// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 60 — spawns the real producer once per single-cause fixture: three `os verify` spawns, one per (flags, posture) pair, already in one beforeAll (`--json`, `--reference-shapes --json`, and `--reference-shapes --json` under OS_ALLOW_LAX_VALUE_SHAPES); slowest CI reading 45.37 s (run 40447801748) of the three scheduled CI runs after the oclif test manifest (PR #26256: 40392443783, 40424746941, 40447801748), x 1.25, rounded up

/**
 * PIN — `os verify --reference-shapes` runs the reference-value shape family
 * (ADR-0104 D1) and counts what it finds in the exit status.
 *
 * ## What is pinned
 *
 *   - without the flag the run is what it was: no `referenceShapes` key in the
 *     `--json` document, and the exit status reads CRUD (and RLS) only;
 *   - with the flag, on a stack whose engine refuses wrong-shaped references
 *     (a fresh datastore is born strict), every client-writable reference
 *     field is `proven`, `hardFailures` stays 0 and the run exits 0;
 *   - with the flag, on the same metadata under the posture that admits
 *     wrong shapes (`OS_ALLOW_LAX_VALUE_SHAPES=1`, ADR-0104's declared escape
 *     hatch), each field is reported with holes, `hardFailures` counts them and
 *     the run exits 1 — the negative control, through the CLI.
 *
 * Spawned rather than run in-process: the exit status is the contract a CI
 * gate reads, and only a real process has one.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const STACK = {
  manifest: {
    id: 'com.example.verify-reference-shapes',
    namespace: 'vrs',
    version: '1.0.0',
    name: 'Verify Reference Shapes',
    type: 'app',
    engines: { protocol: '^18' },
  },
  objects: [
    {
      name: 'vrs_account',
      label: 'Account',
      pluralLabel: 'Accounts',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
    {
      name: 'vrs_contact',
      label: 'Contact',
      pluralLabel: 'Contacts',
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Name', required: true },
        account: { type: 'lookup', reference: 'vrs_account', label: 'Account' },
      },
    },
  ],
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Doc {
  hardFailures?: number;
  referenceShapes?: {
    results: Array<{ object: string; field: string; status: string }>;
    summary: { proven: number; holes: number; hardFailures: number };
  };
}

function runCli(dir: string, args: string[], env: Record<string, string> = {}): Run {
  // `bin/run-dev.js` runs this checkout's `src/` (oclif maps its command tree there).
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1', OS_ALLOW_LAX_VALUE_SHAPES: undefined, ...env }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const docOf = (run: Run): Doc => JSON.parse(run.stdout) as Doc;

describe('os verify --reference-shapes', () => {
  let dir: string;
  let plain: Run;
  let strict: Run;
  let lax: Run;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-verify-reference-shapes-'));
    writeFileSync(join(dir, 'objectstack.config.mjs'), defineStackSource(STACK));
    linkSpec(dir);
    plain = runCli(dir, ['verify', '--json']);
    strict = runCli(dir, ['verify', '--reference-shapes', '--json']);
    lax = runCli(dir, ['verify', '--reference-shapes', '--json'], { OS_ALLOW_LAX_VALUE_SHAPES: '1' });
  }, 480_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('leaves the run unchanged without the flag', () => {
    expect(plain.status, `${plain.stdout}\n${plain.stderr}`).toBe(0);
    const doc = docOf(plain);
    expect('referenceShapes' in doc).toBe(false);
    expect(doc.hardFailures).toBe(0);
  });

  it('proves the reference field on a strict stack, and exits 0', () => {
    expect(strict.status, `${strict.stdout}\n${strict.stderr}`).toBe(0);
    const doc = docOf(strict);
    expect(doc.referenceShapes?.results).toEqual([
      expect.objectContaining({ object: 'vrs_contact', field: 'account', status: 'proven' }),
    ]);
    expect(doc.referenceShapes?.summary).toMatchObject({ proven: 1, holes: 0, hardFailures: 0 });
    expect(doc.hardFailures).toBe(0);
  });

  it('NEGATIVE CONTROL: reports the hole on a posture that admits wrong shapes, counts it, and exits 1', () => {
    expect(lax.status, `${lax.stdout}\n${lax.stderr}`).toBe(1);
    const doc = docOf(lax);
    expect(doc.referenceShapes?.summary).toMatchObject({ proven: 0, holes: 1, hardFailures: 1 });
    expect(doc.hardFailures).toBe(1);
  });
});
