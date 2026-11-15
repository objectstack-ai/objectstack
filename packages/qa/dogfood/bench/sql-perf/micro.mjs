#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The "expected gain" half of the SQL performance baseline: on a database that
 * `bench.mjs` has already seeded, time the statement the engine runs TODAY
 * beside the statement it could run instead, straight through the driver's own
 * client (no HTTP, no engine). Each pair is one inventory item of the M0 ranked
 * list; the "today" text is copied from the SQL the benchmark captured.
 *
 *   node packages/qa/dogfood/bench/sql-perf/micro.mjs --dialect sqlite --scale 1000000
 *   node packages/qa/dogfood/bench/sql-perf/micro.mjs --dialect pg --scale 1000000 \
 *     --pg-url postgres://postgres@127.0.0.1:5432/postgres
 *
 * It creates two temporary indexes (`owner_id`, `created_at`) for the index pairs
 * and drops each again before moving on, so the seeded database is left as it was.
 * Output: `<work-dir>/results/micro-<dialect>-<scale>.{json,md}`.
 */

import { createRequire } from 'node:module';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '../..');
const driverRequire = createRequire(realpathSync(join(PKG_DIR, 'node_modules/@objectstack/driver-sql/package.json')));

const args = { dialect: 'sqlite', scale: 100_000, runs: 7, pgUrl: process.env.OS_BENCH_PG_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres', workDir: resolve(process.env.TMPDIR ?? '/tmp', 'os-sql-perf-bench'), timeoutMs: 120_000 };
for (let i = 2; i < process.argv.length; i++) {
  const [flag, inline] = process.argv[i].split('=');
  const val = () => (inline !== undefined ? inline : process.argv[++i]);
  if (flag === '--dialect') args.dialect = val();
  else if (flag === '--scale') args.scale = Number(val());
  else if (flag === '--runs') args.runs = Number(val());
  else if (flag === '--pg-url') args.pgUrl = val();
  else if (flag === '--work-dir') args.workDir = resolve(val());
  else if (flag === '--timeout-ms') args.timeoutMs = Number(val());
  else throw new Error(`unknown argument: ${process.argv[i]}`);
}

const pad = (n) => String(n).padStart(8, '0');
const opportunities = Math.max(100, Math.round(args.scale / 10));
const accounts = Math.max(10, Math.round(args.scale / 100));

/** A tiny client over either database, with a per-statement deadline. */
async function open() {
  if (args.dialect === 'sqlite') {
    const Database = driverRequire('better-sqlite3');
    const db = new Database(join(args.workDir, `bench-${args.scale}.sqlite`));
    return {
      all: async (sql, binds = []) => db.prepare(sql).all(binds),
      run: async (sql) => db.exec(sql),
      close: async () => db.close(),
    };
  }
  const { Client } = driverRequire('pg');
  const url = new URL(args.pgUrl);
  url.pathname = `/os_sqlperf_${args.scale}`;
  const c = new Client({ connectionString: url.toString(), statement_timeout: args.timeoutMs });
  await c.connect();
  let n = 0;
  return {
    all: async (sql, binds = []) => { n = 0; const text = sql.replace(/\?/g, () => `$${++n}`); return (await c.query(text, binds)).rows; },
    run: async (sql) => c.query(sql),
    close: async () => c.end(),
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

async function time(db, sql, binds) {
  await db.all(sql, binds); // warm
  const ms = [];
  let rows = 0;
  for (let i = 0; i < args.runs; i++) {
    const t0 = performance.now();
    const r = await db.all(sql, binds);
    ms.push(performance.now() - t0);
    rows = r.length;
  }
  return { ms: Math.round(median(ms) * 100) / 100, rows };
}

async function main() {
  const db = await open();
  const memberId = (await db.all('select owner_id from bench_account where id = ?', [`ac${pad(0)}`]))[0]?.owner_id;
  if (!memberId) throw new Error('no seeded bench_account row; run bench.mjs at this scale first');
  const chainAll = 'opportunity in (select id from bench_opportunity where account in (select id from bench_account))';
  const chainMember = 'opportunity in (select id from bench_opportunity where account in (select id from bench_account where owner_id = ?))';
  const productIds = (await db.all("select id from bench_product where family = 'hardware' order by id")).map((r) => r.id);
  const inList = (ids) => ids.map(() => '?').join(', ');
  const tz = args.dialect === 'sqlite'
    ? "strftime('%Y-%m', datetime(close_date, '+8 hours'))"
    : "to_char((close_date::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')";

  const pairs = [
    {
      item: 'I1 vacuous controlled-by-parent chain on an unrestricted (admin) read',
      today: `select * from bench_line_item where status = 'open' and quantity >= 10 and ${chainAll} order by created_at desc, id desc limit 50`,
      target: "select * from bench_line_item where status = 'open' and quantity >= 10 order by created_at desc, id desc limit 50",
    },
    {
      item: 'I1b the same, on the list total',
      today: `select count(*) as n from bench_line_item where status = 'open' and quantity >= 10 and ${chainAll}`,
      target: "select count(*) as n from bench_line_item where status = 'open' and quantity >= 10",
    },
    {
      item: 'I2 list total (count(*)) beside the page it accompanies — member, read-scoped',
      today: `select count(*) as n from bench_line_item where ${chainMember}`,
      target: `select * from bench_line_item where ${chainMember} order by created_at desc, id desc limit 50`,
      binds: [memberId],
      targetBinds: [memberId],
      note: 'not a rewrite: the second statement is the page itself, to size what the total adds',
    },
    {
      item: 'I3 cross-object filter: materialized id list vs a subquery (small match)',
      today: `select * from bench_line_item where product in (${inList(productIds)}) and ${chainAll} order by created_at desc, id desc limit 50`,
      target: `select * from bench_line_item where product in (select id from bench_product where family = 'hardware') and ${chainAll} order by created_at desc, id desc limit 50`,
      binds: productIds,
      targetBinds: [],
    },
    {
      item: 'I3b cross-object filter over the 1000-id cap (refused today with INVALID_FILTER): the subquery that would serve it',
      today: null,
      target: `select * from bench_line_item where opportunity in (select id from bench_opportunity where stage = 'won') and ${chainAll} order by created_at desc, id desc limit 50`,
    },
    {
      item: 'I4 per-measure aggregation filter: every row to the app vs a conditional aggregate',
      today: `select * from bench_line_item where ${chainAll}`,
      target: `select status, sum(case when quantity >= 10 then quantity end) as big, count(*) as n from bench_line_item where ${chainAll} group by status`,
    },
    {
      item: 'I5 non-UTC month bucket: every row to the app vs a zone-aware SQL bucket',
      today: 'select * from bench_opportunity where account in (select id from bench_account)',
      target: `select ${tz} as bucket, count(*) as n from bench_opportunity where account in (select id from bench_account) group by 1`,
    },
    {
      item: 'I6 analytics dimension through a lookup: group by FK + id list + regroup vs one join',
      today: `select opportunity, count(*) as n from bench_line_item where ${chainAll} group by opportunity`,
      target: `select o.stage, count(*) as n from bench_line_item l join bench_opportunity o on o.id = l.opportunity where l.${chainAll} group by o.stage`,
      note: 'today is the first of the two reads only; the second binds every distinct FK value as an IN list',
    },
  ];

  const results = [];
  for (const p of pairs) {
    const today = p.today ? await time(db, p.today, p.binds) : null;
    const target = await time(db, p.target, p.targetBinds ?? (p.today ? p.binds : undefined));
    results.push({ ...p, todayMs: today?.ms ?? null, todayRows: today?.rows ?? null, targetMs: target.ms, targetRows: target.rows });
    console.log(`${p.item}\n  today ${today ? `${today.ms} ms (${today.rows} rows)` : 'refused'} · target ${target.ms} ms (${target.rows} rows)`);
  }

  // I7: the owner column the private-OWD read scope filters on carries no index.
  const memberChainSql = `select count(*) as n from bench_line_item where ${chainMember}`;
  const accountsSql = 'select * from bench_account where owner_id = ? order by created_at desc limit 50';
  const before = { chain: await time(db, memberChainSql, [memberId]), accounts: await time(db, accountsSql, [memberId]) };
  await db.run('create index if not exists tmp_bench_account_owner on bench_account (owner_id)');
  if (args.dialect === 'pg') await db.run('analyze bench_account'); else await db.run('analyze');
  const after = { chain: await time(db, memberChainSql, [memberId]), accounts: await time(db, accountsSql, [memberId]) };
  await db.run('drop index tmp_bench_account_owner');
  results.push({ item: 'I7 owner_id carries no index (member chain count, unindexed vs indexed)', today: memberChainSql, todayMs: before.chain.ms, targetMs: after.chain.ms, target: '(same, with an index on bench_account.owner_id)' });
  results.push({ item: 'I7b owner_id carries no index (member account list)', today: accountsSql, todayMs: before.accounts.ms, targetMs: after.accounts.ms, target: '(same, with an index on bench_account.owner_id)' });
  console.log(`I7 member chain count: ${before.chain.ms} ms unindexed -> ${after.chain.ms} ms indexed; accounts ${before.accounts.ms} -> ${after.accounts.ms}`);

  // I8: the default list order (`created_at desc`) has no index, so every
  // default-ordered page sorts its whole filtered set before taking 50 rows.
  const pageSql = `select * from bench_line_item where ${chainMember} order by created_at desc, id desc limit 50`;
  const adminPageSql = 'select * from bench_line_item order by created_at desc, id desc limit 50';
  const sortBefore = { member: await time(db, pageSql, [memberId]), admin: await time(db, adminPageSql) };
  await db.run('create index if not exists tmp_bench_line_item_created on bench_line_item (created_at, id)');
  if (args.dialect === 'pg') await db.run('analyze bench_line_item'); else await db.run('analyze');
  const sortAfter = { member: await time(db, pageSql, [memberId]), admin: await time(db, adminPageSql) };
  await db.run('drop index tmp_bench_line_item_created');
  results.push({ item: 'I8 default order created_at carries no index (member page)', today: pageSql, todayMs: sortBefore.member.ms, targetMs: sortAfter.member.ms, target: '(same, with an index on bench_line_item (created_at, id))' });
  results.push({ item: 'I8b default order created_at carries no index (unfiltered page)', today: adminPageSql, todayMs: sortBefore.admin.ms, targetMs: sortAfter.admin.ms, target: '(same, with an index on bench_line_item (created_at, id))' });
  console.log(`I8 member page: ${sortBefore.member.ms} -> ${sortAfter.member.ms} ms; unfiltered page ${sortBefore.admin.ms} -> ${sortAfter.admin.ms} ms`);
  await db.close();

  const outDir = join(args.workDir, 'results');
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `micro-${args.dialect}-${args.scale}`);
  writeFileSync(`${base}.json`, JSON.stringify({ dialect: args.dialect, scale: args.scale, runs: args.runs, accounts, opportunities, results }, null, 2));
  const md = [`# SQL pairs — ${args.dialect}, ${args.scale} line items (median of ${args.runs})`, '', '| item | today ms | target ms |', '|:--|--:|--:|',
    ...results.map((r) => `| ${r.item} | ${r.todayMs ?? 'refused'} | ${r.targetMs} |`)].join('\n') + '\n';
  writeFileSync(`${base}.md`, md);
  console.log(`wrote ${base}.json and ${base}.md`);
}

main().catch((e) => { console.error(`[micro] FAILED: ${e?.stack ?? e}`); process.exit(1); });
