// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18682] A validation rule's related read stays inside the caller's
 * organization — so a reference naming ANOTHER organization's row tells the
 * caller nothing about that row.
 *
 * The related read runs under system authority, which skips this plugin's
 * Layer 0 wall. What keeps it in the caller's organization is that the engine
 * spreads the caller's context into it, `tenantId` included, and the driver
 * scopes the read by that. A bare `{ isSystem: true }` would read the other
 * organization's row, and the rule's verdict on it would reach the caller.
 *
 * Driven on the real `SqlDriver` under the `isolated` posture, through the
 * real middleware: a caller bound to org X writes a reference to org Y's row,
 * once with that row `secret` and once `public`. The two must end identically,
 * the read must return nothing, and the org X control must reach the rule.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

const RULE_MESSAGE = 'Inspections on a secret line are frozen.';

const OBJECTS = [
  {
    name: 'qa_line',
    label: 'Line',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      kind: { name: 'kind', type: 'text' },
    },
  },
  {
    name: 'qa_inspection',
    label: 'Inspection',
    sharingModel: 'public_read_write',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
      line: { name: 'line', type: 'lookup', reference: 'qa_line' },
    },
    validations: [{
      name: 'no_secret_line', type: 'script', severity: 'error',
      message: RULE_MESSAGE, condition: "record.line.kind == 'secret'",
    }],
  },
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: {
    qa_inspection: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_line: { allowRead: true },
  },
} as unknown as PermissionSet;

/** The driver's own query builder, reached past its `protected` modifier. */
type Table = (name: string) => {
  insert(rows: Array<Record<string, unknown>>): Promise<unknown>;
  where(match: Record<string, unknown>): { select(...columns: string[]): Promise<unknown[]> };
};

/** Bound to org X. */
const CALLER = { userId: 'u_x', tenantId: 'org_x', positions: [], permissions: [], posture: 'MEMBER' };

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** `kind` is org Y's row's value; org X holds one `secret` line of its own. */
async function boot(kind: 'secret' | 'public') {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.predicate-related-read-tenant-scope',
    name: 'Predicate related read tenant scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    'org-scoping': { name: 'org-scoping' },
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (_t: string, name: string) => engine.getSchema(name) ?? null, list: async () => [MEMBER] },
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

  // Straight into the table, past every scope: the fixture is not the subject.
  const table = (driver as unknown as { knex: Table }).knex;
  await table('qa_line').insert([
    { id: 'line_x', kind: 'secret', organization_id: 'org_x' },
    { id: 'line_y', kind, organization_id: 'org_y' },
  ]);

  // What the driver hands back for every read of the related object.
  const readsOfLine: unknown[][] = [];
  const find = driver.find.bind(driver);
  vi.spyOn(driver, 'find').mockImplementation(async (object, ast, options) => {
    const rows = await find(object, ast, options);
    if (object === 'qa_line') readsOfLine.push(rows as unknown[]);
    return rows;
  });

  const stored = async (name: string) => (await table('qa_inspection').where({ name }).select('id')).length;
  return { engine, readsOfLine, stored };
}

/** Everything the caller sees of one write and one preview naming `line`. */
async function observe(kind: 'secret' | 'public', line: string) {
  const h = await boot(kind);
  const refusal = await h.engine
    .insert('qa_inspection', { name: 'probe', line }, { context: CALLER } as never)
    .then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
  const preview = await h.engine.validate(
    'qa_inspection', { name: 'probe', line }, { mode: 'insert', context: CALLER } as never,
  );
  return {
    seen: {
      refusal,
      committed: await h.stored('probe'),
      preview: { valid: preview.results?.[0]?.valid, errors: preview.results?.[0]?.errors?.map((e) => e.message) },
    },
    readsOfLine: h.readsOfLine,
  };
}

describe('#18682 — the related read stays inside the caller’s organization', () => {
  it('a reference to org Y’s row ends identically whether that row is secret or public', async () => {
    const secret = await observe('secret', 'line_y');
    const open = await observe('public', 'line_y');

    expect(open.seen).toEqual(secret.seen);
    expect(secret.seen.refusal?.code).toBe('VALIDATION_FAILED');
    expect(secret.seen.committed).toBe(0);
    // The read happened, once per door, and found nothing in org X.
    expect(secret.readsOfLine).toEqual([[], []]);
    expect(open.readsOfLine).toEqual([[], []]);
  });

  it('CONTROL: org X’s own secret line reaches the rule on both doors', async () => {
    const own = await observe('public', 'line_x');

    expect(own.seen.refusal).toEqual({ code: 'VALIDATION_FAILED', message: RULE_MESSAGE });
    expect(own.seen.committed).toBe(0);
    expect(own.seen.preview).toEqual({ valid: false, errors: [RULE_MESSAGE] });
    expect(own.readsOfLine.map((rows) => rows.length)).toEqual([1, 1]);
  });
});
