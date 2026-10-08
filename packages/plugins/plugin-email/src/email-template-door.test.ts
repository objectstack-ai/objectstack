// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The closed `sys_email_template` organization door (ADR-0131 D6, ruling C on
 * ADR-0131 §6 Q1), pinned against the REAL engine.
 *
 *  1. An organization's create, update and predicate update are refused with
 *     `PERMISSION_DENIED` / 403, the refusal names the closed door, and nothing
 *     reaches the driver.
 *  2. A system-context write still passes: the seeds, the boot sweep, the live
 *     projector of a Studio save, and the v18 migration ceremony's promotion.
 *  3. No update marks a row `customized` any more. The provenance stamp that
 *     did is retired, and with the door closed no non-system update reaches the
 *     engine's write at all.
 *
 * ⚠️ The engine half resolves through `@objectstack/objectql`'s `exports` to
 * `dist/` (this package aliases no objectql entry; the ledger in
 * `scripts/check-test-source-alias.mjs` records that). The SUBJECT -
 * `./email-template-door.js` - is a relative import read from source, which is
 * what an ablation of the door mutates.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bindEmailTemplateDoor, unbindEmailTemplateDoor } from './email-template-door.js';

const OBJECT = 'sys_email_template';
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** An organization admin through the data door: a caller, not system-elevated. */
const ORG_CTX = { userId: 'usr_admin', tenantId: 'org_default', positions: [], permissions: [] };
/** The platform's own writers (seeds, sweep, projector, promotion). */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** Minimal in-memory driver: what reached it is what the door let through. */
function makeStubDriver(): any {
  const store = new Map<string, Record<string, unknown>>();
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      const expected = v && typeof v === 'object' && '$eq' in (v as any) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const d: any = {
    name: 'memory', version: '0.0.0', supports: {},
    store,
    /** One entry per write that reached the driver. */
    writes: [] as Array<{ op: string; data: Record<string, unknown> }>,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; }, async syncSchema() {},
    async find(_o: string, ast: any) {
      const rows = [...store.values()].filter((r) => matches(r, ast?.where));
      // Hold the caller's bound, AFTER the filter and by PRESENCE
      // (`check:objectql-double-limit`).
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(_o: string, ast: any) {
      for (const r of store.values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(_o: string, data: Record<string, unknown>) {
      d.writes.push({ op: 'create', data: { ...data } });
      const row = { ...data }; store.set(String(row.id), row); return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      d.writes.push({ op: 'update', data: { ...data } });
      const cur = store.get(id); if (!cur) return null;
      const u = { ...cur, ...data, id }; store.set(id, u); return u;
    },
    async upsert(o: string, data: any) { return this.create(o, data); },
    async delete(_o: string, id: string) { return store.delete(id); },
    async count(_o: string, ast: any) { return [...store.values()].filter((r) => matches(r, ast?.where)).length; },
    async bulkCreate(o: string, rows: any[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      d.writes.push({ op: 'updateMany', data: { ...data } });
      const rows = [...store.values()].filter((r) => matches(r, ast?.where));
      for (const r of rows) store.set(String(r.id), { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return d;
}

const text = (name: string) => ({ name, label: name, type: 'text' as const });

async function boot() {
  const engine: any = new ObjectQL();
  const driver = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: OBJECT, label: OBJECT,
    fields: {
      id: { ...text('id'), primaryKey: true },
      name: text('name'),
      locale: text('locale'),
      subject: text('subject'),
      managed_by: text('managed_by'),
      customized: { name: 'customized', label: 'customized', type: 'boolean' as const },
    },
  });
  bindEmailTemplateDoor(engine, silentLogger, OBJECT);
  return { engine, driver };
}

/** A package-seeded and a platform-seeded row, as the boot seeders leave them. */
const SEEDED = [
  { id: 'a', name: 'auth.password_reset', locale: 'en-US', subject: 'Reset', managed_by: 'package', customized: false },
  { id: 'b', name: 'auth.verify_email', locale: 'en-US', subject: 'Verify', managed_by: 'platform', customized: false },
];

async function bootSeeded() {
  const booted = await boot();
  await booted.engine.insert(OBJECT, SEEDED.map((r) => ({ ...r })), { context: SYSTEM_CTX });
  booted.driver.writes.length = 0;
  return booted;
}

/** The engine's answer to a write, as a value — a rejection is read by FIELD. */
const settle = (p: Promise<unknown>) => p.then((value) => ({ ok: true as const, value }), (err: any) => ({ ok: false as const, err }));

const rows = (driver: any) => [...driver.store.values()].map((r: any) => ({ id: r.id, subject: r.subject, customized: r.customized }));

/* ── 1. the organization door is closed ────────────────────────────────── */

describe('the sys_email_template organization door is closed', () => {
  it('refuses an organization\'s create with PERMISSION_DENIED / 403 naming the door, and writes nothing', async () => {
    const { engine, driver } = await boot();

    const out = await settle(engine.insert(OBJECT, {
      id: 'etpl_org', name: 'auth.password_reset', locale: 'en-US', subject: 'Ours',
    }, { context: ORG_CTX }));

    expect(out.ok).toBe(false);
    const err = (out as { err: any }).err;
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.status).toBe(403);
    // The door is NAMED (ADR-0123 D4) — the one sentence a reader acts on.
    expect(String(err.message)).toMatch(/^PERMISSION_DENIED: sys_email_template is closed to organization writes/);
    expect(driver.writes).toEqual([]);
    expect(driver.store.size).toBe(0);
  });

  it('refuses an organization\'s update by id, and the row keeps its bytes', async () => {
    const { engine, driver } = await bootSeeded();

    const out = await settle(engine.update(OBJECT, { id: 'a', subject: 'Reworded by the organization' }, { context: ORG_CTX }));

    expect(out.ok).toBe(false);
    const err = (out as { err: any }).err;
    expect([err.code, err.status]).toEqual(['PERMISSION_DENIED', 403]);
    expect(String(err.message)).toMatch(/^PERMISSION_DENIED: sys_email_template is closed to organization writes/);
    expect(driver.writes).toEqual([]);
    expect(rows(driver)).toEqual([
      { id: 'a', subject: 'Reset', customized: false },
      { id: 'b', subject: 'Verify', customized: false },
    ]);
  });

  it('refuses an organization\'s predicate update, per matched row, and no SET clause reaches the driver', async () => {
    const { engine, driver } = await bootSeeded();

    const out = await settle(engine.update(OBJECT, { subject: 'Bulk edit' }, {
      multi: true, where: { id: { $in: ['a', 'b'] } }, context: ORG_CTX,
    } as any));

    expect(out.ok).toBe(false);
    expect([(out as { err: any }).err.code, (out as { err: any }).err.status]).toEqual(['PERMISSION_DENIED', 403]);
    expect(driver.writes).toEqual([]);
    expect(rows(driver).map((r) => r.subject)).toEqual(['Reset', 'Verify']);
  });
});

/* ── 2. system writes pass ─────────────────────────────────────────────── */

describe('a system-context write passes the closed door', () => {
  it('creates and updates a template row (the seeds, the sweep, the projector, the promotion)', async () => {
    const { engine, driver } = await boot();

    await engine.insert(OBJECT, {
      id: 'etpl_sys', name: 'auth.magic_link', locale: 'en-US', subject: 'Sign in', managed_by: 'package', customized: false,
    }, { context: SYSTEM_CTX });
    await engine.update(OBJECT, { id: 'etpl_sys', subject: 'Projected from a Studio save' }, { context: SYSTEM_CTX });

    expect(rows(driver)).toEqual([{ id: 'etpl_sys', subject: 'Projected from a Studio save', customized: false }]);
  });

  it('lets a write with no caller at all through — not an organization\'s write', async () => {
    const { engine, driver } = await boot();

    await engine.insert(OBJECT, { id: 'etpl_nc', name: 'n', locale: 'en-US', subject: 'No caller' });

    expect(rows(driver)).toEqual([{ id: 'etpl_nc', subject: 'No caller', customized: undefined }]);
  });

  it('releases the door on unbind', async () => {
    const { engine, driver } = await boot();
    unbindEmailTemplateDoor(engine);

    await engine.insert(OBJECT, { id: 'etpl_after', name: 'n', locale: 'en-US', subject: 'After teardown' }, { context: ORG_CTX });

    expect(driver.store.size).toBe(1);
  });
});

/* ── 3. no update marks a row customized ───────────────────────────────── */

describe('no update marks a row `customized` any more', () => {
  it('leaves `customized` false after an organization\'s refused edit AND after a system edit of a seeded row', async () => {
    const { engine, driver } = await bootSeeded();

    // The edit the retired provenance stamp used to mark: refused at the door.
    await settle(engine.update(OBJECT, { id: 'a', subject: 'Org wording' }, { context: ORG_CTX }));
    await settle(engine.update(OBJECT, { subject: 'Org bulk wording' }, {
      multi: true, where: { id: { $in: ['a', 'b'] } }, context: ORG_CTX,
    } as any));
    // The edit the platform makes: never marked, before or after.
    await engine.update(OBJECT, { id: 'b', subject: 'Re-seeded' }, { context: SYSTEM_CTX });

    expect(rows(driver)).toEqual([
      { id: 'a', subject: 'Reset', customized: false },
      { id: 'b', subject: 'Re-seeded', customized: false },
    ]);
    expect(driver.writes.flatMap((w: any) => Object.keys(w.data))).not.toContain('customized');
  });
});
