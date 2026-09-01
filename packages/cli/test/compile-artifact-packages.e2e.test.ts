// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 — `os compile` / `os build` write side, measured on the artifact
 * the commands actually put on disk.
 *
 * D4's acceptance has two halves and they pull in opposite directions, which is
 * why both are measured here from real runs rather than argued from the source:
 *
 *   1. A single-package project keeps writing `manifest` EXACTLY as today. The
 *      default compile output does not move — no new key, no reordering, no
 *      materialised empty list. This is the half a schema change breaks by
 *      accident (a `.default([])` on the new key would rewrite every project's
 *      artifact on its next build), so it is pinned as an exact top-level key
 *      set, not as a spot check.
 *
 *   2. An artifact that DOES declare `packages` survives the whole pipeline —
 *      `normalizeStackInput` → `lowerCallables` → `ObjectStackDefinitionSchema`
 *      → `JSON.stringify(finalBundle)`. Each of those steps shallow-clones the
 *      top level, so the key passes through *by construction*; construction is
 *      exactly the kind of claim that stops being true when someone adds a
 *      whitelist to one of the three, and nothing would have failed.
 *
 * ⛔ A green run here does NOT mean a multi-package artifact installs. The load
 * path that iterates the list (ADR-0130 D5, topologically ordered through
 * `resolvePluginOrder`) and the `installPackage` co-ownership gate (D1/D3) are
 * separate, dependent cards. This file pins what the COMPILER writes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

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

function payloadOf(run: Run, label: string): Record<string, unknown> {
  try {
    return JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`${label}: stdout was not one JSON document (exit ${run.code})\n${run.stdout}\n${run.stderr}`);
  }
}

/** Today's shape: one package, declared through the singular `manifest`. */
const CONFIG_SINGLE = `
export default {
  manifest: { id: 'com.example.solo', name: 'solo', version: '1.0.0', type: 'app', namespace: 'solo' },
  objects: [
    {
      name: 'solo_ticket',
      label: 'Ticket',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
};
`;

/** ADR-0130 D4: the artifact carries two co-owning packages, wrapper form. */
const CONFIG_MULTI = `
export default {
  manifest: { id: 'com.example.crm', name: 'crm', version: '1.0.0', type: 'app', namespace: 'crm' },
  packages: [
    { manifest: { id: 'com.example.crm', name: 'crm', version: '1.0.0', type: 'app', namespace: 'crm' } },
    { manifest: { id: 'com.example.crm.cpq', name: 'cpq', version: '1.0.0', type: 'module', namespace: 'crm' } },
  ],
  objects: [
    {
      name: 'crm_account',
      label: 'Account',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
};
`;

/**
 * The reservation, violated: the manifest body inlined flat as the array
 * element. Must be refused at the compile door, not written to an artifact.
 */
const CONFIG_FLATTENED = `
export default {
  packages: [
    { id: 'com.example.flat', name: 'flat', version: '1.0.0', type: 'app', namespace: 'flat' },
  ],
  objects: [],
};
`;

const dirs: Record<string, string> = {};
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-d4-packages-'));
  for (const [name, source] of Object.entries({
    single: CONFIG_SINGLE,
    multi: CONFIG_MULTI,
    flattened: CONFIG_FLATTENED,
  })) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'objectstack.config.ts'), source);
    dirs[name] = dir;
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const artifactOf = (payload: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(readFileSync(String(payload.output), 'utf8')) as Record<string, unknown>;

describe('ADR-0130 D4 — the default (single-package) compile output does not move', () => {
  it('writes `manifest` and NO `packages` key', async () => {
    const run = await runCli(['build', '--json'], dirs.single);
    expect(run.code, `os build --json failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

    const artifact = artifactOf(payloadOf(run, 'os build --json'));

    expect((artifact.manifest as Record<string, unknown>).id).toBe('com.example.solo');
    // The exact key set, so a materialised `"packages": []` — the near-miss
    // this criterion exists for — fails here rather than being noticed by a
    // customer diffing their artifact.
    expect(Object.keys(artifact).sort()).toEqual(['manifest', 'objects']);
    expect(readFileSync(String(payloadOf(run, 'os build --json').output), 'utf8')).not.toContain('"packages"');
  }, 180_000);
});

describe('ADR-0130 D4 — an artifact declaring `packages` compiles and keeps it', () => {
  it('carries both package manifests through to the written artifact, in order', async () => {
    const run = await runCli(['build', '--json'], dirs.multi);
    expect(run.code, `os build --json failed:\n${run.stdout}\n${run.stderr}`).toBe(0);

    const artifact = artifactOf(payloadOf(run, 'os build --json'));
    const packages = artifact.packages as { manifest: { id: string; type: string } }[];

    expect(Array.isArray(packages), 'the compiler dropped the `packages` key').toBe(true);
    expect(packages.map((p) => p.manifest.id)).toEqual([
      'com.example.crm',
      'com.example.crm.cpq',
    ]);
    // The wrapper survives as a wrapper — not flattened, not unwrapped.
    expect(packages[0]).toEqual({ manifest: expect.objectContaining({ id: 'com.example.crm' }) });
    expect(packages[1].manifest.type).toBe('module');
  }, 180_000);

  it('keeps the singular `manifest` beside it — retained, not replaced', async () => {
    const run = await runCli(['build', '--json'], dirs.multi);
    const artifact = artifactOf(payloadOf(run, 'os build --json'));

    expect((artifact.manifest as Record<string, unknown>).id).toBe('com.example.crm');
  }, 180_000);
});

describe('ADR-0130 D4 — the compile door refuses a flattened entry', () => {
  it('exits non-zero rather than writing an artifact in the unreserved shape', async () => {
    const run = await runCli(['build', '--json'], dirs.flattened);

    expect(run.code, `expected a refusal, got exit 0:\n${run.stdout}`).not.toBe(0);
    const payload = payloadOf(run, 'os build --json');
    expect(payload.success).toBe(false);

    // The refusal must point at the offending entry, so the author can find it
    // in an artifact with N packages.
    const errors = JSON.stringify(payload.errors ?? payload.error ?? '');
    expect(errors).toContain('packages');
  }, 180_000);
});
