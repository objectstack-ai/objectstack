// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_packages` boot hydration is a LOAD of data at rest, so a stored
 * package body that declares its protocol range converts forward under ADR-0087
 * D2 before the registry judges it — through the engine's one registration-door
 * entry point (`ObjectQL.convertPackageBodyForward`), reused, never re-derived.
 *
 * Over the REAL stack, end to end: an `ObjectKernel` with `ObjectQLPlugin` (the
 * real `SchemaRegistry`, which is the judge that refuses) over a real
 * `SqlDriver` (better-sqlite3, on disk), and this package's plugin. One process
 * publishes the records through the `package` service; a second process over
 * the same database file boots and hydrates them, as a restart does. A stubbed
 * registry cannot refuse anything, so it could not tell these cases apart.
 *
 * ## Which bodies reach the window on this runtime
 *
 * The body is HotCRM 4.0.1's (`__fixtures__/hotcrm-4.0.1-published-pages.artifact.json`
 * in `@objectstack/objectql`): a `type: 'home'` page with `isDefault: true`,
 * declared floor 17.7.0, a shape this spec refuses since 18.0. As PUBLISHED it
 * declares `^17.7.0`, a range that excludes this runtime's major, so the ADR-0087
 * D1 handshake that runs first refuses it by name and it never reaches the
 * registry (pinned below as the fact it is). The window opens for a stored body
 * whose declared range ADMITS this runtime with a floor before the retirement,
 * so the converting cases restamp the same body `>=17.7.0` — same floor, same
 * pages, a range the handshake accepts.
 *
 * What is pinned:
 *   - that body hydrates, converted, with the engine's named warning; the
 *     registry serves the converted record and the stored row is left as
 *     published;
 *   - one record the registry still refuses after conversion is reported BY
 *     NAME at `error`, with the refusal attached, and the record listed after
 *     it keeps hydrating — it used to throw out of the whole loop to a `debug`
 *     line;
 *   - CONTROL: the same body with no declared range (a manifest built in code)
 *     meets the registry's refusal exactly as before, and nothing converts;
 *   - HotCRM 4.0.1 exactly as published is refused by the handshake, not the
 *     registry, and the records after it keep hydrating.
 *
 * ## The install door stays strict, and why (`protocol.installPackage`)
 *
 * The same converting body handed to the install primitive is REFUSED by the
 * registry, and nothing lands in `sys_packages`. That door is authoring-side:
 * its HTTP caller, `POST /api/v1/packages`, parses the whole body through the
 * closed `ManifestSchema` first, which refuses a `pages` key outright, so no
 * package body carrying metadata collections reaches the primitive over HTTP;
 * `duplicatePackage` copies the registry's own record (already judged), and
 * the unmanaged install's base is identity keys only. What it does receive is
 * a manifest being authored now (AI Studio's blueprint tools call it
 * in-process), and a retired declaration there is the author's to fix, loudly,
 * at the moment of writing. A body that lands in `sys_packages` by any road is
 * data at rest from then on, and the hydration above converts it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PackageServicePlugin, type PackageService } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(HERE, '../../../objectql/src/__fixtures__/hotcrm-4.0.1-published-pages.artifact.json');

type Bag = Record<string, any>;
type Line = { level: 'info' | 'warn' | 'error'; text: string; error?: unknown };

const HOTCRM_ID = 'app.objectstack.hotcrm';
/** The same body as a plugin would build it in code: its own id, no namespace, NO declared range. */
const CODE_BUILT_ID = 'com.example.code_built_home';
const IS_DEFAULT_CONVERSION = 'page-is-default-off-record-page-removed';

/** HotCRM 4.0.1's `app.objectstack.hotcrm` body, flat, exactly as `os build` assembled it (`^17.7.0`). */
const publishedHotcrmBody = (): Bag => {
  const artifact = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  return artifact.packages.find((e: Bag) => e.manifest.id === HOTCRM_ID).manifest;
};
/** The same body under a range that admits this runtime, from the same 17.7.0 floor. */
const hotcrmBody = (): Bag => ({ ...publishedHotcrmBody(), engines: { protocol: '>=17.7.0' } });
const codeBuiltBody = (): Bag => {
  const { engines: _engines, namespace: _namespace, ...rest } = hotcrmBody();
  return { ...rest, id: CODE_BUILT_ID, name: 'Code-built home' };
};

const dirs: string[] = [];
const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/**
 * One process over the database file in `dir`. A first plugin registers the
 * driver and records every line the engine and the plugins log, from before
 * the package service's `start()` — which is where the hydration runs.
 */
async function boot(dir: string) {
  const lines: Line[] = [];
  const record = (target: Bag | undefined) => {
    if (!target) return;
    for (const level of ['info', 'warn', 'error'] as const) {
      target[level] = (text: unknown, error?: unknown) => { lines.push({ level, text: String(text), error }); };
    }
  };
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const recorder: Plugin = {
    name: 'test.sqlite-and-log-recorder',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.getService<ObjectQL>('objectql').registerDriver(driver as never, true);
    },
    async start(ctx: PluginContext) {
      record(ctx.logger as unknown as Bag);
      record((ctx.getService<ObjectQL>('objectql') as unknown as { logger?: Bag }).logger);
    },
  };
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(recorder);
  await kernel.use(new PackageServicePlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  return { kernel, ql, lines, packages: kernel.getService<PackageService>('package') };
}

/**
 * Publish `bodies` in a first process, listed in the order given (the hydration
 * walks `sys_packages` newest first, so each row is stamped older than the one
 * before it), and stop it — then boot the second process, which hydrates.
 */
async function restartWith(bodies: Bag[]) {
  const dir = mkdtempSync(join(tmpdir(), 'os-sys-packages-hydration-'));
  dirs.push(dir);
  const first = await boot(dir);
  for (const [i, manifest] of bodies.entries()) {
    expect(await first.packages.publish({ manifest: manifest as never, metadata: {} as never })).toEqual({ success: true });
    await first.ql.execute({
      sql: 'UPDATE sys_packages SET created_at = ? WHERE id = ?',
      args: [`2026-01-01 00:00:${String(59 - i).padStart(2, '0')}`, manifest.id],
    });
  }
  expect((await first.packages.list()).map((r: Bag) => r.manifest.id)).toEqual(bodies.map((b) => b.id));
  await first.kernel.shutdown();
  return boot(dir);
}

const named = (lines: Line[], id: string) =>
  lines.filter((l) => l.level === 'warn' && l.text.includes(`package '${id}'`) && l.text.includes('ADR-0087 conversion'));
const notHydrated = (lines: Line[], id: string) =>
  lines.filter((l) => l.level === 'error' && l.text.startsWith(`Package '${id}' from sys_packages was NOT hydrated`));

const expectMisplacedDefault = (line: Line | undefined, id: string) => {
  expect(line, `no error line names ${id}`).toBeDefined();
  const refusal = line!.error as Error & { code?: string; status?: number };
  expect({ name: refusal.name, code: refusal.code, status: refusal.status })
    .toEqual({ name: 'MisplacedDefaultPageError', code: 'INVALID_METADATA', status: 422 });
  expect(line!.text).toContain(`Page "sales_home_page" of package "${id}": \`isDefault: true\` is refused on a \`type: 'home'\` page`);
};

describe('the install primitive is authoring-side and stays strict', () => {
  it('protocol.installPackage refuses the same body with the registry\'s refusal, and writes no sys_packages row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-sys-packages-install-'));
    dirs.push(dir);
    const { ql, lines, packages } = await boot(dir);
    const protocol = new ObjectStackProtocolImplementation(
      ql as never,
      () => new Map<string, unknown>([['package', packages]]),
    );

    let refusal: (Error & { code?: string; status?: number }) | undefined;
    try {
      await protocol.installPackage({ manifest: hotcrmBody() } as never);
    } catch (e) {
      refusal = e as typeof refusal;
    }
    expect(refusal, 'the install primitive accepted a retired declaration').toBeDefined();
    expect({ name: refusal!.name, code: refusal!.code, status: refusal!.status })
      .toEqual({ name: 'MisplacedDefaultPageError', code: 'INVALID_METADATA', status: 422 });
    expect(refusal!.message).toContain(`Page "sales_home_page" of package "${HOTCRM_ID}": \`isDefault: true\` is refused on a \`type: 'home'\` page`);
    expect(ql.registry.getPackage(HOTCRM_ID)).toBeUndefined();
    expect(await packages.get(HOTCRM_ID)).toBeNull();
    expect(lines.filter((l) => l.text.includes('ADR-0087 conversion'))).toEqual([]);
  });
});

describe('sys_packages boot hydration converts a stored body forward before the registry judges it', () => {
  it('hydrates HotCRM 4.0.1\'s stored body, converted, with the engine\'s named warning', async () => {
    const { ql, lines, packages } = await restartWith([hotcrmBody()]);

    const record = ql.registry.getPackage(HOTCRM_ID);
    expect(record, 'the stored HotCRM body was not hydrated').toBeDefined();
    const home = ((record!.manifest as Bag).pages as Bag[]).find((p) => p.name === 'sales_home_page')!;
    expect(home).toMatchObject({ type: 'home' });
    expect(home).not.toHaveProperty('isDefault');

    const warning = named(lines, HOTCRM_ID).filter((l) => l.text.includes(`conversion '${IS_DEFAULT_CONVERSION}'`));
    expect(warning).toHaveLength(1);
    expect(warning[0].text).toContain('declared protocol floor 17.7.0');
    expect(notHydrated(lines, HOTCRM_ID)).toEqual([]);
    expect(lines.filter((l) => l.level === 'info' && l.text === 'Hydrated 1 package(s) from sys_packages into registry')).toHaveLength(1);

    // The row stays as published: data at rest replays the chain at every load.
    const [row] = await packages.list();
    expect(((row.manifest as Bag).pages as Bag[]).find((p) => p.name === 'sales_home_page')).toMatchObject({ isDefault: true });
  });

  it('reports a record the registry still refuses by name, and keeps hydrating the records after it', async () => {
    const { ql, lines } = await restartWith([codeBuiltBody(), hotcrmBody()]);

    // The refused record: named, at error, with the registry's own refusal attached.
    const [line, ...more] = notHydrated(lines, CODE_BUILT_ID);
    expect(more).toEqual([]);
    expectMisplacedDefault(line, CODE_BUILT_ID);
    expect(ql.registry.getPackage(CODE_BUILT_ID)).toBeUndefined();

    // The record listed after it still hydrated, converted.
    expect(ql.registry.getPackage(HOTCRM_ID)).toBeDefined();
    expect(named(lines, HOTCRM_ID).length).toBeGreaterThan(0);
    // The count is what the registry accepted.
    expect(lines.filter((l) => l.level === 'info' && l.text.startsWith('Hydrated '))).toEqual([
      expect.objectContaining({ text: 'Hydrated 1 package(s) from sys_packages into registry' }),
    ]);
  });

  it('CONTROL — a stored body with no declared range meets the registry\'s refusal exactly as before, unconverted', async () => {
    const { ql, lines } = await restartWith([codeBuiltBody()]);

    expectMisplacedDefault(notHydrated(lines, CODE_BUILT_ID)[0], CODE_BUILT_ID);
    expect(ql.registry.getPackage(CODE_BUILT_ID)).toBeUndefined();
    expect(lines.filter((l) => l.text.includes('ADR-0087 conversion'))).toEqual([]);
    expect(lines.filter((l) => l.level === 'info' && l.text.startsWith('Hydrated '))).toEqual([]);
  });

  it('HotCRM 4.0.1 exactly as published (`^17.7.0`) is refused by the D1 handshake, named, and the records after it keep hydrating', async () => {
    const other = { id: 'com.example.after', name: 'After', version: '1.0.0', type: 'app' };
    const { ql, lines } = await restartWith([publishedHotcrmBody(), other]);

    const refused = lines.filter((l) => l.level === 'error'
      && l.text.startsWith(`[protocol] refusing to rehydrate package '${HOTCRM_ID}' from sys_packages`));
    expect(refused).toHaveLength(1);
    expect(refused[0].text).toContain('OS_PROTOCOL_INCOMPATIBLE');
    expect(ql.registry.getPackage(HOTCRM_ID)).toBeUndefined();
    // The handshake answered first: nothing converted and the registry never judged it.
    expect(named(lines, HOTCRM_ID)).toEqual([]);
    expect(notHydrated(lines, HOTCRM_ID)).toEqual([]);
    expect(ql.registry.getPackage('com.example.after')).toBeDefined();
  });
});
