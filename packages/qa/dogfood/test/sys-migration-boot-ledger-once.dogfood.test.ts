// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22099] Every row of the `sys_migration` ledger is written ONCE across a
// fresh database's first two boots, and neither boot logs a warning that names
// the ledger — enumerated from the table's own rows, over the real boot.
//
// ## Why an enumeration, and why here
//
// This is the third false `sys_migration` warning a fresh boot printed: #20648
// (a paged read on an upgraded database), #20768 (a read before the table
// exists) and #22099 (plugin-auth's owner-bind gate re-entering itself, so the
// inner call recorded first and the outer call's accurate record was refused by
// the primary key — a warning and a stack on every first boot, and a ledger row
// naming the wrong outcome). Each was found by someone reading boot output.
// The ledger has several writers in several packages, and a new one arrives
// with every one-time pass, so a pin keyed to the ids known today would miss
// the next one. The ids are therefore read from the table after the boots, and
// each one must have been inserted exactly once.
//
// `bootStack` is the cheapest composition that writes the ledger the way a
// served kernel does: `PlatformObjectsPlugin` (the ledger and its fresh-store
// attestations), `AuthPlugin` with its defaults (the owner bind and the
// membership backfill), `SecurityPlugin` (the platform-admin promotion and the
// organization-admin grant that re-entered the owner bind) and the dev admin
// `objectstack dev` seeds. Two boots over one database file make the second a
// genuine cold boot over the first's ledger.
//
// ## What is counted, and how the counts are made non-vacuous
//
//   - Insert ATTEMPTS, not rows: a probe plugin in the harness's `extraPlugins`
//     slot registers an engine middleware that records the id of every
//     `sys_migration` insert before it reaches the driver, refused or not. A
//     refused second insert leaves the row count unchanged, which is exactly
//     why rows alone could not see the defect. An insert that ran before the
//     probe was registered would leave a row with zero attempts — red, not
//     green.
//   - Every line the process writes during each boot (the kernel logger writes
//     to the streams). The control below requires the capture to have parsed an
//     `INFO` line naming the ledger, so an empty capture, or a line format this
//     file no longer parses, cannot pass the absence.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { DATA_MIGRATION_FLAG_OBJECT } from '@objectstack/spec/system';

const LEDGER = DATA_MIGRATION_FLAG_OBJECT;
const SYS = { context: { isSystem: true } } as const;
const OWNER_BIND_ID = 'adr-0093-default-org-owner-bind';

/** An app with nothing in it: every ledger row below is the platform's own. */
const APP = {
  manifest: {
    id: 'com.dogfood.sys-migration-boot-ledger',
    namespace: 'ledgerboot',
    version: '0.0.0',
    type: 'app',
    name: 'Ledger Boot Fixture',
  },
  objects: [],
};

/** Records the id of every ledger insert the engine is asked to make. */
function ledgerInsertProbe(attempts: string[]) {
  return {
    name: 'dogfood.sys-migration-insert-probe',
    async init(ctx: any) {
      const ql = ctx.getService('objectql');
      ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx?.object === LEDGER && (opCtx?.operation === 'insert' || opCtx?.operation === 'create')) {
          const rows = Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data];
          for (const row of rows) attempts.push(String(row?.id));
        }
        await next();
      });
    },
    async start() {},
  };
}

/** Every line the process writes while `run` is in flight. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  const error = console.error;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { chunks.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { chunks.push(`WARN ${args.map(String).join(' ')}\n`); warn(...args); };
  console.error = (...args: unknown[]) => { chunks.push(`ERROR ${args.map(String).join(' ')}\n`); error(...args); };
  try {
    const value = await run();
    return { value, lines: chunks.join('').split('\n') };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
    console.error = error;
  }
}

/** The level of one kernel-logger line (`<ISO time> <LEVEL> <message> …`), or `undefined`. */
function levelOf(line: string): string | undefined {
  return /^(?:\S+Z\s+)?(DEBUG|INFO|WARN|ERROR|FATAL)\b/.exec(line.trim())?.[1];
}

describe('[#22099] a fresh database\'s first two boots write each sys_migration row once, and warn about none', () => {
  let dir: string;
  const attempts: string[][] = [[], []];
  const lines: string[][] = [[], []];
  let rows: Array<{ id: string; details: unknown }> = [];
  let ownerMembers: Array<Record<string, unknown>> = [];
  let stack: VerifyStack | undefined;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-22099-'));
    const databaseFile = join(dir, 'ledger.db');
    for (const boot of [0, 1]) {
      const run = await captureOutput(() =>
        bootStack(APP as never, { databaseFile, extraPlugins: [ledgerInsertProbe(attempts[boot]!)] }),
      );
      stack = run.value;
      lines[boot] = run.lines;
      if (boot === 1) {
        const ql: any = await stack.kernel.getServiceAsync('objectql');
        rows = (await ql.find(LEDGER, { where: {} }, SYS)).map((r: any) => ({ id: String(r.id), details: r.details }));
        ownerMembers = await ql.find('sys_member', { where: { role: 'owner' } }, SYS);
      }
      await stack.stop();
      stack = undefined;
    }
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('control: the ledger has rows, and the capture parsed an INFO line naming it', () => {
    expect(rows.length, `the boots wrote no ${LEDGER} row — every assertion below would be vacuous`).toBeGreaterThan(0);
    const named = lines[0]!.filter((l) => l.includes(LEDGER));
    expect(named.some((l) => levelOf(l) === 'INFO'), `no INFO line naming ${LEDGER} was parsed in boot 1`).toBe(true);
  });

  it('every id in the table was inserted exactly once across both boots — enumerated from the rows', () => {
    const all = [...attempts[0]!, ...attempts[1]!];
    const counts = Object.fromEntries(rows.map((r) => [r.id, all.filter((id) => id === r.id).length]));
    expect(counts).toEqual(Object.fromEntries(rows.map((r) => [r.id, 1])));
    // And nothing was attempted that the table does not hold.
    expect([...new Set(all)].sort()).toEqual(rows.map((r) => r.id).sort());
    // The second boot is a cold boot over a decided ledger: it writes nothing.
    expect(attempts[1]).toEqual([]);
  });

  it(`no line at WARN or above names ${LEDGER}, on either boot`, () => {
    for (const boot of [0, 1]) {
      const loud = lines[boot]!.filter((l) => l.includes(LEDGER) && ['WARN', 'ERROR', 'FATAL'].includes(levelOf(l) ?? ''));
      expect(loud, `boot ${boot + 1}`).toEqual([]);
    }
  });

  it('the owner-bind row records the deciding call\'s outcome, with the organization its owner row names', () => {
    // On this composition the Default Organization exists before the dev admin
    // (ADR-0131 D3), the membership reconciler binds the admin as `member`, and
    // the gate PROMOTES that row — so the accurate outcome is `promoted`. The
    // lost update recorded the re-entrant call's `admin-already-member`, with
    // no organization.
    const row = rows.find((r) => r.id === OWNER_BIND_ID);
    expect(row, `no ${OWNER_BIND_ID} row`).toBeDefined();
    expect(ownerMembers).toHaveLength(1);
    expect(JSON.parse(String(row!.details))).toEqual({
      outcome: 'promoted',
      organizationId: ownerMembers[0]!.organization_id,
    });
  });
});
