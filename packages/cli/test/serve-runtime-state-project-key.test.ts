// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15733 — the runtime state file is keyed by the PROJECT, not by the
 * environment id alone.
 *
 * ## The collision, driven before it was repaired
 *
 * `os serve` publishes `{ pid, port, url, environmentId, startedAt }` to a file
 * under the ObjectStack home so a supervisor can answer *"is my server running,
 * and where?"*. Both halves of where that file lived were machine-global:
 * `resolveObjectStackHome()` takes NO arguments — `OS_HOME`, else
 * `~/.objectstack` — and an environment id is not a project identity. So two
 * different projects on one machine, both in the ordinary `local` environment,
 * addressed ONE file. Two real `os serve` boots, two project roots, one home:
 *
 * ```text
 * project A boots → runtime.env_local.json = { pid 9301, port 42693 }
 * project B boots → runtime.env_local.json = { pid 9345, port 46175 }
 * A asks the file "is my server running, and where?"
 *                → pid 9345 on :46175 — B's server — while A's own was still
 *                  alive and still listening on 42693.
 * A shuts down   → its exit handler deleted the file that by then described B,
 *                  so B served on with no supervision record at all.
 * ```
 *
 * Two failures, one cause: the NAME answered nothing about *whose* server it
 * described. Both are guarded below, because repairing the wrong-answer half
 * and leaving the deleted-record half is exactly the shape that reads as fixed.
 *
 * ## Why child PROCESSES, and why no server
 *
 * Both properties need more than one process. Distinct pids are what make "the
 * second record replaced the first" a reading instead of an artefact of one
 * process writing twice, and `runtimeBoundPortChannels` registers its cleanup
 * as an `exit` listener — so "whose record does a shutdown delete" needs a
 * process that can exit while another keeps running.
 *
 * ⛔ None of them binds a port. What is under test is the file's NAME; a
 * listening socket would add a port race and a boot's worth of seconds to a
 * question that has neither. The two-real-server run above is the measurement
 * that established the defect; this is the pin that keeps it repaired.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectStateKey, runtimeStateFileName } from '../src/commands/serve.js';
import { childEnv, TSX } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CHILD = resolve(HERE, 'helpers/runtime-state-child.ts');

/** The name the file used to have — the one every project shared. */
const LEGACY_SHARED_NAME = 'runtime.env_local.json';

/**
 * A fixed root both sides name a file for, so their answers can be compared.
 *
 * Handed to the child over argv rather than imported from it: that module's
 * body RUNS on import (it is a script), so importing a constant out of it would
 * take this runner down with a `process.exit(2)`.
 */
const NAMING_CONTROL_ROOT = '/objectstack-15733/naming-control';

/** How long one child gets to publish its file and say so. */
const CHILD_READY_TIMEOUT_MS = 90_000;

interface Published {
  pid: number;
  port: number;
  cwd: string;
  home: string;
  namingControl: string;
}

interface Child {
  published: Published;
  /** Close stdin and wait for a CLEAN exit, so the `exit` cleanup really runs. */
  stop: () => Promise<void>;
}

/** Counters, printed at the end: an assertion about runs that never ran is vacuous. */
let childrenSpawned = 0;
let overwritesObserved = 0;

/**
 * Publish one project's state file from its own process.
 *
 * @param projectRoot the child's CWD — the project identity under test
 * @param home        the ONE machine-global home every child here shares
 */
function publishFrom(projectRoot: string, home: string, port: number): Promise<Child> {
  return new Promise((resolveChild, rejectChild) => {
    const child: ChildProcess = spawn(TSX, [CHILD, String(port), NAMING_CONTROL_ROOT], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      // ⛔ `childEnv`, never a bare `...process.env`: vitest sets `TEST`,
      // `VITEST` and the `VITEST_*` family on its worker, and a child that
      // inherits them boots with a different auth and crypto posture than the
      // one under test (`check:cli-test-child-env` is the gate that keeps this
      // directory on the choke point).
      env: childEnv({
        OS_HOME: home,
        // UNSET, so the environment half of the name is serve's own default.
        OS_ENVIRONMENT_ID: undefined,
      }),
    });
    childrenSpawned += 1;

    let stdout = '';
    let stderr = '';
    let settled = false;

    const stop = (): Promise<void> =>
      new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) { done(); return; }
        child.on('exit', () => done());
        child.stdin?.end();
      });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectChild(new Error(
        `child for ${projectRoot} never published.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      ));
    }, CHILD_READY_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      const line = stdout.split('\n').find((candidate) => candidate.trim().startsWith('{'));
      if (line === undefined || settled) return;
      settled = true;
      clearTimeout(timer);
      resolveChild({ published: JSON.parse(line) as Published, stop });
    });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectChild(new Error(
        `child for ${projectRoot} exited ${code} before publishing.\n`
        + `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
      ));
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectChild(error);
    });
  });
}

const readState = (file: string): Published & { url: string } =>
  JSON.parse(readFileSync(file, 'utf8')) as Published & { url: string };

/** ⚠️ The key is a pure function of the ROOT — no filesystem, no writes. */
describe('#15733 the key itself', () => {
  it('gives two different project roots two different keys', () => {
    expect(projectStateKey('/srv/alpha')).not.toBe(projectStateKey('/srv/beta'));
  });

  it('gives one project ONE key however its path is spelled', () => {
    // ⛔ Not a nicety: a supervisor that resolved the root differently from the
    // server would look in the wrong place and read "not running".
    expect(projectStateKey('/srv/alpha/')).toBe(projectStateKey('/srv/alpha'));
    expect(projectStateKey('/srv/beta/../alpha')).toBe(projectStateKey('/srv/alpha'));
  });

  it('still keys a root whose basename sanitises away to nothing', () => {
    // The readable half is DERIVED and may vanish; uniqueness rests on the
    // digest, so this must be a key and not an empty component.
    const key = projectStateKey('/srv/___');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(key).not.toBe(projectStateKey('/srv/+++'));
  });

  it('names the file `runtime.<environment>.<project>.json`, and NOT the shared name', () => {
    const name = runtimeStateFileName('env_local', '/srv/alpha');
    expect(name).toBe(`runtime.env_local.${projectStateKey('/srv/alpha')}.json`);
    expect(name).not.toBe(LEGACY_SHARED_NAME);
    // ⭐ The one non-test reader in this repo — `scripts/publish-smoke.sh`'s
    // `smoke_wait_for_own_server` — finds the file by globbing
    // `runtime.*.json` in the home it pinned. The new name still matches that
    // glob, which is why this repair does not have to move that script.
    expect(/^runtime\..*\.json$/.test(name)).toBe(true);
  });

  it('keeps the environment apart too — the half that already worked', () => {
    expect(runtimeStateFileName('env_local', '/srv/alpha'))
      .not.toBe(runtimeStateFileName('env_staging', '/srv/alpha'));
  });
});

describe('#15733 two projects, one machine-global home', () => {
  let home: string;
  let projectA: string;
  let projectB: string;
  let fileA: string;
  let fileB: string;
  let a: Child;
  let b: Child;
  const temps: string[] = [];
  const live: Child[] = [];

  beforeAll(async () => {
    const mk = (prefix: string): string => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      temps.push(dir);
      return dir;
    };
    // ONE home for both projects. That is not a contrivance: it is what
    // `resolveObjectStackHome()` returns for every project on the machine.
    home = mk('os-15733-home-');
    projectA = mk('os-15733-project-a-');
    projectB = mk('os-15733-project-b-');
    fileA = join(home, runtimeStateFileName('env_local', projectA));
    fileB = join(home, runtimeStateFileName('env_local', projectB));

    a = await publishFrom(projectA, home, 45801);
    live.push(a);
    b = await publishFrom(projectB, home, 45802);
    live.push(b);
  }, 200_000);

  afterAll(async () => {
    for (const child of live) await child.stop();
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  });

  it('CONTROL — both children really ran, in their own processes', () => {
    // Everything below is about what two processes did; without this the suite
    // could be green on a run where one of them never started.
    expect(childrenSpawned).toBeGreaterThanOrEqual(2);
    expect(a.published.pid).not.toBe(b.published.pid);
    expect(a.published.pid).not.toBe(process.pid);
    expect(a.published.cwd).toBe(projectA);
    expect(b.published.cwd).toBe(projectB);
    expect(a.published.home).toBe(home);
    expect(b.published.home).toBe(home);
  });

  it('CONTROL — the children and this file resolve the SAME writer source', () => {
    // ⛔ Freshness, not decoration. The children reach the writer by a relative
    // import into `packages/cli/src` and so does this file, but two readings of
    // one stale build are still one reading — so both sides answer for a FIXED
    // root and the answers are compared, and the answer is checked against the
    // name the repair replaced.
    const mine = runtimeStateFileName('env_local', NAMING_CONTROL_ROOT);
    expect(a.published.namingControl).toBe(mine);
    expect(b.published.namingControl).toBe(mine);
    expect(mine).not.toBe(LEGACY_SHARED_NAME);
  });

  it('⭐ gives each project its OWN file — neither record overwrote the other', () => {
    // ⛔ THE CARD. Before the repair both projects wrote `runtime.env_local.json`
    // and this is the assertion that failed: one path, and only the second
    // boot's record in it.
    expect(fileA).not.toBe(fileB);
    expect(existsSync(fileA), 'project A has no state file of its own').toBe(true);
    expect(existsSync(fileB), 'project B has no state file of its own').toBe(true);

    const stateA = readState(fileA);
    const stateB = readState(fileB);
    expect(stateA.pid, "project A's file describes another project's process").toBe(a.published.pid);
    expect(stateB.pid, "project B's file describes another project's process").toBe(b.published.pid);
    expect(stateA.port).toBe(45801);
    expect(stateB.port).toBe(45802);
    expect(stateA.url).toBe('http://localhost:45801');
    expect(stateB.url).toBe('http://localhost:45802');
  });

  it('⛔ and nothing is written under the shared name any more', () => {
    expect(
      existsSync(join(home, LEGACY_SHARED_NAME)),
      'the environment-only name is back, and with it the collision',
    ).toBe(false);
  });

  it('CONTROL — the key is the PROJECT, not the process: a second boot of A lands on A\'s file', async () => {
    // ⚠️ Discriminates the repair from a much worse one that would pass every
    // assertion above: giving every PROCESS its own file. That would separate
    // the two projects and simultaneously destroy the file's purpose, since no
    // reader could name the file belonging to the project it cares about.
    //
    // It is also the READ-half control. "Both records survived" means nothing
    // unless this harness can see a record being replaced — so here one is,
    // deliberately, and the reading changes.
    const before = readState(fileA);
    const c = await publishFrom(projectA, home, 45803);
    live.push(c);

    const after = readState(fileA);
    expect(after.pid, 'a second boot of the SAME project wrote somewhere else').toBe(c.published.pid);
    expect(after.port).toBe(45803);
    expect(after.pid).not.toBe(before.pid);
    overwritesObserved += 1;
    expect(overwritesObserved).toBe(1);

    // …and it did not touch the other project.
    expect(readState(fileB).pid).toBe(b.published.pid);
  }, 200_000);

  it('⭐ one project\'s shutdown no longer deletes another project\'s record', async () => {
    // The second half of the measured defect: the writer registers an `exit`
    // cleanup for the file it wrote, and when every project shared one file,
    // ANY project exiting removed the record of whoever was still serving.
    expect(existsSync(fileB), 'precondition: B still has a record to lose').toBe(true);

    for (const child of live.filter((candidate) => candidate !== b)) await child.stop();

    expect(existsSync(fileA), "project A's own file survived its own exit").toBe(false);
    expect(existsSync(fileB), "project B's record was deleted by another project's shutdown").toBe(true);
    expect(readState(fileB).pid, "project B's record was rewritten by another project").toBe(b.published.pid);

    // …and B still cleans up after ITSELF.
    await b.stop();
    expect(existsSync(fileB), 'project B left its own record behind on a clean exit').toBe(false);
  }, 200_000);

  it('COUNTS — what actually ran', () => {
    expect(childrenSpawned, 'no child processes were driven at all').toBe(3);
    expect(overwritesObserved, 'the read half was never exercised').toBe(1);
  });
});
