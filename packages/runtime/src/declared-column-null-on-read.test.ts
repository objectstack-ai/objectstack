// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29408] One record reads the same on every driver: a declared column the
 * read selected and the write never touched is `null`, not a missing key.
 *
 * Measured on `origin/main` before the fix, through the engine, a row inserted
 * as `{ title }` on an object that also declares `note`:
 *
 * | read                         | driver-sql (SQLite) | driver-memory |
 * |:-----------------------------|:--------------------|:--------------|
 * | findOne, no projection       | `note: null`        | no `note` key |
 * | findOne `fields` naming note | `note: null`        | no `note` key |
 * | findOne `fields` without it  | no `note` key       | no `note` key |
 * | find, no projection          | `note: null`        | no `note` key |
 *
 * driver-mongodb answers as driver-memory does (its insert doors store no key
 * for a field given no value); it is pinned in its own package,
 * `mongodb-declared-column-null-on-read.test.ts`. driver-memory is not bound
 * here: a new test consumer of it is a maintainer ruling
 * (`check:driver-memory-census`), so its shape is pinned through the engine by
 * the sparse driver in `@objectstack/objectql`'s
 * `selected-declared-columns-answered.test.ts`, and the table's memory column
 * was measured once, with a probe that is not kept.
 *
 * The engine answers the selected column `null` in one place
 * (`selectedStoredColumns` in `@objectstack/objectql`'s
 * `declared-read-columns.ts`), so every driver answers as SQL does. The security
 * plugin is composed with a member who may not read `secret`: field-level
 * security's refusal must keep the key ABSENT — a refused column must never
 * reappear as `null`, which would tell the member the field exists and is
 * empty. A system read of the same row is the control: there `secret` IS a
 * selected, readable, unwritten column, and is answered `null`.
 *
 * Reads `@objectstack/objectql` from its built `dist/`, as every runtime suite
 * does: rebuild objectql before trusting a run of this file.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { installDefaultOrganization } from './default-organization.testkit.js';

const LEDGER = 'nk_null_ledger';
const ROW_ID = 'nk1';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: { [`${LEDGER}.secret`]: { readable: false, editable: false } },
});

const MEMBER_CTX = { userId: 'usr_member', positions: [] as string[], permissions: [MEMBER_SET.name], posture: 'MEMBER' as const };

type Ctx = EngineQueryOptions['context'];

const own = (row: unknown, key: string): boolean =>
  row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key);

/**
 * The driver with the composition it serves: driver-sql under a real `single`
 * install's Default Organization (its tenant column is NOT NULL).
 */
const DRIVERS: Array<[string, () => unknown, boolean]> = [
  ['driver-sql (SQLite)', () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never), true],
];

describe.each(DRIVERS)('[#29408] a selected, unwritten declared column reads null — %s', (_label, makeDriver, withOrganization) => {
  let engine: ObjectQL;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeDriver() as never, true);
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.declared-column-null-on-read',
      name: 'Declared column null on read',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: LEDGER,
          label: 'Ledger',
          sharingModel: 'public_read_write',
          fields: {
            title: { name: 'title', type: 'text' },
            note: { name: 'note', type: 'text' },
            secret: { name: 'secret', type: 'text' },
          },
        },
      ],
    } as never);
    await engine.syncSchemas();
    if (withOrganization) await installDefaultOrganization(engine);

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [MEMBER_SET],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

    // Only `title` is written: `note` and `secret` are never given a value.
    await engine.insert(LEDGER, { id: ROW_ID, title: 'written' }, { context: SYS_CTX } as never);
  }, 60_000);

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const byId = (context: Ctx, fields?: string[]): EngineQueryOptions =>
    ({ where: { id: ROW_ID }, ...(fields ? { fields } : {}), context });

  it('whole-record read (findOne, no projection): the unwritten column is null', async () => {
    const row = await engine.findOne(LEDGER, byId(MEMBER_CTX));
    expect(row).toMatchObject({ id: ROW_ID, title: 'written' });
    expect(own(row, 'note')).toBe(true);
    expect(row!.note).toBeNull();
  });

  it('list read (find, no projection): the unwritten column is null', async () => {
    const rows = await engine.find(LEDGER, { context: MEMBER_CTX });
    expect(rows).toHaveLength(1);
    expect(own(rows[0], 'note')).toBe(true);
    expect(rows[0]!.note).toBeNull();
  });

  it('a projection naming the column answers it null, on findOne and find', async () => {
    const one = await engine.findOne(LEDGER, byId(MEMBER_CTX, ['title', 'note']));
    expect(own(one, 'note')).toBe(true);
    expect(one!.note).toBeNull();
    const rows = await engine.find(LEDGER, { fields: ['title', 'note'], context: MEMBER_CTX });
    expect(own(rows[0], 'note')).toBe(true);
    expect(rows[0]!.note).toBeNull();
  });

  it('NOT SELECTED stays absent: a projection that does not name the column never answers it', async () => {
    const one = await engine.findOne(LEDGER, byId(MEMBER_CTX, ['title']));
    expect(own(one, 'note')).toBe(false);
    const rows = await engine.find(LEDGER, { fields: ['title'], context: MEMBER_CTX });
    expect(own(rows[0], 'note')).toBe(false);
  });

  it('FLS-REFUSED stays absent: a column the member may not read never reappears as null', async () => {
    const whole = await engine.findOne(LEDGER, byId(MEMBER_CTX));
    expect(own(whole, 'secret')).toBe(false);
    const listed = await engine.find(LEDGER, { context: MEMBER_CTX });
    expect(own(listed[0], 'secret')).toBe(false);
    const named = await engine.findOne(LEDGER, byId(MEMBER_CTX, ['title', 'note', 'secret']));
    expect(own(named, 'secret')).toBe(false);
    expect(own(named, 'note')).toBe(true);
  });

  it('control: the same column, read by the system, is a selected unwritten column and answers null', async () => {
    const row = await engine.findOne(LEDGER, byId(SYS_CTX));
    expect(own(row, 'secret')).toBe(true);
    expect(row!.secret).toBeNull();
  });
});
