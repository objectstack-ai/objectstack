// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui-SHA drift guard — the seat on the boot path itself (#7752).
 *
 * `pnpm check:console-sha` guards the root `pnpm dev` / `dev:showcase` /
 * `dev:crm` / `dev:todo` scripts. Every other way to boot reaches the server
 * without passing it: `objectstack dev` run inside an example dir, an
 * example's own `dev` script (`objectstack dev --seed-admin`), a
 * `.claude/launch.json` config driving `pnpm exec objectstack dev`. A QA sweep
 * booted that way and spent the run measuring a console two days behind the
 * repo's pin, with a warning the boot log scrolled past.
 *
 * `decideConsoleMount` is what closes it: on drift it can *prove*, the dev
 * server does not mount the Console at all, so the stale bundle is
 * unreachable rather than silently authoritative. Detection semantics
 * (`detectConsoleShaDrift`) are pinned in `test/console-resolve.test.ts`.
 *
 * Unreachable must not mean silent. A refused boot used to mount nothing, so
 * `GET /_console/` and `GET /` answered the router's bare 404, the same answer
 * a wrong URL gets, and only the terminal said why. `os serve` now mounts
 * `createConsoleShaDriftRefusalPlugin` on that boot — the not-built answer's
 * routes (`console.not-built.test.ts`) with the refusal's own text — and the
 * last block below pins what it answers, on a REAL Hono app, from a fixture
 * tree whose pin and stamp are made up here (never the repo's live pin).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import {
  createConsoleShaDriftRefusalPlugin,
  createConsoleStaticPlugin,
  decideConsoleMount,
  detectConsoleShaDrift,
  formatConsoleShaDriftRefusal,
  formatConsoleShaDriftWarning,
  DRIFT_OVERRIDE_ENV,
  type ConsoleShaDrift,
} from './console.js';

/** The exact gap #7752 measured: pin two days ahead of the served bundle. */
const drift = {
  pin: '6314e87f2d49b1ff3b158c296f1b2a52d14dff68',
  stamp: '09987b680aa1c3e4f5061d2b7c8a9e0f1a2b3c4d',
  pinFile: '/repo/.objectui-sha',
};

describe('decideConsoleMount', () => {
  it('refuses to mount a drifted console under `os dev`', () => {
    expect(decideConsoleMount({ hasDist: true, drift, isDev: true, env: {} })).toEqual({
      mount: false,
      refusedForDrift: true,
    });
  });

  it('mounts when the dist matches the pin — no false positive', () => {
    expect(decideConsoleMount({ hasDist: true, drift: null, isDev: true, env: {} })).toEqual({
      mount: true,
      refusedForDrift: false,
    });
  });

  it('leaves non-dev serves advisory — a published install carries no pin anyway', () => {
    expect(decideConsoleMount({ hasDist: true, drift, isDev: false, env: {} })).toEqual({
      mount: true,
      refusedForDrift: false,
    });
  });

  it(`boots the stale bundle deliberately when ${DRIFT_OVERRIDE_ENV} is set`, () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(
        decideConsoleMount({
          hasDist: true,
          drift,
          isDev: true,
          env: { [DRIFT_OVERRIDE_ENV]: value },
        }),
      ).toEqual({ mount: true, refusedForDrift: false });
    }
  });

  it('does not read an unset-looking value as an override', () => {
    for (const value of ['0', 'false', 'no', '']) {
      expect(
        decideConsoleMount({
          hasDist: true,
          drift,
          isDev: true,
          env: { [DRIFT_OVERRIDE_ENV]: value },
        }),
      ).toEqual({ mount: false, refusedForDrift: true });
    }
  });

  it('keeps "no dist at all" distinct from "refused for drift"', () => {
    // Both leave the Console unmounted, but they need different messages —
    // "run objectui:build" vs the existing "console dist not found" hint.
    expect(decideConsoleMount({ hasDist: false, drift: null, isDev: true, env: {} })).toEqual({
      mount: false,
      refusedForDrift: false,
    });
  });
});

describe('drift messages', () => {
  it('names the rebuild, never the pin bump — refresh would move the pin instead', () => {
    for (const message of [
      formatConsoleShaDriftWarning(drift),
      formatConsoleShaDriftRefusal(drift),
    ]) {
      expect(message).toContain('pnpm objectui:build');
    }
    // `objectui:refresh` appears only as the explicitly-labelled wrong turn.
    expect(formatConsoleShaDriftRefusal(drift)).toContain(
      "(Use 'pnpm objectui:refresh' only when you intend to move the pin",
    );
  });

  it('shows both SHAs and the escape hatch, so the boot log is self-explaining', () => {
    const message = formatConsoleShaDriftRefusal(drift);
    expect(message).toContain(drift.pin.slice(0, 12));
    expect(message).toContain(drift.stamp.slice(0, 12));
    expect(message).toContain(drift.pinFile);
    expect(message).toContain(DRIFT_OVERRIDE_ENV);
  });
});

describe('what a dev server that refused a drifted Console answers', () => {
  const ORIGIN = 'http://console.example.test';
  const PIN = 'aaaaaaaaaaaa1111111111111111111111111111';
  const STAMP = 'bbbbbbbbbbbb2222222222222222222222222222';
  const HEADLINE =
    'The ObjectStack Console here was built from a different objectui commit than this checkout pins, ' +
    'so this dev server refuses to serve it at /_console/.';
  /** The shell, a client-side route and a hashed asset: the refusal covers every path under the mount. */
  const CONSOLE_REQUESTS = ['/_console/', '/_console/apps/crm/records/42', '/_console/assets/index-ocmkyCt6.js'];

  type Request = (p: string) => Promise<Response>;
  let scratch: string;

  beforeAll(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-drift-refusal-')));
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  /** A checkout pinned at `PIN` whose console dist is stamped `stamp` — what `os dev` resolves. */
  function pinnedTree(tag: string, stamp: string): { root: string; consoleDir: string } {
    const root = path.join(scratch, tag);
    const consoleDir = path.join(root, 'packages', 'console');
    fs.mkdirSync(path.join(consoleDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(root, '.objectui-sha'), `${PIN}\n`);
    fs.writeFileSync(path.join(consoleDir, 'package.json'), JSON.stringify({ name: '@objectstack/console' }));
    fs.writeFileSync(
      path.join(consoleDir, 'dist', 'index.html'),
      '<!doctype html><html><head></head><body>console shell</body></html>',
    );
    fs.writeFileSync(path.join(consoleDir, 'dist', '.objectui-sha'), `${stamp}\n`);
    return { root, consoleDir };
  }

  async function serve(plugin: { start: (ctx: any) => Promise<void> }): Promise<Request> {
    const server = new HonoHttpServer(0);
    await plugin.start({ getServiceAsync: async () => server, logger: { warn: () => {} } });
    const app = server.getRawApp();
    return async (p) => app.request(`${ORIGIN}${p}`);
  }

  describe('the build is not the pin', () => {
    let root: string;
    let drift: ConsoleShaDrift;
    let request: Request;
    beforeAll(async () => {
      const tree = pinnedTree('drifted', STAMP);
      root = tree.root;
      const found = detectConsoleShaDrift(tree.consoleDir);
      expect(found, 'the fixture must be a drift detectConsoleShaDrift can prove').not.toBeNull();
      drift = found!;
      // The premise: this is the boot `os dev` refuses, not one it serves.
      expect(decideConsoleMount({ hasDist: true, drift, isDev: true, env: {} })).toEqual({
        mount: false,
        refusedForDrift: true,
      });
      request = await serve(createConsoleShaDriftRefusalPlugin(drift));
    });

    it.each(CONSOLE_REQUESTS)('GET %s answers 503 naming `pnpm objectui:build`, not the SPA', async (p) => {
      const res = await request(p);
      expect(res.status).toBe(503);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.text();
      expect(body.split('\n')[0]).toBe(HEADLINE);
      expect(body).toContain('pnpm objectui:build');
      expect(body).toContain(PIN.slice(0, 12));
      expect(body).toContain(STAMP.slice(0, 12));
      expect(body).toContain(DRIFT_OVERRIDE_ENV);
      expect(body).not.toContain('console shell');
    });

    it('is the terminal refusal\'s text, with only the absolute pin-file path left out', async () => {
      const refusal = formatConsoleShaDriftRefusal(drift);
      expect(drift.pinFile.startsWith(root)).toBe(true);
      // The refusal block names the pin file by its path on this host; the
      // HTTP answer says where it is in words. Everything below the block's
      // headline, either side of that path, is the same text.
      const [before, after] = refusal.slice(refusal.indexOf('pinned')).split(drift.pinFile);
      expect(after, 'the refusal no longer names the pin file this test splits on').toBeDefined();

      const body = await (await request('/_console/')).text();
      expect(body).toContain(before);
      expect(body).toContain(after);
      expect(body).not.toContain(root);
    });

    it('redirects `/` and `/_console` to `/_console/`, as a served Console does', async () => {
      for (const p of ['/', '/_console']) {
        const res = await request(p);
        expect(res.status, `GET ${p}`).toBe(302);
        expect(res.headers.get('location'), `GET ${p}`).toBe('/_console/');
      }
    });
  });

  it('control: a build that matches the pin is no drift, mounts, and serves the SPA shell', async () => {
    const { consoleDir } = pinnedTree('matching', PIN);
    const drift = detectConsoleShaDrift(consoleDir);
    expect(drift).toBeNull();
    expect(decideConsoleMount({ hasDist: true, drift, isDev: true, env: {} })).toEqual({
      mount: true,
      refusedForDrift: false,
    });
    const request = await serve(createConsoleStaticPlugin(path.join(consoleDir, 'dist')));
    const res = await request('/_console/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('console shell');
  });
});
