// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console document's `content-security-policy`.
 *
 * The Console keeps its session token where any script on the page can read
 * it, so the document is served with a nonce-based `script-src`: a fresh nonce
 * per response, named in the header and stamped on every `<script>` the
 * document carries. These cases run the REAL plugin on a REAL Hono app (the
 * `HonoHttpServer` production resolves as `http.server`); the error-reporting
 * case adds the REAL `RuntimeConfigPlugin`, so the `connect-src` follows what
 * that door serves; the storage cases add the REAL `StorageServicePlugin`, so
 * the `connect-src` follows the adapter it builds.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RuntimeConfigPlugin } from '@objectstack/cloud-connection';
import { S3StorageAdapter, StorageServicePlugin, type StorageServicePluginOptions } from '@objectstack/service-storage';

import { createConsoleStaticPlugin } from './console.js';

const ORIGIN = 'http://csp.example.test';

/**
 * The shell's script shapes, as objectui ships them: classic inline scripts in
 * the head, one of them mentioning a closing tag inside a string, and the
 * module entry with attributes.
 */
const SHELL = [
  '<!doctype html><html><head><meta charset="UTF-8"><title></title>',
  '<script>window.early = 1;</script>',
  '<SCRIPT>window.shim = "</" + "script>";</SCRIPT>',
  '<style>#boot-splash{display:flex}</style>',
  '<script type="module" crossorigin src="./assets/index-BQWjE1TW.js"></script>',
  '</head><body><div id="root"></div></body></html>',
].join('\n');

/** The environment this suite sets; each test starts with all of it unset and leaves it as it found it. */
const ENV = [
  'OS_PAGE_REACT_ENABLED',
  'OS_PAGE_REACT',
  'OS_CONSOLE_CSP_CONNECT_SRC',
  'OS_CONSOLE_MAP_STYLE_URL',
  'OS_CLOUD_URL',
  'OS_TELEMETRY_CLIENT_ERROR_REPORTING_DSN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

let saved: Record<string, string | undefined>;
let consoleRoot: string;
let distPath: string;

beforeAll(() => {
  consoleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-csp-'));
  distPath = path.join(consoleRoot, 'dist');
  fs.mkdirSync(path.join(distPath, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distPath, 'index.html'), SHELL);
  fs.writeFileSync(path.join(distPath, 'assets', 'index-BQWjE1TW.js'), 'export {};');
});

afterAll(() => {
  fs.rmSync(consoleRoot, { recursive: true, force: true });
});

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) delete process.env[name];
});

afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

async function mount(opts: {
  runtimeConfig?: ConstructorParameters<typeof RuntimeConfigPlugin>[0];
  /** The kernel services the console plugin's context resolves by name. */
  services?: Map<string, unknown>;
  warnings?: string[];
} = {}) {
  const server = new HonoHttpServer(0);
  server.installNotFoundSeam();
  const logger = {
    warn: (message: string) => { opts.warnings?.push(message); },
    info: () => {},
    debug: () => {},
    error: () => {},
  };
  if (opts.runtimeConfig) {
    const hooks: Array<() => Promise<void>> = [];
    await new RuntimeConfigPlugin(opts.runtimeConfig).start({
      hook: (name: string, fn: () => Promise<void>) => { if (name === 'kernel:ready') hooks.push(fn); },
      getService: (name: string) => {
        if (name === 'http.server') return server;
        throw new Error(`no service ${name}`);
      },
      logger,
    } as any);
    for (const fn of hooks) await fn();
  }
  await createConsoleStaticPlugin(distPath).start({
    getServiceAsync: async () => server,
    getService: (name: string) => {
      if (opts.services?.has(name)) return opts.services.get(name);
      throw new Error(`no service ${name}`);
    },
    logger,
  });
  const app = server.getRawApp();
  return async (p: string, init?: RequestInit): Promise<Response> => app.request(`${ORIGIN}${p}`, init);
}

/** The policy's directives by name; a directive named twice fails. */
function directives(policy: string | null): Map<string, string[]> {
  expect(policy, 'content-security-policy header').toBeTruthy();
  const map = new Map<string, string[]>();
  for (const part of policy!.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    expect(map.has(name), `${name} named twice`).toBe(false);
    map.set(name, sources);
  }
  return map;
}

/** The nonce `script-src` names; exactly one. */
function headerNonce(policy: string | null): string {
  const nonces = directives(policy).get('script-src')!.filter((s) => s.startsWith("'nonce-"));
  expect(nonces).toHaveLength(1);
  return nonces[0].slice("'nonce-".length, -1);
}

/** Every `<script` start tag in `html`, whatever its case. */
function scriptTags(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
}

describe('the console document is served with a nonce-based content-security-policy', () => {
  it('names the policy\'s fixed directives on the document', async () => {
    const request = await mount();
    const res = await request('/_console/');
    expect(res.status).toBe(200);
    const policy = directives(res.headers.get('content-security-policy'));

    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('script-src')).toEqual(expect.arrayContaining(["'self'", "'wasm-unsafe-eval'"]));
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://demotiles.maplibre.org']);
  });

  it('stamps every <script> in the served document with the nonce the header names', async () => {
    const request = await mount();
    const res = await request('/_console/');
    const nonce = headerNonce(res.headers.get('content-security-policy'));
    const html = await res.text();

    // The build's three, and the server's react-pages capability global.
    const tags = scriptTags(html);
    expect(tags).toHaveLength(4);
    for (const tag of tags) expect(tag).toContain(` nonce="${nonce}"`);
    expect(html.match(/ nonce="/g)).toHaveLength(4);
  });

  it('draws a fresh nonce for every response', async () => {
    const request = await mount();
    const seen = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const res = await request('/_console/');
      const nonce = headerNonce(res.headers.get('content-security-policy'));
      expect(await res.text()).toContain(`nonce="${nonce}"`);
      seen.add(nonce);
    }
    expect(seen.size).toBe(5);
  });

  it('carries the policy on every HTML answer: an SPA fallback and a direct .html hit', async () => {
    const request = await mount();
    for (const p of ['/_console/apps/crm/record/42', '/_console/index.html']) {
      const res = await request(p);
      const nonce = headerNonce(res.headers.get('content-security-policy'));
      for (const tag of scriptTags(await res.text())) expect(tag, p).toContain(`nonce="${nonce}"`);
    }
  });

  it('leaves the build\'s other files without a document policy', async () => {
    const request = await mount();
    const res = await request('/_console/assets/index-BQWjE1TW.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
});

describe('\'unsafe-eval\' follows the react-pages tier, which is off unless the deployment turns it on', () => {
  /** The served document's policy, its nonce, and its html. */
  async function serve(warnings?: string[]) {
    const request = await mount({ warnings });
    const res = await request('/_console/');
    const policy = res.headers.get('content-security-policy');
    return { scriptSrc: directives(policy).get('script-src')!, nonce: headerNonce(policy), html: await res.text() };
  }

  it('is refused by default, and the document carries the disable global under the nonce', async () => {
    const { scriptSrc, nonce, html } = await serve();
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(html).toContain(
      `<script nonce="${nonce}">window.__OBJECTUI_CAPABILITIES_DISABLED__=(window.__OBJECTUI_CAPABILITIES_DISABLED__||[]).concat('react-pages');</script>`,
    );
    expect(html).not.toContain('window.__OBJECTUI_CAPABILITIES__=');
  });

  it('is allowed with OS_PAGE_REACT_ENABLED=true, and the document carries the enable global under the nonce', async () => {
    process.env.OS_PAGE_REACT_ENABLED = 'true';
    const { scriptSrc, nonce, html } = await serve();
    expect(scriptSrc).toContain("'unsafe-eval'");
    expect(html).toContain(
      `<script nonce="${nonce}">window.__OBJECTUI_CAPABILITIES__=(window.__OBJECTUI_CAPABILITIES__||[]).concat('react-pages');</script>`,
    );
    expect(html).not.toContain('__OBJECTUI_CAPABILITIES_DISABLED__');
  });

  it('reads the legacy OS_PAGE_REACT in both directions while the new name is unset, and names the new one', async () => {
    process.env.OS_PAGE_REACT = 'on';
    const warnings: string[] = [];
    expect((await serve(warnings)).scriptSrc).toContain("'unsafe-eval'");
    expect(warnings.filter((w) => w.includes('`OS_PAGE_REACT` is deprecated; rename it to `OS_PAGE_REACT_ENABLED`'))).toHaveLength(1);
    process.env.OS_PAGE_REACT = 'off';
    expect((await serve()).scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('lets the new name win over the legacy one', async () => {
    process.env.OS_PAGE_REACT = 'on';
    process.env.OS_PAGE_REACT_ENABLED = 'false';
    expect((await serve()).scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('keeps the tier off on a value that is neither on nor off, and says so once', async () => {
    process.env.OS_PAGE_REACT_ENABLED = 'ture';
    const warnings: string[] = [];
    const request = await mount({ warnings });
    for (let i = 0; i < 2; i += 1) {
      const res = await request('/_console/');
      expect(directives(res.headers.get('content-security-policy')).get('script-src')).not.toContain("'unsafe-eval'");
    }
    const named = warnings.filter((w) => w.includes('OS_PAGE_REACT_ENABLED="ture"'));
    expect(named).toHaveLength(1);
  });
});

describe('frame-ancestors', () => {
  it('is omitted on the public form page, which authors embed on their own sites', async () => {
    const request = await mount();
    const res = await request('/_console/f/contact-us');
    const policy = directives(res.headers.get('content-security-policy'));
    expect(policy.has('frame-ancestors')).toBe(false);
    expect(policy.get('script-src')!.some((s) => s.startsWith("'nonce-"))).toBe(true);
  });

  it('is kept on a page whose path only begins like it', async () => {
    const request = await mount();
    const res = await request('/_console/forms/contact-us');
    expect(directives(res.headers.get('content-security-policy')).get('frame-ancestors')).toEqual(["'self'"]);
  });
});

describe('connect-src', () => {
  it('names the origin of the error-reporting DSN the runtime serves, without its key', async () => {
    const request = await mount({ runtimeConfig: { clientErrorReporting: { dsn: 'https://abc123@o1.ingest.sentry.io/42' } } });
    const served = await (await request('/api/v1/runtime/config')).json();
    expect(served.telemetry.errorReporting.dsn).toBe('https://abc123@o1.ingest.sentry.io/42');

    const res = await request('/_console/');
    const policy = res.headers.get('content-security-policy')!;
    expect(directives(policy).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://o1.ingest.sentry.io',
    ]);
    expect(policy).not.toContain('abc123');
  });

  it('names no error-reporting origin when the runtime serves no DSN', async () => {
    const request = await mount({ runtimeConfig: {} });
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
    ]);
  });

  it('adds the sources an operator names in OS_CONSOLE_CSP_CONNECT_SRC', async () => {
    process.env.OS_CONSOLE_CSP_CONNECT_SRC = '  https://tiles.example.com\twss://*.example.com:8443/rt/ https: ';
    const request = await mount();
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://tiles.example.com',
      'wss://*.example.com:8443/rt/',
      'https:',
    ]);
  });

  it.each([
    ["'unsafe-inline'"],
    ['https://tiles.example.com;script-src'],
    ['*'],
    ['javascript:'],
    ['tiles.example.com'],
  ])('refuses the boot when OS_CONSOLE_CSP_CONNECT_SRC names %j', async (value) => {
    process.env.OS_CONSOLE_CSP_CONNECT_SRC = `https://ok.example.com ${value}`;
    await expect(mount()).rejects.toThrow(/OS_CONSOLE_CSP_CONNECT_SRC names .*not a connect-src source/);
  });

  it('adds the origin of the deployment\'s default map style, named in OS_CONSOLE_MAP_STYLE_URL', async () => {
    process.env.OS_CONSOLE_MAP_STYLE_URL = 'https://tiles.example.com:8443/styles/basic/style.json?key=public';
    const request = await mount();
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://tiles.example.com:8443',
    ]);
  });

  it('names no map style origin of its own when OS_CONSOLE_MAP_STYLE_URL is unset or empty', async () => {
    process.env.OS_CONSOLE_MAP_STYLE_URL = '  ';
    const request = await mount();
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
    ]);
  });

  it('keeps OS_CONSOLE_CSP_CONNECT_SRC working beside it, after the map style origin', async () => {
    process.env.OS_CONSOLE_MAP_STYLE_URL = 'https://tiles.example.com/style.json';
    process.env.OS_CONSOLE_CSP_CONNECT_SRC = 'https://glyphs.example.com https://tiles.example.com';
    const request = await mount();
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://tiles.example.com',
      'https://glyphs.example.com',
    ]);
  });

  it('allows the very origin RuntimeConfigPlugin serves as the default map style, from one env var', async () => {
    process.env.OS_CONSOLE_MAP_STYLE_URL = 'https://tiles.example.com/styles/basic/style.json';
    const request = await mount({ runtimeConfig: {} });
    const served = await (await request('/api/v1/runtime/config')).json();
    expect(served.mapStyleUrl).toBe('https://tiles.example.com/styles/basic/style.json');
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toContain(
      new URL(served.mapStyleUrl).origin,
    );
  });

  it.each([
    ['http://tiles.example.com/style.json'],
    ['/styles/basic/style.json'],
    ['tiles.example.com'],
    ["https://tiles.example.com/style.json 'unsafe-inline'"],
  ])('refuses the boot when OS_CONSOLE_MAP_STYLE_URL is %j', async (value) => {
    process.env.OS_CONSOLE_MAP_STYLE_URL = value;
    await expect(mount()).rejects.toThrow(/^OS_CONSOLE_MAP_STYLE_URL is .*absolute https: URL/s);
  });

  // The Console mount restates RuntimeConfigPlugin's reader rather than
  // importing it (this module imports Node built-ins only), so the two are held
  // here to one verdict, refusal text included, on every value named.
  it.each([
    ['https://tiles.example.com/styles/basic/style.json'],
    ['https://Tiles.Example.com:8443/style.json?key=public'],
    ['https://192.0.2.10/style.json'],
    ['   '],
    ['http://tiles.example.com/style.json'],
    ['/styles/basic/style.json'],
    ['tiles.example.com'],
    ['javascript:alert(1)'],
    ['https://user:secret@tiles.example.com/style.json'],
    ['https://[::1]/style.json'],
    ['https://a.example.com/style.json https://b.example.com/style.json'],
  ])('gives the same verdict as RuntimeConfigPlugin on OS_CONSOLE_MAP_STYLE_URL=%j', async (value) => {
    process.env.OS_CONSOLE_MAP_STYLE_URL = value;
    const verdict = (start: () => Promise<unknown>) => start().then(() => 'accepted', (e: Error) => e.message);
    const runtimeConfig = await verdict(() => new RuntimeConfigPlugin({}).start({
      hook: () => {},
      getService: (name: string) => { throw new Error(`no service ${name}`); },
      logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    } as any));
    expect(await verdict(() => mount())).toBe(runtimeConfig);
  });
});

/**
 * The kernel services a REAL `StorageServicePlugin` registers when it is
 * initialised with `options`: the `storage` service the upload doors presign
 * through, built from the same options.
 */
async function storageServices(options: StorageServicePluginOptions): Promise<Map<string, unknown>> {
  const services = new Map<string, unknown>();
  await new StorageServicePlugin(options).init({
    registerService: (name: string, service: unknown) => { services.set(name, service); },
    getService: (name: string) => {
      if (services.has(name)) return services.get(name);
      throw new Error(`no service ${name}`);
    },
    logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
  } as any);
  return services;
}

/** An S3-compatible store whose presigned URLs are virtual-hosted: the bucket is in the host name. */
const R2_STORAGE: StorageServicePluginOptions = {
  adapter: 's3',
  s3: { bucket: 'csp-uploads', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', keyPrefix: 'projects/env_1' },
};

describe('connect-src names the host the storage service presigns browser uploads to', () => {
  it('adds the origin of the presigned upload URL when the deployment stores files in S3', async () => {
    const request = await mount({ services: await storageServices(R2_STORAGE) });
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://csp-uploads.acct123.r2.cloudflarestorage.com',
    ]);
  });

  it('allows exactly the origin of a real presigned upload URL from the same storage service', async () => {
    // The presign itself signs with whatever credentials the adapter resolves.
    process.env.AWS_ACCESS_KEY_ID = 'AKIAFAKEFAKEFAKEFAKE';
    process.env.AWS_SECRET_ACCESS_KEY = 'fake-secret-access-key';
    for (const options of [
      R2_STORAGE,
      { adapter: 's3', s3: { bucket: 'csp-uploads', region: 'eu-west-2', keyPrefix: null } },
      { adapter: 's3', s3: { bucket: 'csp.uploads.example', region: 'us-east-1', keyPrefix: null } },
      { adapter: 's3', s3: { bucket: 'csp-uploads', region: 'us-east-1', endpoint: 'http://127.0.0.1:9000', keyPrefix: null } },
    ] satisfies StorageServicePluginOptions[]) {
      const services = await storageServices(options);
      const presigned = await (services.get('storage') as S3StorageAdapter).getPresignedUpload('a/b.txt', 60, { contentType: 'text/plain' });
      const request = await mount({ services });
      const res = await request('/_console/');
      const connectSrc = directives(res.headers.get('content-security-policy')).get('connect-src')!;
      expect(connectSrc, options.s3?.endpoint ?? options.s3?.region).toEqual([
        "'self'",
        'https://demotiles.maplibre.org',
        new URL(presigned.uploadUrl).origin,
      ]);
    }
  });

  it('follows the adapter a storage settings change swaps in, on the next document', async () => {
    const services = await storageServices(R2_STORAGE);
    const request = await mount({ services });
    const storage = services.get('storage') as { swap(next: unknown): void };
    storage.swap(new S3StorageAdapter({
      bucket: 'moved', region: 'auto', endpoint: 'https://acct456.r2.cloudflarestorage.com', keyPrefix: null, forcePathStyle: true,
    }));
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://acct456.r2.cloudflarestorage.com',
    ]);
  });

  it('adds nothing when the deployment stores files on the local disk, whose uploads go to the server itself', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-test-console-csp-storage-'));
    try {
      const request = await mount({ services: await storageServices({ adapter: 'local', local: { rootDir } }) });
      const res = await request('/_console/');
      expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
        "'self'",
        'https://demotiles.maplibre.org',
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('adds nothing, and says so once, when the store\'s endpoint is one the presigner refuses', async () => {
    const warnings: string[] = [];
    const services = await storageServices({ adapter: 's3', s3: { bucket: 'csp-uploads', region: 'auto', endpoint: 'not a url', keyPrefix: null } });
    const request = await mount({ services, warnings });
    for (let i = 0; i < 2; i += 1) {
      const res = await request('/_console/');
      expect(res.status).toBe(200);
      expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
        "'self'",
        'https://demotiles.maplibre.org',
      ]);
    }
    expect(warnings.filter((w) => w.includes('presigns uploads to'))).toHaveLength(1);
  });

  it('keeps OS_CONSOLE_CSP_CONNECT_SRC working beside it, after the storage origin', async () => {
    process.env.OS_CONSOLE_CSP_CONNECT_SRC = 'https://glyphs.example.com';
    const request = await mount({ services: await storageServices(R2_STORAGE) });
    const res = await request('/_console/');
    expect(directives(res.headers.get('content-security-policy')).get('connect-src')).toEqual([
      "'self'",
      'https://demotiles.maplibre.org',
      'https://csp-uploads.acct123.r2.cloudflarestorage.com',
      'https://glyphs.example.com',
    ]);
  });
});
