// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#19098) — the retired-generator door of `os generate`, in the run that
 * gates the merge queue.
 *
 * `os generate schema` was retired by maintainer ruling (comment 5856790152 on
 * #19098, letter C): the JSON Schema it wrote passed configs the platform then
 * refused. Retiring it moved the `RETIRED_GENERATORS` lookup to the top of
 * `Generate.run`, ahead of the sub-command routing and the `<name>`
 * requirement, because `schema` was a routed sub-command that took no name:
 * behind either of those, the ledger was never read for it. The lookup is an
 * own-key read, so an inherited name such as `constructor` is not taken for a
 * retired type (it used to be, and the refusal then crashed on
 * `retired.detail`).
 *
 * Held here, each to exit 1 and bytes on disk:
 *
 *   1. `os generate schema`, the documented spelling, with no name: the
 *      retirement refusal, not "Missing required argument" (what the old
 *      position answered) and not "Unknown type:"; it names the ruling,
 *      `os validate` and the per-type schemas `@objectstack/spec` publishes;
 *      and it writes nothing, not even the default `objectstack.schema.json`.
 *   2. `os g schema -o FILE`: the same door for the alias with the old flag,
 *      and the `-o` target stays unwritten.
 *   3. `os g constructor NAME`: an own-key miss. It is not answered as
 *      retired, it does not crash, and it writes nothing.
 *
 * One control keeps the refusals from being satisfied by a command that
 * refuses everything: in the same directory `os g object customer --dry-run`
 * exits 0 and previews exactly what the object template emits (anchored to
 * the exported template rather than to a copied line of it).
 *
 * ## Why a child process, and why this file is NOT named `.e2e`
 *
 * The same reasons `generate-refuses-namespace-prefix.test.ts` gives: an exit
 * code plus bytes on disk are the contract, `process.exitCode` inside a
 * vitest worker is not an exit status, and `printError` writes to stdout.
 * Spawning puts the file in the `integration` project; the name keeps it in
 * the per-PR run. `generate-schema-retired.e2e.test.ts` and
 * `generate-agent-retired.e2e.test.ts` hold the fuller refusal texts nightly;
 * this file is the per-PR guard for the door.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold starts, four of them, sequential. */
const RUN_TIMEOUT_MS = 240_000;

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

const objectTemplate = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'object');

let dir: string;
let schema: Run;
let schemaAlias: Run;
let inherited: Run;
let control: Run;

/** The directory as each refusal left it, read before the control runs. */
let afterSchemaRuns: string[];
let afterInherited: string[];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-g-refuses-retired-'));

  // Sequential on purpose: cold tsx starts in a container several agents share.
  // Every refusal runs BEFORE the control, so the listings below are what each
  // refusal was measured against.
  schema = await runTsx([CLI, 'generate', 'schema'], dir);
  schemaAlias = await runTsx([CLI, 'g', 'schema', '-o', 'custom.schema.json'], dir);
  afterSchemaRuns = readdirSync(dir);
  inherited = await runTsx([CLI, 'g', 'constructor', 'thing'], dir);
  afterInherited = readdirSync(dir);
  control = await runTsx([CLI, 'g', 'object', 'customer', '--dry-run'], dir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('[#19098] `os generate schema` answers the retirement refusal', () => {
  it('exits 1, for the documented spelling and for the alias with `-o`', () => {
    expect(schema.code, schema.stdout + schema.stderr).toBe(1);
    expect(schemaAlias.code, schemaAlias.stdout + schemaAlias.stderr).toBe(1);
  });

  it('writes nothing: neither the default `objectstack.schema.json` nor the `-o` target', () => {
    expect(afterSchemaRuns).toEqual([]);
  });

  it('is the retirement, not a missing name and not an unknown type', () => {
    for (const run of [schema, schemaAlias]) {
      expect(run.stdout).toContain('`os g schema` was retired');
      expect(run.stdout).not.toContain('Missing required argument');
      expect(run.stdout).not.toContain('Unknown type:');
    }
  });

  it('names the ruling, `os validate` and the per-type schemas `@objectstack/spec` publishes', () => {
    expect(schema.stdout).toContain('maintainer ruling');
    expect(schema.stdout).toContain('os validate');
    expect(schema.stdout).toContain('@objectstack/spec/json-schema/');
  });
});

describe('[#19098] the ledger is read by own key only', () => {
  it('`os g constructor thing` is not taken for a retired type, and does not crash', () => {
    expect(inherited.code, inherited.stdout + inherited.stderr).toBe(1);
    expect(inherited.stdout).not.toContain('was retired');
    expect(`${inherited.stdout}\n${inherited.stderr}`).not.toContain('TypeError');
  });

  it('writes nothing', () => {
    expect(afterInherited).toEqual([]);
  });
});

describe('[#19098] CONTROL — the door is not a command that refuses everything', () => {
  it('`os g object customer --dry-run` exits 0 and previews what the object template emits', () => {
    expect(control.code, control.stdout + control.stderr).toBe(0);
    expect(control.stdout).toContain('Dry run');
    expect(objectTemplate).toBeDefined();
    // The preview prints the template's output, each line indented two spaces;
    // this directory has no config, so the template is called with no namespace.
    const preview = objectTemplate!.generate('customer').split('\n').map((l) => `  ${l}`).join('\n');
    expect(control.stdout).toContain(preview);
  });
});
