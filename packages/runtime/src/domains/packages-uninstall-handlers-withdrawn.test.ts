// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What `DELETE /api/v1/packages/:id` (the protocol uninstall door) leaves
 * bound on the engine: nothing of a package it uninstalls.
 *
 * ## The question
 *
 * The install-local uninstall door withdraws a package's script-action
 * handlers, body hooks and functions from the engine through
 * `unbindAppArtifactHandlers`, the inverse of the runtime binder that bound
 * them under `app:<id>`. This door calls no such inverse, so it read as if an
 * uninstalled package's handlers stayed bound here until a restart.
 *
 * ## Measured: they do not
 *
 * Two kinds of package hold handlers on the engine, and neither is left
 * running by this door:
 *
 *  1. A package this door can uninstall is a writable base — authored through
 *     `POST /packages` and the metadata door. Its script actions and body
 *     hooks are bound under the environment's authored-handler owner
 *     (`metadata-service`) by `ObjectQLPlugin`'s authored resync, never under
 *     `app:<id>`. The door deletes the package's `sys_metadata` rows and then
 *     announces the withdrawal (`metadata:reloaded`, `app/ID`); the resync
 *     that announcement runs tears the authored set down and binds only the
 *     rows that remain. By the time the door answers, the uninstalled
 *     package's action is refused `404` with nothing run, its hook no longer
 *     fires, and the engine holds no handler under the key. Another authored
 *     package's action and hook (the CONTROL) still run.
 *  2. A package the runtime binder bound under `app:<id>` — an install-local
 *     install (`manifest.register`, then `bindAppArtifactHandlers` with the
 *     door's own options, as `MarketplaceInstallLocalPlugin` does) or a code
 *     boot — is a registered manifest, which this door refuses as read-only
 *     (`422 WRITABLE_PACKAGE_REQUIRED`, ADR-0070) before anything moves. The
 *     package stays installed, so its handler and hook stay bound and run, as
 *     they must; its uninstall belongs to its own door, which unbinds them.
 *
 * So the binder's owners never reach this door, and the door needs no handler
 * cleanup of its own.
 *
 * ## The composition
 *
 * A real `ObjectKernel` with the SQL driver (better-sqlite3 `:memory:`), the
 * real `ObjectQLPlugin` (engine, registry, protocol, authored resync) and the
 * runtime's `AppPlugin` (the default action runner a script body runs
 * through), with an `HttpDispatcher` over that kernel: every call below goes
 * through `dispatch`, the routes a server mounts. `OS_HOME` is redirected to a
 * temp dir: the doors write a real package-state file under it.
 *
 * The negative controls (red with the announcement, or the read-only refusal,
 * ablated) are one-time ablations cited in the PR, not permanent cases.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import { AppPlugin } from '../app-plugin.js';
import { HttpDispatcher } from '../http-dispatcher.js';
import { bindAppArtifactHandlers } from '../app-artifact-handlers.js';
// Paid at collection, not inside a clocked case: the dispatcher's package domain
// reaches it through a dynamic import (check:test-source-alias).
import '@objectstack/metadata';

const HOST = 'com.qa.uh.host';
const TICKET = 'qa_uh_ticket';
/** The authored package under uninstall. */
const P = 'com.qa.uh.p';
/** The CONTROL: another authored package, never uninstalled. */
const Q = 'com.qa.uh.q';
/** A package bound by the runtime binder under `app:<id>`, the way install-local's install leaves it. */
const BOUND = 'com.qa.uh.bound';

const CALLER = {
    userId: 'u_admin', tenantId: 'org_qa', isSystem: false, positions: [], permissions: [],
    systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
};

const js = (source: string) => ({ language: 'js', source, capabilities: [] });
/** A script action on the ticket whose body answers who ran. */
const action = (name: string, by: string) => ({ name, label: name, objectName: TICKET, type: 'script', body: js(`return { by: '${by}' };`) });
/** A body hook on the ticket that appends `by` to the row's `stamped_by`. */
const hook = (name: string, by: string) => ({
    name,
    object: TICKET,
    events: ['beforeInsert'],
    body: js(`const d = ctx.input && ctx.input.data ? ctx.input.data : ctx.input; d.stamped_by = (d.stamped_by || '') + '|${by}';`),
});

const hostStack: any = {
    manifest: { id: HOST, name: 'qa_uh_host', version: '1.0.0', type: 'app', namespace: 'qauhhost' },
    objects: [{
        name: TICKET,
        label: 'Ticket',
        sharingModel: 'public_read_write',
        fields: { name: { type: 'text', label: 'Name' }, stamped_by: { type: 'text', label: 'Stamped by' } },
    }],
};

const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;
let kernel: ObjectKernel;
let ql: ObjectQL;
let dispatcher: HttpDispatcher;

beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'os-uninstall-handlers-'));
    process.env.OS_HOME = home;
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
    await kernel.use({
        name: 'test.uninstall-handlers.driver',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('driver.default', new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any));
        },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppPlugin(hostStack, undefined, { skipSeedData: true }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    ql.registry.logLevel = 'silent';
    dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });
}, 60_000);

afterAll(async () => {
    await Promise.race([kernel?.shutdown(), new Promise<void>((r) => setTimeout(r, 10_000))]);
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    rmSync(home, { recursive: true, force: true });
});

/** One request through the dispatcher's routes, answered as the wire answers it. */
async function http(method: string, path: string, body?: unknown, query: Record<string, string> = {}) {
    const raw = new Request(`http://localhost/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    try {
        const out: any = await dispatcher.dispatch(method, path, body, query, { request: raw } as any, '/api/v1');
        const answer = JSON.parse(JSON.stringify(out.response?.body ?? null));
        return { status: out.response?.status as number, code: answer?.error?.code as string | undefined, data: answer?.data, body: answer };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status, code: thrown.code as string | undefined, data: undefined, body: undefined };
    }
}

/** `POST /data/TICKET`, then what every hook that fired appended to the row. */
async function insertTicket(name: string): Promise<{ id: string; stamped: string }> {
    const res = await http('POST', `/data/${TICKET}`, { name });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = String(res.data?.id);
    const rows = (await ql.find(TICKET, { where: { id }, fields: ['id', 'stamped_by'], context: { isSystem: true } })) as Array<Record<string, unknown>>;
    return { id, stamped: String(rows[0]?.stamped_by ?? '') };
}

/** `POST /actions/TICKET/NAME/RID`. */
const run = (name: string, recordId: string) => http('POST', `/actions/${TICKET}/${name}/${recordId}`, {});

/** The owners holding a handler under `TICKET`'s action `name`, from the engine's listing. */
const holdersOf = (name: string) => ql.listRegisteredActions()
    .filter((row) => row.objectName === TICKET && row.actionName === name)
    .map((row) => row.package);

/** An authored package: installed through `POST /packages`, an action and a body hook saved under it through the metadata door. */
async function authorPackage(id: string, by: string) {
    const installed = await http('POST', '/packages', { manifest: { id, name: id.replace(/\./g, '_'), version: '1.0.0', type: 'app', namespace: `qauh${by}` } });
    expect(installed.status, JSON.stringify(installed.body)).toBe(201);
    const savedAction = await http('PUT', `/meta/action/qa_uh_run_${by}`, action(`qa_uh_run_${by}`, by), { package: id });
    expect(savedAction.status, JSON.stringify(savedAction.body)).toBe(200);
    const savedHook = await http('PUT', `/meta/hook/qa_uh_stamp_${by}`, hook(`qa_uh_stamp_${by}`, by), { package: id });
    expect(savedHook.status, JSON.stringify(savedHook.body)).toBe(200);
}

describe('`DELETE /api/v1/packages/:id` leaves nothing of the package it uninstalls bound on the engine', () => {
    it('an authored package: once the door answers, its action is refused with nothing run, its hook no longer fires; the CONTROL package still runs', async () => {
        await authorPackage(P, 'p');
        await authorPackage(Q, 'q');
        const before = await insertTicket('before');
        // Preconditions: both packages' handlers are bound and run.
        expect(before.stamped.split('|').filter(Boolean).sort()).toEqual(['p', 'q']);
        expect(holdersOf('qa_uh_run_p')).toEqual(['metadata-service']);
        expect((await run('qa_uh_run_p', before.id)).data).toEqual({ by: 'p' });

        const deleted = await http('DELETE', `/packages/${P}`);
        expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
        expect(deleted.data?.registryRemoved).toBe(true);

        // ⭐ No restart, no wait: the door's own answer already found them gone.
        expect(holdersOf('qa_uh_run_p'), 'no handler is left under the uninstalled package\'s action').toEqual([]);
        const after = await run('qa_uh_run_p', before.id);
        expect([after.status, after.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
        expect(after.data, 'the uninstalled package\'s body did not run').toBeUndefined();
        const written = await insertTicket('after');
        expect(written.stamped, 'only the remaining package\'s hook fired').toBe('|q');

        // CONTROL: the other authored package is untouched.
        expect(holdersOf('qa_uh_run_q')).toEqual(['metadata-service']);
        expect((await run('qa_uh_run_q', written.id)).data).toEqual({ by: 'q' });
    }, 60_000);

    it('a package the runtime binder bound under `app:<id>` is refused `422` before anything moves, so its handlers stay bound with it', async () => {
        // What install-local's install leaves: the registration through the
        // `manifest` service, then the runtime binder with the door's options.
        const manifest = {
            id: BOUND, name: 'qa_uh_bound', version: '1.0.0', type: 'app', namespace: 'qauhbound',
            actions: [action('qa_uh_run_bound', 'bound')],
            hooks: [hook('qa_uh_stamp_bound', 'bound')],
        };
        await kernel.getService<{ register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): unknown }>('manifest')
            .register(manifest, { source: 'marketplace' });
        const bound = bindAppArtifactHandlers(ql as any, manifest, {
            appId: BOUND, logger: { info() {}, warn() {}, error() {}, debug() {} } as any,
            source: 'MarketplaceInstallLocal', withholdHooksWithoutBody: true,
        });
        expect([bound.actions, bound.hooks], 'precondition: its action and hook are bound').toEqual([1, 1]);
        expect(holdersOf('qa_uh_run_bound')).toEqual([`app:${BOUND}`]);

        const deleted = await http('DELETE', `/packages/${BOUND}`);
        expect([deleted.status, deleted.code]).toEqual([422, 'WRITABLE_PACKAGE_REQUIRED']);

        // Nothing moved: still installed, so still running.
        expect(ql.registry.getPackage(BOUND)).toBeDefined();
        expect(holdersOf('qa_uh_run_bound')).toEqual([`app:${BOUND}`]);
        const written = await insertTicket('bound');
        expect(written.stamped).toContain('|bound');
        expect((await run('qa_uh_run_bound', written.id)).data).toEqual({ by: 'bound' });
    }, 60_000);
});
