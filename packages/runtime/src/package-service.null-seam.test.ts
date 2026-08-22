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
 * `@objectstack/service-package` is a devDependency and this package's
 * `vitest.config.ts` already aliases it to `src/` for exactly this reason (the
 * `#5047` rehydration pin next door). `service-package` itself depends on
 * neither the engine nor a driver, so the same boot cannot be written inside it.
 *
 * ## Why the driver here is a LOCAL DOUBLE, not `@objectstack/driver-memory`
 *
 * The first version of this file booted the real `InMemoryDriver`. That made it
 * a THIRD consumer of a package whose investment is frozen (#5499), arriving
 * after #5704 migrated the test backends and #6664 replaced the prose census
 * with a ledger — and `check:driver-memory-census` refused it, correctly.
 *
 * The disposition taken was MIGRATE, not ledger. The two consumers a maintainer
 * ruled permanent are both kept because nothing can stand in for them: one needs
 * the SCHEMALESS arm of a divergence pin, the other needs a driver whose
 * `supports = {}` hands autonumber seeding back to the engine. Neither shape is
 * what this file needs. What it needs is a seam whose `execute()` RETURNS
 * without answering — one return value, not a capability profile — and
 * `packages/objectql/src/protocol-recorded-by-null.test.ts` already models
 * exactly that with a local `makeStubDriver` carrying `async execute() { return
 * null; }`. `makeStubDriver` is itself the convention #5704/#5784 established so
 * that grepping for the driver lands on real consumers only.
 *
 * ⚠️ **What the double does NOT model.** It is not evidence about
 * `@objectstack/driver-memory`'s behaviour. That the real driver logs
 * `Raw execution not supported in InMemory driver` and returns `null` was
 * measured on a real boot while triaging #10965, and it stays pinned on a real
 * booted driver by `packages/cli/src/commands/migrate/duplicates.null-seam.test.ts`
 * (#10677), which reaches it through the datasource factory rather than by
 * importing it. Nothing about that fact is re-asserted here, and this file would
 * not notice if that driver changed. What it models is the SHAPE — a seam that
 * accepts a statement and returns no result set — which is the only property the
 * guard under test keys on, and which the implementation deliberately judges by
 * return value rather than by driver identity.
 *
 * ## Measured on a real booted `InMemoryDriver`, before the fix (framework
 * `2866d5f97`) — the triage measurement this file is the regression pin for
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
 * ⭐ What this pins is NOT "some named driver is refused". It is the separation
 * the guard keys on: **a seam that cannot ANSWER is absent, not empty.** No
 * driver is named by the implementation — the seam is judged by what it
 * returns — so the double below is judged by the same rule any real host is.
 *
 * No real driver is asserted anywhere in this file, by construction: every
 * driver-specific claim would be a false pin over a backend this suite does not
 * load.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
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

/**
 * A seam that ACCEPTS a statement and returns no result set.
 *
 * The whole double, and deliberately the smallest thing that can be one: the
 * engine's `execute` delegates straight to `driver.execute(...)` after checking
 * only that the method EXISTS (`packages/objectql/src/engine.ts:11687`), which
 * is the half of the defect that made the conflation invisible — the shape test
 * passes and the answer never arrives.
 *
 * `execute` returning `null` is the measured `InMemoryDriver` return, modelled
 * here the way `protocol-recorded-by-null.test.ts`'s own `makeStubDriver` models
 * it. The rest of the surface exists so `kernel.bootstrap()` completes; nothing
 * below `execute` is asserted on.
 */
function makeNonAnsweringDriver() {
  const driver = {
    name: 'stub-non-answering',
    version: '0.0.0',
    supports: {},
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    /** ⭐ The one behaviour under test: it RETURNS, and it does not answer. */
    async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async count() { return 0; },
    async create(_object: string, data: Record<string, unknown>) { return data; },
    async update(_object: string, _id: unknown, data: Record<string, unknown>) { return data; },
    async delete() { return true; },
  };
  return driver;
}

interface BootedStack {
  kernel: LiteKernel;
  engine: ObjectQlSlot;
  statements: string[];
  results: unknown[];
  warnLogs: string[];
  service: PackageSlot;
}

/**
 * The zero-install stack: REAL kernel, REAL ObjectQL engine and registry, REAL
 * `PackageServicePlugin.start()` — with the non-answering seam supplied by the
 * double above. Everything the guard is judged against is real except the one
 * property being modelled.
 */
async function bootNonAnsweringStack(): Promise<BootedStack> {
  const kernel = new LiteKernel({ logger: { level: 'error' } });
  kernel.use(new ObjectQLPlugin({}));
  kernel.use(new DriverPlugin(makeNonAnsweringDriver()));
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

describe('#10965 service-package over a booted engine whose seam never answers', () => {
  it('the seam has the SHAPE of a seam and answers nothing — the two the guard separates', async () => {
    const stack = await bootNonAnsweringStack();
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
    const stack = await bootNonAnsweringStack();
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
    const stack = await bootNonAnsweringStack();
    try {
      const skip = stack.warnLogs.find((l) => /hydration from sys_packages SKIPPED/i.test(l));
      expect(skip, 'the silent skip is now audible').toBeDefined();
      expect(skip).toMatch(/not "no packages installed"/);
    } finally {
      await stack.kernel.shutdown();
    }
  }, 120_000);

  it('get() and list() REFUSE with the ADR-0112 envelope instead of answering an absence', async () => {
    const stack = await bootNonAnsweringStack();
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
