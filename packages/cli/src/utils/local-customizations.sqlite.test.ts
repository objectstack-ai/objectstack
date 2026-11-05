// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The integration half of `os build`'s local-customization notice: the read
// against a real SQLite file, the shape `os dev` leaves in
// `.objectstack/data/objectstack.db` (a `sys_metadata` row per stored item,
// keyed by `package_id`). The pure half is `local-customizations.test.ts`.

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
// Loaded here, at module top, so no clocked test pays the runtime graph's first
// load inside its window: `readLocalCustomizations` imports it lazily.
import '@objectstack/runtime';
import { readCustomizationsFromSqlite, readLocalCustomizations } from './local-customizations.js';

const dirs: string[] = [];
function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-local-customizations-db-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function devDatabase(root: string, rows: Array<[type: string, name: string, packageId: string | null]>): string {
  const file = path.join(root, '.objectstack', 'data', 'objectstack.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec('CREATE TABLE sys_metadata (id TEXT PRIMARY KEY, type TEXT, name TEXT, package_id TEXT, state TEXT)');
  const insert = db.prepare('INSERT INTO sys_metadata (id, type, name, package_id, state) VALUES (?, ?, ?, ?, ?)');
  rows.forEach(([type, name, packageId], i) => insert.run(`m${i}`, type, name, packageId, 'active'));
  db.close();
  return file;
}

describe('reading the stored `.custom` items of the dev database', () => {
  it('counts the items of each `.custom` package, and nothing else', async () => {
    const root = tempProject();
    const file = devDatabase(root, [
      ['view', 'asset_list', 'com.example.asset-repair.custom'],
      ['dashboard', 'ops', 'com.example.asset-repair.custom'],
      ['view', 'lead_list', 'com.vendor.crm.custom'],
      ['view', 'authored', 'com.example.studio-app'],
      ['view', 'packageless', null],
      // A package whose id merely contains the suffix is not a pair.
      ['view', 'decoy', 'com.custom.tools'],
      // The suffix ends the id; `.customs` is another package.
      ['view', 'decoy2', 'com.example.customs'],
    ]);

    const reading = await readLocalCustomizations({ projectRoot: root, env: {} });
    expect(reading).toEqual({
      status: 'found',
      filename: file,
      packages: [
        { id: 'com.example.asset-repair.custom', items: 2 },
        { id: 'com.vendor.crm.custom', items: 1 },
      ],
    });
  });

  it('answers none for a database with no `.custom` item, or not yet booted into tables', async () => {
    const root = tempProject();
    const file = devDatabase(root, [['view', 'authored', 'com.example.studio-app']]);
    expect(await readCustomizationsFromSqlite(file)).toEqual({ status: 'none', filename: file });

    const empty = path.join(tempProject(), 'empty.db');
    new Database(empty).close();
    expect(await readCustomizationsFromSqlite(empty)).toEqual({ status: 'none', filename: empty });
  });

  it('opens the file read-only: it is byte-identical after the read', async () => {
    const root = tempProject();
    const file = devDatabase(root, [['view', 'asset_list', 'com.example.app.custom']]);
    const before = fs.readFileSync(file);
    await readCustomizationsFromSqlite(file);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('answers unknown, with the reason, for a file that is not a database', async () => {
    const file = path.join(tempProject(), 'objectstack.db');
    fs.writeFileSync(file, 'not a sqlite database, just text that is long enough to have a header'.repeat(10));
    const reading = await readCustomizationsFromSqlite(file);
    expect(reading.status).toBe('unknown');
    expect(reading).toMatchObject({ filename: file });
  });

  it('follows OS_DATABASE_URL to the file `os dev` would open', async () => {
    const root = tempProject();
    const elsewhere = devDatabase(tempProject(), [['view', 'v', 'com.example.app.custom']]);
    const reading = await readLocalCustomizations({ projectRoot: root, env: { OS_DATABASE_URL: `file:${elsewhere}` } });
    expect(reading).toMatchObject({ status: 'found', filename: elsewhere });
  });
});
