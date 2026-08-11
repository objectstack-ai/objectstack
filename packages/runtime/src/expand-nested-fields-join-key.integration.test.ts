// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7537 — `expand` must not degrade to a no-op when the nested `fields` omits `id`.
 *
 * `expandRelatedRecords` forwards `nestedAST.fields` to the sub-`find` verbatim
 * and then keys its `recordMap` on `rec.id`. A nested projection that does not
 * name `id` therefore produced rows with no `id`, an EMPTY map, and an injection
 * that fell through `recordMap.get(String(val)) ?? val` — writing the original
 * foreign key back. Nothing in the response distinguished "expanded" from "not
 * expanded": the field just still held an id, which is a valid-looking value.
 *
 * ## Why this needs a REAL driver
 *
 * The defect is invisible to the drivers most suites reach for. `InMemoryDriver`
 * force-adds the primary key to every projection ("Always include id if not
 * explicitly listed", `memory-driver.ts` `projectFields`), so its rows always
 * carry the join key and the map is never empty. `SqlDriver` emits the requested
 * column list verbatim (`builder.select(query.fields...)`), so it is the side
 * that actually drops `id` — which is why the QA run that found this (#7463) hit
 * it on better-sqlite3 and why the engine's mock-driver unit pins could not.
 * This wires the REAL {@link ObjectQL} engine to the REAL {@link SqlDriver}.
 *
 * ## Why the no-`id` spelling is the one that must work
 *
 * It is PRESCRIBED VERBATIM by two spec retirement messages —
 * `FIELD_NODE_OBJECT_FORM_REMOVED` and `QUERY_JOINS_REMOVED` (`query.zod.ts`)
 * both tell the author to write `expand: { owner: { object: 'user', fields:
 * ['name'] } }`. A caller who does exactly what the error message instructed got
 * a silent no-op, so refusing the mismatch would turn the documented migration
 * target into an error. The join key is added to the sub-read unconditionally
 * (it is machinery, not a caller-chosen column) and stripped from the emitted
 * nested record when the caller did not ask for it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const ACCOUNT = {
  name: 'showcase_account',
  fields: {
    name: { type: 'text' },
    industry: { type: 'text' },
  },
};

const INVOICE = {
  name: 'showcase_invoice',
  fields: {
    name: { type: 'text' },
    account: { type: 'lookup', reference: 'showcase_account' },
  },
};

// The second object pair from the issue's repro — the report confirmed 2/2, so
// both pairs are pinned rather than only the one that was written up first.
const PROJECT = {
  name: 'showcase_project',
  fields: {
    name: { type: 'text' },
  },
};

const TASK = {
  name: 'showcase_task',
  fields: {
    name: { type: 'text' },
    project: { type: 'lookup', reference: 'showcase_project' },
  },
};

describe('#7537 expand with a nested `fields` that omits the join key (REAL SqlDriver)', () => {
  let engine: ObjectQL | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = null;
    if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
  });

  async function boot() {
    dir = mkdtempSync(join(tmpdir(), 'os-expand-7537-'));
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: join(dir, 'data.sqlite') },
      useNullAsDefault: true,
    });
    await driver.initObjects([ACCOUNT, INVOICE, PROJECT, TASK]);
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const obj of [ACCOUNT, INVOICE, PROJECT, TASK]) {
      engine.registry.registerObject(obj as any);
    }
    return engine;
  }

  it('expands with `fields: ["name"]` — the spelling the retirement messages prescribe', async () => {
    const e = await boot();
    const acct: any = await e.insert('showcase_account', { name: 'Acme', industry: 'Manufacturing' });
    await e.insert('showcase_invoice', { name: 'INV-001', account: acct.id });

    const rows = await e.find('showcase_invoice', {
      expand: { account: { object: 'showcase_account', fields: ['name'] } },
    });

    expect(rows).toHaveLength(1);
    // SUBSTANCE: the nested value is the RELATED RECORD, not the raw FK id.
    expect(typeof rows[0].account).toBe('object');
    expect(rows[0].account.name).toBe('Acme');
    // Projected to exactly what was asked for: the unrequested column is absent…
    expect(rows[0].account).not.toHaveProperty('industry');
    // …and so is the join key the engine added for its own use.
    expect(rows[0].account).not.toHaveProperty('id');
    expect(rows[0].account).toEqual({ name: 'Acme' });
  });

  it('keeps `id` when the caller DID ask for it (`fields: ["id","name"]` — the workaround spelling)', async () => {
    const e = await boot();
    const acct: any = await e.insert('showcase_account', { name: 'Acme', industry: 'Manufacturing' });
    await e.insert('showcase_invoice', { name: 'INV-001', account: acct.id });

    const rows = await e.find('showcase_invoice', {
      expand: { account: { object: 'showcase_account', fields: ['id', 'name'] } },
    });

    expect(rows[0].account).toEqual({ id: acct.id, name: 'Acme' });
  });

  it('second object pair (showcase_task → project) — the issue confirmed 2/2', async () => {
    const e = await boot();
    const proj: any = await e.insert('showcase_project', { name: 'Apollo' });
    await e.insert('showcase_task', { name: 'Design', project: proj.id });

    const rows = await e.find('showcase_task', {
      expand: { project: { object: 'showcase_project', fields: ['name'] } },
    });

    expect(rows[0].project).toEqual({ name: 'Apollo' });
  });

  it('findOne takes the same path (single-record entry point)', async () => {
    const e = await boot();
    const acct: any = await e.insert('showcase_account', { name: 'Acme', industry: 'Manufacturing' });
    const inv: any = await e.insert('showcase_invoice', { name: 'INV-001', account: acct.id });

    const row: any = await e.findOne('showcase_invoice', {
      where: { id: inv.id },
      expand: { account: { object: 'showcase_account', fields: ['name'] } },
    } as any);

    expect(row.account).toEqual({ name: 'Acme' });
  });

  it('no projection at all still returns the whole related record (unchanged behaviour)', async () => {
    const e = await boot();
    const acct: any = await e.insert('showcase_account', { name: 'Acme', industry: 'Manufacturing' });
    await e.insert('showcase_invoice', { name: 'INV-001', account: acct.id });

    const rows = await e.find('showcase_invoice', {
      expand: { account: { object: 'showcase_account' } },
    });

    expect(rows[0].account.id).toBe(acct.id);
    expect(rows[0].account.name).toBe('Acme');
    expect(rows[0].account.industry).toBe('Manufacturing');
  });
});
