// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The email plugin on the REAL engine and the REAL SQL driver: what a boot and
 * a send cost the `sys_email_template` table — nothing, now.
 *
 * ## What this file used to pin (#22062)
 *
 * plugin-email's declared-template boot sweep copied every `email_template`
 * into `sys_email_template` rows, and #22062 made that copy cheap: a steady
 * boot over 450 unchanged templates went from 1,800 statements to three reads
 * and no write, and the bulk read was paged so it chose the same row as the
 * per-template lookup for a `(name, locale)` several organizations held.
 *
 * ## What it pins now (ADR-0131 D6/D10, ruling C on §6 Q1)
 *
 * The sweep, the boot seed and the live projector are gone: templates resolve
 * from the registry, so the cheapest boot #22062 measured — three reads — is
 * now zero statements against the table, and a send reads no row either. The
 * rows earlier releases left behind — several organizations' copies of one
 * slot included, the population the v18 migration ceremony promotes — keep
 * their bytes and are never what a send renders.
 *
 * ## Why here and not beside the plugin
 *
 * A statement count is a count of what reaches the database, which belongs to
 * the driver: `@objectstack/plugin-email` cannot import a driver for its own
 * suite, so this runs where `ObjectQL` and `SqlDriver` already are.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { EmailServicePlugin } from '@objectstack/plugin-email';

const SYS = { isSystem: true, positions: [], permissions: [] };
const TABLE = 'sys_email_template';

const engines: ObjectQL[] = [];

afterEach(async () => {
  while (engines.length) await engines.pop()?.destroy();
});

/**
 * A fresh engine on its own `:memory:` database with `EmailServicePlugin`'s
 * `init()` run against it — the plugin's manifest (its two objects and the
 * built-in templates) registered through the engine's own `registerApp`, the
 * schema synced — and every statement the engine sends from then on recorded.
 * `start()` takes the plugin through `kernel:ready` and hands back the `email`
 * service it installs; sends are captured off the wire.
 */
async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engines.push(engine);

  const sent: Array<{ subject?: string }> = [];
  const services: Record<string, unknown> = {
    manifest: { register: (m: unknown) => engine.registerApp(m as never) },
    objectql: engine,
  };
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
  };
  const plugin = new EmailServicePlugin({
    persist: false,
    transport: { async send(m: { subject?: string }) { sent.push({ subject: m.subject }); return { messageId: `m${sent.length}` }; } } as never,
    defaultFrom: { address: 'no-reply@example.test' },
  });
  await plugin.init(ctx as never);
  await engine.syncSchemas();

  const statements: string[] = [];
  driver.getKnex().on('query', (q: { sql: string }) => statements.push(q.sql));
  const start = async () => {
    await plugin.start(ctx as never);
    for (const fn of hooks['kernel:ready'] ?? []) await fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return services.email as any;
  };
  return { engine, statements, sent, start };
}

/** Statements that name the template table. */
const onTable = (statements: string[]) => statements.filter((s) => s.includes(`\`${TABLE}\``));

/**
 * One `(name, locale)` held by three organizations and the global row, plus
 * another locale of the same name: the shape #22062 pinned the row choice on,
 * every row carrying stale wording a send must never render.
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
      id, organization_id, name: 'auth.password_reset', label: 'Stale', category: 'auth', locale,
      subject: `stale ${id}`, body_html: '<p>stale</p>', active: true, managed_by: 'package', customized: id === 'etpl_c',
    }, { context: SYS } as never);
  }
}

async function subjects(engine: ObjectQL): Promise<Record<string, string>> {
  const rows = (await engine.find(TABLE, { context: SYS } as never)) as any[];
  return Object.fromEntries(rows.map((r) => [r.id, r.subject]));
}

const RESET_DATA = { appName: 'Acme', resetUrl: 'https://example.test/r', user: { name: 'Ada', email: 'ada@example.test' } };

describe('the email plugin on the real engine and SQL driver: no statement reaches sys_email_template', () => {
  it('a boot and a send of a built-in template send no statement to the table', async () => {
    const { engine, statements, sent, start } = await boot();
    statements.length = 0;

    const email = await start();
    await email.sendTemplate({ template: 'auth.password_reset', to: 'ada@example.test', data: RESET_DATA });

    expect(sent.map((m) => m.subject)).toEqual(['Reset your Acme password']);
    expect(onTable(statements)).toEqual([]);
    expect(await subjects(engine)).toEqual({});
  });

  it('rows several organizations hold for one slot keep their bytes and are never what a send renders', async () => {
    const { engine, statements, sent, start } = await boot();
    await seedSharedSlot(engine);
    const before = await subjects(engine);
    statements.length = 0;

    const email = await start();
    await email.sendTemplate({ template: 'auth.password_reset', to: 'ada@example.test', data: RESET_DATA });
    await email.sendTemplate({ template: 'auth.password_reset', to: 'ada@example.test', locale: 'zh-CN', data: RESET_DATA });

    expect(sent.map((m) => m.subject)).toEqual(['Reset your Acme password', '重置您的 Acme 密码']);
    expect(onTable(statements)).toEqual([]);
    expect(await subjects(engine)).toEqual(before);
    expect(Object.keys(before)).toHaveLength(5);
  });
});
