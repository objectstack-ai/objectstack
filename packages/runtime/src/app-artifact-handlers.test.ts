// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21321 — `bindAppArtifactHandlers`, the ONE binder of an app artifact's
 * script-action bodies and body hooks, on a REAL `ObjectQL` engine and the
 * real QuickJS sandbox.
 *
 * Its two callers (`AppPlugin.start`, and the install-local plugin's install
 * and rehydrate) are pinned where they live; this file pins the contract they
 * share:
 *
 *   - a body action becomes an `executeAction` handler under `app:<appId>`,
 *     and running it runs the body;
 *   - a body hook fires through the engine's own `triggerHooks`;
 *   - re-binding the same artifact leaves exactly one handler per action and
 *     one binding per hook (a reinstall);
 *   - re-binding an artifact that DROPPED its action and its hook unbinds both
 *     — including the hook, which `bindHooksToEngine` alone would keep firing
 *     because it unregisters only when handed a non-empty list;
 *   - another owner's handlers are never touched.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bindAppArtifactHandlers, appArtifactHandlerOwner } from './app-artifact-handlers.js';

const APP_ID = 'com.example.tasksapp';
const OWNER = appArtifactHandlerOwner(APP_ID);

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

const ACTION = {
    name: 'complete_task',
    objectName: 'tasks_app_task',
    type: 'script',
    body: { language: 'js', source: 'return { ran: true, id: ctx.recordId };' },
};
const HOOK = {
    name: 'tasks_app_stamp_status',
    object: 'tasks_app_task',
    events: ['beforeInsert'],
    // Appends, so a hook bound twice is visible on the input.
    body: { language: 'js', source: "ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + 'stamped';" },
};

/** The compiled-artifact shape: meta under `manifest`, the action both standalone and object-embedded. */
function artifact(opts: { withHandlers: boolean }) {
    return {
        manifest: { id: APP_ID, version: '0.1.0', type: 'app' },
        objects: [{ name: 'tasks_app_task', fields: {}, ...(opts.withHandlers ? { actions: [ACTION] } : {}) }],
        ...(opts.withHandlers ? { actions: [ACTION], hooks: [HOOK] } : {}),
    };
}

const owned = (ql: ObjectQL, owner = OWNER) =>
    ql.listRegisteredActions().filter((r) => r.package === owner).map((r) => `${r.objectName}:${r.actionName}`);

async function insertStatus(ql: ObjectQL): Promise<unknown> {
    const ctx: any = { object: 'tasks_app_task', event: 'beforeInsert', input: { name: 'probe' }, session: {} };
    await ql.triggerHooks('beforeInsert', ctx);
    return ctx.input.status;
}

describe('#21321: bindAppArtifactHandlers', () => {
    it('binds the body action under app:<appId> — executeAction runs the body', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        const bound = bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });

        expect(bound.owner).toBe(OWNER);
        expect(owned(ql)).toEqual(['tasks_app_task:complete_task']);
        await expect(ql.executeAction('tasks_app_task', 'complete_task', { recordId: 'r1', params: {} }))
            .resolves.toEqual({ ran: true, id: 'r1' });
    });

    it('binds the body hook — the engine’s own triggerHooks runs it', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        expect(await insertStatus(ql), 'precondition: nothing bound yet').toBeUndefined();

        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });

        expect(await insertStatus(ql)).toBe('stamped');
    });

    it('re-binding the same artifact keeps exactly one handler per action and one binding per hook', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });

        expect(owned(ql)).toEqual(['tasks_app_task:complete_task']);
        expect(await insertStatus(ql), 'stampedstamped = the hook is bound twice').toBe('stamped');
    });

    it('re-binding an artifact that dropped its action and hook unbinds both', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });
        expect(owned(ql)).toHaveLength(1);

        const bound = bindAppArtifactHandlers(ql as any, artifact({ withHandlers: false }), { appId: APP_ID, logger: quiet });

        expect(bound).toMatchObject({ hooks: 0, actions: 0 });
        expect(owned(ql), 'an action the new version dropped must stop running').toEqual([]);
        expect(await insertStatus(ql), 'a hook the new version dropped must stop firing').toBeUndefined();
    });

    it('never touches another owner’s handlers', async () => {
        const ql = new ObjectQL({ logger: quiet } as any);
        ql.registerAction('tasks_app_task', 'imperative_task', () => ({ mine: true }));
        ql.registerAction('tasks_app_task', 'authored_task', () => ({ authored: true }), 'metadata-service');

        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: true }), { appId: APP_ID, logger: quiet });
        bindAppArtifactHandlers(ql as any, artifact({ withHandlers: false }), { appId: APP_ID, logger: quiet });

        await expect(ql.executeAction('tasks_app_task', 'imperative_task', {})).resolves.toEqual({ mine: true });
        expect(owned(ql, 'metadata-service')).toEqual(['tasks_app_task:authored_task']);
    });
});
