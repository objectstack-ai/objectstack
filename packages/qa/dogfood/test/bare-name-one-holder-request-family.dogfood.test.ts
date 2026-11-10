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
//     `app:<id>` handler owner) and the rename for the API and the function;
//   - `POST /marketplace/install-local` of a third package declaring the held
//     API name is 422 PLUGIN_REGISTER_FAILED naming both holders and the
//     rename, installs nothing, and its endpoint path stays unserved;
//   - the same door refusing a co-owner of `alpha`'s namespace that declares
//     the held object-less action and the showcase's own API name, naming
//     both;
//   - CONTROL: a package declaring fresh names, and an action BOUND to its own
//     object under the held object-less action's name, installs.
//
// A function cannot come through install-local (it is code; that door carries
// no runtime module), so its post-boot door is pinned in-process only.
//
// [#31697, ADR-0150 D2/D9, child B] The object-less action has since narrowed
// to the namespace: `alpha` and `beta` (two namespaces) each hold
// `qa_shared_run`, so the cold boot's warning no longer names it. What a
// caller with no package reaches is refused instead (ADR-0150 D3/D5):
//
//   - `GET /meta/action/NAME` and the bare `POST /actions/global/NAME` answer
//     `409 RESOURCE_CONFLICT` naming both packages; `?package=` and the
//     addressed `/actions/:ns/global/NAME` reach each package's own;
//   - install-local of a package of a THIRD namespace declaring the held name
//     installs; of a CO-OWNER of `alpha`'s namespace is refused, naming
//     `alpha` and the rename, as before.

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

/**
 * An inline install-local manifest of package `p`, in namespace `ns` (its own
 * by default). A package of another package's namespace is its co-owner: it
 * declares the dependency the namespace gate requires, and its object carries
 * that namespace's prefix.
 */
const inline = (p: string, collections: Record<string, unknown[]>, ns = p) => ({
  manifest: {
    id: `com.qa.bare.${p}`, namespace: ns, name: `qa_bare_${p}`, version: '1.0.0', type: 'app', scope: 'project',
    engines: { protocol: `^${PROTOCOL_MAJOR}` },
    objects: [item(ns === p ? p : `${ns}_${p}`)],
    ...(ns === p ? {} : { dependencies: { [`com.qa.bare.${ns}`]: '^1.0.0' } }),
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
const messageOf = (body: any) =>
  String(typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? '');

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

  /** `GET /meta/action/NAME`, naming no package: refused `409 RESOURCE_CONFLICT`, naming each holder. */
  const expectMetaRefused = async (holders: string[]) => {
    const r = await stack.apiAs(admin, 'GET', `/meta/action/${ACTION}`);
    const body = (await r.json()) as any;
    expect([r.status, codeOf(body)], JSON.stringify(body)).toEqual([409, 'RESOURCE_CONFLICT']);
    for (const holder of holders) expect(messageOf(body)).toContain(holder);
  };

  /** The object-less action `GET /meta/action/NAME?package=PKG` serves: its package and its label. */
  const metaAt = async (pkg: string): Promise<[string | undefined, string | undefined]> => {
    const r = await stack.apiAs(admin, 'GET', `/meta/action/${ACTION}?package=${pkg}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    const d = body?.data ?? body;
    const it = d?.item ?? d;
    return [it?._packageId, it?.label];
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

  it('the cold boot of a deployment holding the clash boots, and warns once naming both packages and the rename for the API and the function — the object-less action is no clash between two namespaces (#31697)', async () => {
    const warnings = bootLines.filter((l) => l.includes('Bare-name conflict at boot'));
    expect(warnings, 'one warning line').toHaveLength(1);
    const line = warnings[0]!;
    expect(levelOf(line)).toBe('WARN');
    expect(line).toContain(`the API "${API}"`);
    expect(line).toContain(`the function "${FN}"`);
    for (const name of [API, FN]) expect(line, `the rename of ${name}`).toContain(`"beta_${name}"`);
    expect(line).not.toContain(`the object-less action "${ACTION}"`);
    expect(line).toContain('package "com.qa.bare.alpha"');
    expect(line).toContain('package "com.qa.bare.beta"');
    expect(line, 'the package, never the handler owner').not.toContain('app:com.qa');
    expect(await packageIds(), 'both packages booted').toEqual(expect.arrayContaining(['com.qa.bare.alpha', 'com.qa.bare.beta']));
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

  it('install-local of a co-owner of `alpha`\'s namespace declaring the held object-less action and the showcase\'s API name is refused, naming both holders', async () => {
    const before = await packageIds();
    const { status, body } = await installLocal(inline('delta', {
      apis: [api('delta', SHOWCASE_API)],
      actions: [action('delta')],
    }, 'alpha'));
    expect([status, codeOf(body)], JSON.stringify(body)).toEqual([422, 'PLUGIN_REGISTER_FAILED']);
    const message = String(body?.error?.message ?? '');
    expect(message).toContain(`the API "${SHOWCASE_API}"`);
    expect(message).toContain(SHOWCASE_PKG);
    expect(message).toContain(`the object-less action "${ACTION}", already held by package "com.qa.bare.alpha"`);
    expect(message).toContain(`"alpha_${ACTION}"`);
    expect(message, 'another namespace\'s holder is no clash').not.toContain('com.qa.bare.beta');
    expect(await packageIds(), 'the package list is unchanged').toEqual(before);
  });

  it('[#31697] a caller naming no package is refused 409 naming both holders — `/meta/action/NAME` and the bare `/actions/global/NAME`; `?package=` and `/actions/:ns/global/NAME` reach each package\'s own', async () => {
    await expectMetaRefused(['com.qa.bare.alpha', 'com.qa.bare.beta']);
    expect(await metaAt('com.qa.bare.alpha')).toEqual(['com.qa.bare.alpha', 'alpha run']);
    expect(await metaAt('com.qa.bare.beta')).toEqual(['com.qa.bare.beta', 'beta run']);

    const bare = await stack.apiAs(admin, 'POST', `/actions/global/${ACTION}`, {});
    const bareBody = (await bare.json()) as any;
    expect([bare.status, codeOf(bareBody)], JSON.stringify(bareBody)).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(messageOf(bareBody)).toContain('com.qa.bare.alpha');
    expect(messageOf(bareBody)).toContain('com.qa.bare.beta');

    for (const ns of ['alpha', 'beta']) {
      const addressed = await stack.apiAs(admin, 'POST', `/actions/${ns}/global/${ACTION}`, {});
      const body = (await addressed.json()) as any;
      expect(addressed.status, JSON.stringify(body)).toBe(200);
      expect(JSON.stringify(body), `${ns}'s own body ran`).toContain(`"from":"${ns}"`);
    }
  });

  it('[#31697] install-local of a package of a THIRD namespace declaring the held object-less action name installs; the bare read then names all three holders, and its address reaches its own', async () => {
    const { status, body } = await installLocal(inline('zeta', { actions: [action('zeta')] }));
    expect(status, JSON.stringify(body)).toBeLessThan(300);
    expect(await packageIds()).toContain('com.qa.bare.zeta');
    expect(await metaAt('com.qa.bare.zeta')).toEqual(['com.qa.bare.zeta', 'zeta run']);
    await expectMetaRefused(['com.qa.bare.alpha', 'com.qa.bare.beta', 'com.qa.bare.zeta']);
    expect(await metaAt('com.qa.bare.alpha'), 'the first holder\'s item is unchanged').toEqual(['com.qa.bare.alpha', 'alpha run']);
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
