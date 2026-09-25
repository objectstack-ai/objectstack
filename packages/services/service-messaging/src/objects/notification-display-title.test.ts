// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The record title of the four notification objects that declared a
 * `titleFormat` and no title pointer (#20044): `sys_notification_delivery`,
 * `sys_notification_preference`, `sys_notification_subscription` and
 * `sys_notification_receipt`.
 *
 * ADR-0079 resolves a record's title as `nameField ?? displayNameField ??
 * derivation`, and an explicit `nameField` takes precedence over the
 * render-only `titleFormat`. With no pointer declared, the registry's
 * designate-only pass (`provisionPrimary(…, { synthesize: false })`) stamped
 * `nameField: 'id'` — the first title-eligible field — onto each registered
 * body, and a `/meta` read serves that stamp as if the author had written it.
 * A renderer honouring the order therefore drew the raw id as the record
 * page's H1.
 *
 * The three composite titles now point at `display_title`, a text formula over
 * the columns `titleFormat` names. `sys_notification_receipt`'s title is one
 * column (`{state}`), so its `nameField` names that column directly — the
 * describe's own migration for a single-field title. An explicit pointer is
 * honoured whatever the field's type (ADR-0079 D4); `select` is only kept out
 * of DERIVATION, which is why the pass skipped `state` and stamped `id`.
 *
 * Through the real engine this file asserts, per object:
 *
 *  1. the body the registry holds after registration names the new pointer;
 *  2. a seeded row's H1 is the `titleFormat` text, not the id, and the
 *     server-side accessor (`resolveRecordTitle`) agrees;
 *  3. a row missing a title column never gives the title a NULL part: the
 *     write path refuses it, or fills the column's declared default;
 *  4. the formula reads exactly the columns `titleFormat` names, on this row
 *     only, each required and none withheld from a reader of the row;
 *  5. nothing adds a stored column — no formula column, no search companion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, resolveRecordTitle } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveDisplayField } from '@objectstack/spec/data';
import { NotificationDelivery } from './notification-delivery.object.js';
import { NotificationPreference } from './notification-preference.object.js';
import { NotificationReceipt } from './notification-receipt.object.js';
import { NotificationSubscription } from './notification-subscription.object.js';

const SYS = { context: { isSystem: true } } as any;
const NOW = new Date('2026-09-25T00:00:00Z');

interface Case {
  schema: any;
  /** The title pointer the object declares. */
  pointer: string;
  /** A row carrying every column the object requires. */
  row: () => Record<string, unknown>;
  title: string;
  /** Title columns the write path REFUSES to omit (no declared default). */
  refused: string[];
  /** Title columns an omission fills from the declared default, with the H1 that yields. */
  defaulted: Record<string, string>;
}

// `notification_id` is part of the delivery and receipt unique keys and of
// neither title, so each row gets its own.
let seq = 0;
const unique = (prefix: string) => `${prefix}_${++seq}`;

const CASES: Case[] = [
  {
    schema: NotificationDelivery,
    pointer: 'display_title',
    row: () => ({
      notification_id: unique('ntf'), recipient_id: 'usr_alice', channel: 'email',
      status: 'pending', created_at: NOW, updated_at: NOW,
    }),
    title: 'email → usr_alice',
    refused: ['channel', 'recipient_id'],
    defaulted: {},
  },
  {
    schema: NotificationPreference,
    pointer: 'display_title',
    row: () => ({ user_id: 'usr_alice', topic: 'billing.invoice', channel: 'email', created_at: NOW }),
    title: 'usr_alice · billing.invoice · email',
    refused: ['user_id'],
    // `topic` / `channel` default to the '*' wildcard (ADR-0030 Layer 3).
    defaulted: { topic: 'usr_alice · * · email', channel: 'usr_alice · billing.invoice · *' },
  },
  {
    schema: NotificationSubscription,
    pointer: 'display_title',
    row: () => ({ topic: 'billing.invoice', principal: 'role:sales_manager', created_at: NOW }),
    title: 'role:sales_manager · billing.invoice',
    refused: ['principal', 'topic'],
    defaulted: {},
  },
  {
    schema: NotificationReceipt,
    pointer: 'state',
    row: () => ({ notification_id: unique('ntf'), user_id: 'usr_alice', channel: 'inbox', state: 'read', created_at: NOW }),
    title: 'read',
    refused: [],
    // `state` defaults to 'delivered': the receipt a channel writes on delivery.
    defaulted: { state: 'delivered' },
  },
];

/** The `titleFormat` source: the parsed schema carries it as an envelope. */
function titleFormatSource(schema: unknown): string {
  const tf = (schema as { titleFormat?: unknown }).titleFormat;
  const source = typeof tf === 'string' ? tf : (tf as { source?: unknown })?.source;
  if (typeof source !== 'string') throw new Error(`titleFormat carries no template source: ${JSON.stringify(tf)}`);
  return source;
}

/**
 * The H1 a `titleFormat`-first renderer draws: each `{field}` placeholder
 * substituted with the row's value. It is the reference the title has to
 * reproduce, not a second title resolver.
 */
function renderTitleFormat(schema: unknown, row: Record<string, unknown>): string {
  return titleFormatSource(schema).replace(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g, (_m, key: string) => String(row[key] ?? ''));
}

/** The columns `titleFormat` names. */
function titleFormatColumns(schema: unknown): string[] {
  return [...titleFormatSource(schema).matchAll(/\{\{?\s*([a-zA-Z0-9_.]+)\s*\}?\}/g)].map((m) => m[1]).sort();
}

/** Every `record.<path>` the `display_title` expression reads, as written. */
function formulaReads(schema: { fields: Record<string, any> }): string[] {
  const source = schema.fields.display_title?.expression?.source;
  if (typeof source !== 'string') throw new Error('display_title carries no expression source');
  return [...source.matchAll(/record\.([A-Za-z_][A-Za-z0-9_.]*)/g)].map((m) => m[1]).sort();
}

/** The stored row as a hook body holds it: no formula value on it. */
function storedOnly(row: Record<string, unknown>): Record<string, unknown> {
  const { display_title: _omit, ...rest } = row;
  return rest;
}

describe('[#20044] notification objects resolve a real record title under ADR-0079 order', () => {
  let engine: ObjectQL;
  let driver: SqlDriver;

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    for (const { schema } of CASES) {
      engine.registry.registerObject(schema, 'com.objectstack.test.20044');
    }
    await engine.syncSchemas();
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  for (const c of CASES) {
    const object: string = c.schema.name;

    it(`${object}: the registered body points at ${c.pointer} — not the id the designation pass stamped`, () => {
      const registered = engine.registry.getObject(object) as any;
      expect(registered.nameField).toBe(c.pointer);
      expect(registered.displayNameField).toBe(c.pointer);
      expect(resolveDisplayField(registered)).toBe(c.pointer);
      if (c.pointer === 'display_title') {
        expect(registered.fields.display_title?.type).toBe('formula');
        expect(registered.fields.display_title?.returnType).toBe('text');
      }
    });

    it(`${object}: the H1 is "${titleFormatSource(c.schema)}", not the id`, async () => {
      const registered = engine.registry.getObject(object) as any;
      const created = await engine.insert(object, c.row(), SYS);
      const row = await engine.findOne(object, { where: { id: created.id } }, SYS);
      expect(row).not.toBeNull();

      const h1 = row![resolveDisplayField(registered)!];
      expect(h1).toBe(c.title);
      expect(h1).not.toBe(row!.id);
      expect(h1).toBe(renderTitleFormat(c.schema, row!));
      expect(resolveRecordTitle(registered, storedOnly(row!))).toBe(c.title);
    });

    it(`${object}: a row missing a title column never gives the title a NULL part`, async () => {
      const registered = engine.registry.getObject(object) as any;
      for (const omit of c.refused) {
        const partial = c.row();
        delete partial[omit];
        await expect(engine.insert(object, partial, SYS)).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          fields: expect.arrayContaining([expect.objectContaining({ field: omit, code: 'required' })]),
        });
      }
      for (const [omit, expected] of Object.entries(c.defaulted)) {
        const partial = c.row();
        delete partial[omit];
        const created = await engine.insert(object, partial, SYS);
        const row = await engine.findOne(object, { where: { id: created.id } }, SYS);
        expect(row![resolveDisplayField(registered)!]).toBe(expected);
        expect(row![resolveDisplayField(registered)!]).toBe(renderTitleFormat(c.schema, row!));
      }
      expect([...c.refused, ...Object.keys(c.defaulted)].sort()).toEqual(titleFormatColumns(c.schema));
    });

    it(`${object}: the title reads exactly the titleFormat columns, on this row, each required and none withheld`, () => {
      const fields = c.schema.fields as Record<string, any>;
      // One level deep: a dotted path would read a looked-up record's field.
      const reads = c.pointer === 'display_title' ? formulaReads(c.schema) : [c.pointer];
      expect(reads).toEqual(titleFormatColumns(c.schema));
      for (const column of reads) {
        expect(fields[column], column).toBeDefined();
        expect(fields[column].required, column).toBe(true);
        expect(fields[column].hidden ?? false, column).toBe(false);
        expect(fields[column].requiredPermissions ?? [], column).toEqual([]);
        expect(fields[column].maskingRule, column).toBeUndefined();
      }
    });

    it(`${object}: adds no stored column — no formula column and no search companion`, async () => {
      const columns = Object.keys(await driver.getKnex()(object).columnInfo());
      expect(columns).toContain(titleFormatColumns(c.schema)[0]);
      expect(columns).not.toContain('display_title');
      expect(columns).not.toContain('__search');
    });
  }
});
