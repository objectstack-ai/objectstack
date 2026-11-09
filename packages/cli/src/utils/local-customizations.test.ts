// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The pure half of `os build`'s local-customization notice: which database it
// reads, which file a URL names, what it says for each reading, and that only
// `os build` says it. Reading a real SQLite file is the integration half
// (`local-customizations.sqlite.test.ts`).

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sqliteFilenameFromUrl } from '@objectstack/runtime';
import {
  devDatabaseEnv,
  localSqliteFile,
  localCustomizationNotice,
  readCustomizationsFromSqlite,
  readLocalCustomizations,
} from './local-customizations.js';
import Build from '../commands/build.js';
import Compile from '../commands/compile.js';

const dirs: string[] = [];
function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'os-local-customizations-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('the database the notice reads is the one `os dev` opens', () => {
  it('layers the development .env files under the process environment, without loading them', () => {
    const root = tempProject();
    fs.writeFileSync(path.join(root, '.env'), 'OS_DATABASE_URL=file:./from-env-file.db\nOS_ONLY_IN_FILE=1\n');
    fs.writeFileSync(path.join(root, '.env.development'), 'OS_DATABASE_URL=file:./from-development.db\n');

    const fromFiles = devDatabaseEnv(root, {});
    expect(fromFiles.OS_DATABASE_URL).toBe('file:./from-development.db');
    expect(fromFiles.OS_ONLY_IN_FILE).toBe('1');

    // dotenv-flow never overrides a variable the process already has.
    expect(devDatabaseEnv(root, { OS_DATABASE_URL: 'file:/from-shell.db' }).OS_DATABASE_URL).toBe('file:/from-shell.db');
    expect(process.env.OS_ONLY_IN_FILE).toBeUndefined();
  });

  it('names a file only for a local SQLite URL', () => {
    expect(localSqliteFile('file:/tmp/x/objectstack.db', sqliteFilenameFromUrl)).toBe('/tmp/x/objectstack.db');
    expect(localSqliteFile('wasm-sqlite:///tmp/x/objectstack.db', sqliteFilenameFromUrl)).toBe('/tmp/x/objectstack.db');
    expect(localSqliteFile('file::memory:', sqliteFilenameFromUrl)).toBeNull();
    expect(localSqliteFile(':memory:', sqliteFilenameFromUrl)).toBeNull();
    expect(localSqliteFile('postgres://u:p@db:5432/app', sqliteFilenameFromUrl)).toBeNull();
    expect(localSqliteFile('libsql://app.turso.io', sqliteFilenameFromUrl)).toBeNull();
  });

  it('reads nothing when the resolved database is remote or not created yet', async () => {
    const root = tempProject();
    expect(await readLocalCustomizations({ projectRoot: root, env: { OS_DATABASE_URL: 'postgres://u:p@db:5432/app' } }))
      .toEqual({ status: 'not_applicable' });
    // The unified default `<root>/.objectstack/data/objectstack.db`, never booted.
    expect(await readLocalCustomizations({ projectRoot: root, env: {} })).toEqual({ status: 'not_applicable' });
    expect(await readCustomizationsFromSqlite(path.join(root, 'absent.db'))).toEqual({ status: 'not_applicable' });
  });

  it('reads nothing, and never throws, for a selection the dev boot refuses', async () => {
    const root = tempProject();
    expect(await readLocalCustomizations({ projectRoot: root, env: { OS_DATABASE_DRIVER: 'memory' } }))
      .toEqual({ status: 'not_applicable' });
  });
});

describe('what the notice says', () => {
  it('names each pair, the count, the file and `os package export`', () => {
    const lines = localCustomizationNotice({
      status: 'found',
      filename: '/p/.objectstack/data/objectstack.db',
      packages: [
        { id: 'com.example.app.custom', items: 2 },
        { id: 'com.vendor.crm.custom', items: 1 },
      ],
    });
    const text = lines.join('\n');
    expect(text).toContain('3 Studio customizations');
    expect(text).toContain('com.example.app.custom (2)');
    expect(text).toContain('com.vendor.crm.custom (1)');
    expect(text).toContain('/p/.objectstack/data/objectstack.db');
    expect(text).toContain('os package export');
  });

  it('says it could not check, never that there is nothing, when the read failed', () => {
    const text = localCustomizationNotice({ status: 'unknown', filename: '/p/x.db', detail: 'file is not a database' }).join('\n');
    expect(text).toContain('Could not check /p/x.db');
    expect(text).toContain('file is not a database');
    expect(text).toContain('os package export');
  });

  it('says nothing when there is nothing to leave behind', () => {
    expect(localCustomizationNotice({ status: 'none', filename: '/p/x.db' })).toEqual([]);
    expect(localCustomizationNotice({ status: 'not_applicable' })).toEqual([]);
  });
});

describe('only `os build` says it', () => {
  it('turns the notice on for build and leaves it off for compile, which `os dev` runs', () => {
    const flag = (C: typeof Compile) => (Reflect.construct(C, [[], {}]) as unknown as { reportsLocalCustomizations: boolean })
      .reportsLocalCustomizations;
    expect(flag(Build)).toBe(true);
    expect(flag(Compile)).toBe(false);
  });
});
