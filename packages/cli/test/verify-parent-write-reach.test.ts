// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 70 — spawns the real producer once per single-cause fixture: three `os verify` spawns, one per (flags, fixture) pair, already in one beforeAll (`--json` and `--parent-write-reach --json` on the app, `--parent-write-reach --json` on the hook control); slowest CI reading 55.76 s (run 40392443783) of the three scheduled CI runs after the oclif test manifest (PR #26256: 40392443783, 40424746941, 40447801748), x 1.25, rounded up

/**
 * PIN — `os verify --parent-write-reach` runs the parent-derived write reach
 * family and counts what it finds in the exit status.
 *
 * ## What is pinned
 *
 *   - without the flag the run is what it was: no `parentWriteReach` key in
 *     the `--json` document, and the exit status reads CRUD only;
 *   - with the flag, the stack is booted with the verifier personas' sets
 *     registered, so all three verifier personas run beside the one declared
 *     position; the `controlled_by_parent` contract is `proven`, its manager
 *     edits another principal's contract through the account and is refused
 *     the delete it lacks, `hardFailures` stays 0 and the run exits 0;
 *   - with the flag, on the same metadata plus a hook that refuses every edit
 *     of the contract with the platform's own envelope (`403
 *     PERMISSION_DENIED`, `details` naming the update of the contract), the
 *     detail's answer disagrees with its master's: the contract is reported
 *     `contradicted`, `hardFailures` counts it and the run exits 1.
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
  id: 'com.example.verify-parent-write-reach',
  namespace: 'vpw',
  version: '1.0.0',
  name: 'Verify Parent Write Reach',
  type: 'app',
  engines: { protocol: '^18' },
};

const OBJECTS = [
  {
    name: 'vpw_account',
    label: 'Account',
    pluralLabel: 'Accounts',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name', required: true } },
  },
  {
    name: 'vpw_contract',
    label: 'Contract',
    pluralLabel: 'Contracts',
    sharingModel: 'controlled_by_parent',
    fields: {
      account: { type: 'master_detail', label: 'Account', reference: 'vpw_account', required: true },
      title: { type: 'text', label: 'Title' },
    },
  },
];

const PERMISSIONS = [
  {
    name: 'vpw_manager',
    label: 'Manager',
    objects: {
      vpw_account: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
      vpw_contract: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false },
    },
  },
];

// [ADR-0131 D3/D4; #24757] The position names its set: a set that only shares
// a position's name is granted by nothing.
const POSITIONS = [{ name: 'vpw_manager', label: 'Manager', permissionSets: ['vpw_manager'] }];

/** The same app, plus a hook that refuses every edit of a contract with the platform's own code. */
const CONTROL_SOURCE = `{
  manifest: ${JSON.stringify({ ...MANIFEST, id: 'com.example.verify-parent-write-reach-control' })},
  objects: ${JSON.stringify(OBJECTS)},
  permissions: ${JSON.stringify(PERMISSIONS)},
  positions: ${JSON.stringify(POSITIONS)},
  hooks: [
    {
      name: 'vpw_contract_refuses_every_edit',
      object: 'vpw_contract',
      events: ['beforeUpdate'],
      handler: async () => {
        throw Object.assign(new Error('refused by the app'), {
          code: 'PERMISSION_DENIED',
          status: 403,
          details: { operation: 'update', object: 'vpw_contract' },
        });
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
  parentWriteReach?: {
    door: string;
    personas: Array<{ name: string; kind: string; status: string }>;
    results: Array<{
      object: string;
      status: string;
      reaches: Array<{ persona: string; masters: string; masterEdit?: string; probes: Array<{ verb: string; detailOwner?: string; expected: string; outcome: string }> }>;
    }>;
    summary: { proven: number; contradicted: number; failed: number; hardFailures: number; personas: { run: number; notRun: number } };
  };
}

function runCli(dir: string, args: string[]): Run {
  // `bin/run-dev.js` runs this checkout's `src/` (oclif maps its command tree there).
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const docOf = (run: Run): Doc => JSON.parse(run.stdout) as Doc;

const shape = (doc: Doc, persona: string, masters: string) =>
  doc.parentWriteReach!.results[0]!.reaches
    .find((r) => r.persona === persona && r.masters === masters)!
    .probes.map((p) => `${p.verb}${p.detailOwner ? `/${p.detailOwner}` : ''} ${p.expected} ${p.outcome}`);

describe('os verify --parent-write-reach', () => {
  let root: string;
  let plain: Run;
  let proven: Run;
  let control: Run;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'os-verify-parent-write-reach-'));
    const app = join(root, 'app');
    const controlApp = join(root, 'control');
    for (const [dir, source] of [
      [app, defineStackSource({ manifest: MANIFEST, objects: OBJECTS, permissions: PERMISSIONS, positions: POSITIONS })],
      [controlApp, defineStackSourceFromLiteral(CONTROL_SOURCE)],
    ] as const) {
      mkdirSync(dir);
      writeFileSync(join(dir, 'objectstack.config.mjs'), source);
      linkSpec(dir);
    }
    plain = runCli(app, ['verify', '--json']);
    proven = runCli(app, ['verify', '--parent-write-reach', '--json']);
    control = runCli(controlApp, ['verify', '--parent-write-reach', '--json']);
  }, 480_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('leaves the run unchanged without the flag', () => {
    expect(plain.status, `${plain.stdout}\n${plain.stderr}`).toBe(0);
    const doc = docOf(plain);
    expect('parentWriteReach' in doc).toBe(false);
    expect(doc.hardFailures).toBe(0);
  });

  it("proves the contract for every persona, the manager's reach through the account included, and exits 0", () => {
    expect(proven.status, `${proven.stdout}\n${proven.stderr}`).toBe(0);
    const doc = docOf(proven);
    const report = doc.parentWriteReach!;
    expect(report.door).toBe('user');
    expect(report.personas.map((p) => `${p.name} ${p.status}`)).toEqual([
      'master-all-records run', 'detail-only run', 'master-all-records-no-delete run', 'position:vpw_manager run',
    ]);
    expect(report.results).toEqual([expect.objectContaining({ object: 'vpw_contract', status: 'proven' })]);
    // Another principal's account, edited by the all-records grant: the contract follows, never its delete.
    expect(shape(doc, 'position:vpw_manager', 'other')).toEqual([
      'edit/other allowed held', 'delete/other refused held', 'edit/own allowed held', 'delete/own refused held', 'create allowed held',
    ]);
    expect(report.summary).toMatchObject({ proven: 1, contradicted: 0, failed: 0, hardFailures: 0, personas: { run: 4, notRun: 0 } });
    expect(doc.hardFailures).toBe(0);
  });

  it("counts a detail whose answer disagrees with its master's, and exits 1", () => {
    expect(control.status, `${control.stdout}\n${control.stderr}`).toBe(1);
    const doc = docOf(control);
    expect(doc.parentWriteReach!.results).toEqual([expect.objectContaining({ object: 'vpw_contract', status: 'contradicted' })]);
    expect(shape(doc, 'master-all-records', 'other')).toEqual([
      'edit/other allowed contradicted', 'delete/other allowed held', 'edit/own allowed contradicted', 'delete/own allowed held', 'create allowed held',
    ]);
    expect(doc.parentWriteReach!.summary).toMatchObject({ contradicted: 1, hardFailures: 1 });
    expect(doc.hardFailures).toBe(1);
  });
});
