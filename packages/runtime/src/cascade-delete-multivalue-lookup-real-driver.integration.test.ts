// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9362] The card's reproduction, on the REAL stack — a real `ObjectQL` over a
 * real `SqlDriver`, driven through the real
 * `ObjectStackProtocolImplementation`'s data-plane delete (the method
 * `DELETE /api/v1/data/:object/:id` serves).
 *
 * ```
 * POST   /api/v1/data/showcase_account  {"name":"anything","status":"active"} -> 201
 * DELETE /api/v1/data/showcase_account/<id>                                   -> 400 INVALID_FILTER
 * ```
 *
 * Nothing below builds that refusal: `f_lookups` is declared exactly as the
 * showcase declares it — `Field.lookup('showcase_account', { multiple: true })`
 * — the real driver really does store it in a JSON column, and the real
 * `#7398` gate really does refuse the bare-equality probe
 * `cascadeDeleteRelations` used to build for it. The sibling unit suite
 * (`packages/objectql/src/engine-cascade-delete-multivalue-probe.test.ts`) pins
 * the probe's SPELLING against a double; this file is what proves the spelling
 * the fix chose is one this driver actually answers, and that the row is really
 * gone from the database afterwards.
 *
 * The dependent table is EMPTY in the first case, deliberately: the fault is
 * schema-driven, so a fixture with rows in it would prove less, not more.
 *
 * Both directions, as always on a referential guard: a fix that made the probe
 * find nothing would turn the 400 into a 200 and silently delete referenced
 * records. The `restrict` case asserts the full ADR-0112 envelope (`code` AND
 * `status`) and re-reads the row.
 *
 * ## [#18617] Why this file runs a DRIVER MATRIX and not one hard-coded client
 *
 * Until #18617 every rig below was `client: 'better-sqlite3'`, and that single
 * literal is the named mechanism by which #18172 shipped: every DELETE of an
 * object targeted by a `multiple: true` reference returned 500 on PostgreSQL,
 * always, even against an empty dependents table — through two published
 * releases (17.3.0, 17.4.0), found by a customer and NOT by CI. This file was
 * the only real-stack pin of that path, so the SQLite face was pinned and the
 * PostgreSQL face never was.
 *
 * The divergence is not incidental to the dialect, which is why the matrix is
 * the fix rather than more SQLite assertions. A `multiple: true` lookup is
 * stored in a TEXT column on SQLite and in a real `json` column on PostgreSQL,
 * and the cascade probe the engine builds is `{ field: { $contains: id } }` —
 * lowered by `SqlDriver.applyJsonMembership` to a MEMBERSHIP construct on a
 * JSON column and to `LIKE '%…%'` on a text one. Aim `LIKE` at a PostgreSQL
 * `json` column and the server answers SQLSTATE 42883 (`operator does not
 * exist: json ~~ unknown`); aim it at a SQLite TEXT column and it simply works.
 * ⇒ On SQLite the two lowerings are indistinguishable, so no assertion written
 * here can separate them. Only the live cell can.
 *
 * ⭐ The matrix is therefore ABLATION-BACKED, and the ablation is the reason the
 * cell exists: removing the membership lowering (making `applyJsonMembership`
 * answer `false`) must take the live PostgreSQL cell RED with 42883 while the
 * SQLite cell stays GREEN. That asymmetry is the whole finding, and the PR that
 * landed this file carries the two runs.
 *
 * ## Provisioning, and what happens without a server
 *
 * The live cell needs `OS_TEST_POSTGRES_URL` — the same variable driver-sql's
 * live matrix and `metadata-protocol`'s live migrations already read. Without
 * it the cell is a NAMED skip that says which variable would run it, never a
 * silent omission: {@link declareUnprovisionedCell} emits a suite either way, so
 * a run that did not measure PostgreSQL says so in its own output. A runner that
 * KNOWS it provisioned the server sets `OS_EXPECT_LIVE_DIALECT_MATRIX=1`, which
 * turns the missing URL into a failure — without that, dropping the `env:` block
 * from the job would silently return this file to SQLite-only coverage and stay
 * green, which is exactly the state #18617 was filed against.
 *
 * ⚠️ Read the limit of that honestly: a named skip is a report, not coverage. A
 * cell that skips in every job is a cell that never runs, and the CI leg that
 * supplies the URL to THIS package does not exist yet — the `Temporal
 * Conformance (live PG + MySQL)` job runs driver-sql and metadata-protocol, not
 * `@objectstack/runtime`. The wiring is one build step and one run step in
 * `.github/workflows/ci.yml`; until it lands, this cell is red-CAPABLE and
 * un-run in CI, and `OS_EXPECT_LIVE_DIALECT_MATRIX=1` is what makes the
 * difference loud rather than silent the moment the leg arrives.
 *
 * ## Isolation — a per-file schema, derived and never typed
 *
 * The live cell runs in its own PostgreSQL schema, named from this file's
 * repo-relative path, recreated per test and dropped in `afterAll`. The object
 * names below (`zz_account`, `zz_guard`, …) are short and generic and the CI job
 * provisions ONE server for every live leg, so a shared schema would not be
 * contention but destruction. Same derivation as
 * `packages/drivers/driver-sql/src/live-dialect-matrix.testkit.ts` and
 * `packages/metadata-protocol/src/migrations/live-mysql-database.testkit.ts` —
 * same `os_lv_` prefix, same 34-character slug cap, same 12 hex of sha256 over
 * the workspace-relative path — so the independent copies stay jointly
 * injective on that one server, and one prefix identifies a leftover from any
 * package. `scripts/check-live-db-isolation.mjs` is the repo-wide watcher that
 * refuses a literal name anywhere in the tree.
 *
 * ⚠️ Why a copy and not an import: that testkit is test-only scaffolding on
 * nobody's public surface (`@objectstack/driver-sql` exports `.` alone and its
 * `index.ts` does not re-export it), so reaching it means importing another
 * package's `src/` — which pulls driver-sql's whole source graph into this
 * package's Vite resolution domain and moves this file into the `repo` vitest
 * project. `metadata-protocol` made the same call for the same reason, and
 * recorded it.
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  captureExpectedReadRefusals,
  POSTGRES_MISSING_TABLE_REASON,
  SQLITE_MISSING_TABLE_REASON,
  type ExpectedReadRefusalCapture,
  type MissingTableReason,
} from './expected-read-refusal-noise.js';

const ACCOUNT = { name: 'zz_account', fields: { name: { type: 'text' } } };

/** The showcase's own shape: a multi-value lookup at the object being deleted. */
const FIELD_ZOO = {
    name: 'zz_field_zoo',
    fields: {
        name: { type: 'text' },
        f_lookups: { type: 'lookup', reference: 'zz_account', multiple: true },
    },
};

/** The same relationship declared `restrict` — the guard direction. */
const GUARD = {
    name: 'zz_guard',
    fields: {
        name: { type: 'text' },
        accounts: {
            type: 'lookup', reference: 'zz_account',
            multiple: true, deleteBehavior: 'restrict',
        },
    },
};

/** Multi-value + explicit `cascade` — the P0 must close for this path. */
const CASCADE_MULTI = {
    name: 'zz_cascade',
    fields: {
        name: { type: 'text' },
        accounts: {
            type: 'lookup', reference: 'zz_account',
            multiple: true, deleteBehavior: 'cascade',
        },
    },
};

/** SINGLE-valued, defaulted `set_null` — the limb that must keep running. */
const SINGLE = {
    name: 'zz_single',
    fields: {
        name: { type: 'text' },
        account: { type: 'lookup', reference: 'zz_account' },
    },
};

const OWNER_PACKAGE = 'com.objectstack.test.9362';

/**
 * [#10629] This fixture provisions its own business objects and nothing else,
 * so the engine's single-tenant probe (`ObjectQL.probeInstallOrganizations`,
 * memoised once per engine) reads a `sys_organization` that was never created.
 * The probe is fail-soft by construction — it catches `isMissingTableError` and
 * only that — but the driver and the engine each log the fault on the way out.
 * Withheld and asserted rather than muted; `expected-read-refusal-noise.ts`
 * says why.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

// ── [#18617] The driver axis (ADR-0053 D-A3: "Postgres at minimum") ──────────

const PG_URL = process.env.OS_TEST_POSTGRES_URL;

/**
 * `1` when the runner has provisioned the live server, so a missing URL is a
 * defect in the runner rather than a developer working without Docker.
 */
const EXPECT_LIVE_DIALECTS = process.env.OS_EXPECT_LIVE_DIALECT_MATRIX === '1';

/**
 * The budget a LIVE cell runs under. This package sets no `testTimeout`, so a
 * live cell would otherwise inherit vitest's 5000 ms default — below the
 * driver's OWN 10_000 ms per-dialect connect bound, which means an unbudgeted
 * live cell could never report a connect fault at all: vitest always wins that
 * race. `driver-sql`'s live matrix derives the same number
 * (`LIVE_CELL_TIMEOUT_MS`, #16434) from the corridor between that bound and the
 * ten-minute stall guard; the value is adopted here rather than re-derived, so a
 * red at 60_000 ms means the same thing in both packages. It is NOT a claim that
 * these cases are normally anywhere near that slow.
 */
const LIVE_CELL_TIMEOUT_MS = 60_000;

/** Prefix every per-file live schema carries, so a leftover is identifiable. */
const LIVE_SCHEMA_PREFIX = 'os_lv_';

/**
 * The live schema for one test file, named by its workspace-relative path:
 * `os_lv_<slug>_<12 hex of sha256(path)>`. The slug is readable, so an operator
 * looking at a stray schema can tell which file owns it; the hash is what
 * carries uniqueness, and it is taken over the FULL path so two files that
 * truncate to the same slug still differ.
 *
 * `[a-z0-9_]` only, asserted rather than assumed: the name is interpolated into
 * DDL, and a name that can only be those characters cannot carry a quote out of
 * a file name.
 */
function liveSchemaNameFor(testFileKey: string): string {
    const key = testFileKey.replace(/\\/g, '/');
    const slug = basename(key)
        .replace(/\.test\.tsx?$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 34);
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
    const name = `${LIVE_SCHEMA_PREFIX}${slug}_${hash}`;
    if (!/^[a-z][a-z0-9_]*$/.test(name) || name.length > 63) {
        throw new Error(
            `live-dialect isolation: derived an unusable schema name ${JSON.stringify(name)} from ` +
                `${JSON.stringify(testFileKey)} — it must match /^[a-z][a-z0-9_]*$/ and fit ` +
                "PostgreSQL's 63-byte identifier limit.",
        );
    }
    return name;
}

/**
 * An absolute test path reduced to something stable across machines: the path
 * relative to the workspace root (the nearest ancestor holding
 * `pnpm-workspace.yaml`). The absolute path would isolate just as well, but it
 * differs per checkout, so the same file would own a different schema in a
 * worktree than in CI.
 */
function repoRelativeTestPath(absolutePath: string): string {
    let dir = dirname(absolutePath);
    for (;;) {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return absolutePath.slice(dir.length + 1);
        const parent = dirname(dir);
        if (parent === dir) return basename(absolutePath); // filesystem root: fall back
        dir = parent;
    }
}

/**
 * The schema this file owns.
 *
 * Takes no argument on purpose: a parameter is the one thing a consumer can get
 * wrong, and two files handed the same literal are back to sharing a schema —
 * including each other's `drop schema … cascade`. Absent `testPath` is a hard
 * error rather than a fallback, because the only available fallback is a shared
 * name, which is the defect.
 */
function currentLiveSchema(): string {
    const testPath = expect.getState().testPath;
    if (!testPath) {
        throw new Error(
            '[#18617] live-dialect isolation: vitest reported no testPath, so this live ' +
                'connection cannot be given a per-file schema and would fall back to sharing one ' +
                'with every other live suite on the server CI provisions — their teardown DDL ' +
                'included.',
        );
    }
    return liveSchemaNameFor(repoRelativeTestPath(testPath));
}

const LIVE_SCHEMA = currentLiveSchema();

interface DialectCell {
    id: 'sqlite' | 'pg';
    /** Human label, used in the suite name. */
    label: string;
    /** The env var that provisions this cell — `null` for the embedded one. */
    env: string | null;
    /** Does this cell talk to a separate server? */
    live: boolean;
    /** Can this cell run right now? */
    available: boolean;
}

/**
 * Every cell of the driver axis, available or not — the loop below walks the
 * whole list, so an unprovisioned dialect is REPORTED rather than omitted.
 */
const DIALECT_CELLS: readonly DialectCell[] = [
    { id: 'sqlite', label: 'better-sqlite3', env: null, live: false, available: true },
    { id: 'pg', label: 'live postgres', env: 'OS_TEST_POSTGRES_URL', live: true, available: !!PG_URL },
];

/**
 * [#18617] Which missing-table sentence each cell's server writes. Keyed by the
 * cell id so a new cell cannot be added without answering the question —
 * `Record` over the id union is what makes the omission a type error rather
 * than a silently unrecognised refusal at run time.
 */
const MISSING_TABLE_REASON: Record<DialectCell['id'], MissingTableReason> = {
    sqlite: SQLITE_MISSING_TABLE_REASON,
    pg: POSTGRES_MISSING_TABLE_REASON,
};

/**
 * Declare a cell nobody provisioned: a named skip locally, a FAILURE under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`.
 *
 * The suite is emitted either way, which is the point — a cell that emits
 * nothing at all is not a skip, so vitest's summary counts would read as
 * coverage of a dialect nothing touched.
 */
function declareUnprovisionedCell(cell: DialectCell): void {
    describe(`[#18617] multi-value cascade-delete matrix (${cell.label})`, () => {
        it.skipIf(!EXPECT_LIVE_DIALECTS)(
            `is provisioned — set ${cell.env} to run this cell of the D-A3 driver axis`,
            () => {
                expect.fail(
                    `${cell.env} is unset while OS_EXPECT_LIVE_DIALECT_MATRIX=1: this runner ` +
                        `declared it provisions a live server, so the ${cell.label} cell of the ` +
                        'multi-value cascade-delete matrix must not be skipped. That cell is the ' +
                        'one #18172 shipped through — a PostgreSQL-only 500 on every DELETE of a ' +
                        'referenced object — and the SQLite cell cannot fail for it ' +
                        '(ADR-0053 D-A3, "Postgres at minimum").',
                );
            },
        );
    });
}

/**
 * Drop and recreate this file's schema.
 *
 * Per TEST rather than per file: every case below counts rows out of the driver
 * (`count('zz_account')` is 0 or 1, never "whatever the previous case left"),
 * and unlike the SQLite cell — which gets a fresh tempdir database each time — a
 * live schema outlives the connection. The bootstrap driver is deliberately
 * built WITHOUT `searchPath`: it has to be able to address a schema that does
 * not exist yet.
 */
async function resetLiveSchema(): Promise<void> {
    const boot = new SqlDriver({ client: 'pg', connection: PG_URL });
    try {
        await boot.execute(`DROP SCHEMA IF EXISTS "${LIVE_SCHEMA}" CASCADE`);
        await boot.execute(`CREATE SCHEMA "${LIVE_SCHEMA}"`);
    } finally {
        await boot.disconnect();
    }
}

afterAll(async () => {
    if (!PG_URL) return;
    const boot = new SqlDriver({ client: 'pg', connection: PG_URL });
    try {
        await boot.execute(`DROP SCHEMA IF EXISTS "${LIVE_SCHEMA}" CASCADE`);
    } finally {
        await boot.disconnect();
    }
});

/**
 * One cell of the matrix. Everything inside is written once and measured on
 * every dialect — which is the property the hard-coded client destroyed.
 */
function declareCascadeDeleteCell(cell: DialectCell): void {
  describe(
    `[#9362] REST DELETE on an object targeted by a multiple:true lookup — real driver (${cell.label})`,
    cell.live ? { timeout: LIVE_CELL_TIMEOUT_MS } : {},
    () => {
    let dir: string | null = null;
    let engine: ObjectQL | null = null;
    /** [#10629] The expected-noise capture belonging to the latest rig. */
    let noise: ExpectedReadRefusalCapture | null = null;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
        // [#10629] The capture is a PIN, not a mute — asserted after teardown so
        // a failure here can never leave the engine running. Every test in this
        // file rigs and writes, so the probe fires for each of them: this holds
        // for a single `-t` run as well as for the whole file.
        expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
        noise = null;
    });

    /** [#18617] The ONE place the dialect enters this file. */
    async function newDriver(): Promise<SqlDriver> {
        if (cell.id === 'pg') {
            await resetLiveSchema();
            // knex issues `set search_path` from this on every pooled connection
            // and qualifies its own DDL with it, so the driver's tables land in
            // this file's schema and nowhere else.
            return new SqlDriver({ client: 'pg', connection: PG_URL, searchPath: [LIVE_SCHEMA] });
        }
        dir = mkdtempSync(join(tmpdir(), 'os-9362-real-'));
        return new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.sqlite') },
            useNullAsDefault: true,
        });
    }

    async function rig(objects: unknown[]) {
        const real = await newDriver();
        // [#10629] Installed before the driver runs a statement and before the
        // engine issues a read — the two sinks the expected refusal travels out on.
        // [#18617] The reason half is this CELL'S dialect: the refusal line the
        // driver writes says `no such table: sys_organization` on SQLite and
        // `relation "sys_organization" does not exist` on PostgreSQL, and a
        // capture handed the wrong one recognises nothing — it prints the noise
        // it exists to withhold AND reports the channel silent.
        noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE], MISSING_TABLE_REASON[cell.id]);
        noise.captureDriver(real);
        await real.initObjects(objects as any);
        engine = new ObjectQL();
        noise.captureEngine(engine);
        engine.registerDriver(real as any, true);
        await engine.init();
        for (const o of objects) engine.registry.registerObject(o as any, OWNER_PACKAGE);
        const protocol: any = new ObjectStackProtocolImplementation(engine as any);
        return { protocol, real };
    }

    // ── [#18617] Non-vacuity, for the live cell only ─────────────────────────
    //
    // Everything in this file is an assertion about a multi-value lookup stored
    // in a JSON column. On SQLite that column is TEXT, where the membership
    // lowering and the substring lowering are indistinguishable — which is why a
    // green SQLite run says nothing about the fault #18172 shipped. So before
    // this cell's results mean anything it establishes two facts a
    // mis-provisioned URL could not: that the server really is PostgreSQL, and
    // that the driver really gave `f_lookups` a JSON column on it.
    //
    // Declared with an `if` rather than `it.runIf`, so the SQLite cell does not
    // report a skip for a question that does not apply to it.
    if (cell.id === 'pg') {
    it(
        'is a real PostgreSQL and really stores the lookup as JSON — without this the cell proves nothing',
        async () => {
            const { real } = await rig([ACCOUNT, FIELD_ZOO]);
            // Writes, like every other case in this file — which is what the
            // `afterEach` noise pin is entitled to assume: the engine's
            // single-tenant probe fires on the first engine operation, and a
            // case that only read `information_schema` would leave both
            // withheld-noise channels silent and redden the teardown.
            await engine!.insert('zz_account', { name: 'non-vacuity' });

            const version: any = await real.execute('SELECT version() AS version');
            const text = String(version?.rows?.[0]?.version ?? '');
            // Printed so the log carries the measurement and not just a verdict.
            // eslint-disable-next-line no-console
            console.log(`[#18617] live ${text.split(',')[0]} schema=${LIVE_SCHEMA}`);
            expect(text).toContain('PostgreSQL');

            const columns: any = await real.execute(
                'SELECT data_type FROM information_schema.columns ' +
                    'WHERE table_schema = ? AND table_name = ? AND column_name = ?',
                [LIVE_SCHEMA, 'zz_field_zoo', 'f_lookups'],
            );
            // ⭐ The whole reason the live cell CAN fail where SQLite cannot:
            // `LIKE` has no operator against this type, so a cascade probe
            // lowered to a substring test is SQLSTATE 42883 here and a silent
            // success there.
            expect(String(columns?.rows?.[0]?.data_type ?? '')).toMatch(/^json/);
        },
    );
    }

    it('deletes the record and really removes the row (the card\'s 3/3 reproduction)', async () => {
        const { protocol, real } = await rig([ACCOUNT, FIELD_ZOO]);
        const created: any = await engine!.insert('zz_account', { name: 'anything' });
        expect(typeof created.id).toBe('string');
        // Schema-driven: the referring table has no rows at all.
        expect(await real.count('zz_field_zoo')).toBe(0);

        const res = await protocol.deleteData({ object: 'zz_account', id: created.id });
        expect(res).toMatchObject({ object: 'zz_account', id: created.id, success: true });

        // Read the row count out of the DRIVER, not through the engine.
        expect(await real.count('zz_account')).toBe(0);
    });

    it('still refuses the delete when a row really does reference it through the array', async () => {
        const { protocol, real } = await rig([ACCOUNT, GUARD]);
        const a: any = await engine!.insert('zz_account', { name: 'referenced' });
        await engine!.insert('zz_guard', { name: 'g', accounts: [a.id] });

        const err: any = await protocol
            .deleteData({ object: 'zz_account', id: a.id })
            .catch((e: any) => e);
        expect(err.code).toBe('DELETE_RESTRICTED');
        expect(err.status).toBe(409);
        expect(err.dependentObject).toBe('zz_guard');
        expect(err.dependentCount).toBe(1);
        expect(await real.count('zz_account')).toBe(1);
    });

    it('a referenced id does not lend its dependents to an id it is a prefix of', async () => {
        const { protocol, real } = await rig([ACCOUNT, GUARD]);
        await engine!.insert('zz_account', { id: 'acc_1', name: 'one' });
        await engine!.insert('zz_account', { id: 'acc_10', name: 'ten' });
        // `LIKE '%acc_1%'` matches this row's serialization too.
        await engine!.insert('zz_guard', { name: 'g', accounts: ['acc_10'] });

        const res = await protocol.deleteData({ object: 'zz_account', id: 'acc_1' });
        expect(res).toMatchObject({ id: 'acc_1', success: true });
        expect(await real.count('zz_account', { where: { id: 'acc_10' } })).toBe(1);

        const err: any = await protocol
            .deleteData({ object: 'zz_account', id: 'acc_10' })
            .catch((e: any) => e);
        expect(err.code).toBe('DELETE_RESTRICTED');
        expect(err.status).toBe(409);
    });

    // ── [#9438] Member removal on the real stack. The residual-shape
    //    sentence these tests consume is `FieldSchema`'s, not theirs:
    //    `packages/spec/src/data/field.zod.ts`, the `multiple` and `required`
    //    doc blocks (#9447, maintainer ruling 2026-08-18). Under the #9437
    //    holding position each of these deletes was a 409, so the 200s below
    //    also pin the interim escalation's removal.

    it('a multi-value set_null removes the deleted member and the sibling reference survives', async () => {
        const { protocol, real } = await rig([ACCOUNT, FIELD_ZOO]);
        const a: any = await engine!.insert('zz_account', { id: 'acc_a', name: 'A' });
        await engine!.insert('zz_account', { id: 'acc_b', name: 'B' });
        await engine!.insert('zz_field_zoo', { id: 'z1', name: 'z', f_lookups: ['acc_a', 'acc_b'] });

        const res = await protocol.deleteData({ object: 'zz_account', id: a.id });
        expect(res).toMatchObject({ object: 'zz_account', id: a.id, success: true });

        // Read the stored array back out of the DATABASE, on the driver's own
        // connection. Before the fix this slot re-read as `null`, taking
        // `acc_b` with it; under the interim hold the delete was a 409.
        const [row]: any[] = await real.find('zz_field_zoo', { where: { id: 'z1' } });
        expect(row.f_lookups).toEqual(['acc_b']);
        // …and the surviving member still resolves to a live record.
        expect(await real.count('zz_account', { where: { id: 'acc_b' } })).toBe(1);
        expect(await real.count('zz_account')).toBe(1);
    });

    it('removing the LAST member stores `[]`, never `null` — the ruled representation, in the database', async () => {
        const { protocol, real } = await rig([ACCOUNT, FIELD_ZOO]);
        const a: any = await engine!.insert('zz_account', { id: 'acc_a', name: 'A' });
        await engine!.insert('zz_field_zoo', { id: 'z1', name: 'z', f_lookups: ['acc_a'] });

        const res = await protocol.deleteData({ object: 'zz_account', id: a.id });
        expect(res).toMatchObject({ id: 'acc_a', success: true });

        const [row]: any[] = await real.find('zz_field_zoo', { where: { id: 'z1' } });
        // The literal shape, asserted both ways: `[]`, not `null` — this is
        // the observable half of the #9447 ruling, proved against what the
        // real driver actually stored and read back.
        expect(row.f_lookups).toEqual([]);
        expect(row.f_lookups).not.toBeNull();
        expect(Array.isArray(row.f_lookups)).toBe(true);
    });

    it('a multi-value CASCADE still deletes end to end — the P0 closes for that path', async () => {
        const { protocol, real } = await rig([ACCOUNT, CASCADE_MULTI]);
        const a: any = await engine!.insert('zz_account', { id: 'acc_a', name: 'A' });
        await engine!.insert('zz_cascade', { id: 'c1', name: 'c', accounts: ['acc_a'] });

        const res = await protocol.deleteData({ object: 'zz_account', id: a.id });
        expect(res).toMatchObject({ id: 'acc_a', success: true });
        expect(await real.count('zz_account')).toBe(0);
        expect(await real.count('zz_cascade')).toBe(0);
    });

    it('a SINGLE-valued set_null still clears the foreign key — the hold does not over-fire', async () => {
        const { protocol, real } = await rig([ACCOUNT, SINGLE]);
        const a: any = await engine!.insert('zz_account', { id: 'acc_a', name: 'A' });
        await engine!.insert('zz_single', { id: 's1', name: 's', account: 'acc_a' });

        const res = await protocol.deleteData({ object: 'zz_account', id: a.id });
        expect(res).toMatchObject({ id: 'acc_a', success: true });
        const [row]: any[] = await real.find('zz_single', { where: { id: 's1' } });
        expect(row.account).toBeNull();
    });
    },
  );
}

for (const cell of DIALECT_CELLS) {
    if (cell.available) declareCascadeDeleteCell(cell);
    else declareUnprovisionedCell(cell);
}
