// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25777 — `os build` never writes the stack's `demoStaff` into the artifact.
 *
 * Each entry declares an account that can SIGN IN with the development seed
 * password. The development boot creates them off the authored config, and a
 * deployment boots the artifact — so the artifact is where the list must not
 * be, whatever a later boot's own gates would decide. Measured on the files the
 * command actually puts on disk:
 *
 *   - `objectstack.json`, by key and by text (an address surviving under any
 *     other key would still be a leak);
 *   - what a deployment LOADS — `loadArtifactBundle`, the runtime's own loader,
 *     which merges the runtime module's exports into the bundle. The fixture
 *     carries a `functions` entry so that module is written: it bundles the
 *     authored config's code for its callables (the declaration's text travels
 *     there, as `data` and `devLogins` do), and what it exports is what a boot
 *     can read.
 *
 * `devPlugins` is left out the same way: it is the list a development boot
 * (`os dev`, `os serve --dev`) adds off the config it loads, never read off the
 * artifact, and leaving it in carried a development-only load list through
 * `os package publish` / `os deploy` into a target. The same build measures
 * both keys.
 *
 * The control is the same build carrying the stack's other keys through: the
 * declared position the demo account names is in the artifact, and the
 * `functions` entry runs, so a green here is "these two keys were left out",
 * not "the build wrote nothing".
 *
 * Runs the CLI from source (`bin/run-dev.js` under `node`), as the other build
 * suites do, so `compile.ts` is measured without a rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArtifactBundle } from '@objectstack/runtime';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const RUNTIME_MODULE = /^objectstack-runtime\.[a-f0-9]+\.mjs$/;

const STAFF_EMAIL = 'counsel1@legal.example';
const DEV_PLUGIN = '@acme/legal-dev-only-plugin';

const CONFIG = `import { defineStack } from '@objectstack/spec';

const legalScore = (input) => 7;

export default defineStack({
  manifest: { id: 'com.example.legal', name: 'legal', version: '1.0.0', type: 'app', namespace: 'legal' },
  objects: [
    {
      name: 'legal_matter',
      label: 'Matter',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
  functions: { legal_score: legalScore },
  positions: [{ name: 'legal_counsel', label: 'Legal Counsel' }],
  demoStaff: [{ name: 'Legal Counsel 1', email: '${STAFF_EMAIL}', position: 'legal_counsel' }],
  devPlugins: ['${DEV_PLUGIN}'],
});
`;

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-demo-staff-build-'));
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
  linkSpec(dir);
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function build(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [CLI, 'build', '--json'],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) =>
        done({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        }),
    );
  });
}

/** The one build both cases read: `os build --json` in the fixture directory. */
let built: Promise<{ artifactPath: string; text: string; artifact: Record<string, unknown> }> | undefined;
function buildOnce() {
  built ??= build(dir).then((run) => {
    expect(run.code, `os build --json failed:\n${run.stdout}\n${run.stderr}`).toBe(0);
    const payload = JSON.parse(run.stdout) as { output?: string };
    const artifactPath = String(payload.output);
    const text = readFileSync(artifactPath, 'utf8');
    return { artifactPath, text, artifact: JSON.parse(text) as Record<string, unknown> };
  });
  return built;
}

describe('`os build` leaves the demo accounts out of the artifact (#25777)', () => {
  it('writes no `demoStaff` into objectstack.json, and a deployment that loads the artifact reads none', async () => {
    const { artifactPath, text, artifact } = await buildOnce();

    expect(Object.keys(artifact)).not.toContain('demoStaff');
    expect(text).not.toContain(STAFF_EMAIL);

    // The runtime module was written (the `functions` entry needs it), so the
    // load below merges its exports — the reading is not vacuous.
    const dist = join(dir, 'dist');
    expect(existsSync(dist) ? readdirSync(dist).filter((f) => RUNTIME_MODULE.test(f)) : []).toHaveLength(1);

    const loaded = (await loadArtifactBundle(artifactPath)) as Record<string, unknown> | null;
    expect(loaded, 'the runtime loader could not load the artifact').toBeTruthy();
    expect(Object.keys(loaded!)).not.toContain('demoStaff');
    const { functions, ...rest } = loaded!;
    expect(JSON.stringify(rest)).not.toContain(STAFF_EMAIL);

    // Control: the position the demo account names, and the callable the
    // module carries, both survived the same build.
    expect((artifact.positions as Array<{ name: string }>).map((p) => p.name)).toEqual(['legal_counsel']);
    expect(await (functions as Record<string, (input: unknown) => unknown>).legal_score({})).toBe(7);
  }, 180_000);
});

describe('`os build` leaves the dev-only plugins out of the artifact', () => {
  it('writes no `devPlugins` into objectstack.json, and a deployment that loads the artifact reads none', async () => {
    const { artifactPath, text, artifact } = await buildOnce();

    expect(Object.keys(artifact)).not.toContain('devPlugins');
    expect(text).not.toContain(DEV_PLUGIN);

    const loaded = (await loadArtifactBundle(artifactPath)) as Record<string, unknown> | null;
    expect(loaded, 'the runtime loader could not load the artifact').toBeTruthy();
    expect(Object.keys(loaded!)).not.toContain('devPlugins');

    // Control: the stack's other keys survived the same build.
    expect((artifact.objects as Array<{ name: string }>).map((o) => o.name)).toEqual(['legal_matter']);
  }, 180_000);
});
