// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26857] Every package WRITE door declares the query names it reads, and
 * refuses any other `400 VALIDATION_ERROR` with the repo's one recognition
 * sentence (`unknownQueryParamRefusalMessage`, `@objectstack/rest`) before the
 * registry or the protocol is asked for anything. #26713 closed the two draft
 * doors (`packages-draft-doors-closed-query.test.ts`); this file pins the rest
 * of the family.
 *
 * Measured before this change, driving `dispatch()`:
 *
 * | request | answer |
 * |---|---|
 * | `DELETE /packages/:id?keepdata=true` (or `?keep_data=true`) | `200`; `deletePackage` received the package id alone, so the protocol dropped the object tables the caller asked to keep |
 * | `POST /packages?overwrite_existing=true` | the name ignored, the install ran as if it were absent |
 * | `PATCH`, `enable`, `disable`, `publish`, `revert`, `rollback`, `commits/:c/revert`, `adopt-orphans`, `duplicate` with any name | `200`; the act performed, the name ignored |
 *
 * Both halves per door (AGENTS.md route rule 5): a REFUSAL pin — status,
 * code, the shared sentence over the door's declared set, and the act never
 * performed — beside a PRESERVATION pin on the call without a query and, where
 * the door declares one, on the declared flag.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { unknownQueryParamRefusalMessage } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.app';

/** Admitted by the write doors' capability gate. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };
/** Signed in, but without `manage_metadata`. */
const VIEWER = { userId: 'u_viewer', isSystem: false, systemPermissions: [] as string[] };

/**
 * The dispatcher over a REAL registry holding one installed, writable package,
 * and a recording protocol and metadata service: each door's act is one of
 * these spies, so "the act never happened" is a spy never called.
 */
function boot(caller: Record<string, unknown> = AUTHOR) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, name: PKG, namespace: 'app', version: '1.0.0', type: 'app' } as any, 'authored');
    const acts = {
        installPackage: vi.fn(async (r: any) => ({ package: { manifest: r.manifest, status: 'installed', enabled: true } })),
        deletePackage: vi.fn(async (_r: any) => ({ success: true })),
        updatePackage: vi.fn(async (r: any) => ({ package: { manifest: { id: r.packageId, ...r.patch } } })),
        enablePackage: vi.spyOn(registry, 'enablePackage'),
        disablePackage: vi.spyOn(registry, 'disablePackage'),
        publishPackage: vi.fn(async () => ({ success: true })),
        revertStoredPackage: vi.fn(async () => ({ stored: true })),
        rollbackToPackageCommit: vi.fn(async () => ({ success: true })),
        revertCommit: vi.fn(async () => ({ success: true })),
        reassignOrphanedMetadata: vi.fn(async () => ({ success: true, adoptedCount: 0 })),
        duplicatePackage: vi.fn(async (r: any) => ({ success: true, copiedCount: 0, failedCount: 0, targetPackageId: r.targetPackageId, copied: [], failed: [] })),
    };
    const protocol = {
        installPackage: acts.installPackage,
        deletePackage: acts.deletePackage,
        updatePackage: acts.updatePackage,
        revertStoredPackage: acts.revertStoredPackage,
        rollbackToPackageCommit: acts.rollbackToPackageCommit,
        revertCommit: acts.revertCommit,
        reassignOrphanedMetadata: acts.reassignOrphanedMetadata,
        duplicatePackage: acts.duplicatePackage,
    };
    const metadata = { publishPackage: acts.publishPackage };
    const services: Record<string, unknown> = { objectql: { registry }, protocol, metadata };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get, trigger: vi.fn() }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...caller });
    return { dispatcher, registry, acts };
}

type Acts = ReturnType<typeof boot>['acts'];

interface Answer { status: number; body: any }

async function call(dispatcher: HttpDispatcher, method: string, path: string, body: unknown, query: Record<string, unknown>): Promise<Answer> {
    const res = await dispatcher.dispatch(method, path, body, query, { request: { headers: {} } } as any);
    return { status: res.response?.status ?? (res.handled ? 200 : 0), body: res.response?.body };
}

function expectRecognitionRefusal(answer: Answer, query: Record<string, unknown>, declared: readonly string[]): void {
    expect(answer.status, `expected 400, got ${JSON.stringify(answer)}`).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    // The shared sentence over THIS door's declared set, never a door-local copy.
    expect(answer.body?.error?.message).toBe(unknownQueryParamRefusalMessage(query, declared));
}

const NEW_INSTALL = { manifest: { id: 'com.acme.other', name: 'com.acme.other', namespace: 'other', version: '1.0.0', type: 'app' } };
const UPGRADE = { manifest: { id: PKG, name: PKG, namespace: 'app', version: '1.0.1', type: 'app' } };

interface Door {
    door: string;
    method: string;
    path: string;
    body: unknown;
    declared: readonly string[];
    act: keyof Acts;
    okStatus: number;
}

const DOORS: Door[] = [
    { door: 'DELETE /packages/:id', method: 'DELETE', path: `/packages/${PKG}`, body: undefined, declared: ['keepData'], act: 'deletePackage', okStatus: 200 },
    { door: 'POST /packages', method: 'POST', path: '/packages', body: NEW_INSTALL, declared: ['overwrite'], act: 'installPackage', okStatus: 201 },
    { door: 'PATCH /packages/:id', method: 'PATCH', path: `/packages/${PKG}`, body: { description: 'edited' }, declared: [], act: 'updatePackage', okStatus: 200 },
    { door: 'PATCH /packages/:id/enable', method: 'PATCH', path: `/packages/${PKG}/enable`, body: {}, declared: [], act: 'enablePackage', okStatus: 200 },
    { door: 'PATCH /packages/:id/disable', method: 'PATCH', path: `/packages/${PKG}/disable`, body: {}, declared: [], act: 'disablePackage', okStatus: 200 },
    { door: 'POST /packages/:id/publish', method: 'POST', path: `/packages/${PKG}/publish`, body: {}, declared: [], act: 'publishPackage', okStatus: 200 },
    { door: 'POST /packages/:id/revert', method: 'POST', path: `/packages/${PKG}/revert`, body: {}, declared: [], act: 'revertStoredPackage', okStatus: 200 },
    { door: 'POST /packages/:id/rollback', method: 'POST', path: `/packages/${PKG}/rollback`, body: { commitId: 'c_1' }, declared: [], act: 'rollbackToPackageCommit', okStatus: 200 },
    { door: 'POST /packages/:id/commits/:c/revert', method: 'POST', path: `/packages/${PKG}/commits/c_1/revert`, body: {}, declared: [], act: 'revertCommit', okStatus: 200 },
    { door: 'POST /packages/:id/adopt-orphans', method: 'POST', path: `/packages/${PKG}/adopt-orphans`, body: {}, declared: [], act: 'reassignOrphanedMetadata', okStatus: 200 },
    { door: 'POST /packages/:id/duplicate', method: 'POST', path: `/packages/${PKG}/duplicate`, body: { targetPackageId: 'com.acme.copy' }, declared: [], act: 'duplicatePackage', okStatus: 200 },
];

// `setPackageDisabled` writes a real JSON file under OS_HOME on the enable /
// disable allow path; keep it off the developer's `~/.objectstack`.
let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-pkg-closed-query-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

describe('[#26857] DELETE /packages/:id — a misspelled keep-data flag is refused, the tables are kept', () => {
    it.each([
        [{ keepdata: 'true' }],
        [{ keep_data: 'true' }],
        [{ KeepData: '1' }],
        [{ keepData: 'true', keepdata: 'true' }],
        [{ dryRun: 'true' }],
    ])('refuses %j before the protocol deletes anything, and the package stays installed', async (query) => {
        const { dispatcher, registry, acts } = boot();
        const answer = await call(dispatcher, 'DELETE', `/packages/${PKG}`, undefined, query);
        expectRecognitionRefusal(answer, query, ['keepData']);
        // The sentence names each misspelling the caller sent.
        for (const name of Object.keys(query).filter((n) => n !== 'keepData')) {
            expect(answer.body.error.message).toContain(`"${name}"`);
        }
        expect(acts.deletePackage).not.toHaveBeenCalled();
        expect(registry.getPackage(PKG)).toBeDefined();
    });

    it('recognition outranks arity: an unknown name beside a repeated `keepData` is answered as the unknown name', async () => {
        const { dispatcher, acts } = boot();
        const query = { keepData: ['true', 'true'], keepdata: 'true' };
        expectRecognitionRefusal(await call(dispatcher, 'DELETE', `/packages/${PKG}`, undefined, query), query, ['keepData']);
        expect(acts.deletePackage).not.toHaveBeenCalled();
    });

    it.each([
        ['true', { packageId: PKG, keepData: true }],
        ['1', { packageId: PKG, keepData: true }],
    ])('preserves the declared `keepData=%s`: deletePackage receives %j', async (keepData, received) => {
        const { dispatcher, acts } = boot();
        const answer = await call(dispatcher, 'DELETE', `/packages/${PKG}`, undefined, { keepData });
        expect(answer.status).toBe(200);
        expect(acts.deletePackage).toHaveBeenCalledTimes(1);
        expect(acts.deletePackage.mock.calls[0][0]).toEqual(received);
    });
});

describe('[#26857] POST /packages — `overwrite` is the one query name the install door reads', () => {
    it('preserves the declared `overwrite=true`: the installed id is overwritten', async () => {
        const { dispatcher, acts } = boot();
        const answer = await call(dispatcher, 'POST', '/packages', UPGRADE, { overwrite: 'true' });
        expect(answer.status).toBe(201);
        expect(acts.installPackage).toHaveBeenCalledTimes(1);
        expect(acts.installPackage.mock.calls[0][0].manifest).toEqual(UPGRADE.manifest);
    });

    it('refuses a misspelled overwrite flag before the install, instead of answering the 409 it would have read as absent', async () => {
        const { dispatcher, acts } = boot();
        const query = { overWrite: 'true' };
        expectRecognitionRefusal(await call(dispatcher, 'POST', '/packages', UPGRADE, query), query, ['overwrite']);
        expect(acts.installPackage).not.toHaveBeenCalled();
    });
});

describe.each(DOORS)('[#26857] $door — a closed query set', ({ method, path, body, declared, act, okStatus }) => {
    it.each([
        [{ dryRun: 'true' }],
        [{ dryRun: ['true', 'true'] }],
        [{ dryRun: 'true', force: '1' }],
    ])('refuses %j before the act', async (query) => {
        const { dispatcher, acts } = boot();
        const answer = await call(dispatcher, method, path, body, query);
        expectRecognitionRefusal(answer, query, declared);
        for (const name of Object.keys(query)) expect(answer.body.error.message).toContain(`"${name}"`);
        expect(acts[act]).not.toHaveBeenCalled();
    });

    it('preserves the call without a query: the act runs once and the door answers as before', async () => {
        const { dispatcher, acts } = boot();
        const answer = await call(dispatcher, method, path, body, {});
        expect(answer.status, JSON.stringify(answer)).toBe(okStatus);
        expect(acts[act]).toHaveBeenCalledTimes(1);
    });

    it('answers a caller without manage_metadata 403 first: the capability gate outranks the query', async () => {
        const { dispatcher, acts } = boot(VIEWER);
        const answer = await call(dispatcher, method, path, body, { dryRun: 'true' });
        expect(answer.status).toBe(403);
        expect(acts[act]).not.toHaveBeenCalled();
    });
});
