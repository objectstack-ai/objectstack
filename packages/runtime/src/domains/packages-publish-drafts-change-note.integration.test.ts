// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D1 — `POST /packages/:id/publish-drafts` carries the author's change
 * note into every item history row it writes, and records WHO published as the
 * identity the request was authorized as.
 *
 * Before this, the door forwarded `body.actor` and never `message`; the
 * protocol wrote the note only into the package commit and hard-coded every
 * history row's `change_note` as the sentence naming the package. So Studio's
 * item history could not say why an item changed, and any caller holding
 * `manage_metadata` could record any name as the publisher.
 *
 * What is real: the door (`HttpDispatcher.handlePackages`), the protocol's
 * `publishPackageDrafts` and its per-item promote, ObjectQL, and a SqlDriver
 * over on-disk better-sqlite3 holding the four metadata tables. The rows read
 * back are what landed in SQLite, not what a double was told.
 */

// Pays the lint root's first load at collection, never inside a clocked case.
import '../lint-root-preload.testkit.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
    SysMetadataCommitObject,
} from '@objectstack/metadata-core';
import { captureExpectedReadRefusals, type ExpectedReadRefusalCapture } from '../expected-read-refusal-noise.js';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.notes.app';
const PLATFORM_PKG = '@objectstack/platform-objects';
/** The object the published views bind to; the build probe reads it (see the list-commits suite). */
const UNBOUND_PROBE_OBJECT = 'anything';
const DEFAULT_NOTE = `publish app package '${PKG}'`;

let cleanup: Array<() => void> = [];
let noise: ExpectedReadRefusalCapture | null = null;
afterEach(() => {
    for (const c of cleanup) c();
    cleanup = [];
    expect(noise?.tablesSeen() ?? ['no capture was installed']).toEqual([]);
    noise = null;
});

/**
 * [#32455] `channel` and `namespace` are for the visibility-flip pins below:
 * the publish-time authoring gate runs on the `environment` channel only, and
 * the pre-flight namespace rule needs a declared namespace. Defaults are this
 * file's original boot.
 */
async function boot(opts: { channel?: 'environment' | 'package-author'; namespace?: string } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'os-publish-note-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: join(dir, 'data.sqlite') },
        useNullAsDefault: true,
    });
    const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject] as any[];
    noise = captureExpectedReadRefusals([UNBOUND_PROBE_OBJECT]);
    noise.captureDriver(driver);
    await driver.initObjects(objects);

    const engine = new ObjectQL();
    noise.captureEngine(engine);
    engine.registerDriver(driver as any, true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
    engine.registry.installPackage(
        { id: PKG, name: PKG, version: '1.0.0', ...(opts.namespace ? { namespace: opts.namespace } : {}) } as any,
        'authored',
    );
    cleanup.push(() => { void engine.destroy(); });

    const protocol = new ObjectStackProtocolImplementation(engine as any, undefined, undefined, opts.channel ?? 'package-author');
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve(protocol);
            if (name === 'objectql') return Promise.resolve(engine);
            return null;
        },
        // [#32455] A spy, so a pin can say whether `metadata:reloaded` was announced.
        context: { getService: () => null, trigger: vi.fn() },
    };
    return { engine, protocol, dispatcher: new HttpDispatcher(kernel), trigger: kernel.context.trigger as ReturnType<typeof vi.fn> };
}

async function draftViews(protocol: any, names: string[]) {
    for (const name of names) {
        await protocol.saveMetaItem({
            type: 'view',
            name,
            item: {
                name,
                label: name,
                type: 'grid',
                object: UNBOUND_PROBE_OBJECT,
                viewKind: 'list',
                data: { provider: 'object', object: UNBOUND_PROBE_OBJECT },
                columns: ['id'],
            },
            packageId: PKG,
            mode: 'draft',
        });
    }
}

const caller = (userId: string) => ({
    request: {},
    executionContext: { userId, systemPermissions: ['manage_metadata', 'studio.access'] },
}) as any;

/** Publish through the door and return the history rows and commit rows this publish wrote. */
async function publish(env: Awaited<ReturnType<typeof boot>>, body: Record<string, unknown>, userId = 'u_alice') {
    const seqBefore = Math.max(
        0,
        ...((await env.engine.find('sys_metadata_history', { where: {} })) as any[]).map((r) => Number(r.event_seq)),
    );
    const result = await env.dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', body, {}, caller(userId));
    expect(result.response?.status).toBe(200);
    const data: any = (result.response as any)?.body?.data;
    expect(data?.outcome).toBe('published');
    const history = ((await env.engine.find('sys_metadata_history', { where: {} })) as any[])
        .filter((r) => Number(r.event_seq) > seqBefore);
    const commits = (await env.engine.find('sys_metadata_commit', { where: { package_id: PKG } })) as any[];
    return { data, history, commit: commits.find((c) => c.id === data.commitId) };
}

describe('publish-drafts records the change note and the session user (ADR-0146 D1)', () => {
    it('a note reaches every history row the publish writes, and the package commit', async () => {
        const env = await boot();
        await draftViews(env.protocol, ['notes_open', 'notes_closed']);

        const { data, history, commit } = await publish(env, { message: 'Split notes into open and closed lists' });

        expect(data.publishedCount).toBe(2);
        expect(history.map((r) => r.name).sort()).toEqual(['notes_closed', 'notes_open']);
        for (const row of history) expect(row.change_note).toBe('Split notes into open and closed lists');
        expect(commit?.message).toBe('Split notes into open and closed lists');
        // And read back through the history door's own mapping, as the panel reads it.
        const read: any = await env.protocol.historyMetaItem({ type: 'view', name: 'notes_open' });
        const latest = [...read.events].sort((a: any, b: any) => b.seq - a.seq)[0];
        expect(latest).toMatchObject({ op: 'publish', message: 'Split notes into open and closed lists', actor: 'u_alice' });
    });

    it('no note keeps the sentence naming the package on every row', async () => {
        const env = await boot();
        await draftViews(env.protocol, ['notes_open', 'notes_closed']);

        const { history } = await publish(env, {});

        expect(history).toHaveLength(2);
        for (const row of history) expect(row.change_note).toBe(DEFAULT_NOTE);
    });

    it('a body `actor` is ignored: the authorized user is recorded on every row and on the commit', async () => {
        const env = await boot();
        await draftViews(env.protocol, ['notes_open', 'notes_closed']);

        const { history, commit } = await publish(env, { actor: 'u_mallory', message: 'n' }, 'u_alice');

        expect(history).toHaveLength(2);
        for (const row of history) expect(row.recorded_by).toBe('u_alice');
        expect(commit?.actor).toBe('u_alice');
    });

    it('a note that is not a string is refused 400 VALIDATION_ERROR naming `message`: nothing is published and no history row is written', async () => {
        const env = await boot();
        await draftViews(env.protocol, ['notes_open']);

        for (const message of [42, {}, []]) {
            const body = { message };
            const result = await env.dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', body, {}, caller('u_alice'));
            const response: any = result.response;
            expect(response?.status, JSON.stringify(body)).toBe(400);
            expect(response?.body?.error?.code, JSON.stringify(body)).toBe('VALIDATION_ERROR');
            expect(response?.body?.error?.message, JSON.stringify(body)).toMatch(/^Invalid publish-drafts body .*\bmessage: /);
        }
        const history = (await env.engine.find('sys_metadata_history', { where: {} })) as any[];
        expect(history.filter((r) => r.operation_type === 'publish')).toEqual([]);
        expect(await env.engine.find('sys_metadata_commit', { where: { package_id: PKG } })).toEqual([]);
        // The draft is still pending: the same draft publishes once the note is a string.
        const { history: published } = await publish(env, { message: 'Open notes list' });
        expect(published.map((r) => [r.name, r.change_note])).toEqual([['notes_open', 'Open notes list']]);
    });

    it('a body that is not a JSON object is refused 400 VALIDATION_ERROR: nothing is published and no history row is written', async () => {
        // [#28541] It used to publish every draft with the default note.
        const env = await boot();
        await draftViews(env.protocol, ['notes_open']);

        for (const body of [[], 'x', 42]) {
            const result = await env.dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', body, {}, caller('u_alice'));
            const response: any = result.response;
            expect(response?.status, JSON.stringify(body)).toBe(400);
            expect(response?.body?.error?.code, JSON.stringify(body)).toBe('VALIDATION_ERROR');
        }
        const history = (await env.engine.find('sys_metadata_history', { where: {} })) as any[];
        expect(history.filter((r) => r.operation_type === 'publish')).toEqual([]);
        expect(await env.engine.find('sys_metadata_commit', { where: { package_id: PKG } })).toEqual([]);
        // The draft is still pending, and an object body publishes it.
        const { history: published } = await publish(env, { message: 'Open notes list' });
        expect(published.map((r) => [r.name, r.change_note])).toEqual([['notes_open', 'Open notes list']]);
    });

    it('a caller with no user id records no actor, never the body’s', async () => {
        const env = await boot();
        await draftViews(env.protocol, ['notes_open']);
        const system = { request: {}, executionContext: { isSystem: true } } as any;

        const result = await env.dispatcher.handlePackages(
            `/${PKG}/publish-drafts`, 'POST', { actor: 'u_mallory' }, {}, system,
        );

        expect(result.response?.status).toBe(200);
        const rows = (await env.engine.find('sys_metadata_history', { where: { name: 'notes_open' } })) as any[];
        const published = rows.filter((r) => r.operation_type === 'publish');
        expect(published).toHaveLength(1);
        expect(published[0].recorded_by ?? null).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// [#32455] ADR-0045 §3's visibility flip follows only a publish that refused
// nothing. ADR-0067 D2: "no partial visibility flip". Measured on `main`
// before the change, through this door: a batch refused at a later draft
// (outcome `refused`, `publishedCount: 0`) still answered
// `unhiddenApps: ["<app>"]`, stored the app `_unpublished: false` and announced
// it, so an app the operator kept hidden reached every launcher anyway.
// ─────────────────────────────────────────────────────────────────────────────

const HIDDEN_APP = 'notes_desk';

/** The app as cold boot hydrates it: the stored row's lifecycle state and its gate. */
async function storedApp(env: Awaited<ReturnType<typeof boot>>) {
    const rows = (await env.engine.find('sys_metadata', { where: { type: 'app', name: HIDDEN_APP } })) as any[];
    return rows.map((r) => ({ state: r.state, _unpublished: JSON.parse(r.metadata)._unpublished }));
}

/** Active and kept hidden: the ADR-0045 §2 materialized shape, saved straight to active. */
async function stageHiddenApp(protocol: any) {
    await protocol.saveMetaItem({
        type: 'app',
        name: HIDDEN_APP,
        item: { name: HIDDEN_APP, label: 'Notes Desk', _unpublished: true },
        packageId: PKG,
    });
}

async function draftObject(protocol: any, name: string, fields: Record<string, unknown>) {
    await protocol.saveMetaItem({
        type: 'object',
        name,
        // The authored OWD the publish gate asks of every custom object, so the
        // field below is the only thing the gate can refuse.
        item: { name, label: name, sharingModel: 'private', fields },
        packageId: PKG,
        mode: 'draft',
    });
}

async function publishDrafts(env: Awaited<ReturnType<typeof boot>>) {
    expect(await storedApp(env)).toEqual([{ state: 'active', _unpublished: true }]);
    env.trigger.mockClear();
    const result = await env.dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', {}, {}, caller('u_alice'));
    expect(result.response?.status).toBe(200);
    return (result.response as any)?.body?.data;
}

describe('[#32455] publish-drafts flips visibility only after a publish that refused nothing (ADR-0067 D2)', () => {
    it('a publish refused at a LATER draft (the rollback) leaves the app hidden: no flip, no `unhiddenApps`, no announce', async () => {
        // The `environment` channel: the publish-time authoring gate runs there.
        const env = await boot({ channel: 'environment' });
        await stageHiddenApp(env.protocol);
        await env.protocol.saveMetaItem({
            type: 'view',
            name: 'notes_ticket.open',
            item: { name: 'notes_ticket.open', label: 'Open', type: 'grid', object: 'notes_ticket', viewKind: 'list', columns: ['reason'] },
            packageId: PKG,
            mode: 'draft',
        });
        // `{YYYYMM}` is no date token and no field: refused when published.
        await draftObject(env.protocol, 'notes_ticket', {
            ticket_no: { type: 'autonumber', label: 'Ticket No', autonumberFormat: 'QJ{YYYYMM}-{0000}' },
            reason: { type: 'text', label: 'Reason' },
        });

        const data = await publishDrafts(env);

        expect(data).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0 });
        expect(data.failed.map((f: any) => [`${f.type}/${f.name}`, f.code]).sort()).toEqual([
            ['object/notes_ticket', 'INVALID_METADATA'],
            ['view/notes_ticket.open', 'BATCH_ABORTED'],
        ]);
        expect(data).not.toHaveProperty('unhiddenApps');
        expect(data).not.toHaveProperty('unhideError');
        expect(await storedApp(env)).toEqual([{ state: 'active', _unpublished: true }]);
        expect(env.trigger).not.toHaveBeenCalled();
    });

    it('a PRE-FLIGHT refusal leaves the app hidden as well', async () => {
        const env = await boot({ namespace: 'notes' });
        await stageHiddenApp(env.protocol);
        await draftViews(env.protocol, ['notes_open']);
        // An object without the package's `notes_` prefix: refused before anything is promoted.
        await draftObject(env.protocol, 'ticket', { reason: { type: 'text', label: 'Reason' } });

        const data = await publishDrafts(env);

        expect(data).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0 });
        expect(data.failed.map((f: any) => [`${f.type}/${f.name}`, f.code])).toEqual([['object/ticket', 'NAMESPACE_PREFIX']]);
        expect(data).not.toHaveProperty('unhiddenApps');
        expect(await storedApp(env)).toEqual([{ state: 'active', _unpublished: true }]);
        expect(env.trigger).not.toHaveBeenCalled();
    });

    it('CONTROL: a `published` batch still flips the app and announces it', async () => {
        const env = await boot();
        await stageHiddenApp(env.protocol);
        await draftViews(env.protocol, ['notes_open']);

        const data = await publishDrafts(env);

        expect(data).toMatchObject({ success: true, outcome: 'published', publishedCount: 1 });
        expect(data.unhiddenApps).toEqual([HIDDEN_APP]);
        expect(await storedApp(env)).toEqual([{ state: 'active', _unpublished: false }]);
        expect(env.trigger).toHaveBeenCalledWith('metadata:reloaded', { changed: ['view/notes_open', `app/${HIDDEN_APP}`] });
    });

    it('CONTROL: `nothing_to_publish` still flips — for an additive build the flip IS the publish (ADR-0045 §3)', async () => {
        const env = await boot();
        await stageHiddenApp(env.protocol);

        const data = await publishDrafts(env);

        expect(data).toMatchObject({ success: false, outcome: 'nothing_to_publish', publishedCount: 0, failed: [] });
        expect(data.unhiddenApps).toEqual([HIDDEN_APP]);
        expect(await storedApp(env)).toEqual([{ state: 'active', _unpublished: false }]);
        expect(env.trigger).toHaveBeenCalledWith('metadata:reloaded', { changed: [`app/${HIDDEN_APP}`] });
    });
});
