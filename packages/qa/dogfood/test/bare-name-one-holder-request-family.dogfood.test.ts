// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#30803] One name, one package holder for an API, an object-less action and
// an engine function — the request family (maintainer ruling C on #30798,
// phase 1; ADR-0048 §3.4 narrowed; `packages/objectql/src/bare-name-one-holder.ts`),
// on a booted showcase. The data family's booted pin is
// `bare-name-one-holder.dogfood.test.ts`.
//
// The registry's own pins (`registry-bare-name-one-holder-request-family.test.ts`)
// drive the engine's package door, the item seam and the hook binder's bind
// in-process. This file drives the rule at the doors a deployment reaches:
//
//   - the cold boot of a deployment that already holds the clash — two
//     `AppPlugin` packages, `alpha` and `beta`, shipping one API, one
//     object-less action and one function under the same names — boots, and
//     logs ONE warning line naming both packages (never the runtime's
//     `app:<id>` handler owner) and the rename for every name;
//   - `POST /marketplace/install-local` of a third package declaring the held
//     API name is 422 PLUGIN_REGISTER_FAILED naming both holders and the
//     rename, installs nothing, and its endpoint path stays unserved;
//   - the same door refusing a package that declares the held object-less
//     action and the showcase's own API name, naming both;
//   - CONTROL: a package declaring fresh names, and an action BOUND to its own
//     object under the held object-less action's name, installs.
//
// A function cannot come through install-local (it is code; that door carries
// no runtime module), so its post-boot door is pinned in-process only.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { AppPlugin } from '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { defineStack } from '@objectstack/spec';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { bootShowcase } from './showcase-boot.js';

const SHOWCASE_PKG = 'com.example.showcase';
const SHOWCASE_API = 'showcase_task_feed';
const API = 'qa_shared_api';
const ACTION = 'qa_shared_run';
const FN = 'qa_shared_fn';

const item = (p: string) => ({
  name: `${p}_item`,
  label: `${p} item`,
  sharingModel: 'public_read_write',
  fields: { name: { type: 'text', label: 'Name' } },
});
const api = (p: string, name = API) => ({
  name, path: `/api/v1/apps/${p}/feed`, method: 'GET', summary: `${p} feed`,
  type: 'object_operation', objectParams: { object: `${p}_item`, operation: 'find' }, authRequired: true,
});
const action = (p: string, name = ACTION, extra: Record<string, unknown> = {}) => ({
  name, label: `${p} run`, type: 'script', body: { language: 'js', source: `return { from: '${p}' };`, capabilities: [] }, ...extra,
});

/** One of the two packages the cold boot registers, each shipping all three names. */
function bootPackage(p: 'alpha' | 'beta') {
  return defineStack({
    manifest: { id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app' },
    objects: [item(p)],
    apis: [api(p)],
    actions: [action(p)],
    functions: { [FN]: async () => p },
  } as never);
}

/** An inline install-local manifest. */
const inline = (p: string, collections: Record<string, unknown[]>) => ({
  manifest: {
    id: `com.qa.bare.${p}`, namespace: p, name: `qa_bare_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [item(p)],
    ...collections,
  },
});

/** Every line the process writes while `run` is in flight (security-catalog-one-holder-http's instrument). */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
  }
}

/** The level of one kernel-logger line (`<ISO time> <LEVEL> <message> …`), or `undefined`. */
function levelOf(line: string): string | undefined {
  return /^(?:\S+Z\s+)?(DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(line.trim())?.[1];
}

const codeOf = (body: any) =>
  (body?.error && typeof body.error === 'object' ? body.error.code : undefined) ?? body?.code ?? null;

describe('one package holder per API, object-less action and function name, on a booted showcase', () => {
  let stack: VerifyStack;
  let admin: string;
  let storageDir: string;
  let bootLines: string[] = [];

  const packageIds = async () => {
    const r = await stack.apiAs(admin, 'GET', '/packages');
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const rows = (body?.data?.packages ?? body?.packages ?? body?.data ?? body ?? []) as any[];
    return rows.map((p: any) => p?.manifest?.id ?? p?.id ?? p?.packageId).filter(Boolean).sort();
  };

  const installLocal = async (payload: unknown) => {
    const res = await stack.apiAs(admin, 'POST', '/marketplace/install-local', payload);
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-bare-name-request-'));
    const booted = await captureOutput(() => bootShowcase({
      extraPlugins: [
        new AppPlugin(bootPackage('alpha') as never),
        new AppPlugin(bootPackage('beta') as never),
        new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }),
      ],
    }));
    stack = booted.value;
    bootLines = booted.lines;
    admin = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the cold boot of a deployment holding the clash boots, and warns once naming both packages and the rename for every name', async () => {
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    expect(line).toContain(`the API "${API}"`);
    expect(line).toContain(`the object-less action "${ACTION}"`);
    expect(line).toContain(`the function "${FN}"`);
    for (const name of [API, ACTION, FN]) expect(line, `the rename of ${name}`).toContain(`"beta_${name}"`);
    expect(line).toContain('package "com.qa.bare.alpha"');
    expect(line).toContain('package "com.qa.bare.beta"');
    expect(line, 'the package, never the handler owner').not.toContain('app:com.qa');
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
  });

  // [#32069, ADR-0150 D3/D5] The api reads of the clash the cold boot keeps.
  // On main ff04ad81 the metadata store held one item per api name (the last
  // registered), so `/apps/alpha/feed` answered 404 and the qualified read of
  // alpha served beta's body stamped `_packageId: com.qa.bare.alpha`.
  const metaApi = async (path: string) => {
    const r = await stack.apiAs(admin, 'GET', path);
    const body = (await r.json()) as any;
    return { status: r.status, body, item: body?.item ?? body?.data?.item };
  };

  it('each package\'s qualified api read serves its own body under its own stamp; the bare read is 409 naming both', async () => {
    for (const p of ['alpha', 'beta'] as const) {
      for (const path of [`/meta/api/${p}/${API}`, `/meta/api/${API}?package=com.qa.bare.${p}`]) {
        const { status, item } = await metaApi(path);
        expect([status, item?.path, item?.summary, item?._packageId], path)
          .toEqual([200, `/api/v1/apps/${p}/feed`, `${p} feed`, `com.qa.bare.${p}`]);
      }
    }
    const bare = await metaApi(`/meta/api/${API}`);
    expect([bare.status, codeOf(bare.body)], JSON.stringify(bare.body)).toEqual([409, 'RESOURCE_CONFLICT']);
    const message = String(bare.body?.error?.message ?? bare.body?.error ?? '');
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
  });

  it('each package\'s declared endpoint path is served from its own declaration', async () => {
    for (const p of ['alpha', 'beta'] as const) {
      const r = await stack.apiAs(admin, 'GET', `/apps/${p}/feed`);
      const body = (await r.json()) as any;
      expect([r.status, body?.data?.object], `/apps/${p}/feed`).toEqual([200, `${p}_item`]);
    }
  });

  it('CONTROL — the showcase\'s one-holder api reads as before: bare, by its namespace and by its package', async () => {
    for (const path of [`/meta/api/${SHOWCASE_API}`, `/meta/api/showcase/${SHOWCASE_API}`, `/meta/api/${SHOWCASE_API}?package=${SHOWCASE_PKG}`]) {
      const { status, item } = await metaApi(path);
      expect([status, item?.path, item?._packageId], path).toEqual([200, '/api/v1/apps/showcase/tasks', SHOWCASE_PKG]);
    }
  });

  it('narrowing — a one-holder api read at a package or `_env` that does not hold it is 409 naming the holder (it was served the holder\'s item)', async () => {
    for (const path of [`/meta/api/${SHOWCASE_API}?package=com.qa.bare.alpha`, `/meta/api/alpha/${SHOWCASE_API}`, `/meta/api/_env/${SHOWCASE_API}`]) {
      const { status, body } = await metaApi(path);
      expect([status, codeOf(body)], `${path} ${JSON.stringify(body)}`).toEqual([409, 'RESOURCE_CONFLICT']);
      expect(String(body?.error?.message ?? body?.error ?? ''), path).toContain(SHOWCASE_PKG);
    }
  });

  it('install-local of a third package declaring a held API name is 422 PLUGIN_REGISTER_FAILED naming both holders and the rename; nothing is installed or served', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('gamma', { apis: [api('gamma')] }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the API "${API}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain('com.qa.bare.beta');
    expect(message).toContain(`"gamma_${API}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
    expect((await stack.apiAs(admin, 'GET', '/apps/gamma/feed')).status, 'the refused endpoint is not served').toBe(404);
  });

  it('install-local of a package declaring the held object-less action and the showcase\'s API name is refused, naming both', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('delta', {
      apis: [api('delta', SHOWCASE_API)],
      actions: [action('delta')],
    }));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the API "${SHOWCASE_API}"`);
    expect(message).toContain(SHOWCASE_PKG);
    expect(message).toContain(`the object-less action "${ACTION}"`);
    expect(message).toContain('com.qa.bare.alpha');
    expect(message).toContain(`"delta_${ACTION}"`);
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
  });

  it('CONTROL — install-local of a package declaring fresh names, and an action bound to its own object under the held action name, installs', async () => {
    const { status, body } = await installLocal(inline('epsilon', {
      apis: [api('epsilon', 'epsilon_feed')],
      actions: [action('epsilon', 'epsilon_run'), action('epsilon', ACTION, { objectName: 'epsilon_item' })],
    }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.epsilon');
  });
});
