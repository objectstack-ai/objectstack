// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32590] The metadata publish of a field change on a live object, end to
 * end over the real protocol, engine and SQL driver: what the field-type
 * change table says "passes cleanly" reaches the TABLE, and what it says needs
 * a migration is refused at the save with its reason.
 *
 * The card's two shapes, as a Studio author makes them — a draft save of the
 * changed object, then its publish:
 *
 *   - `date` → `datetime` on a table with rows. Before the fix the publish
 *     answered success and every time of day written afterwards was lost:
 *     dropped at the `date` column on Postgres, collapsed to its day by the
 *     driver's stale date registry on SQLite (this file's dialect).
 *   - `required: true` → `false` with `storage: { notNull: false }`. Before the
 *     fix the column kept its NOT NULL, so a create omitting the field was
 *     refused by the database although the published declaration said it was
 *     optional.
 *
 * The Postgres and MySQL halves of the column work (the in-place widening, the
 * in-place relax) are pinned at the driver door, on every live dialect, in
 * `driver-sql/src/sql-driver-published-column-changes.test.ts`. What this file
 * owns is the wiring: that the publish ASKS for the column half
 * (`ensureObjectStorage` → `syncObjectSchema(name, { applyPublishedColumnChanges:
 * true })`), and that the save still refuses the change the table does not
 * promise (`number` → `text`, the representative `field_type_change`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-publish-column-changes-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const TEST_PACKAGE_ID = 'objectstack-test';
const APP = 'com.acme.leave';
const OBJECT = 'leave_request';
const SYSTEM = { isSystem: true };
/** The tenant every row is written under: the object carries the platform's NOT NULL `organization_id`. */
const ORG = 'org_1';
const LATER = '2026-11-13T01:30:00.000Z';
/** The advisory a publish answers with when a column change did not reach the table (`OBJECT_COLUMN_CHANGES_NOT_APPLIED`). */
const COLUMN_CHANGES_NOT_APPLIED = 'object-column-changes-not-applied';

/** The object as first published: the table is created from this. */
const v1 = () => ({
    name: OBJECT,
    label: 'Leave Request',
    sharingModel: 'public_read_write',
    fields: {
        title: { type: 'text', label: 'Title', required: true, storage: { notNull: true } },
        start_date: { type: 'date', label: 'Start', required: true },
        days: { type: 'number', label: 'Days' },
    },
});

/** The card's change: `date` → `datetime`, and the title made optional in both halves. */
const v2 = () => ({
    ...v1(),
    fields: {
        title: { type: 'text', label: 'Title', required: false, storage: { notNull: false } },
        start_date: { type: 'datetime', label: 'Start', required: true },
        days: { type: 'number', label: 'Days' },
    },
});

/** A change the table says needs a migration: `number` → `text`. */
const v3 = () => ({
    ...v2(),
    fields: { ...v2().fields, days: { type: 'text', label: 'Days' } },
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    await engine.syncSchemas();

    const p = new ObjectStackProtocolImplementation(engine as any, () => new Map()) as any;
    await p.installPackage({ manifest: { id: APP, name: 'leave', version: '0.1.0', type: 'app', namespace: 'leave' } });

    /** A draft save naming the package, then the per-item publish naming it. */
    const saveAndPublish = async (item: unknown) => {
        const saved = await p.saveMetaItem({ type: 'object', name: OBJECT, item, mode: 'draft', packageId: APP });
        const published = await p.publishMetaItem({ type: 'object', name: OBJECT, packageId: APP });
        return { saved, published };
    };
    /** The column as the database reports it. */
    const column = async (name: string) => ((await driver.getKnex()(OBJECT).columnInfo()) as any)[name] as { type: string; nullable: boolean };
    const read = async (id: string) => (await engine.findOne(OBJECT, { where: { id }, context: SYSTEM })) as any;
    return { engine, protocol: p, saveAndPublish, column, read };
}

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);
const advisoryRules = (answer: any) => [
    ...(answer?.saved?.advisories ?? []),
    ...(answer?.published?.advisories ?? []),
].map((a: any) => a?.rule);

describe('[#32590] publishing a field change on a live object — the table follows the declaration', () => {
    it('date → datetime on a table with rows: a datetime written after the publish reads back with its time', async () => {
        const rig = await boot();
        const first = await rig.saveAndPublish(v1());
        expect(first.published?.success, JSON.stringify(first.published)).toBe(true);
        const kept: any = await rig.engine.insert(OBJECT, { title: 'kept', start_date: '2026-11-12', organization_id: ORG }, { context: SYSTEM });
        const edited: any = await rig.engine.insert(OBJECT, { title: 'edited', start_date: '2026-11-12', organization_id: ORG }, { context: SYSTEM });

        const second = await rig.saveAndPublish(v2());
        expect(second.published?.success, JSON.stringify(second.published)).toBe(true);
        expect(advisoryRules(second)).not.toContain(COLUMN_CHANGES_NOT_APPLIED);

        await rig.engine.update(OBJECT, { id: edited.id, start_date: LATER }, { context: SYSTEM });
        expect((await rig.read(edited.id)).start_date).toBe(LATER);
        // The day a row held before the publish is still its day.
        expect(String((await rig.read(kept.id)).start_date).slice(0, 10)).toBe('2026-11-12');
    }, 60_000);

    it('required: true → false with storage.notNull: false — a create omitting the field succeeds', async () => {
        const rig = await boot();
        await rig.saveAndPublish(v1());
        await rig.engine.insert(OBJECT, { title: 'before', start_date: '2026-11-12', organization_id: ORG }, { context: SYSTEM });
        expect((await rig.column('title')).nullable).toBe(false);

        const second = await rig.saveAndPublish(v2());
        expect(second.published?.success, JSON.stringify(second.published)).toBe(true);

        expect((await rig.column('title')).nullable).toBe(true);
        const created: any = await rig.engine.insert(OBJECT, { start_date: LATER, organization_id: ORG }, { context: SYSTEM });
        const row = await rig.read(created.id);
        expect(row.title ?? null).toBeNull();
        expect(row.start_date).toBe(LATER);
    }, 60_000);

    it('a change the table says needs a migration (number → text) is refused at the save with its reason; the table and the served object stay', async () => {
        const rig = await boot();
        await rig.saveAndPublish(v1());
        await rig.engine.insert(OBJECT, { title: 'x', start_date: '2026-11-12', days: 3, organization_id: ORG }, { context: SYSTEM });
        await rig.saveAndPublish(v2());
        const columnBefore = await rig.column('days');

        const err = await refusalOf(rig.protocol.saveMetaItem({ type: 'object', name: OBJECT, item: v3(), mode: 'draft', packageId: APP }));

        expect({ code: err?.code, status: err?.status }, String(err?.stack ?? err)).toEqual({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
        expect(err.issues.map((i: any) => [i.code, i.field])).toEqual([['field_type_change', 'days']]);
        expect(err.issues[0].message).toContain("type changed from 'number' to 'text'");
        expect(await rig.column('days')).toEqual(columnBefore);
        expect((rig.engine.registry.getObject(OBJECT) as any)?.fields?.days?.type).toBe('number');
    }, 60_000);
});
