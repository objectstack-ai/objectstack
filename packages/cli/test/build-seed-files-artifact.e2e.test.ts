// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25779 — `os build` carries the files seed records name with
 * `seedFile(path)` in the artifact, and `os validate` refuses the path the
 * build would refuse.
 *
 * Measured on the files the command actually puts on disk, and on what a
 * deployment LOADS (`loadArtifactBundle`, the runtime's own loader): the
 * dataset keeps the reference as authored and carries the file's bytes, size
 * and SHA-256 under `files`, keyed by the path. The control for the refusal is
 * the same stack with the file present, which both commands accept.
 *
 * Runs the CLI from source (`bin/run-dev.js` through tsx), as the other build
 * suites do, so `compile.ts` and `validate.ts` are measured without a rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArtifactBundle } from '@objectstack/runtime';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

const PDF = '%PDF-1.7 a seeded contract';

const config = (path: string) => `import { defineStack } from '@objectstack/spec';
import { seedFile } from '@objectstack/spec/data';

export default defineStack({
  manifest: { id: 'com.example.clm', name: 'clm', version: '1.0.0', type: 'app', namespace: 'clm' },
  objects: [
    {
      name: 'clm_version',
      label: 'Version',
      sharingModel: 'private',
      fields: {
        code: { type: 'text', label: 'Code' },
        file: { type: 'file', label: 'File', required: true },
      },
    },
  ],
  data: [
    { object: 'clm_version', externalId: 'code', records: [{ code: 'V1', file: seedFile('${path}') }] },
  ],
});
`;

let dir = '';
let missing = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-seed-files-build-'));
  mkdirSync(join(dir, 'fixtures'));
  writeFileSync(join(dir, 'fixtures', 'nda.pdf'), PDF);
  writeFileSync(join(dir, 'objectstack.config.ts'), config('fixtures/nda.pdf'));
  linkSpec(dir);

  missing = mkdtempSync(join(tmpdir(), 'os-seed-files-missing-'));
  writeFileSync(join(missing, 'objectstack.config.ts'), config('fixtures/absent.pdf'));
  linkSpec(missing);
});

afterAll(() => {
  for (const d of [dir, missing]) if (d) rmSync(d, { recursive: true, force: true });
});

function run(command: 'build' | 'validate', cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      TSX,
      [CLI, command, '--json'],
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

describe('seed files ride the artifact (#25779)', () => {
  it('`os build` writes the bytes beside the reference, and a deployment that loads the artifact reads them', async () => {
    const built = await run('build', dir);
    expect(built.code, `os build --json failed:\n${built.stdout}\n${built.stderr}`).toBe(0);

    const artifactPath = String((JSON.parse(built.stdout) as { output?: string }).output);
    const expected = {
      contentType: 'application/pdf',
      size: Buffer.byteLength(PDF),
      sha256: createHash('sha256').update(PDF).digest('hex'),
      data: Buffer.from(PDF).toString('base64'),
    };
    for (const bundle of [
      JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, any>,
      (await loadArtifactBundle(artifactPath)) as Record<string, any>,
    ]) {
      const dataset = bundle.data[0];
      expect(dataset.records[0].file).toEqual({ $file: 'fixtures/nda.pdf' });
      expect(dataset.files).toEqual({ 'fixtures/nda.pdf': expected });
    }

    const validated = await run('validate', dir);
    expect(validated.code, `os validate --json failed:\n${validated.stdout}\n${validated.stderr}`).toBe(0);
  }, 180_000);

  it('both commands refuse a path that names no file, saying where the reference sits', async () => {
    for (const command of ['build', 'validate'] as const) {
      const refused = await run(command, missing);
      expect(refused.code, `${command}:\n${refused.stdout}\n${refused.stderr}`).toBe(1);
      const payload = JSON.parse(refused.stdout) as { issues?: unknown[]; errors?: unknown[] };
      expect(payload.issues ?? payload.errors).toEqual([
        expect.objectContaining({
          location: 'data[0].records[0].file',
          message: expect.stringContaining("seedFile('fixtures/absent.pdf') names no file"),
        }),
      ]);
    }
  }, 180_000);
});
