// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * createRuntimeAssetsPlugin() — serves /runtime/assets/* unconditionally.
 *
 * The route must resolve even when the Console dist isn't built — unlike
 * the rest of createConsoleStaticPlugin which early-returns when
 * dist/index.html is missing.
 *
 * #22071 — and when the route is NOT mounted (the assets directory is absent),
 * or a branding URL names a file it will not serve, the boot says so: once the
 * kernel has bootstrapped, the plugin reads the served app list and warns once
 * per unserved `/runtime/assets/` URL. The end-to-end boot half of that pin
 * (an artifact booted from a directory without `assets/`, and the
 * `OS_RUNTIME_ASSETS_DIR` / `assets/` controls) is
 * `serve-runtime-assets-branding-warning.e2e.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntimeAssetsPlugin } from '../src/utils/console.js';

// Atomically create a uniquely-named temp dir (random suffix) instead of a
// predictable `Date.now()` name — avoids the temp-file race/symlink attack
// flagged by CodeQL js/insecure-temporary-file.
const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-runtime-assets-'));
const testPng = path.join(assetsDir, 'test-logo.png');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

/** A directory that is never created: the "no assets/ here" boot. */
const absentDir = path.join(assetsDir, 'never-created');

beforeAll(() => {
  fs.writeFileSync(testPng, Buffer.from('fake-png-content'));
  fs.writeFileSync(path.join(assetsDir, 'icon.svg'), SVG);
  fs.writeFileSync(path.join(assetsDir, 'my logo.svg'), SVG);
  fs.mkdirSync(path.join(assetsDir, 'sub'));
  fs.writeFileSync(path.join(assetsDir, 'sub', 'deep.svg'), SVG);
});

afterAll(() => {
  fs.rmSync(assetsDir, { recursive: true, force: true });
});

type Handler = (c: any) => Promise<Response>;

/**
 * The kernel surface the plugin touches, recorded: the routes it mounts, the
 * hooks it registers, and every line it logs. `apps` is what the `protocol`
 * service answers `getMetaItems({ type: 'app' })` with — the `{ type, items }`
 * envelope the real protocol answers.
 */
function fakeKernel(opts: { apps?: any[]; protocol?: 'present' | 'absent' | 'throws' } = {}) {
  const routes = new Map<string, Handler>();
  const hooks = new Map<string, Array<() => Promise<void> | void>>();
  const warnings: string[] = [];
  const debugs: string[] = [];
  const appReads: unknown[] = [];
  const protocol = opts.protocol ?? 'present';
  const ctx = {
    getService: (name: string) => {
      if (name === 'http.server') {
        return { getRawApp: () => ({ get: (route: string, handler: Handler) => { routes.set(route, handler); } }) };
      }
      if (name === 'protocol' && protocol !== 'absent') {
        return {
          getMetaItems: async (request: { type: string }) => {
            appReads.push(request);
            if (protocol === 'throws') throw new Error('sys_metadata unreachable');
            return { type: request.type, items: opts.apps ?? [] };
          },
        };
      }
      // The real kernel accessor throws on an unregistered service.
      throw new Error(`[Kernel] Service '${name}' not found`);
    },
    hook: (name: string, handler: () => Promise<void> | void) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    logger: {
      warn: (line: string) => { warnings.push(line); },
      debug: (line: string) => { debugs.push(line); },
    },
  };
  return {
    ctx,
    routes,
    hooks,
    warnings,
    debugs,
    appReads,
    /** Run what the kernel runs once every `kernel:ready` handler has settled. */
    async bootstrapped() {
      for (const handler of hooks.get('kernel:bootstrapped') ?? []) await handler();
    },
  };
}

/** Ask the mounted route for `filename`, as Hono hands it the decoded `:filename`. */
async function serve(routes: Map<string, Handler>, filename: string): Promise<Response> {
  const handler = routes.get('/runtime/assets/:filename');
  if (!handler) throw new Error('the /runtime/assets/:filename route is not mounted');
  return handler({
    req: { param: (key: string) => (key === 'filename' ? filename : undefined) },
    text: (body: string, status: number) => new Response(body, { status }),
  });
}

const brandApp = (name: string, branding: Record<string, unknown>) => ({ name, label: name, branding });

describe('createRuntimeAssetsPlugin', () => {
  it('returns a plugin object with name, init, and start', () => {
    const plugin = createRuntimeAssetsPlugin(assetsDir, 'cwd');
    expect(plugin).toHaveProperty('name', 'com.objectstack.runtime-assets');
    expect(plugin).toHaveProperty('init');
    expect(plugin).toHaveProperty('start');
  });

  it('mounts no route when the assets dir does not exist — and registers the boot check that says so', async () => {
    const kernel = fakeKernel();
    await expect(createRuntimeAssetsPlugin('/nonexistent/dir', 'cwd').start(kernel.ctx)).resolves.toBeUndefined();
    expect([...kernel.routes.keys()]).toEqual([]);
    expect(kernel.hooks.get('kernel:bootstrapped')).toHaveLength(1);
  });

  it('skips registration when http server service is missing', async () => {
    const plugin = createRuntimeAssetsPlugin(assetsDir, 'cwd');
    const ctx = { getService: () => null };
    await expect(plugin.start(ctx as any)).resolves.toBeUndefined();
  });

  it('serves a file in the directory, 404s a missing one and refuses a name that escapes it', async () => {
    const kernel = fakeKernel();
    await createRuntimeAssetsPlugin(assetsDir, 'cwd').start(kernel.ctx);

    const ok = await serve(kernel.routes, 'icon.svg');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/svg+xml');
    expect(await ok.text()).toBe(SVG);
    expect((await serve(kernel.routes, 'missing.svg')).status).toBe(404);
    expect((await serve(kernel.routes, '..')).status).toBe(403);
  });
});

describe('the boot check: a branding URL under /runtime/assets/ this boot will not serve (#22071)', () => {
  it('assets dir absent: ONE warning for a file both logo and favicon name, naming the app, both keys, the file, the directory and OS_RUNTIME_ASSETS_DIR, and saying the directory does not exist', async () => {
    const kernel = fakeKernel({
      apps: [brandApp('crm', { logo: '/runtime/assets/icon.svg', favicon: '/runtime/assets/icon.svg' })],
    });
    await createRuntimeAssetsPlugin(absentDir, 'cwd').start(kernel.ctx);
    // Nothing is said before the boot has settled — the apps are read then.
    expect(kernel.warnings).toEqual([]);
    await kernel.bootstrapped();

    expect(kernel.appReads).toEqual([{ type: 'app' }]);
    expect(kernel.warnings).toHaveLength(1);
    const [line] = kernel.warnings;
    expect(line).toContain("'crm'");
    expect(line).toContain('branding.logo');
    expect(line).toContain('branding.favicon');
    expect(line).toContain('icon.svg');
    expect(line).toContain(absentDir);
    expect(line).toContain('OS_RUNTIME_ASSETS_DIR');
    expect(line).toContain('does not exist');
  });

  it('control: the file present — the route serves it and nothing is printed', async () => {
    const kernel = fakeKernel({
      apps: [brandApp('crm', { logo: '/runtime/assets/icon.svg', favicon: '/runtime/assets/icon.svg' })],
    });
    await createRuntimeAssetsPlugin(assetsDir, 'OS_RUNTIME_ASSETS_DIR').start(kernel.ctx);
    await kernel.bootstrapped();

    // Positive control on the read itself, so the silence below is a verdict.
    expect(kernel.appReads).toEqual([{ type: 'app' }]);
    expect(kernel.warnings).toEqual([]);
    expect((await serve(kernel.routes, 'icon.svg')).status).toBe(200);
  });

  it('assets dir present but the file missing: warns naming the file and the directory, and does NOT claim the directory is absent', async () => {
    const kernel = fakeKernel({ apps: [brandApp('crm', { logo: '/runtime/assets/missing-logo.svg' })] });
    await createRuntimeAssetsPlugin(assetsDir, 'OS_RUNTIME_ASSETS_DIR').start(kernel.ctx);
    await kernel.bootstrapped();

    expect(kernel.warnings).toHaveLength(1);
    const [line] = kernel.warnings;
    expect(line).toContain("'crm'");
    expect(line).toContain('missing-logo.svg');
    expect(line).toContain(assetsDir);
    expect(line).toContain('OS_RUNTIME_ASSETS_DIR');
    expect(line).not.toContain('does not exist');
    expect((await serve(kernel.routes, 'missing-logo.svg')).status).toBe(404);
  });

  it('one line per unserved file, naming every app that uses it', async () => {
    const kernel = fakeKernel({
      apps: [
        brandApp('crm', { logo: '/runtime/assets/shared.svg', favicon: '/runtime/assets/crm.ico' }),
        brandApp('hr', { favicon: '/runtime/assets/shared.svg' }),
      ],
    });
    await createRuntimeAssetsPlugin(absentDir, 'cwd').start(kernel.ctx);
    await kernel.bootstrapped();

    expect(kernel.warnings).toHaveLength(2);
    const shared = kernel.warnings.find((l) => l.includes('shared.svg'));
    expect(shared).toContain("'crm'");
    expect(shared).toContain("'hr'");
    const crmOnly = kernel.warnings.find((l) => l.includes('crm.ico'));
    expect(crmOnly).toContain("'crm'");
    expect(crmOnly).not.toContain("'hr'");
  });

  it('checks only root paths under /runtime/assets/ — every other spelling prints nothing (with a positive control in the same boot)', async () => {
    const kernel = fakeKernel({
      apps: [
        brandApp('absolute', { logo: 'https://cdn.example.com/runtime/assets/icon.svg' }),
        brandApp('protocol_relative', { logo: '//cdn.example.com/runtime/assets/icon.svg' }),
        brandApp('backslash_host', { logo: '/\\cdn.example.com/runtime/assets/icon.svg' }),
        brandApp('data_uri', { logo: 'data:image/svg+xml;base64,PHN2Zy8+' }),
        brandApp('relative', { logo: 'runtime/assets/icon.svg' }),
        brandApp('other_root', { logo: '/assets/todo-logo.png', favicon: '/runtime/assetsx/icon.svg' }),
        brandApp('bare_prefix', { logo: '/runtime/assets/' }),
        brandApp('not_a_string', { logo: 42 }),
        { name: 'no_branding', label: 'No branding' },
        brandApp('control', { logo: '/runtime/assets/icon.svg' }),
      ],
    });
    // Absent directory, so any value the check accepted WOULD warn.
    await createRuntimeAssetsPlugin(absentDir, 'cwd').start(kernel.ctx);
    await kernel.bootstrapped();

    expect(kernel.warnings).toHaveLength(1);
    expect(kernel.warnings[0]).toContain("'control'");
  });

  it('judges a URL by the same resolution the route serves through — query, fragment, dot segments, encoding, directories and subdirectories', async () => {
    // [url, the :filename the route receives — or null when the route's single
    // segment cannot match at all]
    const cases: Array<[string, string | null]> = [
      ['/runtime/assets/icon.svg?v=2#top', 'icon.svg'],
      ['/runtime/assets/./icon.svg', 'icon.svg'],
      [' /runtime/assets/icon.svg ', 'icon.svg'],
      ['/runtime/assets/my%20logo.svg', 'my logo.svg'],
      ['/runtime/assets/sub', 'sub'],
      ['/runtime/assets/sub/deep.svg', null],
      ['/runtime/assets/gone.svg', 'gone.svg'],
    ];
    const kernel = fakeKernel({ apps: cases.map(([url], i) => brandApp(`app_${i}`, { logo: url })) });
    await createRuntimeAssetsPlugin(assetsDir, 'cwd').start(kernel.ctx);
    await kernel.bootstrapped();

    for (const [i, [url, filename]] of cases.entries()) {
      const warned = kernel.warnings.some((l) => l.includes(`'app_${i}'`));
      const served = filename !== null && (await serve(kernel.routes, filename)).status === 200;
      expect({ url, warned }).toEqual({ url, warned: !served });
    }
    // Four the route serves and three it does not, so neither half is vacuous.
    expect(kernel.warnings).toHaveLength(3);
  });

  it('a subdirectory URL is reported as one, not as a missing file', async () => {
    const kernel = fakeKernel({ apps: [brandApp('crm', { logo: '/runtime/assets/sub/deep.svg' })] });
    await createRuntimeAssetsPlugin(assetsDir, 'cwd').start(kernel.ctx);
    await kernel.bootstrapped();

    expect(kernel.warnings).toHaveLength(1);
    expect(kernel.warnings[0]).toContain('/runtime/assets/sub/deep.svg');
    expect(kernel.warnings[0]).toContain('subdirectory');
  });

  it('never fails the boot it reports on: no protocol, or a protocol that throws, logs at debug and warns nothing', async () => {
    for (const protocol of ['absent', 'throws'] as const) {
      const kernel = fakeKernel({ protocol, apps: [brandApp('crm', { logo: '/runtime/assets/icon.svg' })] });
      await createRuntimeAssetsPlugin(absentDir, 'cwd').start(kernel.ctx);
      await expect(kernel.bootstrapped()).resolves.toBeUndefined();
      expect(kernel.warnings).toEqual([]);
      expect(kernel.debugs).toHaveLength(1);
    }
  });
});
