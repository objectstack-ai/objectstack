// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An artifact booted outside its project directory says when its branding
 * logo / favicon will not be served (#22071) — end to end.
 *
 * ## What this pins
 *
 * `os serve` resolves the runtime assets directory as `OS_RUNTIME_ASSETS_DIR`,
 * else `<cwd>/assets`, and mounts `GET /runtime/assets/:filename` only when
 * that directory exists. An artifact is the deployable unit and carries no
 * asset files, so an app whose `branding.logo` / `branding.favicon` names
 * `/runtime/assets/<file>`, booted from a directory without `assets/`, served a
 * 404 for its logo and favicon and printed nothing about it. Three boots of ONE
 * artifact, each from a fresh directory holding only that artifact:
 *
 *   - no `assets/`, `OS_RUNTIME_ASSETS_DIR` unset → the boot prints ONE line
 *     about the file, naming the app, the directory searched and
 *     `OS_RUNTIME_ASSETS_DIR`, and saying the directory does not exist; the
 *     file still answers 404 (nothing about what is served changes);
 *   - control: `OS_RUNTIME_ASSETS_DIR` naming a directory that holds the file
 *     → nothing printed, the file served;
 *   - control: `assets/` beside the artifact → nothing printed, the file served.
 *
 * `objectstack start --artifact <file>` spawns this same `serve` in its own
 * cwd, so the artifact is named here the way that child receives it,
 * `OS_ARTIFACT_PATH`, with the cwd the assets default is read from.
 *
 * ## Why a real child, and why the `e2e` tier
 *
 * Both halves of the defect are about the process's surroundings — the cwd,
 * the environment, the boot's own output and a real HTTP answer — so only a
 * child standing in that directory measures them. The plugin's own logic
 * (which URLs are checked, the resolution it shares with the route, one line
 * per file, never failing the boot) is pinned per pull request by
 * `runtime-assets.test.ts`; this file is the composed boot, and by its name it
 * runs on the nightly tier (`scripts/nightly-tiers.mjs`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import {
  CLI,
  TSX,
  E2E_SECRET_KEY,
  boundPortFromBanner,
  childEnv,
  portContentionError,
  probeThroughChild,
  reservePort,
} from './helpers/serve-process.js';

type ServeChild = ChildProcessByStdio<null, Readable, Readable>;

const LOGO_URL = '/runtime/assets/icon.svg';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" data-fixture="22071"/>';

/** A minimal but real compiled artifact: one object, one app branded from /runtime/assets/. */
const ARTIFACT = JSON.stringify(
  {
    manifest: {
      id: 'com.example.brandassets',
      name: 'brandassets',
      version: '1.0.0',
      type: 'app',
      engines: { protocol: `^${PROTOCOL_MAJOR}` },
    },
    objects: [{ name: 'brandassets_item', label: 'Item', fields: { name: { type: 'text', label: 'Name' } } }],
    apps: [{ name: 'brandassets_app', label: 'Brand', branding: { logo: LOGO_URL, favicon: LOGO_URL } }],
    views: [],
    flows: [],
    requires: [],
  },
  null,
  2,
);

const READY_BANNER_TAIL = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT = 240_000;

let root: string;
const children: ServeChild[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-22071-e2e-'));
});

afterAll(async () => {
  for (const child of children) await stop(child);
  if (root) rmSync(root, { recursive: true, force: true });
}, 60_000);

async function stop(child: ServeChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done();
    }, 10_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

interface BootResult {
  /** Everything the child printed, stdout and stderr, up to the ready banner. */
  output: string;
  /** The `<cwd>/assets` this boot's default resolves to. */
  cwdAssets: string;
  status: number;
  contentType: string | null;
  body: string;
}

/**
 * Boot the artifact from a fresh directory laid out as `layout` says, wait for
 * the complete ready banner, then ask the running server for the logo.
 */
async function bootAndFetchLogo(layout: 'no-assets' | 'cwd-assets' | 'env-assets'): Promise<BootResult> {
  const base = mkdtempSync(join(root, `${layout}-`));
  const cwd = join(base, 'deploy');
  const home = join(base, 'home');
  mkdirSync(cwd);
  mkdirSync(home);
  const artifact = join(cwd, 'objectstack.json');
  writeFileSync(artifact, ARTIFACT, 'utf8');
  const cwdAssets = join(cwd, 'assets');

  let runtimeAssetsDir: string | undefined;
  if (layout === 'cwd-assets') {
    mkdirSync(cwdAssets);
    writeFileSync(join(cwdAssets, 'icon.svg'), SVG, 'utf8');
  } else if (layout === 'env-assets') {
    runtimeAssetsDir = join(base, 'brand-files');
    mkdirSync(runtimeAssetsDir);
    writeFileSync(join(runtimeAssetsDir, 'icon.svg'), SVG, 'utf8');
  }
  // Guard the premise: the deployment directory holds the artifact and,
  // only for the `assets/` control, that directory — nothing else.
  expect(readdirSync(cwd).sort()).toEqual(layout === 'cwd-assets' ? ['assets', 'objectstack.json'] : ['objectstack.json']);

  const port = reservePort();
  const child = spawn(TSX, [CLI, 'serve', '-p', String(port)], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    // `childEnv`, never a bare `...process.env` (`check:cli-test-child-env`).
    env: childEnv({
      NO_COLOR: '1',
      OS_HOME: home,
      OS_DATABASE_URL: ':memory:',
      OS_LOG_LEVEL: '',
      OS_DISABLE_CONSOLE: '1',
      OS_SECRET_KEY: E2E_SECRET_KEY,
      OS_ARTIFACT_URL: undefined,
      OS_ARTIFACT_PATH: artifact,
      // Unset unless this boot is the env control — an inherited value would
      // make the `<cwd>/assets` legs measure some other directory.
      OS_RUNTIME_ASSETS_DIR: runtimeAssetsDir,
    }),
  }) as ServeChild;
  children.push(child);

  let output = '';
  await new Promise<void>((ready, failed) => {
    const timer = setTimeout(() => {
      failed(new Error(`serve never printed its complete ready banner\n--- output ---\n${output}`));
    }, BOOT_TIMEOUT - 30_000);
    const onData = (chunk: Buffer) => {
      output += String(chunk);
      if (READY_BANNER_TAIL.test(output)) {
        clearTimeout(timer);
        ready();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      failed(
        portContentionError(output, 'os serve (bin/run-dev.js, artifact boot)', port)
          ?? new Error(`serve exited ${code} before its ready banner\n--- output ---\n${output}`),
      );
    });
  });

  // `bin/run-dev.js` pins NODE_ENV=development, where a taken port is a hop,
  // not an error — so the port is read back off the child's own banner.
  const readback = boundPortFromBanner(output);
  if (readback.state !== 'bound') {
    await stop(child);
    throw new Error(`cannot read the bound port back (${readback.state})\n--- output ---\n${output}`);
  }

  try {
    const answer = await probeThroughChild(
      {
        child,
        transcript: () => `\n--- child output ---\n${output}`,
        label: 'serve-runtime-assets-branding-warning',
        what: `GET ${LOGO_URL} on port ${readback.port}`,
      },
      async () => {
        const res = await fetch(`http://localhost:${readback.port}${LOGO_URL}`);
        return { status: res.status, contentType: res.headers.get('content-type'), body: await res.text() };
      },
    );
    return { output, cwdAssets, ...answer };
  } finally {
    await stop(child);
  }
}

/** The boot lines that mention the logo's URL — the warning names it; nothing else does. */
function linesNaming(output: string, needle: string): string[] {
  return output.split('\n').filter((line) => line.includes(needle));
}

describe('os serve — an artifact boot names a branding asset it will not serve (#22071)', () => {
  it(
    'no assets/ and OS_RUNTIME_ASSETS_DIR unset: ONE line naming the app, the file, the directory and OS_RUNTIME_ASSETS_DIR; the file still 404s',
    async () => {
      const { output, cwdAssets, status } = await bootAndFetchLogo('no-assets');

      const lines = linesNaming(output, LOGO_URL);
      expect(lines, `expected exactly one boot line naming ${LOGO_URL}\n--- output ---\n${output}`).toHaveLength(1);
      const [line] = lines;
      expect(line).toContain('brandassets_app');
      expect(line).toContain('branding.logo');
      expect(line).toContain('branding.favicon');
      expect(line).toContain(cwdAssets);
      expect(line).toContain('OS_RUNTIME_ASSETS_DIR');
      expect(line).toContain('does not exist');
      // What the route serves is unchanged: still nothing, so still 404.
      expect(status).toBe(404);
    },
    BOOT_TIMEOUT,
  );

  it(
    'control: OS_RUNTIME_ASSETS_DIR names a directory holding the file — nothing printed, the file served',
    async () => {
      const { output, status, contentType, body } = await bootAndFetchLogo('env-assets');

      expect(status).toBe(200);
      expect(contentType).toBe('image/svg+xml');
      expect(body).toBe(SVG);
      expect(linesNaming(output, LOGO_URL), output).toEqual([]);
      expect(linesNaming(output, 'icon.svg'), output).toEqual([]);
    },
    BOOT_TIMEOUT,
  );

  it(
    'control: assets/ beside the artifact holds the file — nothing printed, the file served',
    async () => {
      const { output, status, contentType, body } = await bootAndFetchLogo('cwd-assets');

      expect(status).toBe(200);
      expect(contentType).toBe('image/svg+xml');
      expect(body).toBe(SVG);
      expect(linesNaming(output, LOGO_URL), output).toEqual([]);
      expect(linesNaming(output, 'icon.svg'), output).toEqual([]);
    },
    BOOT_TIMEOUT,
  );
});
