// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24289 — `bindAppArtifactHandlers` hands a hook's inline `handler` function
 * the `ctx.title(field?)` a hook `body` gets, through the one accessor
 * (`buildTitleSurface`), on a REAL `ObjectQL` engine dispatching through its own
 * `triggerHooks`.
 *
 * The cross-door answer (a source boot against the artifact's body, on a booted
 * stack) is pinned in `@objectstack/verify`'s `harness.hook-title-door.test.ts`.
 * This file pins what only the binder can show:
 *
 *   - both forms answer, and an absent title is `null`, as the VM delivers it;
 *   - every write the handler makes lands on the engine's own context, while
 *     that context never gains a `title` key;
 *   - the app's declaration keeps its own function.
 *
 * ⚠️ `@objectstack/objectql` resolves to its `dist/` here, and so do the
 * record-title imports inside `body-runner.ts`: build it first.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bindAppArtifactHandlers } from './app-artifact-handlers.js';

const APP_ID = 'com.example.hook-titles';
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

const PRODUCT = { name: 'ttl_product', nameField: 'name', fields: { name: { type: 'text' } } };
const LINE = {
    name: 'ttl_line',
    nameField: 'label',
    fields: {
        name: { type: 'text' },
        product: { type: 'lookup', reference: 'ttl_product' },
        spare: { type: 'lookup', reference: 'ttl_product' },
        label: { type: 'formula', expression: "'#' + record.name" },
    },
};

function engine(): ObjectQL {
    const ql = new ObjectQL({ logger: quiet } as any);
    for (const o of [PRODUCT, LINE]) ql.registry.registerObject(o as any, 'test');
    return ql;
}

/** The engine's own hook context shape: the payload wrapped under `input.data`, and the scoped `api`. */
function hookContext(event: string, reads: string[]) {
    return {
        object: 'ttl_line',
        event,
        input: { data: { name: 'n1', product: 'p1' } },
        session: { isSystem: true },
        api: {
            object: (name: string) => ({
                findOne: async (q: { where: { id: string } }) => {
                    reads.push(`${name}:${q.where.id}`);
                    return { id: q.where.id, name: 'Widget' };
                },
            }),
        },
    } as Record<string, any>;
}

describe('#24289: bindAppArtifactHandlers hands an inline hook handler ctx.title', () => {
    it('answers both forms through the one accessor; an absent title is null, never an id', async () => {
        const ql = engine();
        const seen: unknown[] = [];
        bindAppArtifactHandlers(ql as any, {
            manifest: { id: APP_ID, version: '0.1.0', type: 'app' },
            hooks: [{
                name: 'ttl_name_line',
                object: 'ttl_line',
                events: ['beforeInsert'],
                handler: async (ctx: any) => {
                    seen.push(await ctx.title(), await ctx.title('product'), await ctx.title('spare'), await ctx.title(null));
                },
            }],
        }, { appId: APP_ID, logger: quiet });

        const reads: string[] = [];
        await ql.triggerHooks('beforeInsert', hookContext('beforeInsert', reads) as any);

        // This record's formula title over its own columns; the related record's
        // title off the one read the hook context's own `api` served.
        expect(seen).toEqual(['#n1', 'Widget', null, '#n1']);
        expect(reads).toEqual(['ttl_product:p1']);
    });

    it("lands every write on the engine's context, which never gains a title key", async () => {
        const ql = engine();
        const handler = async (ctx: any) => {
            ctx.input.stamped = String(await ctx.title());
            ctx.result = { replaced: true };
        };
        const hook = { name: 'ttl_stamp_line', object: 'ttl_line', events: ['beforeInsert'], handler };
        bindAppArtifactHandlers(ql as any, { manifest: { id: APP_ID, version: '0.1.0', type: 'app' }, hooks: [hook] }, {
            appId: APP_ID,
            logger: quiet,
        });

        const ctx = hookContext('beforeInsert', []);
        await ql.triggerHooks('beforeInsert', ctx as any);

        expect(ctx.input.data.stamped).toBe('#n1');
        expect(ctx.result).toEqual({ replaced: true });
        expect('title' in ctx).toBe(false);
        expect(hook.handler, "the app's own declaration is not rewritten").toBe(handler);
    });
});
