// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29888] Comment and attachment reads stay inside a hosted libSQL server's
// expression-depth limit, however many parent objects the deployment registers.
//
// ## The defect
//
// The comment-thread gate (plugin-audit) and the attachment gate
// (service-storage) AND into every caller's read one `ReadableIds` branch per
// registered parent object, ORed together. The SQL driver emitted that `$or`
// as one flat chain, `(b1) or (b2) or … or (bN)`, which SQLite parses into a
// tree N levels deep. A hosted libSQL server refuses a tree deeper than 100
// ("Expression tree is too large (maximum depth 100)"), and a bare environment
// already registers about 80 parents, so every comment and attachment read of a
// hosted record page failed with 500 `DATABASE_ERROR` once an app added a few
// more. Local SQLite allows 1000, which is why a local stack answered 200.
//
// ## The budget, and why it is measured the way it is
//
// The in-process stack runs sql.js, which allows 1000 levels and exposes no
// `sqlite3_limit`. So every SELECT of `sys_comment` / `sys_attachment` the
// driver sends is executed with its WHERE as the left operand of a chain of
// SPINE `and 1` terms: each adds one level above the WHERE, so the statement
// fits under 1000 exactly when its WHERE alone fits under 1000 - SPINE = BUDGET.
// The arming block proves the budget is engaged on the real driver path (a
// 90-level WHERE is served, a 110-level one is refused with SQLite's own
// message, and served again with the budget off) before any case below runs.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, sql.js driver, REST
// and auth layers, `AuditPlugin` and `StorageServicePlugin`. 130 public parent
// objects beside the platform's own, one private object (a member opens only
// its own records) and one object the member may not read at all. Each read is
// the card's own query string, asked at the HTTP door with the budget on and
// off: same status, same rows, same total.
//
// Fixtures are synthetic. ⚠️ No test title states a value.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { mkdtempSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertArmed, armedWhen } from './armed.js';
import { catalogPermissionSet } from './catalog-permission-set.js';
import { uploadFile, FILE_BYTES } from './fixtures/attachments-authz-harness.js';

const COMMENT = 'sys_comment';
const ATTACHMENT = 'sys_attachment';
const SYS = { isSystem: true } as const;
const PASSWORD = 'Xd-Fixture-Pass-29888';

/** Fixture parent objects beside the platform's own — the card asks for 120 or more. */
const EXTRA_PARENTS = 130;
/** The depth a hosted libSQL server allows. */
const BUDGET = 100;
/** sql.js's `SQLITE_MAX_EXPR_DEPTH`, the default. */
const NATIVE_LIMIT = 1000;
const SPINE = NATIVE_LIMIT - BUDGET;
const TOO_DEEP = /Expression tree is too large/;

/** A member opens its own records only (private sharing, ADR-0090 default). */
const CASE = 'xd_case';
/** The member may not read this object at all. */
const VAULT = 'xd_vault';
const parentName = (i: number) => `xd_p${String(i).padStart(3, '0')}`;
const PUBLIC_PARENT = parentName(7);

const objects = [
  ObjectSchema.create({
    name: CASE,
    label: 'XD Case',
    pluralLabel: 'XD Cases',
    enable: { files: true },
    fields: { name: Field.text({ label: 'Name', required: true }) },
  }),
  ObjectSchema.create({
    name: VAULT,
    label: 'XD Vault',
    pluralLabel: 'XD Vaults',
    sharingModel: 'public_read_write',
    enable: { files: true },
    fields: { name: Field.text({ label: 'Name', required: true }) },
  }),
  ...Array.from({ length: EXTRA_PARENTS }, (_, i) =>
    ObjectSchema.create({
      name: parentName(i),
      label: `XD Parent ${i}`,
      pluralLabel: `XD Parents ${i}`,
      sharingModel: 'public_read_write',
      enable: { files: true },
      fields: { name: Field.text({ label: 'Name', required: true }) },
    }),
  ),
];

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.comment-attachment-gate-expression-depth',
    namespace: 'xd',
    version: '0.0.0',
    type: 'app',
    name: 'Comment and Attachment Gate Expression Depth Fixture',
    description: 'Enough parent objects that a per-parent OR chain would pass a hosted expression-depth limit.',
  },
  objects,
});

const write = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };
const baselineSet = PermissionSetSchema.parse({
  name: 'xd_baseline',
  label: 'XD baseline',
  objects: Object.fromEntries(
    [CASE, COMMENT, ATTACHMENT, ...Array.from({ length: EXTRA_PARENTS }, (_, i) => parentName(i))].map((o) => [o, write]),
  ),
});

type Row = Record<string, any>;
const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));

/**
 * The top-level clauses of one SELECT: the table its FROM names, and the
 * span of its WHERE body. Parentheses and quoted text are skipped, so a
 * subquery's own clauses are never taken for the statement's.
 */
function topLevelClauses(sql: string): { table: string | null; whereStart: number; whereEnd: number } | null {
  const marks: Array<{ at: number; word: string }> = [];
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`') {
      const close = sql.indexOf(c, i + 1);
      if (close < 0) return null;
      i = close;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && /\s/.test(c)) {
      const word = /^\s(from|where|order by|group by|limit|offset|having|union)\s/i.exec(sql.slice(i))?.[1];
      if (word) marks.push({ at: i + 1, word: word.toLowerCase() });
    }
  }
  const from = marks.find((m) => m.word === 'from');
  const where = marks.find((m) => m.word === 'where');
  if (!from || !where) return null;
  const end = marks.find((m) => m.at > where.at && m.word !== 'where' && m.word !== 'from');
  const table = /^from\s+[`"]?([a-z_][a-z0-9_]*)/i.exec(sql.slice(from.at))?.[1] ?? null;
  return { table, whereStart: where.at + 'where '.length, whereEnd: end ? end.at - 1 : sql.length };
}

/** `sql` with its WHERE under SPINE levels, or `sql` unchanged when it is not a gated SELECT. */
function underBudget(sql: string): string {
  if (!/^\s*select\b/i.test(sql)) return sql;
  const clauses = topLevelClauses(sql);
  if (!clauses || (clauses.table !== COMMENT && clauses.table !== ATTACHMENT)) return sql;
  const body = sql.slice(clauses.whereStart, clauses.whereEnd);
  return `${sql.slice(0, clauses.whereStart)}(${body})${' and 1'.repeat(SPINE)}${sql.slice(clauses.whereEnd)}`;
}

/** `levels` nested two-member `$or` groups: a WHERE `levels` + 2 deep. */
const nestedOr = (levels: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { thread_id: 'xd-depth-0' };
  for (let i = 1; i <= levels; i++) node = { $or: [node, { thread_id: `xd-depth-${i}` }] };
  return node;
};

describe('[#29888] comment and attachment reads fit a 100-level expression-depth budget with 130 extra parent objects', () => {
  let stack: VerifyStack;
  let ql: any;
  let rootDir: string;
  const budget = { on: false };
  /** SQL the budget was applied to, while it was on. */
  let budgeted = 0;
  const token = { admin: '', member: '', writer: '' };
  const id = { mine: '', other: '', vault: '', open: '' };
  const comment = { mine: '', other: '', vault: '', open: '' };
  const attachment = { mine: '', other: '', vault: '', open: '' };

  const read = async (who: keyof typeof token, path: string) => {
    const res = await stack.apiAs(token[who], 'GET', path);
    const body = (await res.json().catch(() => null)) as any;
    const rows: Row[] = body?.records ?? body?.data ?? [];
    return { status: res.status, ids: rows.map((r) => String(r.id)).sort(), total: body?.total };
  };
  /** The same read with the budget on and off. */
  const both = async (who: keyof typeof token, path: string) => {
    budget.on = true;
    const before = budgeted;
    try {
      const within = await read(who, path);
      return { within, budgetApplied: budgeted > before, unbounded: (budget.on = false, await read(who, path)) };
    } finally {
      budget.on = false;
    }
  };

  beforeAll(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'xd-29888-'));
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
      ],
    });
    ql = await stack.kernel.getServiceAsync('objectql');

    // The budget, on the driver's own execution seam: every statement the
    // driver runs passes through its knex client's `_query`.
    const client = ql.getDriver(COMMENT).knex.client;
    const execute = client._query.bind(client);
    client._query = (connection: unknown, obj: { sql?: string }) => {
      if (budget.on && typeof obj?.sql === 'string') {
        const sql = underBudget(obj.sql);
        if (sql !== obj.sql) {
          budgeted += 1;
          obj.sql = sql;
        }
      }
      return execute(connection, obj);
    };

    token.admin = await stack.signIn();
    const userIdOf = async (email: string) =>
      String((await ql.findOne('sys_user', { where: { email }, context: { ...SYS } }))?.id ?? '');
    for (const who of ['member', 'writer'] as const) {
      const email = `xd-${who}@verify.test`;
      token[who] = await stack.signUp(email, PASSWORD);
      const set = await catalogPermissionSet(ql, baselineSet.name);
      expect(set, 'fixture permission set served by the security catalog').toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: await userIdOf(email), permission_set: set.name }, { context: { ...SYS } });
    }
    const idOf = async (res: Response) => {
      expect(res.status, 'fixture write').toBeLessThan(300);
      const j = (await res.json()) as any;
      return String(j.id ?? j.record?.id ?? j.data?.id);
    };
    id.mine = await idOf(await stack.apiAs(token.member, 'POST', `/data/${CASE}`, { name: 'mine' }));
    id.other = await idOf(await stack.apiAs(token.writer, 'POST', `/data/${CASE}`, { name: 'other' }));
    id.vault = String((await ql.insert(VAULT, { name: 'vault' }, { context: { ...SYS } })).id);
    id.open = String((await ql.insert(PUBLIC_PARENT, { name: 'open' }, { context: { ...SYS } })).id);

    const file = await uploadFile(stack, token.admin, 'xd.txt');
    const parentOf = { mine: CASE, other: CASE, vault: VAULT, open: PUBLIC_PARENT } as const;
    for (const key of ['mine', 'other', 'vault', 'open'] as const) {
      const c = await ql.insert(
        COMMENT,
        { thread_id: `${parentOf[key]}:${id[key]}`, body: `xd ${key}`, author_id: 'usr_xd_fixture' },
        { context: { ...SYS } },
      );
      comment[key] = String(c.id);
      const a = await ql.insert(
        ATTACHMENT,
        { parent_object: parentOf[key], parent_id: id[key], file_id: file, file_name: `${key}.txt`, mime_type: 'text/plain', size: FILE_BYTES.length },
        { context: { ...SYS } },
      );
      attachment[key] = String(a.id);
    }

    await assertArmed([
      armedWhen({
        control: 'the deployment registers 120 or more parent objects beside the platform’s own',
        disarmedBy: 'a fixture with fewer parents keeps a flat per-parent OR chain inside the budget',
        observe: () => {
          const names = new Set<string>((ql.registry.getAllObjects() as Row[]).map((o) => String(o.name)));
          return { registered: names.size, fixtureParents: [...names].filter((n) => n.startsWith('xd_')).length };
        },
        armed: (o) => o.fixtureParents >= 120 + 2,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the 100-level budget is engaged on the driver path the gated reads take',
        disarmedBy: 'a budget the driver never applies would let every case below pass at the native 1000-level limit',
        observe: async () => {
          const attempt = async (levels: number, on: boolean) => {
            budget.on = on;
            try {
              await ql.find(COMMENT, { where: nestedOr(levels), limit: 1, context: { ...SYS } });
              return 'served';
            } catch (err) {
              // The driver answers a refused statement with its own envelope and
              // keeps SQLite's diagnostic as the (non-enumerable) cause.
              const said = [err, (err as { cause?: unknown })?.cause].map((e) => String((e as Error)?.message ?? e));
              return said.some((text) => TOO_DEEP.test(text)) ? 'too-deep' : `other: ${said.join(' <- ')}`;
            } finally {
              budget.on = false;
            }
          };
          return { shallow: await attempt(90, true), deep: await attempt(110, true), deepUnbounded: await attempt(110, false) };
        },
        armed: (o) => o.shallow === 'served' && o.deep === 'too-deep' && o.deepUnbounded === 'served',
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the member opens its own case and the public parent, and neither the writer’s case nor the vault',
        disarmedBy: 'a member who could open every parent would make the withheld rows below measure nothing',
        observe: async () => ({
          mine: (await stack.apiAs(token.member, 'GET', `/data/${CASE}/${id.mine}`)).status,
          open: (await stack.apiAs(token.member, 'GET', `/data/${PUBLIC_PARENT}/${id.open}`)).status,
          other: (await stack.apiAs(token.member, 'GET', `/data/${CASE}/${id.other}`)).status,
          vault: (await stack.apiAs(token.member, 'GET', `/data/${VAULT}/${id.vault}`)).status,
        }),
        armed: (o) => o.mine === 200 && o.open === 200 && [403, 404].includes(o.other) && [403, 404].includes(o.vault),
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 600_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  const cases: Array<{ name: string; path: () => string; expect: () => string[] }> = [
    {
      name: 'a sorted comment read',
      path: () => `/data/${COMMENT}?top=50&sort=created_at`,
      expect: () => [comment.mine, comment.open],
    },
    {
      name: 'a comment read filtered by thread',
      path: () => `/data/${COMMENT}?filter=${enc(['thread_id', '=', `${CASE}:${id.mine}`])}`,
      expect: () => [comment.mine],
    },
    {
      name: 'a comment read filtered by a thread the member may not open',
      path: () => `/data/${COMMENT}?filter=${enc(['thread_id', '=', `${CASE}:${id.other}`])}`,
      expect: () => [],
    },
    {
      name: 'a comment read filtered by a thread on an object the member may not read',
      path: () => `/data/${COMMENT}?filter=${enc(['thread_id', '=', `${VAULT}:${id.vault}`])}`,
      expect: () => [],
    },
    {
      name: 'a sorted attachment read',
      path: () => `/data/${ATTACHMENT}?top=50&sort=created_at`,
      expect: () => [attachment.mine, attachment.open],
    },
    {
      name: 'an attachment read filtered by parent',
      path: () => `/data/${ATTACHMENT}?filter=${enc(['and', ['parent_object', '=', CASE], ['parent_id', '=', id.mine]])}`,
      expect: () => [attachment.mine],
    },
    {
      name: 'an attachment read filtered by a parent the member may not open',
      path: () => `/data/${ATTACHMENT}?filter=${enc(['and', ['parent_object', '=', CASE], ['parent_id', '=', id.other]])}`,
      expect: () => [],
    },
  ];

  for (const c of cases) {
    it(`${c.name} is served within the budget, with the rows and total it is served without it`, async () => {
      const { within, budgetApplied, unbounded } = await both('member', c.path());
      expect(budgetApplied, 'the budget reached this read’s SQL').toBe(true);
      expect(within).toEqual(unbounded);
      expect(within.status).toBe(200);
      expect(within.ids).toEqual([...c.expect()].sort());
      expect(within.total).toBe(c.expect().length);
    });
  }

  it('the writer and the administrator are served their own reads within the budget too', async () => {
    const writer = await both('writer', `/data/${COMMENT}?top=50&sort=created_at`);
    expect(writer.within).toEqual(writer.unbounded);
    expect(writer.within.ids).toEqual([comment.other, comment.open].sort());
    const admin = await both('admin', `/data/${ATTACHMENT}?filter=${enc(['parent_object', '=', VAULT])}`);
    expect(admin.within).toEqual(admin.unbounded);
    expect(admin.within.ids).toEqual([attachment.vault]);
  });
});
