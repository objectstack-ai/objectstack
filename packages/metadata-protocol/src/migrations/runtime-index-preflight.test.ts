// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { DatabaseSync } from 'node:sqlite';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    collectRuntimeIndexPreflight,
    runtimeIndexProbes,
    type RuntimeIndexPreflight,
} from './runtime-index-preflight.js';
import { buildOverlayDuplicateProbeSql } from './overlay-index.js';
import {
    buildSysSettingDuplicateProbeSql,
    buildSysSettingDuplicateProbeSqlMysql,
    buildSysSettingPresenceSql,
} from './sys-setting-identity-index.js';
import { buildDuplicateProbeSql as buildViewActiveDuplicateProbeSql } from './view-definition-active-index.js';
import type { IndexExec } from './partial-index-probe.js';

/**
 * The `kernel:ready` duplicate pre-flight (#8725), against a REAL SQLite
 * database.
 *
 * Real, because the whole point of the section is that it reads rows the drift
 * differ cannot see: an exec double asked to return rows would testify only
 * that this file's own fixture was typed correctly. `node:sqlite` rather than
 * `better-sqlite3` for the same reason the sibling migration tests use it —
 * this package needs no SQL dependency of its own, and the built-in gives real
 * partial indexes and real grouping semantics for free.
 *
 * ⚠️ What is NOT pinned here: anything about a migration ARMING or RUNNING.
 * This module reads; the migrations beside it write. Their own suites own that.
 */
describe('kernel:ready index pre-flight (#8725)', () => {
    let db: DatabaseSync;
    let exec: IndexExec;

    /**
     * Every row of every table plus the schema, ordered — the LOGICAL state.
     *
     * ⚠️ Deliberately not a file hash. A raw hash over a SQLite file reports a
     * difference after any read-write open (header churn: the change counter and
     * the version-valid-for cookie move) and would accuse this pre-flight of
     * mutating a database it only SELECTed from. What must not change is the
     * schema and the rows, so that is what is compared.
     */
    const logicalState = (): string => {
        const schema = db
            .prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')
            .all() as Array<{ type: string; name: string; sql: string | null }>;
        const tables = schema
            .filter((entry) => entry.type === 'table')
            .map((entry) => entry.name);
        const rows: Record<string, unknown[]> = {};
        for (const table of tables) {
            rows[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
        }
        return JSON.stringify({ schema, rows });
    };

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        exec = async (sql: string) => db.prepare(sql).all();

        // ── sys_view_definition: two ACTIVE shared views under one name ────
        // The #5839/#6417 tightening's live conflict — `owner` NULL and
        // `organization_id` NULL both fold into their sentinel buckets, so the
        // two rows collide under the NULL-safe key while the declared,
        // NULL-distinct index admits them.
        db.exec(`CREATE TABLE sys_view_definition (
            id TEXT PRIMARY KEY, name TEXT, organization_id TEXT, owner TEXT, state TEXT
        );`);
        const view = db.prepare(
            'INSERT INTO sys_view_definition (id, name, organization_id, owner, state) VALUES (?,?,?,?,?)',
        );
        view.run('v1', 'crm_case.all_open', null, null, 'active');
        view.run('v2', 'crm_case.all_open', null, null, 'active');
        // The control for the ROW SCOPE: the same collision among ARCHIVED rows
        // is legal — the index is partial — and must not be reported.
        view.run('v3', 'crm_case.retired', null, null, 'archived');
        view.run('v4', 'crm_case.retired', null, null, 'archived');
        // A personal view that collides with nothing.
        view.run('v5', 'crm_case.mine', 'org_x', 'usr_1', 'active');

        // ── sys_metadata: two ACTIVE package-less overlays for one key ─────
        db.exec(`CREATE TABLE sys_metadata (
            id TEXT PRIMARY KEY, type TEXT, name TEXT, organization_id TEXT,
            package_id TEXT, state TEXT
        );`);
        const meta = db.prepare(
            'INSERT INTO sys_metadata (id, type, name, organization_id, package_id, state) VALUES (?,?,?,?,?,?)',
        );
        meta.run('m1', 'view', 'crm_case.board', null, null, 'active');
        meta.run('m2', 'view', 'crm_case.board', null, null, 'active');
        // One DRAFT row, so the draft index is probed over real rows and comes
        // back clear — the two states are independent indexes and a run that
        // conflated them would report this as blocked too.
        meta.run('m3', 'view', 'crm_case.board', null, null, 'draft');

        // ⛔ `sys_setting` is deliberately NOT created: it is registered by the
        // OPTIONAL `service-settings`, so an ordinary kernel reaches
        // `kernel:ready` without it and the migration treats that as a silent
        // no-op. The pre-flight has to say `table-absent`, never `clear`.
    });

    afterEach(() => {
        db.close();
    });

    const by = (index: string, results: RuntimeIndexPreflight[]): RuntimeIndexPreflight => {
        const found = results.find((entry) => entry.index === index);
        if (!found) throw new Error(`no pre-flight entry for '${index}'`);
        return found;
    };

    it('reports the rows blocking each tightening, and says nothing about the ones that do not', async () => {
        const results = await collectRuntimeIndexPreflight(exec, { client: 'better-sqlite3' });

        expect(results.map((entry) => `${entry.index}:${entry.status}`)).toEqual([
            'idx_sys_metadata_overlay_active:blocked',
            'idx_sys_metadata_overlay_draft:clear',
            'idx_sys_view_def_active:blocked',
            'uniq_sys_setting_organization_id_namespace_key_scope_user_id:table-absent',
        ]);

        // The view-definition conflict, named row-for-row. Both NULL columns are
        // reported through their own sentinel bucket, which is what the index
        // actually keys on: `organization_id_key = '__global__'` reads as
        // "organization_id IS NULL", `owner_key = ''` as "owner IS NULL".
        expect(by('idx_sys_view_def_active', results).groups).toEqual([
            {
                key: { name: 'crm_case.all_open', organization_id_key: '__global__', owner_key: '' },
                rowCount: 2,
            },
        ]);

        // The overlay conflict — and here `organization_id` is BARE, because
        // #6418 deliberately did not fold it. A NULL stays a NULL in the key.
        expect(by('idx_sys_metadata_overlay_active', results).groups).toEqual([
            {
                key: {
                    type: 'view',
                    name: 'crm_case.board',
                    organization_id: null,
                    package_id_key: '',
                },
                rowCount: 2,
            },
        ]);

        // ⭐ The archived pair is NOT reported. The index is partial, those rows
        // are outside it, and a pre-flight that flagged them would send an
        // operator to delete data nothing is refusing.
        const viewKeys = JSON.stringify(by('idx_sys_view_def_active', results).groups);
        expect(viewKeys).not.toContain('crm_case.retired');

        expect(by('idx_sys_metadata_overlay_draft', results).groups).toEqual([]);
        expect(by('uniq_sys_setting_organization_id_namespace_key_scope_user_id', results).groups).toEqual([]);
    });

    it('carries the row scope and key parts each migration actually builds', async () => {
        const results = await collectRuntimeIndexPreflight(exec);

        expect(by('idx_sys_view_def_active', results)).toMatchObject({
            migration: 'ensureViewDefinitionActiveIndex',
            table: 'sys_view_definition',
            rowScope: "state = 'active'",
            keyParts: ['name', "COALESCE(organization_id, '__global__')", "COALESCE(owner, '')"],
        });
        expect(by('idx_sys_metadata_overlay_draft', results)).toMatchObject({
            migration: 'ensureMetadataOverlayIndexes',
            table: 'sys_metadata',
            rowScope: "state = 'draft'",
            keyParts: ['type', 'name', 'organization_id', "COALESCE(package_id, '')"],
        });
        // `sys_setting` has no lifecycle column: the declaration means every row.
        expect(by('uniq_sys_setting_organization_id_namespace_key_scope_user_id', results).rowScope).toBeNull();
    });

    it('issues the OWNING migration\'s own statements, never a second spelling of the key', () => {
        const probes = runtimeIndexProbes();
        const sql = Object.fromEntries(probes.map((probe) => [probe.index, probe.duplicateSql]));

        expect(sql['idx_sys_metadata_overlay_active']).toBe(buildOverlayDuplicateProbeSql('active'));
        expect(sql['idx_sys_metadata_overlay_draft']).toBe(buildOverlayDuplicateProbeSql('draft'));
        expect(sql['idx_sys_view_def_active']).toBe(buildViewActiveDuplicateProbeSql());
        expect(sql['uniq_sys_setting_organization_id_namespace_key_scope_user_id']).toBe(
            buildSysSettingDuplicateProbeSql(),
        );
        // The presence question is the migration's own too, so this cannot come
        // to a different verdict about the table than the migration does.
        expect(
            probes.find((p) => p.table === 'sys_setting')!.presenceSql,
        ).toBe(buildSysSettingPresenceSql());
    });

    it('spells the sys_setting probe for MySQL, where the bare form is a parse error', () => {
        const mysql = runtimeIndexProbes({ client: 'mysql2' });
        const setting = mysql.find((probe) => probe.table === 'sys_setting')!;
        // `key` is RESERVED on MySQL — the bare statement is ERROR 1064 there
        // (#9434), which is why the migration ships a second spelling and this
        // picks it up rather than compiling a third.
        expect(setting.duplicateSql).toBe(buildSysSettingDuplicateProbeSqlMysql());
        expect(setting.duplicateSql).toContain('`key`');
        // …and the platform's own spelling everywhere else.
        expect(runtimeIndexProbes({ client: 'mysql' }).find((p) => p.table === 'sys_setting')!.duplicateSql).toBe(
            buildSysSettingDuplicateProbeSqlMysql(),
        );
        expect(runtimeIndexProbes({ client: 'pg' }).find((p) => p.table === 'sys_setting')!.duplicateSql).toBe(
            buildSysSettingDuplicateProbeSql(),
        );
    });

    it('writes NOTHING — schema and every row byte-identical across a full run', async () => {
        const before = logicalState();
        const results = await collectRuntimeIndexPreflight(exec, { client: 'better-sqlite3' });
        // The run really did something, so the comparison below is not vacuous.
        expect(results.some((entry) => entry.status === 'blocked')).toBe(true);
        expect(logicalState()).toEqual(before);
    });

    it('a seam that accepts every statement and answers none is unreadable, never absent', async () => {
        // `InMemoryDriver.execute()` shape (#10677): it neither throws nor is
        // missing, it just returns `null`. Read through the per-index presence
        // question alone that would be four `table-absent` entries — a clean
        // bill of health from a probe that never ran.
        const noop: IndexExec = async () => null;
        const results = await collectRuntimeIndexPreflight(noop);

        expect(results.length).toBeGreaterThan(0);
        expect(new Set(results.map((entry) => entry.status))).toEqual(new Set(['unreadable']));
    });

    it('reports a probe that throws as unreadable, with the driver\'s own message', async () => {
        const failing: IndexExec = async (sql: string) => {
            if (sql.includes('sys_view_definition') && sql.includes('GROUP BY')) {
                throw new Error('database is locked');
            }
            return db.prepare(sql).all();
        };
        const results = await collectRuntimeIndexPreflight(failing);

        expect(by('idx_sys_view_def_active', results)).toMatchObject({
            status: 'unreadable',
            detail: 'database is locked',
            groups: [],
        });
        // …and one unreadable index never aborts the rest of the inventory.
        expect(by('idx_sys_metadata_overlay_active', results).status).toBe('blocked');
    });
});
