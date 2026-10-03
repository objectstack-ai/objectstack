// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21520] The binding half of the stored-metadata family's boundary for
 * app-authored bodies: a hook BODY may not be bound to a family table.
 *
 * Pinned on a REAL `ObjectQL` engine and the real QuickJS sandbox, through each
 * door a body hook binds by:
 *
 *   - `bindAppArtifactHandlers` — the boot artifact (`AppPlugin.start`) and the
 *     install-local plugin's install and rehydrate, which import this binder;
 *   - the engine's DEFAULT body runner — ObjectQLPlugin's metadata-service
 *     bind of runtime-authored hooks (`bindHooks(…, { packageId:
 *     'metadata-service' })`, no runner of its own).
 *
 * Both reach `hookBodyRunnerFactory`, where the refusal is made. Each body here
 * appends to a neutral `status` field of the input, so whether it RAN is
 * observable on the context the engine dispatched.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';
import { bindAppArtifactHandlers } from './app-artifact-handlers.js';
import { hookBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';

const FAMILY = [...STORED_METADATA_BODY_OBJECTS];
const ORDINARY = 'boundary_note';
const APP_ID = 'com.example.boundary';

const STAMP = "ctx.input.status = (typeof ctx.input.status === 'string' ? ctx.input.status : '') + 'ran';";
const body = { language: 'js', source: STAMP };

function recordingLogger() {
    const errors: Array<{ message: string; meta: any }> = [];
    const infos: string[] = [];
    return {
        errors,
        infos,
        logger: {
            debug() {},
            info(message: string) { infos.push(message); },
            warn() {},
            error(message: string, _err?: unknown, meta?: any) { errors.push({ message, meta }); },
        },
    };
}

/** Dispatch one `beforeInsert` on `object` and answer what the bound bodies stamped. */
async function stampOn(ql: ObjectQL, object: string): Promise<unknown> {
    const ctx: any = { object, event: 'beforeInsert', input: { name: 'probe' }, session: {} };
    await ql.triggerHooks('beforeInsert', ctx);
    return ctx.input.status;
}

function expectBoundaryRefusal(err: any, object: string): void {
    expect(err, 'no refusal was raised').toBeInstanceOf(Error);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.status).toBe(403);
    expect(err.object).toBe(object);
    // The ruled prescription: the refusal names the metadata API.
    expect(String(err.message)).toContain('/api/v1/meta/');
}

describe('[#21520] hookBodyRunnerFactory — the one point a body hook becomes a handler', () => {
    const factory = hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: {}, appId: APP_ID });

    for (const object of FAMILY) {
        it(`refuses, at registration, a body hook whose target is '${object}' (string and list forms)`, () => {
            for (const target of [object, [ORDINARY, object]]) {
                let thrown: unknown;
                try {
                    factory({ name: 'family_hook', object: target, events: ['beforeInsert'], body } as any);
                } catch (err) {
                    thrown = err;
                }
                expectBoundaryRefusal(thrown, object);
            }
        });
    }

    it('binds an ordinary-table body hook as before (control)', () => {
        const fn = factory({ name: 'ordinary_hook', object: ORDINARY, events: ['beforeInsert'], body } as any);
        expect(typeof fn).toBe('function');
    });
});

describe('[#21520] the boot and install-local door — bindAppArtifactHandlers', () => {
    const bundle = {
        manifest: { id: APP_ID, version: '0.1.0', type: 'app' },
        objects: [{ name: ORDINARY, fields: {} }],
        hooks: [
            { name: 'ordinary_hook', object: ORDINARY, events: ['beforeInsert'], body },
            ...FAMILY.map((object) => ({ name: `family_hook_${object}`, object, events: ['beforeInsert'], body })),
        ],
    };

    it('binds the ordinary hook, refuses each family hook, and records the refusal against it', async () => {
        const rec = recordingLogger();
        const ql = new ObjectQL({ logger: rec.logger } as any);
        bindAppArtifactHandlers(ql as any, bundle, { appId: APP_ID, logger: rec.logger as any });

        expect(await stampOn(ql, ORDINARY), 'the ordinary hook binds and fires as before').toBe('ran');
        for (const object of FAMILY) {
            expect(await stampOn(ql, object), `a body ran on '${object}'`).toBeUndefined();
            const logged = rec.errors.find((e) => e.meta?.hook === `family_hook_${object}`);
            expect(logged, `the refusal of the '${object}' hook was not recorded`).toBeDefined();
            expect(String(logged!.meta.error)).toContain('/api/v1/meta/');
        }
    });
});

describe('[#21520] the runtime-authored door — the engine default runner', () => {
    it('the metadata-service bind refuses a family hook and binds the ordinary one', async () => {
        const rec = recordingLogger();
        const ql = new ObjectQL({ logger: rec.logger } as any);
        ql.setDefaultBodyRunner(
            hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql, logger: rec.logger, appId: 'runtime-authored' }),
        );
        ql.bindHooks(
            [
                { name: 'authored_ordinary', object: ORDINARY, events: ['beforeInsert'], body },
                ...FAMILY.map((object) => ({ name: `authored_${object}`, object, events: ['beforeInsert'], body })),
            ] as any,
            { packageId: 'metadata-service' },
        );

        expect(await stampOn(ql, ORDINARY)).toBe('ran');
        for (const object of FAMILY) {
            expect(await stampOn(ql, object), `a body ran on '${object}'`).toBeUndefined();
            expect(rec.errors.some((e) => e.meta?.hook === `authored_${object}`)).toBe(true);
        }
    });

    it('under strict binding the refusal is thrown with its envelope', () => {
        const ql = new ObjectQL({ logger: recordingLogger().logger } as any);
        let thrown: unknown;
        try {
            bindHooksToEngine(ql, [{ name: 'strict_family', object: FAMILY[0], events: ['beforeInsert'], body }] as any, {
                bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql, appId: APP_ID }),
                strict: true,
            });
        } catch (err) {
            thrown = err;
        }
        expectBoundaryRefusal(thrown, FAMILY[0]);
    });
});

describe('[#21520] a wildcard body hook — binds, and never runs on a family table', () => {
    it('runs for an ordinary table, not for a family table, and tells the author once at bind', async () => {
        const rec = recordingLogger();
        const ql = new ObjectQL({ logger: rec.logger } as any);
        bindAppArtifactHandlers(
            ql as any,
            { manifest: { id: APP_ID, version: '0.1.0', type: 'app' }, hooks: [{ name: 'every_object', object: '*', events: ['beforeInsert'], body }] },
            { appId: APP_ID, logger: rec.logger as any },
        );

        expect(await stampOn(ql, ORDINARY)).toBe('ran');
        for (const object of FAMILY) expect(await stampOn(ql, object), `a body ran on '${object}'`).toBeUndefined();
        expect(rec.infos.filter((m) => m.includes("'every_object'") && m.includes("('*')"))).toHaveLength(1);
        expect(rec.errors, 'a wildcard is not refused').toEqual([]);
    });
});

describe('[#21520] platform hooks are code, outside the boundary', () => {
    it('a code-handler hook on a family table still binds and fires', async () => {
        const ql = new ObjectQL({ logger: recordingLogger().logger } as any);
        const handler = async (ctx: any) => { ctx.input.status = 'code-ran'; };
        bindHooksToEngine(ql, [{ name: 'platform_code_hook', object: FAMILY[0], events: ['beforeInsert'], handler }] as any, {
            packageId: 'sys:test',
            bodyRunner: hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql, appId: APP_ID }),
        });
        expect(await stampOn(ql, FAMILY[0])).toBe('code-ran');
    });
});
