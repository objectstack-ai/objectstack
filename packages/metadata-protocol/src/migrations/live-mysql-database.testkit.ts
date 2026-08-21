// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10382 — the per-file live MySQL database for this package's live suites.
 *
 * ## What was actually wrong, which is not what the card said
 *
 * The card that asked for this states that the two live-MySQL suites here
 * "land in the `conformance` database the CI job provisions — the same one, as
 * each other". That was already false when it was filed: both files have
 * created and `use`-d their own database since the day each landed, and the two
 * names differ. What was true is the half that matters for the next file:
 * those names were HARD-CODED CONSTANTS (`os_metadata_protocol_9381`,
 * `os_metadata_protocol_9434`), so the property #9350 established for
 * `packages/drivers/driver-sql` — *a live file's database derives from the
 * file, not from a shared constant* — held here only by the authors having
 * remembered to type two different strings.
 *
 * ## The hazard is LATENT, measured — which is the reason to fix it structurally
 *
 * The obvious way to justify this change is to show the collision happening, so
 * that was tried first, on a live MariaDB 10.11.14 in an agent container: both
 * constants pointed at ONE name, the suite run four times. All four runs were
 * GREEN, 10/10.
 *
 * The server's own general query log says why, and the answer is worth keeping.
 * The two files did not overlap at all — file A's `drop database` completed
 * before file B's first `Connect`, both under the default settings and under an
 * explicit `--maxWorkers=2 --fileParallelism`:
 *
 *     16:32:34  40 Connect  …    40 Query  CREATE DATABASE IF NOT EXISTS `…`
 *               41 Connect  …    41 Query  USE `…`  →  DROP DATABASE IF EXISTS `…`
 *     16:32:35  42 Connect  …    42 Query  CREATE DATABASE IF NOT EXISTS `…`
 *               43 Connect  …    43 Query  USE `…`  →  DROP DATABASE IF EXISTS `…`
 *
 * Each file's whole run is ~150 ms while a second fork takes ~1 s to come up, so
 * the destructive window never opens with exactly two small files. So the shared
 * name is a loaded gun that is not currently pointed anywhere: nothing observable
 * distinguishes the broken configuration from the correct one.
 *
 * That is an argument FOR deriving the name rather than against it. What makes
 * the shared constant dangerous is not today's schedule, it is that every input
 * to that schedule is incidental — the file count in the `live-mysql` filter,
 * the runner's CPU count, vitest's `fileParallelism` default, how long a fork
 * takes to boot. And the blast radius is larger here than in driver-sql: both
 * files `DROP DATABASE` in `afterAll` and both `CREATE`/`DROP` fixed platform
 * table names (`_objectstack_sequences`, `sys_organization`, `sys_setting`), so
 * an overlap does not merely contend, it drops the database another file is
 * mid-test in.
 *
 * The consequence for how this change is verified: there is no defect control
 * available — no pre-fix red run exists to point at, because the pre-fix tree is
 * green even when deliberately broken. The controls are the structural test
 * (which ablates the derivation) and the repo-wide gate (which DOES red on the
 * pre-fix tree). See `live-mysql-database.isolation.test.ts`.
 *
 * ## Why this is a sibling of driver-sql's resolver rather than an import of it
 *
 * `packages/drivers/driver-sql/src/live-dialect-matrix.testkit.ts` holds the
 * same derivation, and sharing one copy would be better if it were reachable.
 * It is not, for three independent reasons:
 *
 *  - it is not part of `@objectstack/driver-sql`'s public surface — the package
 *    exports `.` only, `index.ts` does not re-export the testkit, and its own
 *    header says *"Test-only: not exported from `index.ts`."* Reaching it means
 *    either publishing vitest-dependent test scaffolding to npm consumers or
 *    importing another package's `src/`, which is the thing
 *    `check:cross-package-test-inputs` exists to police;
 *  - `@objectstack/metadata-protocol` does not depend on `@objectstack/driver-sql`
 *    at all. Adding it — even as a devDependency — pulls knex, `SqlDriver` and
 *    that package's whole build into this one's test closure to obtain a pure
 *    string function, and inverts the layering (a protocol package would depend
 *    on one storage driver);
 *  - most of that testkit is not this function. `DialectCell` carries knex
 *    configs, `readServerZone` takes a `SqlDriver`, and `liveSchemaLedger()`
 *    hard-codes `packages/drivers/driver-sql/src/` as the directory it reads.
 *    None of it applies to two raw `mysql2` connections.
 *
 * The copy is deliberately BYTE-FOR-BYTE the same derivation, same
 * `os_lv_` prefix, same 34-character slug cap, same 12 hex of sha256 over the
 * same key (the WORKSPACE-RELATIVE path). That is what makes the two
 * independent copies jointly injective on the one MySQL server CI provisions
 * for both legs: two files can only collide by having the same repo-relative
 * path, or by a sha256 collision in 96 bits. A different prefix or a different
 * cap would have been safe too; sameness additionally means one `show
 * databases` prefix identifies a leftover from any package.
 *
 * Drift between the two copies is what `scripts/check-live-db-isolation.mjs`
 * watches, repo-wide: it fails any live suite anywhere in the tree whose
 * database name reaches its DDL from a string literal instead of a call.
 *
 * ## `use`, not the connection URL — the opposite of driver-sql's choice
 *
 * driver-sql names the database in the CONNECTION and its testkit explains at
 * length why `use` was wrong there: knex's `client.database()` keeps returning
 * the URL's database and knex binds THAT into `columnInfo`, so DDL ran in one
 * database while the column read answered from another. None of that mechanism
 * is present here. These files hold a raw `mysql2` connection, issue their own
 * SQL, and nothing reads `connection.config.database` — so the session is the
 * only notion of "current database" there is. `use` is kept because it is what
 * the files already do and what the card asked for; the reason it is SAFE here
 * is the absence of knex, not a disagreement with #9350.
 */

import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Prefix every per-file live database carries, so a leftover on a shared server
 * is identifiable — the same one driver-sql's schemas use, on purpose.
 */
export const LIVE_DB_PREFIX = 'os_lv_';

/** The identifier ceiling that binds: Postgres 63 bytes, MySQL 64. */
const IDENTIFIER_LIMIT = 63;

/**
 * The live database for one test file, named by its workspace-relative path.
 *
 * Pure and deterministic, so `live-mysql-database.isolation.test.ts` can assert
 * distinctness over the real file list with no server at all. The shape is
 * `os_lv_<slug>_<12 hex of sha256(path)>`:
 *
 *  - the SLUG is readable, so an operator looking at `show databases` can tell
 *    which file owns a leftover;
 *  - the HASH carries the uniqueness. The slug is truncated to keep the whole
 *    name inside the shorter of the two dialect limits, and a truncated slug is
 *    not injective; the hash is taken over the FULL path, so two files that
 *    truncate to the same slug still differ.
 *
 * `[a-z0-9_]` only, asserted rather than assumed: the name is interpolated into
 * DDL, and a name that can only be those characters cannot carry a backtick out
 * of a file name.
 */
export function liveMysqlDatabaseNameFor(testFileKey: string): string {
  const key = testFileKey.replace(/\\/g, '/');
  const slug = basename(key)
    .replace(/\.test\.tsx?$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 34);
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  const name = `${LIVE_DB_PREFIX}${slug}_${hash}`;
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length > IDENTIFIER_LIMIT) {
    throw new Error(
      `live-mysql isolation: derived an unusable database name ${JSON.stringify(name)} from ` +
        `${JSON.stringify(testFileKey)} — it must match /^[a-z][a-z0-9_]*$/ and fit the ` +
        `${IDENTIFIER_LIMIT}-byte identifier limit.`,
    );
  }
  return name;
}

/** Memoised so the walk below runs once per file, not once per connection. */
const REPO_RELATIVE_CACHE = new Map<string, string>();

/**
 * An absolute test path reduced to something stable across machines: the path
 * relative to the workspace root (the nearest ancestor holding
 * `pnpm-workspace.yaml`).
 *
 * The absolute path would isolate just as well — it differs per file either way
 * — but it also differs per checkout, so the same file would get a different
 * database in a worktree than in CI and the isolation test could not pin a name.
 */
function repoRelativeTestPath(absolutePath: string): string {
  const cached = REPO_RELATIVE_CACHE.get(absolutePath);
  if (cached !== undefined) return cached;
  let dir = dirname(absolutePath);
  let relative = basename(absolutePath);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      relative = absolutePath.slice(dir.length + 1);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached the filesystem root: fall back to the basename
    dir = parent;
  }
  REPO_RELATIVE_CACHE.set(absolutePath, relative);
  return relative;
}

/**
 * The live MySQL database the CURRENT test file owns.
 *
 * Takes no argument on purpose, and that is the whole design. A parameter is
 * the one thing a consumer can get wrong: two files handed the same literal are
 * back to sharing a database, and nothing about either call site would look
 * wrong — which is precisely how this package ended up with two hand-typed
 * constants. `testPath` is vitest's own per-file fact, available at module
 * scope as well as inside a test (vitest 4.1), so the derivation cannot be
 * pointed anywhere else.
 *
 * Absent `testPath` is a hard error rather than a fallback, because the only
 * available fallback is a shared name — the defect.
 */
export function currentLiveMysqlDatabase(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error(
      'live-mysql isolation (#10382): vitest reported no testPath, so this live connection ' +
        'cannot be given a per-file database and would fall back to sharing one with every ' +
        'other live file in this package — including its `drop database` in afterAll. Call ' +
        'currentLiveMysqlDatabase() from a test file.',
    );
  }
  return liveMysqlDatabaseNameFor(repoRelativeTestPath(testPath));
}
