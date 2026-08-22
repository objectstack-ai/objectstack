// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#10359) — `os g agent` is gone, and its refusal names the replacement.
 *
 * The generator scaffolded into `src/agents`, a surface ADR-0063 §2 withdrew:
 * the kernel ships exactly two agents (`ask`, `build`) and the runtime catalog
 * filters out every other agent record. So the file it wrote passed
 * `os validate`, published without complaint, and then never appeared — no
 * error at any step. That is the silent-strip failure mode, arriving through
 * the scaffolder.
 *
 * Deleting the entry alone would have moved the silence one step earlier
 * rather than ending it: `Unknown type: agent` followed by the surviving
 * roster tells the author their spelling is not on the list, and the natural
 * next move is to hunt for the right spelling of something that no longer
 * exists. So the assertions below are about the CONTENT of the refusal, not
 * only about its absence from the roster — a bare "unknown generator" passes
 * every "the type is gone" assertion and fails this file.
 *
 * Assertions are on a REAL CHILD PROCESS and on stdout, for the two reasons
 * `invocation-loudness.e2e.test.ts` documents at length: `process.exitCode`
 * inside a vitest worker is not an exit status (a CI script judges this
 * command by `$?`), and these commands print through `utils/format.ts`, whose
 * `printError` writes to stdout. Spawned through `bin/run-dev.js` + tsx so the
 * suite does not depend on `packages/cli/dist` having been built.
 *
 * The refusal's pointer at skills is asserted here only as TEXT. That the
 * command it now names actually exists and writes a loadable file is pinned
 * next door, in `generate-skill.e2e.test.ts` (#11025) — when this message was
 * first written there was no `os g skill` to point at, and it said so.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
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
let unknown: Run;
let survivor: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-g-agent-retired-'));

  // Sequential on purpose: three cold tsx starts, each loading every command
  // module, in a container several agents share.
  retired = await runTsx([CLI, 'g', 'agent', 'support'], dir);
  unknown = await runTsx([CLI, 'g', 'nonexistent-type', 'support'], dir);
  survivor = await runTsx([CLI, 'g', 'object', 'customer', '--dry-run'], dir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('[#10359] `os g agent` is retired', () => {
  it('fails instead of scaffolding — a CI script that still calls it stops', () => {
    expect(retired.code).toBe(1);
  });

  it('says the command was RETIRED, not that the type is unrecognised', () => {
    expect(retired.stdout).toContain('was retired');
    // The generic branch would have swallowed the whole explanation.
    expect(retired.stdout).not.toContain('Unknown type:');
  });

  it('names the decision that withdrew the surface', () => {
    expect(retired.stdout).toContain('ADR-0063');
    expect(retired.stdout).toContain('platform-internal');
  });

  it('names the two platform agents and the silent strip, so the WHY is in the message', () => {
    expect(retired.stdout).toContain('`ask`');
    expect(retired.stdout).toContain('`build`');
    expect(retired.stdout).toContain('never appears');
  });

  it('points the author at SKILLS — the half a bare removal would drop', () => {
    expect(retired.stdout).toContain('SKILL');
    expect(retired.stdout).toContain('src/skills/');
    expect(retired.stdout).toContain('defineSkill');
  });

  it('writes nothing — no `src/agents/`, no barrel index', () => {
    expect(existsSync(join(dir, 'src', 'agents'))).toBe(false);
    expect(existsSync(join(dir, 'src'))).toBe(false);
  });
});

describe('[#10359] the roster no longer advertises `agent`', () => {
  it('omits `agent` from the available types an unknown spelling prints', () => {
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain('Unknown type:');
    expect(unknown.stdout).toContain('Available types:');
    expect(unknown.stdout).not.toMatch(/^\s*agent\s/m);
  });

  it('still lists the six that survive', () => {
    for (const type of ['object', 'view', 'action', 'flow', 'dashboard', 'app']) {
      expect(unknown.stdout).toContain(type);
    }
  });
});

describe('[#10359] the generators that were not retired still work', () => {
  it('`os g object … --dry-run` still previews a typed object file', () => {
    expect(survivor.code).toBe(0);
    expect(survivor.stdout).toContain('Dry run');
    expect(survivor.stdout).toContain("import * as Data from '@objectstack/spec/data'");
  });
});
