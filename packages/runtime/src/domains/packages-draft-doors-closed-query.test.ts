// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26713] The package draft doors — `POST /packages/:id/publish-drafts` and
 * its twin `POST /packages/:id/discard-drafts` — read no query parameter, and
 * now say so: any name on the query string is refused `400 VALIDATION_ERROR`
 * with the repo's one recognition sentence (`unknownQueryParamRefusalMessage`,
 * `@objectstack/rest`), before the protocol is asked for anything.
 *
 * Measured before this change, driving `dispatch()`:
 *
 * | request | answer |
 * |---|---|
 * | `POST /packages/:id/publish-drafts?dryRun=true` | `200 outcome: 'published'`; `publishPackageDrafts` ran, so the draft went live |
 * | `POST /packages/:id/discard-drafts?dryRun=true` | `200`; `discardPackageDrafts` ran, so the drafts were dropped |
 *
 * A caller asking for a preview got the irreversible act, answered like a
 * success. A dry run is not a parameter these doors declare; adding one is a
 * protocol change, so until then the name is refused rather than ignored.
 *
 * Both halves (AGENTS.md route rule 5): a REFUSAL pin — status, code, the
 * shared sentence, and the protocol never called — beside a PRESERVATION pin
 * on the call that sends no query.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { unknownQueryParamRefusalMessage } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.app';

/** Admitted by the draft doors' capability gate. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };
/** Signed in, but without `manage_metadata`. */
const VIEWER = { userId: 'u_viewer', isSystem: false, systemPermissions: [] as string[] };

const PUBLISHED_ONE = {
    success: true, outcome: 'published', publishedCount: 1, failedCount: 0,
    published: [{ type: 'flow', name: 'nightly_rollup', version: 'sha256:aa11' }], failed: [],
};
const DISCARDED_ONE = {
    success: true, discardedCount: 1, failedCount: 0,
    discarded: [{ type: 'flow', name: 'nightly_rollup' }], failed: [],
};

/** The dispatcher over a REAL registry holding one installed package, and a recording protocol. */
function boot(caller: Record<string, unknown> = AUTHOR) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, name: PKG, namespace: 'app', version: '1.0.0', type: 'app' } as any, 'code');
    const protocol = {
        publishPackageDrafts: vi.fn(async () => JSON.parse(JSON.stringify(PUBLISHED_ONE))),
        discardPackageDrafts: vi.fn(async () => JSON.parse(JSON.stringify(DISCARDED_ONE))),
        // The ADR-0045 visibility flip after a publish: no app to unhide.
        getMetaItems: vi.fn(async () => ({ items: [] })),
        saveMetaItem: vi.fn(async () => ({ ok: true })),
    };
    const services: Record<string, unknown> = { objectql: { registry }, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = {
        context: { getService: get, trigger: vi.fn() },
        getService: get,
        getServiceAsync: async (n: string) => get(n),
    };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...caller });
    return { dispatcher, protocol };
}

interface Answer { status: number; body: any }

async function call(dispatcher: HttpDispatcher, path: string, query: Record<string, unknown>): Promise<Answer> {
    const res = await dispatcher.dispatch('POST', path, {}, query, { request: { headers: {} } } as any);
    return { status: res.response?.status ?? (res.handled ? 200 : 0), body: res.response?.body };
}

function expectRecognitionRefusal(answer: Answer, query: Record<string, unknown>): void {
    expect(answer.status, `expected 400, got ${JSON.stringify(answer)}`).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    // The shared sentence, never a door-local copy: it names what was not
    // understood and says the door takes no query parameters.
    expect(answer.body?.error?.message).toBe(unknownQueryParamRefusalMessage(query, []));
}

const DOORS = [
    { door: 'publish-drafts', protocolCall: 'publishPackageDrafts' },
    { door: 'discard-drafts', protocolCall: 'discardPackageDrafts' },
] as const;

describe.each(DOORS)('[#26713] POST /packages/:id/$door — a closed, empty query set', ({ door, protocolCall }) => {
    it.each([
        [{ dryRun: 'true' }],
        [{ dryRun: ['true', 'true'] }],
        [{ dryRun: 'true', preview: '1' }],
    ])('refuses %j before the protocol is asked', async (query) => {
        const { dispatcher, protocol } = boot();
        const answer = await call(dispatcher, `/packages/${PKG}/${door}`, query);
        expectRecognitionRefusal(answer, query);
        for (const name of Object.keys(query)) expect(answer.body.error.message).toContain(`"${name}"`);
        expect(protocol[protocolCall]).not.toHaveBeenCalled();
    });

    it('preserves the call without a query: the protocol runs once and the door answers 200', async () => {
        const { dispatcher, protocol } = boot();
        const answer = await call(dispatcher, `/packages/${PKG}/${door}`, {});
        expect(answer.status).toBe(200);
        expect(protocol[protocolCall]).toHaveBeenCalledTimes(1);
    });

    it('answers a caller without manage_metadata 403 first: the capability gate outranks the query', async () => {
        const { dispatcher, protocol } = boot(VIEWER);
        const answer = await call(dispatcher, `/packages/${PKG}/${door}`, { dryRun: 'true' });
        expect(answer.status).toBe(403);
        expect(protocol[protocolCall]).not.toHaveBeenCalled();
    });
});
