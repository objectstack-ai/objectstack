// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D3, C2 stage S7] Under `single`, a position created or edited in
// Setup is written through to the environment ledger, and the positions Setup
// wrote before that are backfilled into it once — over the real showcase
// composition, through the real data door and the real metadata door.
//
// ## What was missing
//
// Measured on `origin/main` before this stage: `POST /api/v1/data/sys_position`
// answered 201 and wrote a row and nothing else — no `sys_metadata` row, and the
// security catalog read (`createSecurityCatalogReader`) did not resolve the name.
// A metadata-door save of a position, conversely, got its row only at the next
// boot. A Setup position had no registry home, so the planned read switch
// (stage S8) would stop it granting.
//
// ## What the pins hold
//
//  - a Setup create: 201, its row, an environment-scoped `sys_metadata` row,
//    and the catalog read resolves it; a rename moves the definition; a delete
//    removes both;
//  - a create named outside the metadata door's grammar is refused with the
//    door's own answer (400 INVALID_REQUEST, 422 INVALID_METADATA) and keeps no
//    row (seat re-rule Q1 = A);
//  - a Setup edit of a position the showcase package declares lands exactly as
//    before, with nothing written to metadata (Q2 = A);
//  - a package registering a name a Setup position now holds in the
//    environment ledger is refused 422 NAMESPACE_CONFLICT (Q3 = A);
//  - the backfill: on a deployment upgraded from before the stage (row-only
//    positions, no verdict in `sys_migration`), the next boot gives each
//    row-only position its definition and records the verdict; a name the
//    metadata door refuses stays row-only as the final reported class; a third
//    boot changes nothing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { createSecurityCatalogReader } from '@objectstack/core';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative refs resolve against the cwd — see the sibling cold-boot files. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const SYS = { context: { isSystem: true } } as const;
/** The backfill's ledger row (`position-environment-backfill.ts`). */
const LEDGER_ID = 'adr-0131-position-environment-backfill';
/** A position the showcase package declares. */
const SHIPPED = 'manager';

describe('[ADR-0131 D3] Setup positions reach the environment ledger under single (showcase)', () => {
  let prevCwd: string;
  let dir: string;
  let db: string;
  let stack: VerifyStack | undefined;
  let token: string;
  let ql: any;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack!.apiAs(token, method, path, body);
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, code: json?.code ?? json?.error?.code ?? null, json };
  };
  const rows = async (name: string) => ql.find('sys_position', { where: { name }, limit: 10 }, SYS);
  const envRows = async (name: string) =>
    ((await ql.find('sys_metadata', { where: { type: 'position', name }, limit: 10 }, SYS)) as any[])
      .map((r) => ({ organization_id: r.organization_id ?? null, state: r.state }));
  const resolves = async (name: string) => {
    const reader = createSecurityCatalogReader({ registry: ql.registry, metadata: stack!.kernel.getService('metadata') });
    const entry = await reader.resolve('position', name);
    return entry !== undefined && entry.name === name;
  };
  const start = async () => {
    stack = await bootStack(showcaseStack, { databaseFile: db });
    token = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  };

  beforeAll(async () => {
    prevCwd = process.cwd();
    process.chdir(SHOWCASE_DIR);
    dir = mkdtempSync(join(tmpdir(), 'dogfood-15196-s7-'));
    db = join(dir, 'showcase.db');
    await start();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop();
    if (prevCwd) process.chdir(prevCwd);
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('PRECONDITION: the boot runs the single posture', () => {
    expect(stack!.tenancy().requestedPosture).toBe('single');
  });

  it('a Setup create lands its row and an environment definition the catalog read resolves', async () => {
    const created = await call('POST', '/data/sys_position', {
      name: 's7_regional_lead', label: 'Regional lead', description: 'Leads a region',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect((await rows('s7_regional_lead')).length).toBe(1);
    expect(await envRows('s7_regional_lead')).toEqual([{ organization_id: null, state: 'active' }]);
    expect(await resolves('s7_regional_lead')).toBe(true);
  });

  it('a rename moves the definition, and a delete removes the row and the definition', async () => {
    await call('POST', '/data/sys_position', { name: 's7_night_lead', label: 'Night lead' });
    const [row] = await rows('s7_night_lead');
    const renamed = await call('PATCH', `/data/sys_position/${row.id}`, { name: 's7_evening_lead' });
    expect(renamed.status, JSON.stringify(renamed.json)).toBe(200);
    expect(await envRows('s7_night_lead')).toEqual([]);
    expect(await envRows('s7_evening_lead')).toEqual([{ organization_id: null, state: 'active' }]);
    expect({ old: await resolves('s7_night_lead'), neu: await resolves('s7_evening_lead') }).toEqual({ old: false, neu: true });

    const deleted = await call('DELETE', `/data/sys_position/${row.id}`);
    expect(deleted.status, JSON.stringify(deleted.json)).toBe(200);
    expect(await rows('s7_evening_lead')).toEqual([]);
    expect(await envRows('s7_evening_lead')).toEqual([]);
    expect(await resolves('s7_evening_lead')).toBe(false);
  });

  it('Q1: a create named outside the metadata door grammar answers the door\'s refusal and keeps no row', async () => {
    const spaced = await call('POST', '/data/sys_position', { name: 'S7 Lead', label: 'x' });
    expect({ status: spaced.status, code: spaced.code }).toEqual({ status: 400, code: 'INVALID_REQUEST' });
    const dotted = await call('POST', '/data/sys_position', { name: 's7.lead', label: 'x' });
    expect({ status: dotted.status, code: dotted.code }).toEqual({ status: 422, code: 'INVALID_METADATA' });
    expect(await rows('S7 Lead')).toEqual([]);
    expect(await rows('s7.lead')).toEqual([]);
  });

  it('Q2: a Setup edit of a position the showcase package declares lands as before, with nothing in metadata', async () => {
    const [row] = await rows(SHIPPED);
    expect(row?.id, 'the showcase declares the position').toBeTruthy();
    const edited = await call('PATCH', `/data/sys_position/${row.id}`, { label: 'Manager (edited)' });
    expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    expect((await rows(SHIPPED))[0]?.label).toBe('Manager (edited)');
    expect(await envRows(SHIPPED)).toEqual([]);
  });

  it('Q3: a package registering a name a Setup position holds is refused 422 NAMESPACE_CONFLICT', async () => {
    let thrown: any = null;
    try {
      ql.registry.registerItem('position', { name: 's7_regional_lead', label: 'Pkg' }, 'name', 'com.dogfood.s7');
    } catch (e) { thrown = e; }
    expect({ code: thrown?.code, status: thrown?.status }).toEqual({ code: 'NAMESPACE_CONFLICT', status: 422 });
  });

  it('the backfill: an upgraded deployment\'s row-only positions get their definitions on the next boot, once', async () => {
    // The upgraded shape: rows the pre-stage data door wrote (system writes are
    // never translated), and no backfill verdict in the ledger.
    await ql.insert('sys_position', [
      { id: 'pos_s7_legacy', name: 's7_legacy_lead', label: 'Legacy lead' },
      { id: 'pos_s7_illegal', name: 'S7 Legacy', label: 'Illegal name' },
    ], SYS);
    await ql.delete('sys_migration', { where: { id: LEDGER_ID }, ...SYS });
    expect({ legacy: await resolves('s7_legacy_lead'), illegal: await resolves('S7 Legacy') })
      .toEqual({ legacy: false, illegal: false });

    await stack!.stop();
    await start();
    expect(await envRows('s7_legacy_lead')).toEqual([{ organization_id: null, state: 'active' }]);
    expect(await resolves('s7_legacy_lead')).toBe(true);
    expect(await resolves('S7 Legacy'), 'a name the door refuses stays row-only, reported').toBe(false);
    const ledger = (await ql.find('sys_migration', { where: { id: LEDGER_ID }, limit: 2 }, SYS)) as any[];
    expect(ledger.length).toBe(1);
    expect(JSON.parse(ledger[0].details)).toMatchObject({ backfilled: 1, refusedName: 1 });

    await stack!.stop();
    await start();
    expect(await envRows('s7_legacy_lead'), 'a third boot writes nothing').toEqual([{ organization_id: null, state: 'active' }]);
    expect(((await ql.find('sys_migration', { where: { id: LEDGER_ID }, limit: 2 }, SYS)) as any[]).length).toBe(1);
  }, 300_000);
});
