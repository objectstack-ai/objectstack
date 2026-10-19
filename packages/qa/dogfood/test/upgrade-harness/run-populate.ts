// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24522] The populator's entry point, run under `tsx` by
// `scripts/gen-upgrade-harness-fixture.mjs` inside the checkout of the ref the
// fixture stands for. ⛔ Not a test: nothing here runs in the dogfood suite.
//
//   tsx run-populate.ts --db <scratch.db> --out <fixture dir> --ref <ref> --sha <sha>
//
// Three boots of that checkout's code over one SQLite file: the fresh install
// and its use, then one restart (an 18.0 database has been booted more than
// once, and a boot-time seeder writes on every boot). Then the census, which
// refuses an empty reshaped table, and the text dump.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { takeCensus } from './fixture-manifest.js';
import { bootFixture, useTheInstall } from './populate-fixture.js';
import { dumpSqliteToSql } from './sqlite-text-dump.js';

const { values } = parseArgs({
  options: { db: { type: 'string' }, out: { type: 'string' }, ref: { type: 'string' }, sha: { type: 'string' } },
});
const { db, out, ref, sha } = values;
if (!db || !out || !ref || !sha) throw new Error('run-populate: --db, --out, --ref and --sha are required');
if (existsSync(db)) throw new Error(`run-populate: ${db} exists; the fixture starts from a fresh install`);

const first = await bootFixture(db);
try {
  await useTheInstall(first);
} finally {
  await first.stop();
}
const restart = await bootFixture(db);
await restart.stop();

const manifest = takeCensus(db, ref, sha);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'database.sql'), dumpSqliteToSql(db));
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`run-populate: ${Object.keys(manifest.tables).length} tables; reshaped ${manifest.reshaped.map((t) => `${t.table}=${t.count}`).join(' ')}`);
// The kernel's timers and the driver's handles are gone after `stop()`, but a
// plugin's unref'd interval is not ours to wait for: the dump is written.
process.exit(0);
