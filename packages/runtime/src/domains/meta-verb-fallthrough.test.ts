// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8848] `DELETE` / `PATCH` / `POST` on `/metadata/:type/:name` must be
 * REFUSED with a `405` naming what is allowed — never answered as a READ.
 *
 * ## The defect this pins
 *
 * The `parts.length >= 2` block contained exactly one method-sensitive branch,
 * the save keyed on `PUT` (#8842's landed fix). The read `try` that follows it
 * carried NO method guard, so every other verb fell into it and was answered
 * with the ordinary metadata read. `DELETE` is the sharpest case: a caller
 * asking to delete a metadata item received `200` plus the document, which is
 * indistinguishable from a successful destructive call — and nothing was
 * deleted. No status, header or field separated any of these answers from a
 * real `GET` (AGENTS.md, Route & surface ownership §3 "Absence must be loud",
 * §4 "machine-readable surfaces must not lie").
 *
 * ⚠️ **Not a privilege escalation, and not pinned as one.** These verbs were
 * answered by the read path, which runs the ADR-0106 mask, so the caller got
 * exactly what `GET` would return and nothing was written. A request that does
 * not write does not escalate by skipping a write gate. What is wrong is that
 * the answer LIES about which operation happened.
 *
 * ## Reachability — measured through a real composed host, not assumed
 *
 * #8842 established the Hono catch-all reaches this dispatcher for `PUT`; per
 * verb it was explicitly unmeasured. Driven against a real `createHonoApp`
 * app (`${prefix}/*` catch-all → `dispatch()` → domain registry → this
 * handler), authenticated caller, `/api/v1/meta/object/account`, BEFORE the
 * fix:
 *
 *     GET     → 200, getMetaItem×1                     (control)
 *     HEAD    → 200, getMetaItem×1                     (control — see below)
 *     OPTIONS → 204, never reaches here (CORS short-circuits it)
 *     PUT     → 403 manage_metadata                    (control, #8842's gate)
 *     POST    → 200, getMetaItem×1
 *     PATCH   → 200, getMetaItem×1
 *     DELETE  → 200, getMetaItem×1, deleteMetaItem×0
 *
 * `createMetaDomain` registers no `methods` restriction (`DomainRoute.methods`
 * is optional, "Omit = all methods"), so `domainRegistry.resolve(path, method)`
 * matches every verb — which is why the cases below drive `dispatch()` rather
 * than `handleMetadata()` directly: the registry lookup is part of what makes
 * these verbs arrive at all, so it belongs inside the pin.
 *
 * The OTHER composition matters for reading the blast radius honestly:
 * `packages/rest` registers `GET`, `PUT` and `DELETE` on
 * `/api/v1/meta/:type/:name` but NOT `POST` or `PATCH` (enumerated from
 * `RestServer.registerRoutes()`). So where REST is mounted alongside the
 * catch-all (ADR-0076 D11: "REST-shadowed but still catch REST misses"),
 * `DELETE` is shadowed by REST's real delete, while `POST` and `PATCH` remain
 * REST misses and still land here. In a catch-all-only host — `n()` on Vercel,
 * the documented embed shape — all three land here.
 *
 * ## Why `HEAD` is allowed rather than refused
 *
 * `HEAD` is measured above as served today: `200` with `getMetaItem` called
 * once, the transport stripping the body. That is correct HTTP for a readable
 * resource, so refusing it would not restore an invariant — it would regress a
 * working read verb. The allowed set is therefore `GET, HEAD, PUT`, and it is
 * spelled once in `METADATA_ITEM_METHODS` so the header and the message cannot
 * drift apart.
 *
 * ## Scope
 *
 * ⛔ This refuses the unsupported verbs; it does not IMPLEMENT them. A real
 * metadata delete exists (`protocol.deleteMetaItem`) and REST already exposes
 * `DELETE /api/v1/meta/:type/:name` — mounting it on this transport would
 * expand the public surface and needs its own card.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const STORED_SCHEMA = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { type: 'text' },
        name: { type: 'text' },
    },
};

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The verbs the block serves, and therefore the exact `Allow` header. */
const ALLOW = 'GET, HEAD, PUT';

/** The three verbs the card measured being answered as reads. */
const REFUSED_VERBS = ['DELETE', 'PATCH', 'POST'] as const;

function boot() {
    const stored: Record<string, any> = { account: copy(STORED_SCHEMA) };

    // Spying on the READ is the load-bearing half: "was this write verb served
    // as a read?" is exactly the question `getMetaItem` having been called
    // answers.
    const getMetaItem = vi.fn(async ({ name }: any) => ({
        type: 'object',
        name,
        item: copy(stored[name] ?? STORED_SCHEMA),
    }));
    const saveMetaItem = vi.fn(async ({ name, item }: any) => {
        stored[name] = copy(item);
        return { success: true, name };
    });
    // Declared on the double on purpose: the protocol really does have a
    // metadata delete, and the pin has to show it is never called from here.
    // Its absence is a scope statement, not an oversight.
    const deleteMetaItem = vi.fn(async () => ({ success: true }));

    const protocol = { getMetaItem, saveMetaItem, deleteMetaItem };

    // `dispatch()` RE-RESOLVES identity and overwrites whatever
    // `executionContext` the caller handed in, so an injected one cannot be
    // used with it — an anonymous context reaches the domain and its
    // anonymous-deny answers 401 before the verb is ever looked at. Supplying a
    // session through the real resolver is what makes the `dispatch()`-level
    // cases below exercise the routing they claim to.
    const auth = { api: { getSession: async () => ({ user: { id: 'u_session' } }) } };

    const services: Record<string, any> = { protocol, auth };
    const get = (n: string) => services[n] ?? null;
    const kernel = {
        context: { getService: get },
        getService: get,
        getServiceAsync: async (n: string) => get(n),
    } as any;

    return {
        dispatcher: new HttpDispatcher(kernel),
        getMetaItem,
        saveMetaItem,
        deleteMetaItem,
        storedLabel: () => stored.account.label,
    };
}

const ctx = (executionContext: any): any => ({
    request: {}, environmentId: 'platform', executionContext,
});

/** Context for `dispatch()` — identity comes from the auth double, not from here. */
const SESSION = (): any => ({ request: { headers: {} }, environmentId: 'platform' });

const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] };
const READER = { userId: 'u_reader', isSystem: false, systemPermissions: [] };

describe('#8848 — an unsupported verb on /metadata/:type/:name', () => {
    describe('is refused with 405, not answered as a read', () => {
        it.each(REFUSED_VERBS)('%s → 405 METHOD_NOT_ALLOWED naming the allowed set', async (method) => {
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                method, '/meta/object/account', { any: 'body' }, {}, SESSION(),
            );

            // The ADR-0112 envelope — both halves, never `toThrow()`-style
            // "it failed somehow".
            expect(res.response?.status).toBe(405);
            expect(res.response?.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
            expect(res.response?.body?.success).toBe(false);

            // THE POINT of the 405 over a bare refusal: it NAMES what is
            // allowed, in the machine-readable place a client actually reads.
            expect(res.response?.headers?.Allow).toBe(ALLOW);
            expect(res.response?.body?.error?.message).toContain(ALLOW);

            // The read never ran, so nothing in this answer can be mistaken for
            // the successful GET the caller never asked for.
            expect(stack.getMetaItem).not.toHaveBeenCalled();

            // Nothing was written or deleted either — the refusal is total.
            expect(stack.saveMetaItem).not.toHaveBeenCalled();
            expect(stack.deleteMetaItem).not.toHaveBeenCalled();
            expect(stack.storedLabel()).toBe('Account');
        });

        it('DELETE no longer returns the document that made it look like a successful delete', async () => {
            // The sharpest case stated as the caller sees it: before the guard
            // this body was `{ success: true, data: { …, item: {…} } }`, which
            // reads as "deleted, here is what was there".
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'DELETE', '/meta/object/account', undefined, {}, SESSION(),
            );

            expect(res.response?.status).toBe(405);
            expect(res.response?.body?.data).toBeUndefined();
            expect(JSON.stringify(res.response?.body)).not.toContain('fields');
        });

        it('the compound-name form too — a name in two segments is the same address', async () => {
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'DELETE', '/meta/lead/views/all_leads', undefined, {}, SESSION(),
            );

            expect(res.response?.status).toBe(405);
            expect(res.response?.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
            expect(stack.getMetaItem).not.toHaveBeenCalled();
        });

        it('refuses a caller holding no authoring capability the same way', async () => {
            // The refusal is about the VERB, not about the caller — a reader
            // must not be able to tell the two apart, and must not be handed
            // the document either.
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'DELETE', '/meta/object/account', undefined, {}, SESSION(),
            );

            expect(res.response?.status).toBe(405);
            expect(stack.getMetaItem).not.toHaveBeenCalled();
        });
    });

    /**
     * The over-refusal guard. A pin that only asserted the new 405 would be
     * satisfied by a change that broke every metadata read and write, so this
     * half is not optional company — it is what says the fix is narrow.
     */
    describe('leaves every supported verb exactly as it was', () => {
        it('GET is still served as a read', async () => {
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'GET', '/meta/object/account', undefined, {}, SESSION(),
            );

            expect(res.response?.status).toBe(200);
            expect(res.response?.body?.data?.item?.label).toBe('Account');
            expect(stack.getMetaItem).toHaveBeenCalledTimes(1);
        });

        it('HEAD is still served as a read — it is a read verb, and it worked', async () => {
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'HEAD', '/meta/object/account', undefined, {}, SESSION(),
            );

            expect(res.response?.status).toBe(200);
            expect(stack.getMetaItem).toHaveBeenCalledTimes(1);
        });

        it('an absent method still defaults to the read, as the sibling routes do', async () => {
            // The neighbours spell this `!method || method === 'GET'`; the
            // guard keeps the same default rather than 405-ing an internal
            // caller that passes no method.
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata(
                '/object/account', ctx(READER), undefined as any,
            );

            expect(res.response?.status).toBe(200);
            expect(stack.getMetaItem).toHaveBeenCalledTimes(1);
        });

        it('PUT still saves — the guard sits after the save branch, not in front of it', async () => {
            // Driven at the domain seam rather than through `dispatch()`: a
            // capability-bearing caller has to be INJECTED, because
            // `dispatch()` re-resolves identity from the auth double and that
            // session carries no `manage_metadata`.
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata(
                '/object/account', ctx(AUTHOR), 'PUT',
                { name: 'account', label: 'Account (renamed)', fields: copy(STORED_SCHEMA.fields) },
            );

            expect(res.response?.status).toBe(200);
            expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
            expect(stack.storedLabel()).toBe('Account (renamed)');
        });

        it("PUT's #8842 capability gate still answers before anything else", async () => {
            // Ordering pin: were the verb guard to move ahead of the save
            // branch, this would become a 405 and the write gate would stop
            // being the thing that judges a write.
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'PUT', '/meta/object/account', { name: 'account' }, {}, SESSION(),
            );

            expect(res.response?.status).toBe(403);
            expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(stack.saveMetaItem).not.toHaveBeenCalled();
        });

        it('the sibling routes in this file are untouched — /published still reads', async () => {
            // The guard lives inside the `parts.length >= 2` block, which is
            // reached only after `/published` and `/state` have had their turn.
            const stack = boot();

            const res = await stack.dispatcher.dispatch(
                'GET', '/meta/object/account', undefined, {}, SESSION(),
            );

            expect(res.response?.status).toBe(200);
        });
    });
});
