// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8842] A `PUT /meta/:type/:name` carrying a FALSY body must be REFUSED —
 * never silently answered as a read.
 *
 * ## The defect this pins
 *
 * The save branch used to open `if (method === 'PUT' && body)`. Every path
 * inside it returns (including the terminal `501`), so a falsy `body` did not
 * merely skip the write — it fell through to the read `try` below and was
 * answered with the ordinary metadata READ. A write verb came back looking
 * like a successful read, with no status, header or field distinguishing it
 * from a real write acknowledgement. That is the shape "Absence must be loud"
 * exists to prevent (AGENTS.md, Route & surface ownership §3).
 *
 * ## Reachability — measured, not assumed
 *
 * The host that mounts this dispatcher path is the Hono adapter's catch-all
 * (`packages/adapters/hono/src/index.ts`), which builds the body as:
 *
 *     body = await c.req.json().catch(() => ({}))
 *
 * The `.catch` covers a parse FAILURE (empty body, garbage) — it does not
 * cover a SUCCESSFUL parse of a falsy JSON value. Driven against a real Hono
 * app, `PUT` with `content-type: application/json` and a payload of `null`,
 * `false`, `0` or `""` each resolve to a falsy `body`; only an unparseable
 * payload lands on the `{}` fallback. So the falsy body is reachable from an
 * ordinary client, which is what makes this a defect rather than dead code.
 *
 * ## Why refusing is spelled as "fold to `{}`"
 *
 * The sibling transport already answers this question: `packages/rest`'s
 * `PUT /meta/:type/:name` folds `req.body ?? {}` and proceeds into the save
 * unconditionally, so its bodyless writes are refused DOWNSTREAM by the
 * per-type schema with `422 INVALID_METADATA`. Matching it makes the two
 * transports agree about what a bodyless metadata write means, instead of
 * minting a second, bespoke refusal here.
 *
 * ## What the fake protocol does and does not prove
 *
 * `saveMetaItem` below is a double that raises the real ADR-0112 envelope
 * (422 / `INVALID_METADATA` / `issues`) for a body that is not a usable
 * metadata document. It pins THIS DOOR's behaviour: that the write path is
 * entered at all, what `item` it is handed, and that the refusal reaches the
 * caller intact. It deliberately does not re-prove the protocol's own
 * validation — that is `packages/metadata-protocol`'s, measured end to end on
 * the REST door.
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

/** The per-type schema's verdict on a body that carries no metadata document. */
function invalidMetadata(type: string, name: string): Error {
    const err = new Error(`[invalid_metadata] ${type}/${name} failed spec validation: <root>: Required`);
    (err as any).code = 'INVALID_METADATA';
    (err as any).status = 422;
    (err as any).issues = [{ path: '', message: 'Required' }];
    return err;
}

function boot() {
    const stored: Record<string, any> = { account: copy(STORED_SCHEMA) };

    const saveMetaItem = vi.fn(async ({ type, name, item }: any) => {
        // What the real per-type schema does with an empty / non-document body.
        if (!item || typeof item !== 'object' || Object.keys(item).length === 0) {
            throw invalidMetadata(type, name);
        }
        stored[name] = copy(item);
        return { success: true, name };
    });

    // The READ the fall-through used to answer. Spying on it is the
    // load-bearing half: "was this write served as a read?" is exactly the
    // question `getMetaItem` having been called answers.
    const getMetaItem = vi.fn(async ({ name }: any) => ({
        type: 'object',
        name,
        item: copy(stored[name] ?? STORED_SCHEMA),
    }));

    const protocol = { saveMetaItem, getMetaItem };
    const kernel = {
        context: { getService: (n: string) => (n === 'protocol' ? protocol : null) },
    } as any;

    return {
        dispatcher: new HttpDispatcher(kernel),
        saveMetaItem,
        getMetaItem,
        storedLabel: () => stored.account.label,
    };
}

const ctx = (executionContext: any): any => ({
    request: {}, environmentId: 'platform', executionContext,
});

const AUTHOR = { userId: 'u_author', systemPermissions: ['manage_metadata'] };
const NO_CAPS = { userId: 'u_portal', systemPermissions: [] };

/**
 * Every payload a client can send that `JSON.parse` accepts and JS calls
 * falsy. Each one reached the read branch before this fix.
 */
const FALSY_BODIES: ReadonlyArray<readonly [string, any]> = [
    ['null', null],
    ['false', false],
    ['0', 0],
    ['empty string', ''],
    ['undefined (no body parsed at all)', undefined],
];

describe('#8842 — dispatcher PUT /meta/:type/:name with a falsy body', () => {
    describe('is refused, not answered as a read', () => {
        it.each(FALSY_BODIES)('%s → 422 INVALID_METADATA, and no read is served', async (_label, falsy) => {
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata(
                '/object/account',
                ctx(AUTHOR),
                'PUT',
                falsy,
            );

            // The ADR-0112 envelope — both halves, not just "it failed".
            expect(res.response?.status).toBe(422);
            expect(res.response?.body?.error?.code).toBe('INVALID_METADATA');

            // THE POINT: the request was judged as a WRITE. The read branch
            // never ran, so nothing about this answer can be mistaken for the
            // successful GET the caller never asked for.
            expect(stack.getMetaItem).not.toHaveBeenCalled();

            // It reached the writer, and the falsy body was folded to `{}` —
            // the same normalization the REST door performs.
            expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
            expect(stack.saveMetaItem.mock.calls[0][0]).toMatchObject({
                type: 'object', name: 'account', item: {},
            });

            // Nothing was written.
            expect(stack.storedLabel()).toBe('Account');
        });

        it('the capability gate now runs on a falsy body — it used to be skipped entirely', async () => {
            // The gate is the first thing the save branch does. A falsy body
            // that never enters the branch is judged only by whatever the read
            // path enforces, which is a different posture from the write door's.
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata(
                '/object/account',
                ctx(NO_CAPS),
                'PUT',
                null,
            );

            expect(res.response?.status).toBe(403);
            expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
            expect(stack.saveMetaItem).not.toHaveBeenCalled();
            expect(stack.getMetaItem).not.toHaveBeenCalled();
        });

        it('the compound-name form too — a name in two segments is the same operation', async () => {
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata(
                '/lead/views/all_leads',
                ctx(AUTHOR),
                'PUT',
                null,
            );

            expect(res.response?.status).toBe(422);
            expect(res.response?.body?.error?.code).toBe('INVALID_METADATA');
            expect(stack.saveMetaItem.mock.calls[0][0]).toMatchObject({
                type: 'lead', name: 'views/all_leads', item: {},
            });
        });
    });

    /**
     * The over-refusal guard. A pin that only asserted the new refusal would
     * be satisfied by a change that broke EVERY metadata write, so these two
     * are not optional company for the cases above — they are the half that
     * says the fix is narrow.
     */
    describe('leaves every real write exactly as it was', () => {
        it('a PUT carrying a body still saves', async () => {
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata(
                '/object/account',
                ctx(AUTHOR),
                'PUT',
                { name: 'account', label: 'Account (renamed)', fields: copy(STORED_SCHEMA.fields) },
            );

            expect(res.response?.status).toBe(200);
            expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
            expect(stack.storedLabel()).toBe('Account (renamed)');
            expect(stack.getMetaItem).not.toHaveBeenCalled();
        });

        it('the body is handed to the writer VERBATIM — the fold touches only falsy bodies', async () => {
            const stack = boot();
            const item = { name: 'account', label: 'Kept', fields: copy(STORED_SCHEMA.fields) };

            await stack.dispatcher.handleMetadata('/object/account', ctx(AUTHOR), 'PUT', item);

            expect(stack.saveMetaItem.mock.calls[0][0].item).toEqual(item);
        });

        it('a GET is still served as a read', async () => {
            const stack = boot();

            const res = await stack.dispatcher.handleMetadata('/object/account', ctx(AUTHOR), 'GET');

            expect(res.response?.status).toBe(200);
            expect(stack.getMetaItem).toHaveBeenCalledTimes(1);
            expect(stack.saveMetaItem).not.toHaveBeenCalled();
        });
    });
});
