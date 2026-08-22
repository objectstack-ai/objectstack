// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10965 — the `service-package` seam guard, on a REAL booted driver.
 *
 * The card established the conflation by reading and named the boot path as
 * unverified: *"Whether the DevPlugin zero-install stack (a real
 * `InMemoryDriver`) reaches `get()`/`list()` at boot is unverified."* This file
 * is that measurement, kept as a pin.
 *
 * It lives in `packages/runtime` because that is where the pieces already are:
 * `@objectstack/driver-memory` is a dependency, `@objectstack/service-package`
 * a devDependency, and this package's `vitest.config.ts` already aliases the
 * latter to its `src/` for exactly this reason (the `#5047` rehydration pin
 * next door). `service-package` itself depends on neither the engine nor a
 * driver, so the same boot cannot be written inside it.
 *
 * ## Measured here, before the fix (framework `2866d5f97`)
 *
 *     typeof objectql.execute            -> 'function'   (the shape test passes)
 *     objectql.registry.installPackage   -> 'function'   (so hydration RUNS)
 *     start() issued three statements, each returning null:
 *       CREATE TABLE IF NOT EXISTS sys_packages …         -> null
 *       CREATE INDEX IF NOT EXISTS idx_packages_latest …  -> null
 *       SELECT * FROM sys_packages … (the hydration list) -> null
 *     list() -> []      ⇒ "no packages are installed"
 *     get()  -> null    ⇒ "this package is not installed"
 *
 * ⭐ What this pins is NOT "the memory driver is refused". It is the separation
 * the guard keys on: **a seam that cannot ANSWER is absent, not empty.** No
 * driver is named by the implementation — the seam is judged by what it
 * returns, and this file asserts the real driver falls on the "cannot answer"
 * side of that line.
 *
 * The mongodb driver is deliberately NOT asserted anywhere here: it is not
 * loaded by this suite, and an assertion about it would be a false pin.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import {
  PackageServicePlugin,
  PACKAGE_SEAM_UNREADABLE_MESSAGE,
} from '@objectstack/service-package';

import { DriverPlugin } from './driver-plugin.js';

/**
 * The `objectql` slot, as this file reads it: the raw-SQL seam under test, plus
 * the registry half whose presence is what lets `start()`'s hydration loop run
 * at all. Spelled out rather than `any` so the slot's shape is a declaration
 * (#4251 / `check:slot-lookup`).
 */
interface ObjectQlSlot {
  execute: (query: { sql: string; args?: unknown[] }) => Promise<unknown>;
  registry?: {
    installPackage?: (manifest: unknown) => unknown;
    getPackage?: (id: string) => unknown;
  };
}

/** The two read methods this card is about, off the registered `package` slot. */
interface PackageSlot {
  get: (packageId: string, version?: string) => Promise<unknown>;
  list: () => Promise<unknown[]>;
}

interface BootedStack {
  kernel: LiteKernel;
  engine: ObjectQlSlot;
  statements: string[];
  results: unknown[];
  warnLogs: string[];
  service: PackageSlot;
}

/** The zero-install stack: real engine, real InMemoryDriver, real plugin. */
async function bootMemoryStack(): Promise<BootedStack> {
  const kernel = new LiteKernel({ logger: { level: 'error' } });
  kernel.use(new ObjectQLPlugin({}));
  kernel.use(new DriverPlugin(new InMemoryDriver({ persistence: false }), 'memory'));
  await kernel.bootstrap();

  const engine = kernel.getService<ObjectQlSlot>('objectql');

  // Record what `start()` actually asks the seam, and what the seam answers.
  const statements: string[] = [];
  const results: unknown[] = [];
  const realExecute = engine.execute.bind(engine);
  engine.execute = async (q: { sql: string; args?: unknown[] }) => {
    const result = await realExecute(q);
    statements.push(String(q.sql).replace(/\s+/g, ' ').trim());
    results.push(result);
    return result;
  };

  const warnLogs: string[] = [];
  let service: PackageSlot | undefined;
  const services = new Map<string, unknown>([['objectql', engine]]);
  const ctx = {
    logger: {
      debug: () => {}, info: () => {},
      warn: (msg: string) => warnLogs.push(String(msg)),
      error: () => {},
    },
    getService: (n: string) => services.get(n),
    registerService: (n: string, s: unknown) => {
      services.set(n, s);
      if (n === 'package') service = s as PackageSlot;
    },
  } as unknown as PluginContext;

  await new PackageServicePlugin().start(ctx);
  return { kernel, engine, statements, results, warnLogs, service: service! };
}

describe('#10965 service-package over a real booted InMemoryDriver', () => {
  it('the seam has the SHAPE of a seam and answers nothing — the two the guard separates', async () => {
    const stack = await bootMemoryStack();
    try {
      // The half that made the conflation invisible: `start()`'s own gate asks
      // whether `execute` is callable, and on this driver it is.
      expect(stack.engine.execute, 'the shape test still passes — that is the defect').toBeTypeOf('function');

      // The half the guard now asks about: the driver accepts the statement
      // and hands back no result set at all.
      await expect(stack.engine.execute({ sql: 'select 1 as os_seam_probe' })).resolves.toBeNull();

      // And the hydration gate it had to get past is genuinely open, so the
      // boot loop below really does run.
      expect(typeof stack.engine.registry?.installPackage).toBe('function');
      expect(typeof stack.engine.registry?.getPackage).toBe('function');
    } finally {
      await stack.kernel.shutdown();
    }
  }, 120_000);

  it('boot REACHES the list read — the card’s unverified half, measured', async () => {
    const stack = await bootMemoryStack();
    try {
      const listStatement = stack.statements.find((s) => /^SELECT \* FROM sys_packages WHERE \(id, created_at\) IN/.test(s));
      expect(listStatement, 'start() issues the latest-per-id SELECT that backs list()').toBeDefined();

      // …and the driver answered every one of them with no result set, which
      // is what `normalizeRows` used to flatten to "no packages installed".
      expect(stack.results.length).toBeGreaterThan(0);
      expect(stack.results.every((r) => r === null)).toBe(true);
    } finally {
      await stack.kernel.shutdown();
    }
  }, 120_000);

  it('boot does not brick, and says the durable packages could not be read', async () => {
    const stack = await bootMemoryStack();
    try {
      const skip = stack.warnLogs.find((l) => /hydration from sys_packages SKIPPED/i.test(l));
      expect(skip, 'the silent skip is now audible').toBeDefined();
      expect(skip).toMatch(/not "no packages installed"/);
    } finally {
      await stack.kernel.shutdown();
    }
  }, 120_000);

  it('get() and list() REFUSE with the ADR-0112 envelope instead of answering an absence', async () => {
    const stack = await bootMemoryStack();
    try {
      for (const call of [
        () => stack.service.get('com.acme.crm', 'latest'),
        () => stack.service.get('com.acme.crm', '1.0.0'),
        () => stack.service.list(),
      ]) {
        let thrown: (Error & { code?: string; status?: number }) | undefined;
        try {
          await call();
          throw new Error('expected a refusal, but the call returned');
        } catch (e) {
          thrown = e as Error & { code?: string; status?: number };
        }
        // code AND status — never status alone, and never a bare toThrow().
        expect(thrown!.code).toBe('SERVICE_UNAVAILABLE');
        expect(thrown!.status).toBe(503);
        expect(thrown!.message).toBe(PACKAGE_SEAM_UNREADABLE_MESSAGE);
      }
    } finally {
      await stack.kernel.shutdown();
    }
  }, 120_000);
});
