// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The execution context must never come off the wire.
//
// `findData` built its engine options as `{ ...request.query }` and then
// overwrote `context` from `request.context` ONLY when that was defined. The
// query bag is caller-controlled on every ingress that reaches here (the REST
// `POST /data/:object/query` route hands `req.body` straight in as `query`), and
// `context` is in the schema's known-params set, so it was NOT swept into the
// implicit-filter bucket — it survived into `engine.find` as the operation's
// execution context whenever no server context resolved.
//
// What rides on that context is total: plugin-security's middleware opens with
// `if (opCtx.context?.isSystem) return next()` — the whole RLS/FLS/CRUD chain
// skipped — and `__expandRead` marks a read as an expansion sub-read (it waived
// the object-level CRUD gate for "public" objects until #7626 removed that).
// Neither is ever schema-stripped on the read path
// (`ExecutionContextSchema.parse` runs only in `createContext`).
//
// The auth gate is what stands between that and a live exploit: `enforceAuth`
// refuses anonymous data requests unless a deployment sets `requireAuth: false`.
// That makes this a fail-OPEN default one layer down — the protocol should not
// depend on a route-level gate staying on. These tests pin the invariant at the
// layer that owns it.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = { name: 'invoice', fields: { title: { name: 'title', type: 'text' } } };

function makeProtocol() {
    const find = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const engine = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        find,
        count,
    };
    return { p: new ObjectStackProtocolImplementation(engine as any), find };
}

/** The engine options `findData` handed to `engine.find`. */
const optionsFrom = (find: any) => find.mock.calls[0][1];

describe('findData never takes its execution context from the caller', () => {
    it('drops a body-supplied context when no server context resolved (the anonymous shape)', async () => {
        const { p, find } = makeProtocol();
        await p.findData({
            object: 'invoice',
            query: { context: { isSystem: true, userId: 'root', __expandRead: true } },
        } as any);

        expect(find).toHaveBeenCalledTimes(1);
        expect(optionsFrom(find).context).toBeUndefined();
    });

    it('the resolved context wins and is not merged with the caller\'s', async () => {
        const { p, find } = makeProtocol();
        const resolved = { userId: 'u1', positions: [] };
        await p.findData({
            object: 'invoice',
            query: { context: { isSystem: true } },
            context: resolved,
        } as any);

        expect(optionsFrom(find).context).toBe(resolved);
        expect((optionsFrom(find).context as any).isSystem).toBeUndefined();
    });

    it('a caller `context` does not become an implicit field filter either', async () => {
        // It must be dropped, not folded into `where` as `where.context` — that
        // would turn a forged principal into a query against a column that does
        // not exist (a confusing 400 instead of a clean ignore).
        const { p, find } = makeProtocol();
        await p.findData({ object: 'invoice', query: { context: { isSystem: true } } } as any);

        const opts = optionsFrom(find);
        expect(opts.where).toBeUndefined();
        expect(opts.context).toBeUndefined();
    });

    it('still forwards a real query alongside a forged context', async () => {
        const { p, find } = makeProtocol();
        await p.findData({
            object: 'invoice',
            query: { where: { title: 'x' }, limit: 5, context: { isSystem: true } },
        } as any);

        const opts = optionsFrom(find);
        expect(opts.where).toEqual({ title: 'x' });
        expect(opts.limit).toBe(5);
        expect(opts.context).toBeUndefined();
    });
});
