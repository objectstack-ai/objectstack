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
 * It creates two temporary indexes (`owner_id`, `created_at`) for the index pairs.
 * Each is dropped (`drop index if exists`) before its "before" reading, so an
 * index a crashed run left behind cannot pose as the baseline, and again in a
 * `finally`, so the seeded database is left as it was.
 * Output: `<work-dir>/results/micro-<dialect>-<scale>.{json,md}`, stamped with the
 * `git rev-parse --short HEAD` of this checkout: the "today" SQL is hand-copied
 * from one tree, and a reading describes only the engine of that commit.
 * `--only m0,r9,r10` runs a subset of the groups (I1–I8, I9, I10) and adds the
 * groups to the file name. I9 writes nothing; I10 rewrites the summary values
 * the seed already holds, so it leaves the database as it was.
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '../..');
const driverRequire = createRequire(realpathSync(join(PKG_DIR, 'node_modules/@objectstack/driver-sql/package.json')));

const args = { dialect: 'sqlite', scale: 100_000, runs: 7, pgUrl: process.env.OS_BENCH_PG_URL ?? 'postgres://postgres@127.0.0.1:5432/postgres', workDir: resolve(process.env.TMPDIR ?? '/tmp', 'os-sql-perf-bench'), timeoutMs: 120_000, only: undefined };
for (let i = 2; i < process.argv.length; i++) {
  const [flag, inline] = process.argv[i].split('=');
  const val = () => (inline !== undefined ? inline : process.argv[++i]);
  if (flag === '--dialect') args.dialect = val();
  else if (flag === '--scale') args.scale = Number(val());
  else if (flag === '--runs') args.runs = Number(val());
  else if (flag === '--pg-url') args.pgUrl = val();
  else if (flag === '--work-dir') args.workDir = resolve(val());
  else if (flag === '--timeout-ms') args.timeoutMs = Number(val());
  else if (flag === '--only') args.only = val().split(','); // groups: m0 (I1–I8), r9 (I9), r10 (I10)
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
      write: async (sql, binds = []) => db.prepare(sql).run(binds),
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
    write: async (sql, binds = []) => { n = 0; const text = sql.replace(/\?/g, () => `$${++n}`); return c.query(text, binds); },
    close: async () => c.end(),
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };

async function time(db, sql, binds) {
  await db.all(sql, binds); // warm
  const ms = [];
  let rows = 0;
  let first;
  for (let i = 0; i < args.runs; i++) {
    const t0 = performance.now();
    const r = await db.all(sql, binds);
    ms.push(performance.now() - t0);
    rows = r.length;
    first = r[0];
  }
  return { ms: Math.round(median(ms) * 100) / 100, rows, first };
}

/**
 * I10 (R10): the roll-up recompute after one batch child write on `bench_roll2`
 * (two summary fields) that touched 10 distinct parents. Today, per parent per
 * summary field: one aggregate, two full reads of the parent, one update (the
 * statements `bench.mjs --sql-log` captured for `rollup2_insert_p10`). Target:
 * one grouped aggregate for both fields and every parent, then one update per
 * parent. Both write the values the seed already holds, so the database is left
 * as it was; the target's answer is checked against today's.
 */
async function rollupPairs(db) {
  const parents = Array.from({ length: 10 }, (_, i) => `r2p${pad(i)}`);
  const seeded = await db.all('select count(*) as n from bench_roll2 where id = ?', [parents[0]]);
  if (!Number(seeded[0]?.n ?? 0)) return { results: [], note: 'no roll-up rows: run bench.mjs at this scale first' };
  const today = async () => {
    const out = {};
    for (const p of parents) {
      const sum = (await db.all('select sum(quantity) as value from bench_roll2_item where parent = ?', [p]))[0].value;
      await db.all('select * from bench_roll2 where id = ? limit 1', [p]);
      await db.all('select * from bench_roll2 where id = ? limit 1', [p]);
      await db.write('update bench_roll2 set total_quantity = ? where id = ?', [sum, p]);
      const count = (await db.all('select count(*) as value from bench_roll2_item where parent = ?', [p]))[0].value;
      await db.all('select * from bench_roll2 where id = ? limit 1', [p]);
      await db.all('select * from bench_roll2 where id = ? limit 1', [p]);
      await db.write('update bench_roll2 set item_count = ? where id = ?', [count, p]);
      out[p] = [Number(sum), Number(count)];
    }
    return out;
  };
  const target = async () => {
    const rows = await db.all(`select parent, sum(quantity) as total_quantity, count(*) as item_count from bench_roll2_item where parent in (${parents.map(() => '?').join(', ')}) group by parent`, parents);
    const out = {};
    for (const r of rows) {
      await db.write('update bench_roll2 set total_quantity = ?, item_count = ? where id = ?', [r.total_quantity, r.item_count, r.parent]);
      out[r.parent] = [Number(r.total_quantity), Number(r.item_count)];
    }
    return out;
  };
  const a = await today();
  const b = await target();
  const key = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const same = key(a) === key(b);
  const seq = async (fn) => {
    await fn();
    const ms = [];
    for (let i = 0; i < args.runs; i++) { const t0 = performance.now(); await fn(); ms.push(performance.now() - t0); }
    return Math.round(median(ms) * 100) / 100;
  };
  return {
    results: [{
      item: 'I10 roll-up recompute, 10 parents x 2 summary fields: 80 statements (aggregate + 2 parent reads + update, per parent per field) vs 11 (one grouped aggregate + one update per parent)',
      today: '10 x [select sum(quantity) … where parent = ?; select * from bench_roll2 where id = ? x2; update bench_roll2 set total_quantity = ?; select count(*) … where parent = ?; select * x2; update … set item_count = ?]',
      target: 'select parent, sum(quantity), count(*) from bench_roll2_item where parent in (?×10) group by parent; then 10 x update bench_roll2 set total_quantity = ?, item_count = ? where id = ?',
      todayMs: await seq(today), targetMs: await seq(target),
      todayAnswer: 'per-parent values', targetAnswer: same ? 'same values' : 'DIFFERENT values', sameAnswer: same,
      todayStatements: 80, targetStatements: 11,
    }],
  };
}

/**
 * I9 (R9): the sharing read scope. Today the sharing service reads the
 * member's grants (`limit 5000`) and the engine binds every `record_id` into
 * `id in (…)`, once for the page and once again for the total; the target folds
 * the grants into the statement as a subquery. The "today" text is copied from
 * the statements `bench.mjs --sql-log` captured for the member; it needs a
 * database `bench.mjs --shares N` seeded. Each pair also compares the ANSWER
 * (page row count, the total): a faster statement that answers differently is
 * not a rewrite. Where the member holds more than 5000 grants the two differ by
 * design, and the row says so.
 */
async function sharePairs(db, memberId) {
  const grantsSql = 'select record_id, access_level from sys_record_share where object_name = ? and recipient_type = ? and recipient_id = ? order by id asc limit 5000';
  const grantBinds = ['bench_account', 'user', memberId];
  const held = (await db.all('select count(*) as n from sys_record_share where object_name = ? and recipient_type = ? and recipient_id = ?', grantBinds))[0];
  const heldN = Number(held?.n ?? held?.count ?? 0);
  if (heldN === 0) return { held: 0, results: [], note: 'no shares seeded: run bench.mjs --shares N at this scale first' };
  const grants = await time(db, grantsSql, grantBinds);
  const ids = (await db.all(grantsSql, grantBinds)).map((r) => r.record_id);
  const inIds = `(${ids.map(() => '?').join(', ')})`;
  const sub = '(select record_id from sys_record_share where object_name = ? and recipient_type = ? and recipient_id = ?)';
  const scopeToday = `((owner_id = ?) or (id in ${inIds}))`;
  const scopeTarget = `((owner_id = ?) or (id in ${sub}))`;
  const todayBinds = [memberId, ...ids];
  const targetBinds = [memberId, ...grantBinds];
  const chain = (scope) => `opportunity in (select id from bench_opportunity where account in (select id from bench_account where ${scope}))`;
  const rows = [
    ['I9 member account page', (sc) => `select * from bench_account where ${sc} order by created_at desc, id desc limit 50`],
    ['I9b member account total', (sc) => `select count(*) as n from bench_account where ${sc}`],
    ['I9c member line-item page (the controlled-by-parent chain carries the share scope)', (sc) => `select * from bench_line_item where ${chain(sc)} order by created_at desc, id desc limit 50`],
    ['I9d member line-item total', (sc) => `select count(*) as n from bench_line_item where ${chain(sc)}`],
  ];
  const out = [{ item: `I9r the grants read itself (${heldN} held, ${ids.length} returned), run before the page and again before the total`, today: grantsSql, todayMs: grants.ms, todayRows: grants.rows, target: '(none: folded into the statement)', targetMs: null }];
  for (const [item, sql] of rows) {
    const today = await time(db, sql(scopeToday), todayBinds);
    const target = await time(db, sql(scopeTarget), targetBinds);
    const answer = (t) => (t.first && ('n' in t.first || 'count' in t.first) ? Number(t.first.n ?? t.first.count) : t.rows);
    const same = answer(today) === answer(target);
    out.push({
      item, today: sql(scopeToday).replace(inIds, `(?×${ids.length})`), target: sql(scopeTarget),
      todayMs: today.ms, targetMs: target.ms, todayAnswer: answer(today), targetAnswer: answer(target), sameAnswer: same,
      note: same ? undefined : `answers differ: today ${answer(today)}, target ${answer(target)} — the ${heldN - ids.length} grants past the 5000 read limit`,
    });
  }
  return { held: heldN, returned: ids.length, results: out };
}

async function dropIndex(db, name, table) {
  await db.run(`drop index if exists ${name}`);
  // Prove it: a "before" reading taken with the index still present is not a baseline.
  const left = args.dialect === 'sqlite'
    ? await db.all("select name from sqlite_master where type = 'index' and name = ?", [name])
    : await db.all('select indexname from pg_indexes where tablename = ? and indexname = ?', [table, name]);
  if (left.length) throw new Error(`temporary index ${name} is still present after drop`);
}

const analyze = (db, table) => db.run(args.dialect === 'pg' ? `analyze ${table}` : 'analyze');

/** The planner's chosen plan, one line, so a reading says which plan it timed. */
async function plan(db, sql) {
  if (args.dialect === 'sqlite') return (await db.all(`explain query plan ${sql}`)).map((r) => r.detail).join(' | ');
  return (await db.all(`explain ${sql}`)).map((r) => r['QUERY PLAN'].trim()).join(' | ');
}

async function main() {
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim(); } catch { /* not a checkout */ }
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
    ...(args.dialect === 'pg' ? [{
      item: 'I4b the same target spelled with PG `FILTER (WHERE …)` instead of `sum(case when … end)`',
      today: null,
      target: `select status, sum(quantity) filter (where quantity >= 10) as big, count(*) as n from bench_line_item where ${chainAll} group by status`,
      note: 'same rows as I4\'s target; times the other spelling R1 names',
    }] : []),
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
  const group = (g) => !args.only || args.only.includes(g);
  if (group('r9')) {
    const r9 = await sharePairs(db, memberId);
    for (const r of r9.results) {
      results.push(r);
      console.log(`${r.item}\n  today ${r.todayMs} ms${r.todayAnswer !== undefined ? ` (answer ${r.todayAnswer})` : ''} · target ${r.targetMs ?? 'n/a'} ms${r.targetAnswer !== undefined ? ` (answer ${r.targetAnswer})` : ''}${r.note ? ` · ${r.note}` : ''}`);
    }
    if (r9.note) console.log(`I9: ${r9.note}`);
  }
  if (group('r10')) {
    const r10 = await rollupPairs(db);
    for (const r of r10.results) {
      results.push(r);
      console.log(`${r.item}\n  today ${r.todayMs} ms · target ${r.targetMs} ms · ${r.targetAnswer}`);
    }
    if (r10.note) console.log(`I10: ${r10.note}`);
  }
  if (!group('m0')) return finish(db, commit, results);
  for (const p of pairs) {
    const today = p.today ? await time(db, p.today, p.binds) : null;
    const target = await time(db, p.target, p.targetBinds ?? (p.today ? p.binds : undefined));
    results.push({ ...p, todayMs: today?.ms ?? null, todayRows: today?.rows ?? null, targetMs: target.ms, targetRows: target.rows });
    console.log(`${p.item}\n  today ${today ? `${today.ms} ms (${today.rows} rows)` : 'n/a'} · target ${target.ms} ms (${target.rows} rows)`);
  }

  // I7: the owner column the private-OWD read scope filters on carries no index.
  const memberChainSql = `select count(*) as n from bench_line_item where ${chainMember}`;
  const accountsSql = 'select * from bench_account where owner_id = ? order by created_at desc limit 50';
  let before;
  let after;
  try {
    await dropIndex(db, 'tmp_bench_account_owner', 'bench_account');
    before = { chain: await time(db, memberChainSql, [memberId]), accounts: await time(db, accountsSql, [memberId]) };
    await db.run('create index tmp_bench_account_owner on bench_account (owner_id)');
    await analyze(db, 'bench_account');
    after = { chain: await time(db, memberChainSql, [memberId]), accounts: await time(db, accountsSql, [memberId]) };
  } finally {
    await dropIndex(db, 'tmp_bench_account_owner', 'bench_account');
  }
  results.push({ item: 'I7 owner_id carries no index (member chain count, unindexed vs indexed)', today: memberChainSql, todayMs: before.chain.ms, targetMs: after.chain.ms, target: '(same, with an index on bench_account.owner_id)' });
  results.push({ item: 'I7b owner_id carries no index (member account list)', today: accountsSql, todayMs: before.accounts.ms, targetMs: after.accounts.ms, target: '(same, with an index on bench_account.owner_id)' });
  console.log(`I7 member chain count: ${before.chain.ms} ms unindexed -> ${after.chain.ms} ms indexed; accounts ${before.accounts.ms} -> ${after.accounts.ms}`);

  // I8: the default list order (`created_at desc`) has no index, so every
  // default-ordered page sorts its whole filtered set before taking 50 rows.
  // The admin's unrestricted page is timed twice: as the engine emits it today
  // (the vacuous controlled-by-parent chain still attached, see I1) and as it
  // would read once that chain is dropped (R4). The index's gain on the first
  // row is what the index buys alone; on the second, what index + R4 buy.
  const pageSql = `select * from bench_line_item where ${chainMember} order by created_at desc, id desc limit 50`;
  const adminPageSql = `select * from bench_line_item where ${chainAll} order by created_at desc, id desc limit 50`;
  const adminPageR4Sql = 'select * from bench_line_item order by created_at desc, id desc limit 50';
  const readSort = async () => ({ member: await time(db, pageSql, [memberId]), admin: await time(db, adminPageSql), adminR4: await time(db, adminPageR4Sql) });
  const plans = {};
  let sortBefore;
  let sortAfter;
  try {
    await dropIndex(db, 'tmp_bench_line_item_created', 'bench_line_item');
    sortBefore = await readSort();
    plans.before = { admin: await plan(db, adminPageSql), adminR4: await plan(db, adminPageR4Sql) };
    await db.run('create index tmp_bench_line_item_created on bench_line_item (created_at, id)');
    await analyze(db, 'bench_line_item');
    sortAfter = await readSort();
    plans.after = { admin: await plan(db, adminPageSql), adminR4: await plan(db, adminPageR4Sql) };
  } finally {
    await dropIndex(db, 'tmp_bench_line_item_created', 'bench_line_item');
  }
  const withIndex = '(same, with an index on bench_line_item (created_at, id))';
  results.push({ item: 'I8 default order created_at carries no index (member page)', today: pageSql, todayMs: sortBefore.member.ms, targetMs: sortAfter.member.ms, target: withIndex });
  results.push({ item: 'I8b default order created_at carries no index (admin page, chained as the engine emits it today)', today: adminPageSql, todayMs: sortBefore.admin.ms, targetMs: sortAfter.admin.ms, target: withIndex, plans: { before: plans.before.admin, after: plans.after.admin } });
  results.push({ item: 'I8c the same admin page with R4 (vacuous chain dropped)', today: adminPageR4Sql, todayMs: sortBefore.adminR4.ms, targetMs: sortAfter.adminR4.ms, target: withIndex, plans: { before: plans.before.adminR4, after: plans.after.adminR4 } });
  console.log(`I8 member page: ${sortBefore.member.ms} -> ${sortAfter.member.ms} ms; admin page (chained) ${sortBefore.admin.ms} -> ${sortAfter.admin.ms} ms; admin page with R4 ${sortBefore.adminR4.ms} -> ${sortAfter.adminR4.ms} ms`);
  for (const [k, v] of Object.entries(plans)) console.log(`  plan ${k} chained: ${v.admin}\n  plan ${k} with R4: ${v.adminR4}`);
  return finish(db, commit, results);
}

async function finish(db, commit, results) {
  await db.close();

  const outDir = join(args.workDir, 'results');
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `micro-${args.dialect}-${args.scale}${args.only ? `-${args.only.join('-')}` : ''}`);
  const measuredAt = new Date().toISOString();
  writeFileSync(`${base}.json`, JSON.stringify({ dialect: args.dialect, scale: args.scale, runs: args.runs, commit, measuredAt, accounts, opportunities, results }, null, 2));
  const md = [`# SQL pairs — ${args.dialect}, ${args.scale} line items (median of ${args.runs})`, '', `commit \`${commit}\` · ${measuredAt}${args.only ? ` · groups ${args.only.join(', ')}` : ''}`, '', '| item | today ms | target ms | answer today / target |', '|:--|--:|--:|:--|',
    ...results.map((r) => `| ${r.item} | ${r.todayMs ?? (r.item.startsWith('I3b') ? 'refused' : 'n/a')} | ${r.targetMs ?? 'n/a'} | ${r.todayAnswer !== undefined ? `${r.todayAnswer} / ${r.targetAnswer}${r.sameAnswer ? '' : ' (differ)'}` : ''} |`)].join('\n') + '\n';
  writeFileSync(`${base}.md`, md);
  console.log(`wrote ${base}.json and ${base}.md`);
}

main().catch((e) => { console.error(`[micro] FAILED: ${e?.stack ?? e}`); process.exit(1); });
