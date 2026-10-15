// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `restoreMetadataFromDb` names the fix that matches WHY `sys_metadata` could
 * not be read.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * A production boot with no datasource declared and no driver registered reads
 * `sys_metadata` through an engine that has nowhere to read it from, and the
 * outage line ended "Fix: check the datasource behind sys_metadata —
 * connection, credentials, and that the table exists". There is no datasource
 * to check and no credential to fix: the operator was sent hunting for a store
 * nobody configured, with the real remedies (a database URL, a driver plugin,
 * the dev store) nowhere on the line.
 *
 * ---------------------------------------------------------------------------
 * What is pinned
 * ---------------------------------------------------------------------------
 *  (a) NO STORAGE — nothing serves `sys_metadata`, no datasource declared: the
 *      line says so, names the three storage remedies the CLI's `⚠ No storage:`
 *      line names, keeps the consequence, stays at `error`, and does NOT send
 *      the operator to a datasource.
 *  (b) CONTROL — a datasource EXISTS and the read still failed: the line is the
 *      datasource remedy, byte for byte as it was. Three ways a datasource can
 *      be there: a registered driver whose read failed; a named binding whose
 *      driver is missing; a declared datasource the connection layer could not
 *      use.
 *
 * The verdict is read off the real engine (`ObjectQL`) in every case, never off
 * a double that answers what the test wants. The protocol is a double that
 * returns `storeUnavailable: true` for the consumer-half cases, and the REAL
 * protocol over the real engine for the two reach cases, which prove the engine
 * state a driverless / failing-driver boot has is the state the verdict reads.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ablate the branch condition (`sysMetadataHasNoStorage` answering `false`):
 * every (a) case goes RED — the line is the datasource remedy again — while
 * every (b) control stays GREEN, because it never depended on the new arm.
 * Ablate it the other way (answering `true`): every (b) case goes RED and (a)
 * stays green. Both are ordinary directions, no inversion.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataObject } from '@objectstack/metadata-core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

type AnyRecord = Record<string, any>;

/** The three remedies of the CLI's `⚠ No storage:` line, copied from it verbatim. */
const REMEDIES = [
  'set OS_DATABASE_URL (e.g. file:./data/app.db, or a postgres:// or mysql:// URL)',
  "mount a storage driver in the stack's plugins (e.g. new DriverPlugin(driver) from @objectstack/runtime)",
  'run with --dev (an in-memory SQLite store, for development)',
];

const DATASOURCE_REMEDY =
  'Fix: check the datasource behind sys_metadata — connection, credentials, and that the table exists — then restart.';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCtx(protocol: unknown) {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getService: vi.fn((name: string) => {
      if (name === 'protocol') return protocol;
      throw new Error(`service '${name}' not registered`);
    }),
    hook: vi.fn(),
  } as AnyRecord;
}

/** A protocol whose boot read reported the store unreadable — the consumer's input. */
const unreadableStore = () => ({
  loadMetaFromDb: vi.fn(async () => ({ loaded: 0, errors: 0, invalid: 0, storeUnavailable: true })),
});

/** A real engine with NO datasource and NO driver — what a production boot with no storage holds. */
function engineWithoutStorage() {
  return new ObjectQL({ logger: { debug() {}, info() {}, warn() {}, error() {} } } as any);
}

/**
 * The same engine with the platform's `sys_metadata` object registered, as every
 * real boot has it: without the object the real protocol's read fails earlier,
 * on "Object 'sys_metadata' not found", which is not the failure under test.
 */
function withSysMetadata(engine: ObjectQL): ObjectQL {
  engine.registry.registerObject(SysMetadataObject as any, 'test-package');
  return engine;
}

/** A driver that is registered and whose every read fails the way a bad credential does. */
function failingDriver(name = 'primary'): IDataDriver {
  const refuse = async () => {
    throw new Error('password authentication failed for user "app"');
  };
  return {
    name,
    version: '0.0.0',
    supports: {},
    find: refuse,
    findOne: refuse,
    count: refuse,
  } as unknown as IDataDriver;
}

/** Run the boot hydration on `engine` and hand back the single ERROR line it logged. */
async function hydrate(engine: ObjectQL, protocol: unknown): Promise<{ ctx: AnyRecord; line: string }> {
  const ctx = makeCtx(protocol);
  await (new ObjectQLPlugin({ ql: engine }) as any).restoreMetadataFromDb(ctx);
  const errors: string[] = ctx.logger.error.mock.calls.map((c: unknown[]) => String(c[0]));
  expect(errors, 'exactly one ERROR line is the outage statement').toHaveLength(1);
  return { ctx, line: errors[0] };
}

/** The consequence sentence and the level — the parts that must NOT move with the cause. */
function expectConsequenceKept(ctx: AnyRecord, line: string) {
  expect(line).toMatch(/NOT restored/);
  expect(line).toMatch(/healthy/);
  expect(line).toContain('Every overlay object, view, app, permission and hook stored in the database is absent');
  expect(line).toMatch(/provisioned/);
  expect(ctx.logger.error).toHaveBeenCalledWith(expect.any(String), undefined, { loaded: 0, errors: 0, invalid: 0 });
}

describe('restoreMetadataFromDb — (a) no storage: the line names the storage remedies', () => {
  it('says no storage is configured, names the three remedies, and does not send the operator to a datasource', async () => {
    const { ctx, line } = await hydrate(engineWithoutStorage(), unreadableStore());

    expect(line).toMatch(/^sys_metadata could NOT be read at boot — no storage is configured: /);
    expect(line).toContain('no datasource is declared and no driver is registered');
    for (const remedy of REMEDIES) expect(line).toContain(remedy);
    expect(line).toContain(`Fix: ${REMEDIES[0]}; ${REMEDIES[1]}; or ${REMEDIES[2]} — then restart.`);

    // The wrong remedy is gone, not merely joined by the right ones.
    expect(line).not.toContain('check the datasource behind sys_metadata');
    expect(line).not.toMatch(/credentials/);

    // Still the durability ERROR it was: level, consequence, counts.
    expectConsequenceKept(ctx, line);
  });

  it('reach: the REAL protocol over a driverless engine reports an unreadable store, and the line is the no-storage one', async () => {
    // Proves the premise at the engine, not at a double: an engine with no
    // driver really does fail the boot read (so `storeUnavailable` is what the
    // card's operator saw), and the engine state it holds is what the verdict
    // reads.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = withSysMetadata(engineWithoutStorage());
    const protocol = new ObjectStackProtocolImplementation(engine as any);

    const { line } = await hydrate(engine, protocol);

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/DB hydration skipped: .*No driver available for object 'sys_metadata'/);
    expect(line).toContain('no storage is configured');
    expect(line).not.toContain('check the datasource behind sys_metadata');
  });
});

describe('restoreMetadataFromDb — (b) CONTROL: a datasource exists and its read failed — the datasource remedy, unchanged', () => {
  it('a registered driver whose read fails keeps the datasource arm', async () => {
    const engine = engineWithoutStorage();
    engine.registerDriver(failingDriver(), true);

    const { ctx, line } = await hydrate(engine, unreadableStore());

    expect(line).toMatch(/^sys_metadata could NOT be read at boot — persisted metadata was NOT restored, and this kernel will keep reporting healthy\. /);
    expect(line).toContain(DATASOURCE_REMEDY);
    expect(line).not.toContain('no storage is configured');
    for (const remedy of REMEDIES) expect(line).not.toContain(remedy);
    expectConsequenceKept(ctx, line);
  });

  it('reach: the REAL protocol over an engine whose driver refuses the read keeps the datasource arm', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = withSysMetadata(engineWithoutStorage());
    engine.registerDriver(failingDriver(), true);
    const protocol = new ObjectStackProtocolImplementation(engine as any);

    const { line } = await hydrate(engine, protocol);

    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/DB hydration skipped: .*password authentication failed/);
    expect(line).toContain(DATASOURCE_REMEDY);
    expect(line).not.toContain('no storage is configured');
  });

  it('sys_metadata bound to a named datasource whose driver is missing keeps the datasource arm', async () => {
    // The datasource is declared (the object names it), so "no datasource is
    // declared" would be false; no driver serves it, so "check the datasource"
    // is the true instruction.
    const engine = engineWithoutStorage();
    engine.registerObject({
      name: 'sys_metadata',
      label: 'Metadata',
      datasource: 'warehouse',
      fields: { id: { type: 'text' } },
    } as any);

    const { line } = await hydrate(engine, unreadableStore());

    expect(line).toContain(DATASOURCE_REMEDY);
    expect(line).not.toContain('no storage is configured');
  });

  it('a declared datasource the connection layer could not use keeps the datasource arm', async () => {
    // A default datasource that failed to connect (or was refused by the host
    // policy) leaves NO driver registered — indistinguishable from "no storage"
    // by drivers alone. The engine was told it exists and why it is unusable.
    const engine = engineWithoutStorage();
    engine.markDatasourceUnavailable({ name: 'default', kind: 'failed' });

    const { line } = await hydrate(engine, unreadableStore());

    expect(line).toContain(DATASOURCE_REMEDY);
    expect(line).not.toContain('no storage is configured');
  });
});
