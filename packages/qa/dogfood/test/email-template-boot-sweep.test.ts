// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22062 — plugin-email's declared-template boot sweep on the REAL engine and
 * the REAL SQL driver: which stored row a `(name, locale)` held by several
 * organizations resolves to, and what a steady boot costs.
 *
 * ## Why here and not beside the sweep
 *
 * Both answers belong to the driver: which row comes first is whatever ORDER BY
 * the driver gives the read, and a statement count is a count of what reaches
 * the database. `@objectstack/plugin-email` cannot import a driver for its own
 * suite, so these run where `ObjectQL` and `SqlDriver` already are, against the
 * sweep's published entry points.
 *
 * ## What was measured before the fix (`ObjectQL` over better-sqlite3)
 *
 *   - The per-template lookup, `find(…, { where: { name, locale }, limit: 1 })`,
 *     goes out as `… order by id asc limit ?`: the SQL driver orders every
 *     paged read by `id`. So its row is the smallest id, not the oldest row.
 *   - The same read in bulk with no `limit` gets NO ORDER BY and walks rows in
 *     storage order. Its first row for the slot below is `etpl_m`; the lookup's
 *     is `etpl_c`. A bulk read must therefore be paged too, or it picks another
 *     row than the lookup it replaces. The first case asserts that difference
 *     on the fixture, so the pin cannot drift into a fixture where both orders
 *     agree.
 *   - A steady boot over 450 unchanged templates issued 1,800 statements: per
 *     template one lookup, one UPDATE and the engine's two read-backs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysEmailTemplate } from '@objectstack/platform-objects/audit';
import { bootstrapDeclaredEmailTemplates, upsertDeclaredEmailTemplate } from '@objectstack/plugin-email';

const SYS = { isSystem: true, positions: [], permissions: [] };
const TABLE = 'sys_email_template';
const NAME = 'auth.password_reset';
const DECLARED_SUBJECT = 'Reset your password, {{user.name}}';

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) await engines.pop()?.destroy();
});

/** A fresh engine on its own `:memory:` database, every statement it sends recorded. */
async function boot(): Promise<{ engine: ObjectQL; statements: string[] }> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.dogfood.email-template-boot-sweep',
    name: 'Email template boot sweep',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysEmailTemplate],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);
  const statements: string[] = [];
  driver.getKnex().on('query', (q: { sql: string }) => statements.push(q.sql));
  return { engine, statements };
}

function declared(over: Record<string, unknown> = {}) {
  return {
    name: NAME,
    label: 'Password Reset',
    category: 'auth',
    subject: DECLARED_SUBJECT,
    bodyHtml: '<p>Click <a href="{{url}}">here</a></p>',
    variables: [{ name: 'url', type: 'string', required: true }],
    ...over,
  };
}

/** The sweep's declared list, through the metadata-service fallback it reads when the registry holds none. */
const listing = (items: unknown[]) => ({ list: () => items });

/**
 * One `(name, locale)` held by three organizations and the global row, plus
 * another locale of the same name. Stored in an order that is neither id order
 * nor its reverse, every row stale, so whichever row the sweep picks is the one
 * it rewrites.
 */
async function seedSharedSlot(engine: ObjectQL): Promise<void> {
  const rows: Array<[string, string | null, string]> = [
    ['etpl_m', 'org_b', 'en-US'],
    ['etpl_z', null, 'en-US'],
    ['etpl_c', 'org_a', 'en-US'],
    ['etpl_q', 'org_c', 'en-US'],
    ['etpl_0', 'org_a', 'zh-CN'],
  ];
  for (const [id, organization_id, locale] of rows) {
    await engine.insert(TABLE, {
      id, organization_id, name: NAME, label: 'Stale', category: 'auth', locale,
      subject: `stale ${id}`, body_html: '<p>stale</p>', active: true, managed_by: 'package', customized: false,
    }, { context: SYS } as never);
  }
}

async function subjects(engine: ObjectQL): Promise<Record<string, string>> {
  const rows = (await engine.find(TABLE, { where: { name: NAME }, context: SYS } as never)) as any[];
  return Object.fromEntries(rows.map((r) => [r.id, r.subject]));
}

describe('[#22062] the declared-template boot sweep on the real engine and SQL driver', () => {
  it('rewrites the row the per-template lookup chooses for a (name, locale) several organizations hold', async () => {
    const { engine, statements } = await boot();
    await seedSharedSlot(engine);

    // The per-template lookup's choice, measured live rather than assumed.
    statements.length = 0;
    const [chosen] = (await engine.find(TABLE, { where: { name: NAME, locale: 'en-US' }, limit: 1, context: SYS } as never)) as any[];
    expect(statements).toEqual(['select * from `sys_email_template` where `name` = ? and `locale` = ? order by `id` asc limit ?']);
    expect(chosen.id).toBe('etpl_c');
    // ANTI-VACUITY: an unpaged bulk read meets another row of this slot first.
    const unpaged = (await engine.find(TABLE, { where: { name: { $in: [NAME] } }, context: SYS } as never)) as any[];
    expect(unpaged.find((r) => r.locale === 'en-US').id).not.toBe(chosen.id);

    const result = await bootstrapDeclaredEmailTemplates(engine as never, listing([declared()]));

    expect(result).toEqual({ seeded: 1, skipped: 0 });
    expect(await subjects(engine)).toEqual({
      etpl_c: DECLARED_SUBJECT,
      etpl_m: 'stale etpl_m',
      etpl_z: 'stale etpl_z',
      etpl_q: 'stale etpl_q',
      etpl_0: 'stale etpl_0',
    });
  });

  it('the live door rewrites the same row over the same rows', async () => {
    const { engine } = await boot();
    await seedSharedSlot(engine);

    expect(await upsertDeclaredEmailTemplate(engine as never, declared())).toBe(true);

    expect((await subjects(engine)).etpl_c).toBe(DECLARED_SUBJECT);
    expect(Object.values(await subjects(engine)).filter((s) => s === DECLARED_SUBJECT)).toHaveLength(1);
  });

  it('a steady boot over 450 unchanged templates sends three reads and no write', async () => {
    const { engine, statements } = await boot();
    const items = Array.from({ length: 450 }, (_, i) => declared({ name: `tpl.n${i}`, bodyText: i % 3 ? undefined : 'Plain' }));
    expect(await bootstrapDeclaredEmailTemplates(engine as never, listing(items))).toEqual({ seeded: 450, skipped: 0 });

    statements.length = 0;
    const result = await bootstrapDeclaredEmailTemplates(engine as never, listing(items));

    expect(result).toEqual({ seeded: 0, skipped: 450 });
    expect(statements.filter((s) => !/^select /i.test(s))).toEqual([]);
    expect(statements).toHaveLength(3);
    expect(statements.every((s) => /^select \* from `sys_email_template` where `name` in \(.*\) order by `id` asc limit \?$/.test(s))).toBe(true);
  });
});
