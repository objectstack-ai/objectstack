// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — an OpenAPI connector app whose `providerConfig.spec` is a
// PACKAGE-RELATIVE file materializes once its built artifact is installed into
// ANOTHER runtime.
//
// ## What was measured before the fix
//
// A scratch app declaring `provider: 'openapi'` with
// `providerConfig.spec: './openapi/fixture.openapi.json'`, built with the real
// `os build` and installed into the showcase through install-local with the body
// `os package install ./dist/objectstack.json` sends: the build wrote the path
// into the artifact unchanged and carried no document; the install answered 200
// (`hotLoaded: true`); the reconcile then logged
//   failed to materialize connector instance '…' via provider 'openapi' …
//   package file ref './openapi/fixture.openapi.json' could not be read
//   (resolved to '<showcase dir>/openapi/fixture.openapi.json'): ENOENT
// and `GET /automation/connectors` did not list the instance at all. The
// runtime an artifact is installed into caches the artifact JSON and nothing
// else, so a path in it can only resolve against that runtime's own root.
//
// ## What this file pins, on one build and one boot
//
//   1. the real `os build` carries the document into the artifact: the
//      connector's `providerConfig.spec` IS the file's JSON, not its path;
//   2. installed into the showcase (whose root is not the app's), the instance
//      materializes: `GET /automation/connectors` lists it `ready`, with the
//      document's one operation as its action.
//
// Spawns the BUILT CLI (`bin/run.js`, as an author runs it), so the build half
// reads `@objectstack/cli`'s `dist/`. Boots a fixture stack of its own (the
// install-local plugin mounted), so it stays out of `SHARED_SHOWCASE`.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';

const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');
const SPEC_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/spec/package.json'));

const CONNECTOR = 'cspec_fixture';
const SPEC_PATH = './openapi/fixture.openapi.json';
/** A one-operation OpenAPI 3 document; nothing is dispatched, so its server answers nothing. */
const DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Connector spec file fixture', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:9/' }],
  paths: { '/v1/things': { get: { operationId: 'GetThings', responses: { '200': { description: 'ok' } } } } },
};

const STACK = {
  manifest: {
    id: 'com.dogfood.connectorspec',
    namespace: 'cspec',
    name: 'Connector spec file probe',
    version: '0.1.0',
    type: 'app',
    engines: { protocol: '^18' },
  },
  requires: ['automation'],
  connectors: [
    { name: CONNECTOR, label: 'Fixture', type: 'api', provider: 'openapi', providerConfig: { spec: SPEC_PATH } },
  ],
};

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

const listedIn = (answer: Answer): any =>
  (answer.body?.data?.connectors ?? []).find((c: any) => c?.name === CONNECTOR);

describe('dogfood: an OpenAPI connector app with a package-relative spec materializes when installed into another runtime', () => {
  let appDir: string;
  let storageDir: string;
  let stack: VerifyStack;
  let build: { exitCode: number; output: string };
  let artifact: any;
  let install: Answer;
  let connectors: Answer;

  beforeAll(async () => {
    appDir = mkdtempSync(join(tmpdir(), 'dogfood-connector-spec-app-'));
    mkdirSync(join(appDir, 'openapi'));
    writeFileSync(join(appDir, SPEC_PATH), JSON.stringify(DOCUMENT, null, 2));
    writeFileSync(
      join(appDir, 'objectstack.config.mjs'),
      `import { defineStack } from '@objectstack/spec';\n\nexport default defineStack(${JSON.stringify(STACK, null, 2)});\n`,
    );
    mkdirSync(join(appDir, 'node_modules', '@objectstack'), { recursive: true });
    symlinkSync(SPEC_ROOT, join(appDir, 'node_modules', '@objectstack', 'spec'), 'dir');

    const res = spawnSync(process.execPath, [CLI_BIN, 'build'], {
      cwd: appDir,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    build = { exitCode: res.status ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
    if (build.exitCode !== 0) return;
    artifact = JSON.parse(readFileSync(join(appDir, 'dist', 'objectstack.json'), 'utf8'));

    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-connector-spec-install-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    const token = await stack.signIn();
    // The body `os package install ./dist/objectstack.json` sends for an artifact file.
    const manifest = { ...artifact, id: artifact.manifest.id, version: artifact.manifest.version };
    install = await json(await stack.apiAs(token, 'POST', '/marketplace/install-local', { manifest }));
    // The reconcile the install's re-sync announces may land after the answer:
    // read the listing until the instance is in it, or the window closes.
    const deadline = Date.now() + 10_000;
    do {
      connectors = await json(await stack.apiAs(token, 'GET', '/automation/connectors'));
      if (listedIn(connectors)) break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < deadline);
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    for (const dir of [appDir, storageDir]) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('os build carries the document into the artifact in place of its path', () => {
    expect(build.exitCode, build.output).toBe(0);
    const entry = (artifact.connectors as any[]).find((c) => c.name === CONNECTOR);
    expect(entry?.providerConfig?.spec).toEqual(DOCUMENT);
  });

  it('installed into the showcase, the instance materializes ready with the document\'s operation', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.hotLoaded).toBe(true);
    expect(connectors.status, JSON.stringify(connectors.body)).toBe(200);
    const listed = listedIn(connectors);
    expect(listed, JSON.stringify(connectors.body?.data?.connectors?.map((c: any) => c.name))).toBeDefined();
    expect(listed.state).toBe('ready');
    expect(listed.actions.map((a: any) => a.key)).toEqual(['GetThings']);
  });
});
