// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os build` carries the OpenAPI document a `provider: 'openapi'` connector
 * names by package-relative file into the artifact, and `os validate` refuses
 * the reference the build would refuse.
 *
 * Measured on the file the command actually puts on disk: the connector's
 * `providerConfig.spec` is the file's JSON, not its path, and its other keys
 * are kept. The control for the refusal is the same stack with the file
 * present, which both commands accept.
 *
 * Runs the CLI from source (`bin/run-dev.js` under `node`), as the other build
 * suites do, so `compile.ts` and `validate.ts` are measured without a rebuild.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');

const DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Billing', version: '1.0.0' },
  paths: { '/v1/things': { get: { operationId: 'GetThings', responses: { '200': { description: 'ok' } } } } },
};

const config = (spec: string) => `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: { id: 'com.example.billing', name: 'billing', version: '1.0.0', type: 'app', namespace: 'billing' },
  requires: ['automation'],
  connectors: [
    {
      name: 'billing_api',
      label: 'Billing API',
      type: 'api',
      provider: 'openapi',
      providerConfig: { spec: '${spec}', include: ['GetThings'] },
    },
  ],
});
`;

let dir = '';
let missing = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-connector-spec-build-'));
  mkdirSync(join(dir, 'openapi'));
  writeFileSync(join(dir, 'openapi', 'billing.json'), JSON.stringify(DOCUMENT));
  writeFileSync(join(dir, 'objectstack.config.ts'), config('./openapi/billing.json'));
  linkSpec(dir);

  missing = mkdtempSync(join(tmpdir(), 'os-connector-spec-missing-'));
  writeFileSync(join(missing, 'objectstack.config.ts'), config('./openapi/absent.json'));
  linkSpec(missing);
});

afterAll(() => {
  for (const d of [dir, missing]) if (d) rmSync(d, { recursive: true, force: true });
});

function run(command: 'build' | 'validate', cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
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

describe('a package-relative OpenAPI connector spec rides the artifact', () => {
  it('`os build` writes the document in place of the path, keeping the other keys; `os validate` accepts the same stack', async () => {
    const built = await run('build', dir);
    expect(built.code, `os build --json failed:\n${built.stdout}\n${built.stderr}`).toBe(0);
    const artifactPath = String((JSON.parse(built.stdout) as { output?: string }).output);
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, any>;
    expect(artifact.connectors[0].providerConfig).toEqual({ spec: DOCUMENT, include: ['GetThings'] });

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
          location: 'connectors[0].providerConfig.spec',
          message: expect.stringContaining("connector 'billing_api' providerConfig.spec './openapi/absent.json'"),
        }),
      ]);
    }
  }, 180_000);
});
