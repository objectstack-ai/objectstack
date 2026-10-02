// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `os verify` runs the author-time rules FIRST, and a stack they refuse
 * fails `verify` with the findings `os validate` reports, before the runtime
 * stage boots anything (#21323).
 *
 * ## The defect
 *
 * `docs/NORTH-STAR.md` defines "done" as `objectstack verify` green. Measured
 * through the real CLI on a blank scaffold plus a small task app carrying
 * three planted mistakes, before this landed:
 *
 *     os validate   EXIT=1   ✗ Author-time rules failed (3 issues)
 *     os build      EXIT=1   the same three
 *     os lint       EXIT=1   the same three, as errors
 *     os verify     EXIT=0   ✓ verify passed — no runtime failures
 *
 * `verify` booted the stack and exercised CRUD and RLS only; it never asked
 * the author-time rule registry, so the documented done-bar was green on a
 * stack the build refuses to ship.
 *
 * ## What is pinned
 *
 *   - the planted stack: `os verify` exits 1 on both faces, the `--json`
 *     document carries the SAME gating findings `os validate --json` carries
 *     under `errors` (deep-equal, in order), and the runtime stage did not run
 *     — the `--json` stdout is one document, because nothing booted to write
 *     a log line into it;
 *   - the clean control: the same stack with the three mistakes corrected
 *     passes the rule stage and reaches the runtime stage, exit 0. Without it,
 *     a `verify` that refused everything would satisfy the first half.
 *
 * Spawned rather than run in-process: the exit CODE is the contract CI reads,
 * and only a real process produces it. The three mistakes are the card's own.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

/** The three rules the card's planted mistakes trip, in the order the registry reports them. */
const PLANTED_RULES = ['expression-invalid', 'object-reference-unknown', 'list-view-field-unknown'];

/**
 * A small task app. `planted` carries the card's three mistakes: a lookup to an
 * object that does not exist, an action `visible` expression with a bare field
 * reference instead of `record.done`, and a list column naming no field.
 */
function taskApp(planted: boolean): Record<string, unknown> {
  return {
    manifest: {
      id: 'com.example.verify-gate',
      namespace: 'vg',
      version: '1.0.0',
      name: 'Verify Gate',
      type: 'app',
      engines: { protocol: '^17' },
    },
    objects: [
      {
        name: 'vg_project',
        label: 'Project',
        pluralLabel: 'Projects',
        sharingModel: 'private',
        fields: { name: { type: 'text', label: 'Name', required: true } },
      },
      {
        name: 'vg_task',
        label: 'Task',
        pluralLabel: 'Tasks',
        sharingModel: 'private',
        fields: {
          title: { type: 'text', label: 'Title', required: true },
          done: { type: 'boolean', label: 'Done' },
          project: { type: 'lookup', label: 'Project', reference: planted ? 'vg_projects' : 'vg_project' },
        },
      },
    ],
    views: [
      {
        name: 'vg_task',
        label: 'Task',
        object: 'vg_task',
        list: {
          type: 'grid',
          label: 'All tasks',
          columns: [{ field: 'title' }, { field: 'done' }, { field: 'project' }, ...(planted ? [{ field: 'priority' }] : [])],
        },
      },
    ],
    actions: [
      {
        name: 'complete_task',
        label: 'Complete',
        objectName: 'vg_task',
        type: 'url',
        target: 'https://example.com/help',
        locations: ['record_header'],
        visible: planted ? 'done != true' : 'record.done != true',
      },
    ],
  };
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(dir: string, args: string[]): Run {
  // Through tsx, so the child runs this checkout's `src/` — under plain node
  // oclif resolves the command from `dist/`, and the pin would measure
  // whatever was last built.
  const r = spawnSync(TSX, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    // Every spawned child under this directory declares its environment at the
    // call site (#11595).
    env: childEnv({ NO_COLOR: '1' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function projectDir(planted: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), `os-verify-author-time-${planted ? 'planted' : 'clean'}-`));
  writeFileSync(join(dir, 'objectstack.config.mjs'), defineStackSource(taskApp(planted)));
  linkSpec(dir);
  return dir;
}

describe('os verify runs the author-time rules before the runtime stage (#21323)', () => {
  let planted: string;
  let clean: string;

  beforeAll(() => {
    planted = projectDir(true);
    clean = projectDir(false);
  });

  afterAll(() => {
    for (const dir of [planted, clean]) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the planted stack fails `os verify --json` with exactly the findings `os validate --json` reports', () => {
    const validate = runCli(planted, ['validate', '--json']);
    expect(validate.status, `os validate --json:\n${validate.stdout}\n${validate.stderr}`).toBe(1);
    const validateDoc = JSON.parse(validate.stdout) as { errors: Array<{ rule: string }> };
    // Positive control: the fixture really plants the card's three, and
    // nothing else gates — otherwise the equality below could hold over the
    // wrong set.
    expect(validateDoc.errors.map((e) => e.rule)).toEqual(PLANTED_RULES);

    const verify = runCli(planted, ['verify', '--json']);
    expect(verify.status, `os verify --json exited 0 on a stack os validate refuses:\n${verify.stdout}`).toBe(1);
    // ONE document on stdout: the runtime stage never booted, so no boot log
    // line can have reached it. A parse failure here means it did.
    const verifyDoc = JSON.parse(verify.stdout) as { error: string; errors: unknown[] };
    expect(typeof verifyDoc.error).toBe('string');
    expect(verifyDoc.errors).toEqual(validateDoc.errors);
  }, 180_000);

  it('the planted stack fails `os verify` on the text face, naming each rule, without booting', () => {
    const verify = runCli(planted, ['verify']);
    const output = `${verify.stdout}${verify.stderr}`;
    expect(verify.status, `os verify exited 0 on a stack os validate refuses:\n${output}`).toBe(1);
    for (const rule of PLANTED_RULES) expect(output).toContain(`rule: ${rule}`);
    expect(output).toContain('the runtime stage did not run');
    expect(output).not.toContain('verify passed');
    expect(output).not.toContain('=== objectstack verify');
  }, 180_000);

  it('the clean control passes the rule stage and the runtime stage (exit 0)', () => {
    const verify = runCli(clean, ['verify']);
    const output = `${verify.stdout}${verify.stderr}`;
    expect(verify.status, `os verify failed on the clean control:\n${output}`).toBe(0);
    expect(output).toContain('Author-time rules passed');
    expect(output).toContain('=== objectstack verify');
    expect(output).toContain('verify passed');
  }, 180_000);
});
