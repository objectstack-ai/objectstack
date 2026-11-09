// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns the real producer once per single-cause fixture: four `os serve` boots, one per declaration spelling and gate state; local card-container reading 29.04 s of test time (no CI reading yet), x 1.25, rounded up

/**
 * `os serve` asks the multi-node gate about the topology the operator DECLARED,
 * in EITHER spelling of the declaration — asserted over the real `os serve`
 * process.
 *
 * ## The defect
 *
 * A multi-node topology has two spellings, both read by `declaresMultiNode`
 * (`@objectstack/service-cluster`, `split-brain-guard.ts`):
 * `OS_CLUSTER_REPLICAS>1` and `OS_EXPECT_MULTI_NODE=true`. With no gate
 * registered, the gate refuses a declared topology (fail closed: multi-node is
 * a licensed capability). But `serve` asked it with
 * `Number(process.env.OS_CLUSTER_REPLICAS)` alone, so a topology declared only
 * as `OS_EXPECT_MULTI_NODE=true` reached the gate as `NaN` — "not declared" —
 * and the remote driver booted multi-node with no gate at all, while the same
 * deployment spelled `OS_CLUSTER_REPLICAS=2` was refused.
 *
 * ## What each case pins
 *
 *   1. `OS_EXPECT_MULTI_NODE=true` + redis + no gate → the gate refuses (its
 *      own no-gate reason in the boot warning) and the boot is REFUSED by the
 *      split-brain guard on the in-process fallback. Red before the fix: the
 *      gate allowed and no refusal line was printed.
 *   2. CONTROL, single node (nothing declared) + redis + no gate → boots, and
 *      the gate prints nothing.
 *   3. CONTROL, `OS_CLUSTER_REPLICAS=2` + redis + no gate → refused exactly as
 *      before the fix.
 *   4. CONTROL, `OS_EXPECT_MULTI_NODE=true` + redis + a REGISTERED gate that
 *      admits whatever it is asked → boots. The gate prints the count it was
 *      asked, so the case also reads the count the fix chose for "declared,
 *      count unknown" (2).
 *
 * ## The fixture
 *
 * The app's `@objectstack/service-cluster` re-exports the framework's REAL ESM
 * entry, so the gate under test — `checkMultiNodeAllowed`, its no-gate refusal
 * and `declaresMultiNode` — is the shipped code, not a stand-in; case 4 adds one
 * `registerMultiNodeGate` call into that same module instance. The app's
 * `@objectstack/service-cluster-redis` is a stand-in that registers a `redis`
 * driver delegating to the in-process `memory` one: this file measures the
 * gate's verdict, never a transport, so no Redis server is needed. Because the
 * composed driver is honestly in-process, the split-brain guard refuses every
 * declared topology that reaches it; case 4 therefore sets
 * `OS_ALLOW_MEMORY_CLUSTER_MULTINODE=true` (the guard's own escape hatch) so
 * that "admitted by the gate" can be read as a completed boot.
 *
 * ## Several replicas over a database local to each one (second `describe`)
 *
 * The same fixture and declaration, read by a second refusal: several replicas
 * declared over redis (`declaresMultiReplicaOnRedis`) cannot each open their
 * own SQLite or sqlite-wasm file, so `serve` refuses the boot with exit 1 and
 * names a Postgres `OS_DATABASE_URL`, ahead of the split-brain guard. The
 * CONTROL boots the same `file:` database with nothing declared. Which
 * resolutions count as local (libSQL over a server URL does not) is pinned
 * beside `serve.ts`, in `serve-multi-replica-local-database.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runServe } from './helpers/serve-process.js';

const CLUSTER = '@objectstack/service-cluster';
const DRIVER_NAME = 'redis';
const DRIVER = `${CLUSTER}-${DRIVER_NAME}`;

/** What the registered gate of case 4 prints, followed by the count it was asked. */
const GATE_ASKED = '[fixture] multi-node gate asked for';

/** The split-brain guard's refusal (`assertClusterDriverSafeForTopology`), by its opening words. */
const GUARD_REFUSAL = 'ClusterServicePlugin: multi-node deployment declared';

/** The gate-denial line `serve` prints, by its opening words. */
const GATE_DENIAL = '[cluster] multi-node not authorized (';

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.multinodegate',
    namespace: 'multinodegate',
    version: '1.0.0',
    type: 'app',
    name: 'Multi-Node Gate Declaration Fixture',
  },
};
`;

/**
 * The framework's own `@objectstack/service-cluster` ESM entry, found from
 * `@objectstack/runtime` (which declares it; `packages/cli` deliberately does
 * not) and read through the package's own `exports["."].import` — the CJS twin
 * `require.resolve` answers with is a different module instance with a
 * different gate and driver registry.
 */
function frameworkClusterEsmEntry(): string {
  const runtimeEntry = createRequire(import.meta.url).resolve('@objectstack/runtime');
  const clusterEntry = createRequire(runtimeEntry).resolve(CLUSTER);
  let dir = dirname(clusterEntry);
  for (;;) {
    let manifest: { name?: string; exports?: Record<string, { import?: string | { default?: string } }> } | undefined;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch { /* not a package root — keep climbing */ }
    if (manifest?.name === CLUSTER) {
      const importCondition = manifest.exports?.['.']?.import;
      const entry = typeof importCondition === 'string' ? importCondition : importCondition?.default;
      if (typeof entry !== 'string') throw new Error(`${CLUSTER} at ${dir} declares no ESM entry`);
      return pathToFileURL(realpathSync(resolve(dir, entry))).href;
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`no ${CLUSTER} package.json above ${clusterEntry}`);
    dir = up;
  }
}

function writePackage(nodeModules: string, name: string, source: string): void {
  const dir = join(nodeModules, ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0-fixture', type: 'module', main: 'index.js' }),
    'utf8',
  );
  writeFileSync(join(dir, 'index.js'), source, 'utf8');
}

let frameworkCluster: string;
/** The gate's own no-gate refusal reason, read from the shipped module rather than retyped. */
let noGateReason: string;
const apps: string[] = [];

beforeAll(async () => {
  frameworkCluster = frameworkClusterEsmEntry();
  const mod = (await import(frameworkCluster)) as { MULTI_NODE_NO_GATE_REASON?: unknown };
  if (typeof mod.MULTI_NODE_NO_GATE_REASON !== 'string') {
    throw new Error(`${frameworkCluster} exports no MULTI_NODE_NO_GATE_REASON — rebuild ${CLUSTER}`);
  }
  noGateReason = mod.MULTI_NODE_NO_GATE_REASON;
});

afterAll(() => {
  for (const dir of apps) rmSync(dir, { recursive: true, force: true });
});

/** An app declaring both cluster packages; `gate` registers an admitting gate. */
function writeApp(prefix: string, gate: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), `os-multinode-gate-${prefix}-`));
  apps.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      { name: 'multinode-gate-fixture', private: true, type: 'module', dependencies: { [CLUSTER]: '*', [DRIVER]: '*' } },
      null,
      2,
    ),
    'utf8',
  );
  const nodeModules = join(dir, 'node_modules');
  const url = JSON.stringify(frameworkCluster);
  writePackage(
    nodeModules,
    CLUSTER,
    `export * from ${url};\n`
    + (gate
      ? `import { registerMultiNodeGate } from ${url};\n`
        + 'registerMultiNodeGate({ allowMultiNode(requested) {\n'
        + `  console.error(${JSON.stringify(`${GATE_ASKED} `)} + String(requested));\n`
        + '  return { allowed: true };\n'
        + '} });\n'
      : ''),
  );
  writePackage(
    nodeModules,
    DRIVER,
    `import { defineCluster, registerClusterDriver } from ${url};\n`
    + `registerClusterDriver(${JSON.stringify(DRIVER_NAME)}, (config) => defineCluster({ driver: 'memory', nodeId: config.nodeId }));\n`,
  );
  return dir;
}

/** Boot once; `booted` is true only when the child printed a complete banner with the port it bound. */
async function boot(prefix: string, gate: boolean, env: Record<string, string | undefined>) {
  const dir = writeApp(prefix, gate);
  const run = await runServe(dir, [], {
    waitFor: /Press Ctrl\+C to stop|multi-node deployment declared/,
    timeoutMs: 150_000,
    env: {
      OS_CLUSTER_DRIVER: DRIVER_NAME,
      // Every case states both spellings, so an inherited value cannot decide one.
      OS_EXPECT_MULTI_NODE: undefined,
      OS_CLUSTER_REPLICAS: undefined,
      OS_ALLOW_MEMORY_CLUSTER_MULTINODE: undefined,
      ...env,
    },
  });
  return { out: `${run.stderr}\n${run.stdout}`, booted: run.port !== undefined };
}

/** One real `serve` boot per case. */
const BOOT_TIMEOUT = 180_000;

describe('os serve → multi-node gate reads both spellings of the declaration', () => {
  it('REFUSES OS_EXPECT_MULTI_NODE=true over redis when no gate is registered', async () => {
    const { out, booted } = await boot('expect-nogate', false, { OS_EXPECT_MULTI_NODE: 'true' });

    // The gate was asked about a DECLARED topology and refused it for its own
    // stated reason …
    expect(out).toContain(`${GATE_DENIAL}${noGateReason})`);
    // … so the remote driver was dropped and the split-brain guard refused the
    // in-process fallback: the boot did not come up.
    expect(out).toContain(GUARD_REFUSAL);
    expect(booted).toBe(false);
  }, BOOT_TIMEOUT);

  it('CONTROL: a single-node boot over redis with no gate is unchanged — it boots, the gate says nothing', async () => {
    const { out, booted } = await boot('single', false, {});

    expect(booted).toBe(true);
    expect(out).not.toContain(GATE_DENIAL);
    expect(out).not.toContain(GUARD_REFUSAL);
  }, BOOT_TIMEOUT);

  it('CONTROL: OS_CLUSTER_REPLICAS=2 over redis with no gate is refused, as before', async () => {
    const { out, booted } = await boot('replicas-nogate', false, { OS_CLUSTER_REPLICAS: '2' });

    expect(out).toContain(`${GATE_DENIAL}${noGateReason})`);
    expect(out).toContain(GUARD_REFUSAL);
    expect(booted).toBe(false);
  }, BOOT_TIMEOUT);

  it('CONTROL: a registered gate that admits the topology still boots OS_EXPECT_MULTI_NODE=true', async () => {
    const { out, booted } = await boot('expect-gate', true, {
      OS_EXPECT_MULTI_NODE: 'true',
      // The composed driver is in-process by construction (see the header).
      OS_ALLOW_MEMORY_CLUSTER_MULTINODE: 'true',
    });

    // Asked with the smallest multi-node count — a declared topology whose
    // count was not given — and admitted.
    expect(out).toContain(`${GATE_ASKED} 2`);
    expect(out).not.toContain(GATE_DENIAL);
    expect(booted).toBe(true);
  }, BOOT_TIMEOUT);
});

/** The local-database refusal (`multiReplicaLocalDatabaseRefusal` in `serve.ts`), by its opening words. */
const LOCAL_DATABASE_REFUSAL = '[database] Refusing to start: several replicas are declared';

/** The remedy that refusal names. */
const POSTGRES_REMEDY = 'OS_DATABASE_URL=postgres://';

/**
 * Boot once and let the child run until it prints its banner or EXITS on its
 * own, so a refusal's exit code is the child's and not a signal's.
 */
async function bootToExit(prefix: string, env: Record<string, string | undefined>) {
  const dir = writeApp(prefix, false);
  const run = await runServe(dir, [], {
    waitFor: /Press Ctrl\+C to stop/,
    timeoutMs: 150_000,
    env: {
      OS_CLUSTER_DRIVER: DRIVER_NAME,
      OS_EXPECT_MULTI_NODE: undefined,
      OS_CLUSTER_REPLICAS: undefined,
      OS_ALLOW_MEMORY_CLUSTER_MULTINODE: undefined,
      OS_DATABASE_URL: undefined,
      OS_DATABASE_DRIVER: undefined,
      DATABASE_URL: undefined,
      TURSO_DATABASE_URL: undefined,
      // `<app>` in a value is the fixture app's own directory.
      ...Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value?.replace('<app>', dir)])),
    },
  });
  return { out: `${run.stderr}\n${run.stdout}`, booted: run.port !== undefined, exitCode: run.exitCode };
}

describe('os serve → several replicas declared over redis refuse a database local to each replica', () => {
  it('REFUSES OS_DATABASE_URL=file:… with OS_CLUSTER_REPLICAS=2 — exit 1, naming a Postgres OS_DATABASE_URL', async () => {
    const { out, booted, exitCode } = await bootToExit('db-file', {
      OS_DATABASE_URL: 'file:<app>/app.db',
      OS_CLUSTER_REPLICAS: '2',
    });

    expect(out).toContain(LOCAL_DATABASE_REFUSAL);
    expect(out).toContain(POSTGRES_REMEDY);
    expect(booted).toBe(false);
    expect(exitCode).toBe(1);
    // Refused before the boot reached the split-brain guard: the database is
    // the cause named, the guard's own refusal is not the one printed.
    expect(out).not.toContain(GUARD_REFUSAL);
  }, BOOT_TIMEOUT);

  it('REFUSES the SQLite default (no OS_DATABASE_URL) and sqlite-wasm the same way', async () => {
    for (const [prefix, url] of [['db-default', undefined], ['db-wasm', 'file:<app>/app.wasm.db']] as const) {
      const { out, booted, exitCode } = await bootToExit(prefix, {
        ...(url ? { OS_DATABASE_URL: url } : {}),
        OS_CLUSTER_REPLICAS: '2',
      });
      expect(out, prefix).toContain(LOCAL_DATABASE_REFUSAL);
      expect(out, prefix).toContain(POSTGRES_REMEDY);
      expect(booted, prefix).toBe(false);
      expect(exitCode, prefix).toBe(1);
    }
  }, BOOT_TIMEOUT * 2);

  it('CONTROL: the same file: database with nothing declared boots as before', async () => {
    const { out, booted } = await bootToExit('db-file-single', { OS_DATABASE_URL: 'file:<app>/app.db' });

    expect(booted).toBe(true);
    expect(out).not.toContain(LOCAL_DATABASE_REFUSAL);
  }, BOOT_TIMEOUT);
});
