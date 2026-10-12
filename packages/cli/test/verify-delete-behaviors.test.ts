// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os verify --delete-behaviors` runs the delete-behaviour family and
 * counts what it finds in the exit status.
 *
 * ## What is pinned
 *
 *   - without the flag the run is what it was: no `deleteBehaviors` key in the
 *     `--json` document, and the exit status reads CRUD only;
 *   - with the flag, each declared behaviour (`cascade`, `restrict`, and the
 *     `set_null` the spec states for a lookup that authors nothing) is
 *     `proven` through both doors, `hardFailures` stays 0 and the run exits 0;
 *   - with the flag, on the same metadata plus a `beforeDelete` hook that
 *     detaches the cascading holders before the engine's referential pass
 *     runs, the `cascade` field is reported contradicted, `hardFailures`
 *     counts it and the run exits 1 — the negative control, through the CLI.
 *
 * Spawned rather than run in-process: the exit status is the contract a CI
 * gate reads, and only a real process has one.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { defineStackSource, defineStackSourceFromLiteral, linkSpec } from './helpers/define-stack-fixture.js';

const MANIFEST = {
  id: 'com.example.verify-delete-behaviors',
  namespace: 'vdb',
  version: '1.0.0',
  name: 'Verify Delete Behaviors',
  type: 'app',
  engines: { protocol: '^18' },
};

const OBJECTS = [
  {
    name: 'vdb_account',
    label: 'Account',
    pluralLabel: 'Accounts',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name', required: true } },
  },
  {
    name: 'vdb_contact',
    label: 'Contact',
    pluralLabel: 'Contacts',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name', required: true },
      account: { type: 'lookup', reference: 'vdb_account', label: 'Account', deleteBehavior: 'cascade' },
    },
  },
  {
    name: 'vdb_note',
    label: 'Note',
    pluralLabel: 'Notes',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name', required: true },
      account: { type: 'lookup', reference: 'vdb_account', label: 'Account', deleteBehavior: 'restrict' },
    },
  },
  {
    name: 'vdb_tag',
    label: 'Tag',
    pluralLabel: 'Tags',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name', required: true },
      account: { type: 'lookup', reference: 'vdb_account', label: 'Account' },
    },
  },
];

/** The same app, plus a hook that undoes the cascade before the engine judges the delete. */
const CONTROL_SOURCE = `{
  manifest: ${JSON.stringify({ ...MANIFEST, id: 'com.example.verify-delete-behaviors-control' })},
  objects: ${JSON.stringify(OBJECTS)},
  hooks: [
    {
      name: 'vdb_account_detaches_contacts',
      object: 'vdb_account',
      events: ['beforeDelete'],
      handler: async (ctx) => {
        const contacts = ctx.api.object('vdb_contact');
        for (const row of await contacts.find({ where: { account: ctx.input.id } })) {
          await contacts.updateById(row.id, { account: null });
        }
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
  deleteBehaviors?: {
    results: Array<{ object: string; field: string; declared?: string; status: string }>;
    summary: { proven: number; contradicted: number; hardFailures: number };
  };
}

function runCli(dir: string, args: string[]): Run {
  // Through tsx, so the child runs this checkout's `src/`.
  const r = spawnSync(TSX, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: childEnv({ NO_COLOR: '1' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const docOf = (run: Run): Doc => JSON.parse(run.stdout) as Doc;

describe('os verify --delete-behaviors', () => {
  let root: string;
  let plain: Run;
  let proven: Run;
  let control: Run;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'os-verify-delete-behaviors-'));
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
    proven = runCli(app, ['verify', '--delete-behaviors', '--json']);
    control = runCli(controlApp, ['verify', '--delete-behaviors', '--json']);
  }, 480_000);

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('leaves the run unchanged without the flag', () => {
    expect(plain.status, `${plain.stdout}\n${plain.stderr}`).toBe(0);
    const doc = docOf(plain);
    expect('deleteBehaviors' in doc).toBe(false);
    expect(doc.hardFailures).toBe(0);
  });

  it('proves each declared behaviour, and exits 0', () => {
    expect(proven.status, `${proven.stdout}\n${proven.stderr}`).toBe(0);
    const doc = docOf(proven);
    expect(doc.deleteBehaviors?.results).toEqual([
      expect.objectContaining({ object: 'vdb_contact', field: 'account', declared: 'cascade', status: 'proven' }),
      expect.objectContaining({ object: 'vdb_note', field: 'account', declared: 'restrict', status: 'proven' }),
      expect.objectContaining({ object: 'vdb_tag', field: 'account', declared: 'set_null', status: 'proven' }),
    ]);
    expect(doc.deleteBehaviors?.summary).toMatchObject({ proven: 3, contradicted: 0, hardFailures: 0 });
    expect(doc.hardFailures).toBe(0);
  });

  it('NEGATIVE CONTROL: reports a cascade a hook undid, counts it, and exits 1', () => {
    expect(control.status, `${control.stdout}\n${control.stderr}`).toBe(1);
    const doc = docOf(control);
    expect(doc.deleteBehaviors?.results).toEqual([
      expect.objectContaining({ object: 'vdb_contact', field: 'account', declared: 'cascade', status: 'contradicted' }),
      expect.objectContaining({ object: 'vdb_note', field: 'account', status: 'proven' }),
      expect.objectContaining({ object: 'vdb_tag', field: 'account', status: 'proven' }),
    ]);
    expect(doc.deleteBehaviors?.summary).toMatchObject({ proven: 2, contradicted: 1, hardFailures: 1 });
    expect(doc.hardFailures).toBe(1);
  });
});
