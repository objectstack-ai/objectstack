// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a server with no built Console answers at `/_console/` and at `/`.
 *
 * Before the not-built answer existed, `os serve` mounted nothing when the
 * console package resolved without a `dist/`: `GET /_console/` got the
 * router's bare not-found and `GET /` an empty 404, the same answers a wrong
 * URL gets, and only the boot warning said why. `os serve` now mounts
 * `createConsoleNotBuiltPlugin` on that boot, and these tests pin what it
 * answers:
 *
 *   - `GET /_console/` (and every path under it) answers `503` with the remedy
 *     the boot warning names — the same sentence from the same picker, with
 *     the host's absolute paths left out;
 *   - `GET /` and `GET /_console` redirect to `/_console/`, exactly as they do
 *     once the Console is built (the control below), so neither route changes
 *     owner with the build.
 *
 * These tests run the REAL plugins on a REAL Hono app (the `HonoHttpServer`
 * that production resolves as `http.server`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import {
  createConsoleNotBuiltPlugin,
  createConsoleStaticPlugin,
  formatConsoleDistMissingWarning,
} from './console.js';

const ORIGIN = 'http://console.example.test';

/** The first line of the not-built answer, which says what is wrong before saying how to fix it. */
const NOT_BUILT_HEADLINE = 'The ObjectStack Console is not built, so this server has no Console to serve at /_console/.';

/** The framework repo's remedy. */
const BUILD_REMEDY = 'pnpm objectui:build';

/** The prefix the terminal warning carries and the HTTP answer does not. */
const WARNING_PREFIX = '  ⚠ ';

/** Requests the not-built answer must cover: the shell, a client-side route, and a hashed asset. */
const CONSOLE_REQUESTS = ['/_console/', '/_console/apps/crm/records/42', '/_console/assets/index-ocmkyCt6.js'];

type Request = (p: string, init?: RequestInit) => Promise<Response>;

let scratch: string;

beforeAll(() => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-not-built-')));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

/** A console package with a manifest and no `dist/` — what the boot warning is printed for. */
function writeUnbuiltConsole(dir: string): string {
  writeJson(path.join(dir, 'package.json'), { name: '@objectstack/console', version: '1.0.0' });
  return dir;
}

/** The framework repo's shape: the root manifest declares the console build script. */
function frameworkTree(): { root: string; consoleDir: string } {
  const root = path.join(scratch, 'framework');
  writeJson(path.join(root, 'package.json'), {
    name: 'framework-root',
    private: true,
    scripts: { build: 'turbo run build', 'objectui:build': 'bash scripts/build-console.sh' },
  });
  return { root, consoleDir: writeUnbuiltConsole(path.join(root, 'packages', 'console')) };
}

/** A project that installed the CLI, whose `@objectstack/console` arrived without its `dist/`. */
function installTree(): { project: string; consoleDir: string } {
  const project = path.join(scratch, 'app');
  writeJson(path.join(project, 'package.json'), { name: 'consumer-app', scripts: { dev: 'objectstack dev' } });
  return {
    project,
    consoleDir: writeUnbuiltConsole(path.join(project, 'node_modules', '@objectstack', 'console')),
  };
}

async function serve(plugin: { start: (ctx: any) => Promise<void> }): Promise<Request> {
  const server = new HonoHttpServer(0);
  await plugin.start({ getServiceAsync: async () => server, logger: { warn: () => {} } });
  const app = server.getRawApp();
  return async (p, init) => app.request(`${ORIGIN}${p}`, init);
}

/** `/` and `/_console` redirect to the Console's shell, built or not. */
async function expectRedirectsToConsole(request: Request): Promise<void> {
  for (const p of ['/', '/_console']) {
    const res = await request(p);
    expect(res.status, `GET ${p}`).toBe(302);
    expect(res.headers.get('location'), `GET ${p}`).toBe('/_console/');
  }
}

describe('a framework checkout with no built Console', () => {
  let request: Request;
  let root: string;
  let consoleDir: string;
  beforeAll(async () => {
    ({ root, consoleDir } = frameworkTree());
    request = await serve(createConsoleNotBuiltPlugin(consoleDir));
  });

  it.each(CONSOLE_REQUESTS)('GET %s answers 503 naming `pnpm objectui:build`', async (p) => {
    const res = await request(p);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe(NOT_BUILT_HEADLINE);
    expect(body).toContain(BUILD_REMEDY);
  });

  it('is the boot warning\'s sentence, with only the absolute build root left out', async () => {
    const warning = formatConsoleDistMissingWarning(consoleDir);
    expect(warning.startsWith(WARNING_PREFIX)).toBe(true);
    // The warning names the root to run the script in; the HTTP answer says
    // where in words. Everything either side of that path is the same text.
    const [before, after] = warning.slice(WARNING_PREFIX.length).split(` in ${root} `);
    expect(after, 'the warning no longer names the build root this test splits on').toBeDefined();

    const body = await (await request('/_console/')).text();
    expect(body).toContain(before);
    expect(body).toContain(after);
    expect(body).toContain(path.join('packages', 'console', 'dist'));
    expect(body).not.toContain(root);
  });

  it('redirects `/` and `/_console` to `/_console/`, as a built Console does', async () => {
    await expectRedirectsToConsole(request);
  });
});

describe('an installed CLI whose `@objectstack/console` has no `dist/`', () => {
  let request: Request;
  let project: string;
  let consoleDir: string;
  beforeAll(async () => {
    ({ project, consoleDir } = installTree());
    request = await serve(createConsoleNotBuiltPlugin(consoleDir));
  });

  it('answers 503 with the reinstall remedy, the boot warning\'s sentence without the dist path', async () => {
    const warning = formatConsoleDistMissingWarning(consoleDir);
    const dist = path.join(consoleDir, 'dist');
    const [before, after] = warning.slice(WARNING_PREFIX.length).split(` at ${dist}`);
    expect(after, 'the warning no longer names the dist path this test splits on').toBeDefined();

    const res = await request('/_console/');
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body.split('\n')[0]).toBe(NOT_BUILT_HEADLINE);
    expect(body).toContain(`${before}${after}`);
    expect(body).toContain('@objectstack/console');
    expect(body).not.toContain(BUILD_REMEDY);
    expect(body).not.toContain(project);
  });

  it('redirects `/` and `/_console` to `/_console/`', async () => {
    await expectRedirectsToConsole(request);
  });
});

describe('controls', () => {
  it('a BUILT Console serves its SPA shell at `/_console/` and the same redirects', async () => {
    const dist = path.join(scratch, 'built', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head></head><body>console shell</body></html>');
    const request = await serve(createConsoleStaticPlugin(dist));

    const res = await request('/_console/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('console shell');
    await expectRedirectsToConsole(request);
  });

  it('with no Console plugin mounted, both paths are the bare 404 the not-built answer replaces', async () => {
    // What `--no-ui` composes, and what a not-built boot composed before: the
    // answers above come from the plugin, not from the server.
    const request = await serve({ start: async () => {} });
    for (const p of ['/', '/_console/']) {
      const res = await request(p);
      expect(res.status, `GET ${p}`).toBe(404);
      expect(await res.text(), `GET ${p}`).not.toContain(NOT_BUILT_HEADLINE);
    }
  });
});
