// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#19098) — `os generate schema` is retired, and its refusal says where
 * the truth lives instead.
 *
 * Maintainer ruling on #19098 (comment 5856790152, letter C). The command
 * wrote a JSON Schema of `ObjectStackDefinitionSchema` through a bare
 * `z.toJSONSchema`, so every refinement the platform enforces beyond the
 * shape was missing from the file, and an editor passed configs the runtime
 * then refused. It is retired, not repaired, and no replacement file is
 * generated. The refusal names the ruling, `os validate` (the real parse) and
 * the per-type schemas `@objectstack/spec` publishes (the published
 * projection).
 *
 * This file replaces `generate-schema-writes-json-schema.e2e.test.ts`
 * (#17873), which pinned the document the command wrote — the very file the
 * ruling withdrew.
 *
 * The shape follows `generate-agent-retired.e2e.test.ts` (commit 15b63e85a): the
 * assertions are about the CONTENT of the refusal, not only about a non-zero
 * exit, because a bare "unknown type" or "missing argument" also exits 1 and
 * leaves the author hunting for a spelling of something that no longer
 * exists. They run on a REAL CHILD PROCESS and read stdout, for the reasons
 * that file gives (`process.exitCode` in a vitest worker is not an exit
 * status; `printError` writes to stdout), spawned through `bin/run-dev.js` +
 * tsx so the suite does not depend on `packages/cli/dist`.
 *
 * ## Why the DOOR is pinned, not only the ledger entry
 *
 * `schema` was a routed sub-command that took no `<name>`. A ledger entry on
 * its own is unreachable from `os generate schema`: the sub-command switch in
 * `Generate.run` returned first, and with that case gone the `<name>`
 * requirement answered "Missing required argument" before the ledger was read
 * (measured before this change on `os g agent`, which printed exactly that).
 * So the two spellings below are the ones an author or a CI script actually
 * runs — the documented `os generate schema` with no name, and the alias with
 * the old `-o` flag, whose target must stay unwritten. Two controls hold the
 * door's shape: `os g agent` with no name proves the door is the ledger rather
 * than a `schema` special case, and `os g constructor` proves it reads own
 * keys only (an inherited name used to be taken for a retired type and crash
 * the refusal on `retired.detail`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
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

let dir: string;
let retired: Run;
let retiredAlias: Run;
let writtenBySchemaRuns: string[];
let agentNoName: Run;
let inherited: Run;
let survivor: Run;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-g-schema-retired-'));

  // Sequential on purpose: five cold tsx starts, each loading every command
  // module, in a container several agents share.
  retired = await runTsx([CLI, 'generate', 'schema'], dir);
  retiredAlias = await runTsx([CLI, 'g', 'schema', '-o', 'custom.schema.json'], dir);
  // Listed right after the two schema runs and before anything else runs in
  // this directory: the default target and the `-o` target must both be absent.
  writtenBySchemaRuns = readdirSync(dir);
  agentNoName = await runTsx([CLI, 'g', 'agent'], dir);
  inherited = await runTsx([CLI, 'g', 'constructor', 'thing'], dir);
  survivor = await runTsx([CLI, 'g', 'object', 'customer', '--dry-run'], dir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('[#19098] `os generate schema` is retired', () => {
  it('fails instead of writing — a CI script that still calls it stops', () => {
    expect(retired.code).toBe(1);
    expect(retiredAlias.code).toBe(1);
  });

  it('writes nothing — neither the default `objectstack.schema.json` nor an `-o` target', () => {
    expect(writtenBySchemaRuns).toEqual([]);
  });

  it('says the command was RETIRED — not an unknown type, not a missing name', () => {
    expect(retired.stdout).toContain('`os g schema` was retired');
    expect(retired.stdout).not.toContain('Unknown type:');
    expect(retired.stdout).not.toContain('Missing required argument');
  });

  it('names the ruling that retired it', () => {
    expect(retired.stdout).toContain('maintainer ruling');
  });

  it('points at `os validate` — the parse that runs the rules the file dropped', () => {
    expect(retired.stdout).toContain('os validate');
  });

  it('points at the per-type schemas `@objectstack/spec` publishes', () => {
    expect(retired.stdout).toContain('@objectstack/spec/json-schema/');
  });

  it('answers the alias with the old `-o` flag through the same door, byte for byte', () => {
    expect(retiredAlias.stdout).toBe(retired.stdout);
  });
});

describe('[#19098] the retirement door is the ledger, read before routing and before `<name>`', () => {
  it('`os g agent` with no name gets the agent retirement, not "Missing required argument"', () => {
    expect(agentNoName.code).toBe(1);
    expect(agentNoName.stdout).toContain('`os g agent` was retired');
    expect(agentNoName.stdout).toContain('ADR-0063');
    expect(agentNoName.stdout).not.toContain('Missing required argument');
  });

  it('an inherited name (`constructor`) is not a retired type — own keys only', () => {
    expect(inherited.code).toBe(1);
    expect(inherited.stdout).not.toContain('was retired');
    expect(`${inherited.stdout}\n${inherited.stderr}`).not.toContain('TypeError');
  });
});

describe('[#19098] the generators that were not retired still work', () => {
  it('`os g object … --dry-run` still previews a typed object file', () => {
    expect(survivor.code).toBe(0);
    expect(survivor.stdout).toContain('Dry run');
    expect(survivor.stdout).toContain('src/objects/customer.object.ts');
    // The import line, not a spelling of it: the template's binding changed
    // once already (a namespace import became `{ ObjectSchema }`), and the
    // control asks only that a typed object file is still previewed.
    expect(survivor.stdout).toContain("from '@objectstack/spec/data'");
  });
});
