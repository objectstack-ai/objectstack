// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2, child N] `os validate` and `os build` refuse an artifact two of
 * whose packages hold one `(type, name)` inside one namespace — for the twelve
 * uncovered bucket 2/3 types — in the package door's words, and `os build`
 * writes nothing.
 *
 * The row's message is asserted EQUAL to the refusal the real package door
 * throws for the same artifact (`manifest.register()` on a booted kernel), so
 * the two doors cannot drift into two sentences.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { childEnv } from './helpers/serve-process.js';
import { defineStackSource, linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
/** A cold spawn of the CLI source entry runs well past vitest's 5 s default. */
const SPAWN_TIMEOUT_MS = 120_000;
/** `os build`'s default `--output`, relative to the working directory. */
const ARTIFACT = join('dist', 'objectstack.json');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

function payloadOf(run: Run, label: string): Record<string, any> {
  try {
    return JSON.parse(run.stdout) as Record<string, any>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

const ALPHA = 'com.example.nsn-alpha';
const BETA = 'com.example.nsn-beta';

/**
 * A two-package artifact; `betaNs` is the second package's namespace. Inside
 * one namespace both packages hold the page `nsn_home` and the tool
 * `nsn_lookup`. Across two namespaces only the page is shared: a tool is also
 * phase 1's bare-name one-holder type, which refuses one tool name held by two
 * packages environment-wide, so a shared tool there would be that rule's
 * refusal, not this one's CONTROL.
 */
function packagesStack(betaNs: string): Record<string, unknown> {
  const pkg = (id: string, ns: string, tag: string, tool: string) => ({
    id,
    name: tag,
    version: '1.0.0',
    type: 'app',
    namespace: ns,
    pages: [{ name: 'nsn_home', label: `${tag} home`, type: 'app', regions: [] }],
    tools: [{ name: tool, label: `${tag} lookup`, description: 'Looks a record up', parameters: {} }],
  });
  const betaTool = betaNs === 'nsn' ? 'nsn_lookup' : `${betaNs}_lookup`;
  return {
    packages: [
      { manifest: pkg(ALPHA, 'nsn', 'nsn_alpha', 'nsn_lookup') },
      { manifest: pkg(BETA, betaNs, 'nsn_beta', betaTool) },
    ],
  };
}

/** What the package door throws for the same artifact, driven the way the load path drives it. */
async function doorRefusal(artifact: Record<string, unknown>): Promise<any> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  try {
    await (kernel.getService('manifest') as { register(m: unknown): void | Promise<void> }).register(artifact);
    return undefined;
  } catch (e) {
    return e;
  } finally {
    await kernel.shutdown();
  }
}

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-validate-namespace-name-'));
  const make = (label: string, s: Record<string, unknown>) => {
    const dir = join(root, label);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), defineStackSource(s));
    linkSpec(dir);
    dirs[label] = dir;
  };
  make('shared-validate', packagesStack('nsn'));
  make('shared-build', packagesStack('nsn'));
  make('two-namespaces', packagesStack('nsn_other'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('ADR-0150 child N — os validate and os build refuse what the package door refuses, in its words', () => {
  it('premise: the package door refuses the shared artifact and installs the two-namespace one', async () => {
    const refusal = await doorRefusal(packagesStack('nsn'));
    expect([refusal?.code, refusal?.status]).toEqual(['NAMESPACE_CONFLICT', 422]);
    expect(await doorRefusal(packagesStack('nsn_other'))).toBeUndefined();
  });

  it('os validate --json exits 1 with one row for the second package, naming both holders, in the door\'s words', async () => {
    const run = await runCli(['validate', '--json'], dirs['shared-validate']);
    const payload = payloadOf(run, 'validate --json');
    expect(run.code).toBe(1);
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    const [row] = payload.errors;
    expect([row.packageId, row.code, row.httpStatus]).toEqual([BETA, 'NAMESPACE_CONFLICT', 422]);
    expect(row.conflicts.map((c: any) => `${c.type}/${c.name}:${c.existingPackageIds.join(',')}`))
      .toEqual([`page/nsn_home:${ALPHA}`, `tool/nsn_lookup:${ALPHA}`]);
    expect(row.message).toBe((await doorRefusal(packagesStack('nsn'))).message);
  }, SPAWN_TIMEOUT_MS);

  it('os build --json exits 1 with the same row and writes no artifact', async () => {
    const dir = dirs['shared-build'];
    const run = await runCli(['build', '--json'], dir);
    const payload = payloadOf(run, 'build --json');
    expect(run.code).toBe(1);
    expect(payload.success).toBe(false);
    expect(payload.errors.map((r: any) => [r.packageId, r.code])).toEqual([[BETA, 'NAMESPACE_CONFLICT']]);
    expect(existsSync(join(dir, ARTIFACT)), 'os build wrote an artifact the package door refuses').toBe(false);
  }, SPAWN_TIMEOUT_MS);

  it('CONTROL — the same page name in two namespaces validates', async () => {
    const run = await runCli(['validate', '--json'], dirs['two-namespaces']);
    const payload = payloadOf(run, 'two-namespaces --json');
    expect(payload.valid, JSON.stringify(payload.errors)).toBe(true);
    expect(run.code).toBe(0);
  }, SPAWN_TIMEOUT_MS);
});
