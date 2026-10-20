// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A missing database client on the REAL boot-refusal path (#24909).
 *
 * The unit pins in `datasource-connection-service.test.ts` hand the service a
 * knex-shaped error. This file builds the genuine one: the real shared factory
 * constructs the real `SqlDriver`, knex fails to load a client that cannot be
 * resolved, and the real `DatasourceConnectionService` refuses the host's
 * boot-critical `default` datasource — the path a scaffolded app takes when it
 * is pointed at PostgreSQL without `pg` installed.
 *
 * ## How a client is made unresolvable
 *
 * knex loads the client with a CJS `require()`. For that one specifier the test
 * has Node's own resolver (`Module._resolveFilename`) look in an EMPTY directory
 * and nowhere else, so Node raises its genuine `MODULE_NOT_FOUND` and knex
 * wraps it exactly as it does in a project without the package: nothing in the
 * error text is written here. Two details make "nowhere else" true:
 *
 *  - The hook sits on `Module._load`, the entry every `require()` passes
 *    through, rather than on the resolver: `_load` answers a request it has
 *    already resolved for the same parent from a cache without asking the
 *    resolver again, so a client an earlier case loaded would slip past.
 *  - The resolver always appends the global folders, and those include
 *    `NODE_PATH` — which pnpm points at its hoisted store when it runs a
 *    script, so every client in the store would still be found there. The
 *    hook resolves with `NODE_PATH` set aside (`Module._initPaths()` re-reads
 *    it) and puts it back before the real load runs.
 *
 * If the narrowing ever stopped taking effect, the client would load, the
 * driver would try to connect, and the `Cannot find module` assertion below
 * would fail loudly — measured: it does, against port 1, with ECONNREFUSED.
 *
 * What must NOT move is pinned beside what did: the boot is still refused, the
 * error is still a plain `Error`, the verdict is still retained as failed, and
 * a refused connection with the client present still ends on the generic
 * sentence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Module from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The factory loads the SQL driver (and knex with it) through a dynamic import
// inside `create()`. Paid here, at collection, so no case's clock measures a
// cold load of the driver's whole module graph — clocked windows measure
// behaviour, never loading.
import '@objectstack/driver-sql';
import { DatasourceConnectionService, type ConnectionEngineLike } from '../datasource-connection-service.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';
import {
  GENERIC_CONNECT_FAILURE_REMEDY,
  UNBUILT_WORKSPACE_REMEDY,
  missingDriverClientRemedy,
} from '../connect-failure-remedy.js';

type ResolveFilename = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: { paths?: string[] },
) => string;
type Load = (request: string, parent: unknown, isMain: boolean) => unknown;
const loader = Module as unknown as { _resolveFilename: ResolveFilename; _load: Load; _initPaths: () => void };

/** Resolve `request` from `dir` alone — no `NODE_PATH` — and throw Node's own error when absent. */
function resolveFromOnly(dir: string, request: string, parent: unknown, isMain: boolean): void {
  const nodePath = process.env.NODE_PATH;
  delete process.env.NODE_PATH;
  loader._initPaths();
  try {
    loader._resolveFilename(request, parent, isMain, { paths: [dir] });
  } finally {
    if (nodePath !== undefined) process.env.NODE_PATH = nodePath;
    loader._initPaths();
  }
}

/** Run `fn` with `specifier` resolvable from nowhere but an empty directory. */
async function withUnresolvable<T>(specifier: string, fn: () => Promise<T>): Promise<T> {
  const empty = mkdtempSync(join(tmpdir(), 'os-unresolvable-'));
  const original = loader._load;
  loader._load = function (this: unknown, request, parent, isMain) {
    // Throws Node's own MODULE_NOT_FOUND; should it ever resolve instead, the
    // real load runs and the assertions below catch it.
    if (request === specifier) resolveFromOnly(empty, request, parent, isMain);
    return original.call(this, request, parent, isMain);
  };
  // knex prints its own copy of the failure through `console.log`; the thrown
  // error is what is under test, so keep the run's output readable.
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    return await fn();
  } finally {
    loader._load = original;
    log.mockRestore();
    rmSync(empty, { recursive: true, force: true });
  }
}

/** The narrowest engine the connect path needs, recording the availability verdict. */
function engine(): ConnectionEngineLike & { unavailable: Map<string, string> } {
  const unavailable = new Map<string, string>();
  return {
    unavailable,
    registerDriver: () => undefined,
    registerDatasourceDef: () => undefined,
    getDriverByName: () => undefined,
    markDatasourceUnavailable: (info) => {
      unavailable.set(info.name, info.kind);
    },
    clearDatasourceUnavailable: (name) => {
      unavailable.delete(name);
    },
  };
}

/** Connect the host's boot-critical `default`, as `DefaultDatasourcePlugin` does at boot. */
async function bootDefault(driver: string, config: Record<string, unknown>) {
  const eng = engine();
  const service = new DatasourceConnectionService({
    engine: () => eng,
    // `dev: false` — production, where the sqlite arm builds the native client
    // unprobed instead of stepping down to WASM.
    factory: () => createDefaultDatasourceDriverFactory({ dev: false }),
  });
  const outcome = await service
    .connect(
      { name: 'default', driver, config, bootCritical: true },
      { asDefault: true, context: { trigger: 'declared-auto' } },
    )
    .then(
      (result) => ({ refused: false as const, result }),
      (error: unknown) => ({ refused: true as const, error: error as Error }),
    );
  return { outcome, service, eng };
}

const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
let saved: string | undefined;
let scratch: string;
beforeEach(() => {
  saved = process.env[ENV];
  delete process.env[ENV];
  scratch = mkdtempSync(join(tmpdir(), 'os-client-refusal-'));
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
  rmSync(scratch, { recursive: true, force: true });
});

describe('a missing database client refuses the boot with ITS install (#24909)', () => {
  // Port 1: nothing listens there, and the client never gets as far as trying.
  const arms: Array<[client: string, driver: string, config: () => Record<string, unknown>]> = [
    ['pg', 'postgres', () => ({ url: 'postgres://app@127.0.0.1:1/app' })],
    ['mysql2', 'mysql', () => ({ host: '127.0.0.1', port: 1, database: 'app', user: 'app' })],
    ['better-sqlite3', 'sqlite', () => ({ filename: join(scratch, 'app.db') })],
  ];

  it.each(arms)('%s absent: the %s default is refused, ending on the install of that client', async (client, driver, config) => {
    const { outcome, service, eng } = await withUnresolvable(client, () => bootDefault(driver, config()));

    // The refusal still happens, as the same plain Error.
    expect(outcome.refused).toBe(true);
    if (!outcome.refused) return;
    expect(outcome.error).toBeInstanceOf(Error);
    expect(outcome.error.name).toBe('Error');
    // It is the genuine client failure that reached the remedy…
    expect(outcome.error.message).toContain(`Cannot find module '${client}'`);
    expect(outcome.error.message).toContain('fail-fast per ADR-0062 D5');
    // …and the remedy names that client's install, not a build.
    expect(outcome.error.message.endsWith(missingDriverClientRemedy(client))).toBe(true);
    expect(outcome.error.message).not.toContain('pnpm build');
    expect(outcome.error.message).not.toContain(UNBUILT_WORKSPACE_REMEDY);

    // The verdict is retained exactly as before.
    expect(service.getConnectionState('default')?.status).toBe('failed-degraded');
    expect(eng.unavailable.get('default')).toBe('failed');
  });

  it('the escape hatch still boots degraded instead of refusing', async () => {
    process.env[ENV] = '1';
    const { outcome } = await withUnresolvable('pg', () =>
      bootDefault('postgres', { url: 'postgres://app@127.0.0.1:1/app' }),
    );
    expect(outcome.refused).toBe(false);
    if (outcome.refused) return;
    expect(outcome.result.status).toBe('failed-degraded');
  });

  it('control: with the client present, a refused connection keeps the generic sentence', async () => {
    const { outcome } = await bootDefault('postgres', { url: 'postgres://app@127.0.0.1:1/app' });
    expect(outcome.refused).toBe(true);
    if (!outcome.refused) return;
    expect(outcome.error.message).toContain('ECONNREFUSED');
    expect(outcome.error.message.endsWith(GENERIC_CONNECT_FAILURE_REMEDY)).toBe(true);
  });
});
