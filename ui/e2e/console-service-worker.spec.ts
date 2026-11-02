import { test, expect, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { CONSOLE_BASE, waitForReactMount } from './helpers';

/**
 * objectstack#29155 — the Console's Service Worker, on the production build.
 *
 * 1. After one load, an offline reload shows the Console shell (the document
 *    comes from the worker), and data calls fail visibly as offline: the
 *    sign-in screen's "Cannot connect to server" panel, and a direct API
 *    request rejects instead of answering from a cache.
 * 2. A new build is picked up within one navigation: a server that switches
 *    to a "next" build (new document, new worker build id) serves that
 *    document on the next navigation, and the new worker deletes the old
 *    build's cache when it activates.
 *
 * Chromium only: `context.setOffline` and Cache Storage are measured there,
 * and the CI lane runs `--project=chromium`.
 */

const CACHE_PREFIX = 'objectui-console::';

/** Waits until the worker controls the page and holds every console file the page loaded. */
async function waitForShellCached(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, { timeout: 30_000 });
  await page.waitForFunction(
    async ({ prefix, base }) => {
      const loaded = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => new URL(url).pathname.startsWith(`${base}/assets/`));
      const name = (await caches.keys()).find((key) => key.startsWith(prefix));
      if (!name || loaded.length === 0) return false;
      const cache = await caches.open(name);
      for (const url of loaded) if (!(await cache.match(url))) return false;
      return true;
    },
    { prefix: CACHE_PREFIX, base: CONSOLE_BASE },
    { timeout: 30_000, polling: 250 },
  );
}

test.describe('Console service worker', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'measured on chromium, the CI E2E project');

  test('after one load, an offline reload shows the shell and data calls fail as offline', async ({
    page,
    context,
  }) => {
    await page.goto(`${CONSOLE_BASE}/`);
    await waitForReactMount(page);
    await waitForShellCached(page);

    await context.setOffline(true);
    const document = await page.reload();
    expect(document?.fromServiceWorker(), 'the offline document is the worker-cached shell').toBe(true);
    await waitForReactMount(page);

    // The shell renders; its data read fails and says so.
    await expect(page.getByTestId('auth-server-unreachable')).toBeVisible({ timeout: 30_000 });

    // The API is network-only: offline, a data call rejects instead of
    // answering from the worker's cache.
    const apiAnswer = await page.evaluate(() =>
      fetch('/api/v1/auth/get-session').then(
        (res) => `answered ${res.status}`,
        (error: Error) => error.name,
      ),
    );
    expect(apiAnswer).toBe('TypeError');
    const cachedApi = await page.evaluate(async (prefix) => {
      const hits: string[] = [];
      for (const key of await caches.keys()) {
        if (!key.startsWith(prefix)) continue;
        for (const req of await (await caches.open(key)).keys()) {
          if (new URL(req.url).pathname.startsWith('/api/')) hits.push(req.url);
        }
      }
      return hits;
    }, CACHE_PREFIX);
    expect(cachedApi, 'the worker cached an API response').toEqual([]);

    await context.setOffline(false);
  });

  test('a new build is picked up within one navigation, and its worker drops the old cache', async ({ page }) => {
    const dist = path.resolve(import.meta.dirname, '../apps/console/dist');
    const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const worker = fs.readFileSync(path.join(dist, 'service-worker.js'), 'utf8');
    const build = /const BUILD = "([^"]+)";/.exec(worker)?.[1];
    expect(build, 'the emitted worker names its build').toBeTruthy();

    // A server for the same dist that can switch to a "next" build: a new
    // document and a worker with a new build id, the two things a deploy
    // changes for the browser.
    let next = false;
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!pathname.startsWith(`${CONSOLE_BASE}/`)) {
        res.writeHead(404).end();
        return;
      }
      const rel = pathname.slice(CONSOLE_BASE.length + 1);
      if (rel === 'service-worker.js') {
        const body = next ? worker.replace(`const BUILD = "${build}";`, `const BUILD = "${build}-next";`) : worker;
        res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }).end(body);
        return;
      }
      const file = path.join(dist, rel);
      if (rel && file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
        res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(file));
        return;
      }
      if (rel.startsWith('assets/')) {
        res.writeHead(404).end();
        return;
      }
      const html = next ? index.replace('<head>', '<head><meta name="e2e-build" content="next">') : index;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      await page.goto(`${origin}${CONSOLE_BASE}/`);
      await waitForReactMount(page);
      await waitForShellCached(page);
      expect(await page.evaluate(() => caches.keys())).toContain(`${CACHE_PREFIX}${CONSOLE_BASE}/::${build}`);

      // Deploy.
      next = true;
      await page.goto(`${origin}${CONSOLE_BASE}/login`);
      await expect(page.locator('meta[name="e2e-build"]')).toHaveAttribute('content', 'next');
      await waitForReactMount(page);

      // The new worker installs, takes over and deletes the old build's cache.
      await page.waitForFunction(
        async ({ prefix, oldBuild }) => {
          const keys = (await caches.keys()).filter((key) => key.startsWith(prefix));
          return keys.length === 1 && keys[0].endsWith(`::${oldBuild}-next`);
        },
        { prefix: CACHE_PREFIX, oldBuild: build },
        { timeout: 30_000, polling: 250 },
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
