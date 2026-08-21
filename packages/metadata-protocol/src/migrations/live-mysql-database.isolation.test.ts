// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10382 — this package's live-MySQL suites must not be able to share one
 * database.
 *
 * ## Why this suite is structural, and what it is a control FOR
 *
 * There is no defect run to reproduce, and that is a measurement rather than an
 * assumption. Before this change, both live files named their database with a
 * hard-coded constant; pointing BOTH constants at one name and running the
 * suite on a live MariaDB 10.11.14 produced four green runs, 10/10 — the
 * server's general query log shows the two files never overlap (file A's `drop
 * database` completes about a second before file B's first `Connect`, with
 * default settings and with `--maxWorkers=2 --fileParallelism` alike). See
 * `live-mysql-database.testkit.ts` for the log excerpt.
 *
 * So a green live run is not evidence here, in either direction: it was green
 * with the property present and green with the property deliberately broken.
 * What this suite asserts instead is the property that makes the collision
 * impossible — **two files resolve two different databases, and each file's
 * database derives from the file rather than from a shared constant** — which
 * needs no server at all.
 *
 * ⚠️ Which kind of control this is, stated plainly: it is an ABLATION control,
 * not a defect control. Its subject — the derivation — does not exist before
 * the change, so no pre-fix red run can exist. It is falsified by removing the
 * derivation (replace `currentLiveMysqlDatabase()` with a literal and this file
 * goes red), never by a pre-fix measurement. The one control that DOES red on
 * the pre-fix tree is `scripts/check-live-db-isolation.mjs`, which is a source
 * scan and therefore sees the constants that were there.
 *
 * ## Division of labour with the repo-wide gate
 *
 * This file asserts what only running code can answer: that the derivation is
 * injective over the real files on disk and fits both dialects' identifier
 * limits. `scripts/check-live-db-isolation.mjs` asserts what only a repo-wide
 * pass can: that no live suite ANYWHERE in the tree — including packages that
 * do not exist yet — names its database with a literal. Neither subsumes the
 * other, and each says so in its own header.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIVE_DB_PREFIX,
  currentLiveMysqlDatabase,
  liveMysqlDatabaseNameFor,
} from './live-mysql-database.testkit.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo-relative prefix of this directory — the key the derivation hashes. */
const DIR_KEY = 'packages/metadata-protocol/src/migrations/';

/** The identifier ceiling that binds: Postgres 63 bytes, MySQL 64. */
const IDENTIFIER_LIMIT = 63;

/** Source with line and block comments removed, so prose is not a hit. */
const codeOf = (file: string): string =>
  readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The REAL population, read off disk: every test file in this directory that
 * resolves a per-file live database.
 *
 * Not a hand-written list, for the reason #9350 records — a property that holds
 * for two invented strings and fails for the two files that actually collide is
 * a measurement of a neighbouring object. A file that starts calling the
 * resolver joins this list on its next run with nothing to remember.
 */
const LIVE_TEST_FILES = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .filter((f) => codeOf(f).includes('currentLiveMysqlDatabase('));

describe('live-MySQL suites — per-file database isolation (#10382)', () => {
  it('has a non-trivial file list to measure over', () => {
    // Guards the vacuous pass: every assertion below iterates this list, so an
    // empty list would report success having checked nothing. Three today —
    // the two live suites and this file.
    expect(LIVE_TEST_FILES.length).toBeGreaterThanOrEqual(3);
    expect(LIVE_TEST_FILES).toContain('seed-tenancy-backfill.live-mysql.test.ts');
    expect(LIVE_TEST_FILES).toContain('sys-setting-identity-index.live-mysql.test.ts');
  });

  it('gives every live file in this package a DISTINCT database', () => {
    const byName = new Map<string, string[]>();
    for (const file of LIVE_TEST_FILES) {
      const name = liveMysqlDatabaseNameFor(`${DIR_KEY}${file}`);
      byName.set(name, [...(byName.get(name) ?? []), file]);
    }
    const collisions = [...byName].filter(([, files]) => files.length > 1);
    expect(
      collisions,
      `these files would share one database — and each drops it in afterAll: ${JSON.stringify(collisions)}`,
    ).toEqual([]);
    expect(byName.size).toBe(LIVE_TEST_FILES.length);
  });

  it('is deterministic — the same file always resolves the same database', () => {
    for (const file of LIVE_TEST_FILES) {
      const key = `${DIR_KEY}${file}`;
      expect(liveMysqlDatabaseNameFor(key)).toBe(liveMysqlDatabaseNameFor(key));
    }
  });

  it('derives the name from the WHOLE path, so same-named files in two packages differ', () => {
    // The cross-package half of the joint injectivity argument: CI points both
    // this package's live leg and driver-sql's at ONE MySQL server, so two
    // identically-named files in different packages must not meet there.
    const a = `${DIR_KEY}seed-tenancy-backfill.live-mysql.test.ts`;
    const b = 'packages/drivers/driver-sql/src/seed-tenancy-backfill.live-mysql.test.ts';
    expect(liveMysqlDatabaseNameFor(a)).not.toBe(liveMysqlDatabaseNameFor(b));
  });

  it('stays distinct where the readable slug truncates to the same prefix', () => {
    // The trap: the slug is capped at 34 characters so the whole identifier
    // fits, and a cap is not injective. Two file names that agree over the
    // first 34 characters are the realistic shape of that.
    const a = `${DIR_KEY}a-very-long-live-mysql-database-name-one.test.ts`;
    const b = `${DIR_KEY}a-very-long-live-mysql-database-name-two.test.ts`;
    const [na, nb] = [liveMysqlDatabaseNameFor(a), liveMysqlDatabaseNameFor(b)];
    expect(na.slice(0, 40)).toBe(nb.slice(0, 40)); // the fixture is vacuous otherwise
    expect(na).not.toBe(nb);
  });

  it('fits both dialects’ identifier limits, and is DDL-safe by construction', () => {
    // The name is interpolated into `create database` / `use` / `drop database`
    // unquoted-by-value, so its character set is a safety property, not style.
    // Postgres truncates over 63 bytes SILENTLY, which would fold two long
    // names back onto one database with nothing red anywhere.
    for (const file of LIVE_TEST_FILES) {
      const name = liveMysqlDatabaseNameFor(`${DIR_KEY}${file}`);
      expect(name.length, `${name} exceeds the ${IDENTIFIER_LIMIT}-byte limit`)
        .toBeLessThanOrEqual(IDENTIFIER_LIMIT);
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name.startsWith(LIVE_DB_PREFIX)).toBe(true);
    }
  });

  it('cannot carry a backtick out of a file name into the DDL', () => {
    // The escape story for `create database \`${DB}\``, which does no escaping:
    // it is the character set, so a hostile or merely non-ASCII file name must
    // still slug down to `[a-z0-9_]`. Stated as a test because the resolver's
    // own length/charset guard is unreachable by construction — 6-byte prefix +
    // 34-byte cap + 1 + 12 hex can never exceed 63 — so that guard is
    // defensive, and this is the property actually being relied on.
    const hostile = liveMysqlDatabaseNameFor(`${DIR_KEY}a\`; drop database x; --.test.ts`);
    expect(hostile).toMatch(/^[a-z][a-z0-9_]*$/);

    // A name that slugs to nothing still resolves — and still distinctly,
    // because the hash is taken over the full path rather than the slug.
    const one = liveMysqlDatabaseNameFor(`${DIR_KEY}äö.test.ts`);
    const two = liveMysqlDatabaseNameFor(`${DIR_KEY}üï.test.ts`);
    expect(one).toMatch(/^os_lv__[0-9a-f]{12}$/);
    expect(two).toMatch(/^os_lv__[0-9a-f]{12}$/);
    expect(one).not.toBe(two);
  });

  it('resolves the CURRENT file from vitest’s testPath, not from an argument', () => {
    // `currentLiveMysqlDatabase()` takes nothing, so there is no parameter a
    // copy-paste could carry over from the file it was copied from — the exact
    // way the two constants this replaced stayed distinct only by luck.
    expect(currentLiveMysqlDatabase()).toBe(
      liveMysqlDatabaseNameFor(`${DIR_KEY}live-mysql-database.isolation.test.ts`),
    );
  });

  it('two different files do not resolve to one shared name', () => {
    expect(liveMysqlDatabaseNameFor(`${DIR_KEY}seed-tenancy-backfill.live-mysql.test.ts`)).not.toBe(
      liveMysqlDatabaseNameFor(`${DIR_KEY}sys-setting-identity-index.live-mysql.test.ts`),
    );
  });
});
