// Cross-process round-trip proof. Run twice:
//   node scripts/restart-proof.mjs write    # inserts a row, prints id
//   node scripts/restart-proof.mjs read <id> # re-opens file and asserts row exists
// With no args: run write + read in sequence (same-process; still validates
// the on-disk file is re-readable after disconnect).

import { SqliteWasmDriver } from '../dist/index.mjs';
import initSqlJs from 'sql.js';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const FILENAME =
  '/Users/zhuangjianguo/Documents/GitHub/objectstack/examples/app-todo/.objectstack/data/todo.wasm.db';
const STATE_FILE = new URL('./.restart-proof-id', import.meta.url);

const require = createRequire(import.meta.url);
// sql.js v1.14.1's `exports` map does not expose `./package.json`, so resolve
// the main entry (`.../sql.js/dist/sql-wasm.js`) and use its directory.
const sqlJsDir = dirname(require.resolve('sql.js'));
const locateFile = (file) => join(sqlJsDir, file);

async function writePhase() {
  const driver = new SqliteWasmDriver({
    filename: FILENAME,
    persist: 'on-write',
    locateFile,
  });
  await driver.connect();
  const knex = driver.knex;
  const id = 'proof_' + Math.random().toString(36).slice(2, 12);
  const subject = `wasm restart proof ${new Date().toISOString()}`;
  const now = new Date().toISOString();
  await knex('todo_task').insert({
    id,
    subject,
    status: 'not_started',
    priority: 'normal',
    created_at: now,
    updated_at: now,
  });
  await driver.flush();
  await driver.disconnect();
  await writeFile(STATE_FILE, id);
  console.log(`[write] inserted id=${id} subject=${JSON.stringify(subject)}`);
  return id;
}

async function readPhase(id) {
  const SQL = await initSqlJs({ locateFile });
  const bytes = await readFile(FILENAME);
  const db = new SQL.Database(new Uint8Array(bytes));
  const res = db.exec(
    `SELECT id, subject, status, priority FROM todo_task WHERE id = ?`,
    [id]
  );
  db.close();
  if (!res.length || !res[0].values.length) {
    throw new Error(`FAIL: row ${id} NOT found after reopening file.`);
  }
  console.log('[read]  reread row =', res[0].values[0]);
}

const mode = process.argv[2];
if (mode === 'write') {
  await writePhase();
} else if (mode === 'read') {
  const id = process.argv[3] ?? (await readFile(STATE_FILE, 'utf8')).trim();
  await readPhase(id);
  console.log('OK: row survived a process boundary.');
} else {
  const id = await writePhase();
  await readPhase(id);
  console.log('OK: SqliteWasmDriver round-trip via on-disk file passed.');
}
