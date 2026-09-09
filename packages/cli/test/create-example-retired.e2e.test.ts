// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#16483) — `os create example` is gone, and its refusal names `os init`.
 *
 * ## What the ruling actually replaced
 *
 * #15531 rendered and hashed the real emission of both scaffolder families and
 * found one template-level duplicate: `os create example` wrote a SUBSET of
 * what `os init` writes, plus one README. The director seat ruled (#15531,
 * batch #66, option B) that the template goes rather than that the two command
 * families merge.
 *
 * ⚠️ That entry settles the REMOVAL, and it is the only half verified. The
 * terms asserted below — no alias, no deprecation window — are recorded on
 * card #16483 and are PENDING MAINTAINER CONFIRMATION: a contract review could
 * not locate the ruling they were attributed to. They are asserted here as
 * SHIPPED BEHAVIOUR, which is what a pin can hold: whatever settles the
 * provenance, these assertions describe what the command does today, and they
 * go red if that changes. ⛔ Do not restate the attribution as settled.
 *
 * ⛔ So deleting the template is only half of it. A removal that let
 * `os create example` fall through to `Unknown type:` would print the surviving
 * roster and nothing else, and a reader arriving from an old doc page, an older
 * tutorial or a CI script would learn only that their spelling is off the list
 * — and would go hunting for the right spelling of something that no longer
 * exists. The ruling replaces the command with a SIGNPOST.
 *
 * ## Why a non-zero exit is NOT enough to assert, and what carries the weight
 *
 * A pin that asserted only `code !== 0` stays green on exactly the outcome the
 * ruling exists to prevent: the generic "unknown template" failure is also
 * non-zero. So the load-bearing assertion here is the CONTENT — the refusal
 * names `os init` — and `the generic branch is a different answer` below is its
 * control: an unknown template must exit non-zero and must NOT name `os init`.
 * With both, "assert non-zero" cannot be mistaken for "assert the signpost",
 * because a message that stopped naming `os init` would leave the retired case
 * indistinguishable from the unknown case and this file would go red.
 *
 * ## Why the CLI is driven rather than the module read
 *
 * `RETIRED_TEMPLATES` is asserted as DATA next door in `create.test.ts`. That
 * is worth nothing on its own: a registry nothing reads prints nothing. What is
 * measured here is a real child process — the exit status a CI script judges by
 * `$?`, and the bytes that reach a terminal. Spawned through `bin/run-dev.js` +
 * tsx so the suite does not depend on `packages/cli/dist` having been built
 * (`@objectstack/cli#test` depends on `^build` only), the same way
 * `create-refuses-invalid-project-name.e2e.test.ts` and
 * `generate-agent-retired.e2e.test.ts` spawn.
 *
 * ## ⚠️ This file is NIGHTLY-tier, and the docs half is deliberately NOT here
 *
 * `*.e2e.test.*` is a NAME-decided tier (`scripts/nightly-tiers.mjs`, #16455):
 * these files are excluded from the per-PR and merge-queue population and run
 * in the nightly job. That is the right lane for four cold `tsx` spawns, and it
 * is where both of this pin's closest siblings already live
 * (`create-refuses-invalid-project-name.e2e.test.ts`,
 * `generate-agent-retired.e2e.test.ts`).
 *
 * It is the wrong lane for a file read. So the docs half of this card's pin —
 * that no public page still offers `os create example` to copy — lives next
 * door in `create-example-retired-docs-parity.test.ts`, which spawns nothing,
 * is queue-tier by name, and therefore reddens on the PR that reintroduces the
 * command in a doc page rather than the following night.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { RETIRED_TEMPLATES, templates } from '../src/commands/create.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

const PROJECT = 'my-app';
/** A spelling no template has ever carried — the generic branch's own input. */
const UNKNOWN_TYPE = 'definitely-not-a-template';

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
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
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

let dir: string;
let retired: Run;
let retiredNoName: Run;
let unknown: Run;
let survivor: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-create-example-retired-'));

  // Sequential on purpose: four cold tsx starts, each loading every command
  // module, in a container several agents share.
  retired = await runCli(['create', 'example', PROJECT], dir);
  retiredNoName = await runCli(['create', 'example'], dir);
  unknown = await runCli(['create', UNKNOWN_TYPE, PROJECT], dir);
  survivor = await runCli(['create', 'plugin', PROJECT], dir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('[#16483] `os create example` is retired', () => {
  it('fails instead of scaffolding — a CI script that still calls it stops', () => {
    expect(retired.code).toBe(1);
  });

  it('NAMES `os init` — the half a bare removal would drop', () => {
    // The load-bearing assertion of this file. See the header: non-zero alone
    // is satisfied by the generic failure this refusal exists to replace.
    expect(retired.stderr).toContain('os init');
  });

  it('says the template was RETIRED, not that the type is unrecognised', () => {
    expect(retired.stderr).toContain('was retired');
    // The generic branch would have swallowed the whole explanation.
    expect(retired.stderr).not.toContain('Unknown type:');
  });

  it('states the terms the ruling fixed — no alias, no deprecation window', () => {
    expect(retired.stderr).toContain('no alias');
    expect(retired.stderr).toContain('no deprecation window');
  });

  it('says `os create plugin` survives, so the refusal is not read as the family going', () => {
    expect(retired.stderr).toContain('os create plugin');
  });

  it('writes NOTHING — the refusal lands before the first mkdir', () => {
    expect(existsSync(join(dir, PROJECT))).toBe(false);
  });

  it('answers the same with no project name at all', () => {
    // `os create example` on its own must reach the signpost rather than be
    // told to supply an argument to a command that no longer exists.
    expect(retiredNoName.code).toBe(1);
    expect(retiredNoName.stderr).toContain('os init');
    expect(retiredNoName.stderr).not.toContain('Project name is required');
  });
});

describe('[#16483] the generic branch is a DIFFERENT answer — the control', () => {
  it('an unknown template still fails, and does NOT name `os init`', () => {
    // Without this, "the refusal names `os init`" could be satisfied by any
    // failure path at all, and the pin would not be able to tell a signpost
    // from the generic "unknown template" outcome the ruling forbids.
    expect(unknown.code).toBe(1);
    expect(unknown.stdout + unknown.stderr).toContain('Unknown type:');
    expect(unknown.stdout + unknown.stderr).not.toContain('os init');
  });

  it('the roster it prints no longer advertises `example`', () => {
    expect(unknown.stdout).toContain('Available types:');
    expect(unknown.stdout).not.toContain('example');
    // Derived, so the roster and this assertion cannot drift apart.
    for (const key of Object.keys(templates)) {
      expect(unknown.stdout).toContain(key);
    }
  });

  it('`example` is off the template map and on the retired one', () => {
    expect(Object.keys(templates)).not.toContain('example');
    expect(Object.keys(RETIRED_TEMPLATES)).toContain('example');
  });
});

describe('[#16483] the template that was NOT retired still scaffolds', () => {
  it('`os create plugin <name>` still exits 0 and writes its project', () => {
    // The positive control for every `code === 1` above: the same command in
    // the same directory reaches the opposite verdict, so those assertions are
    // capable of failing.
    expect(survivor.code).toBe(0);
    expect(existsSync(join(dir, templates.plugin.dirName(PROJECT), 'package.json'))).toBe(true);
  });
});
