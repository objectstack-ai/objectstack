// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * Tests for the Protocol Implementation's data methods (findData, getData).
 * Validates that expand/populate/select parameters are correctly normalized
 * and forwarded to the underlying engine.
 */
describe('ObjectStackProtocolImplementation - Data Operations', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;

    beforeEach(() => {
        mockEngine = {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
        };
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    });

    // ═══════════════════════════════════════════════════════════════
    // findData — expand/populate normalization
    // ═══════════════════════════════════════════════════════════════

    describe('findData', () => {
        it('normalizes $search/$searchFields (OData) to bare search/searchFields, not implicit filters', async () => {
            await protocol.findData({ object: 'showcase_account', query: { $search: 'retail', $searchFields: ['name', 'industry'] } });
            const opts = mockEngine.find.mock.calls[0][1];
            expect(opts.search).toBe('retail');
            expect(opts.searchFields).toEqual(['name', 'industry']);
            expect(opts.$search).toBeUndefined();
            expect(opts.$searchFields).toBeUndefined();
            // critical: must NOT fall through to the implicit-filter pass as where.$search
            expect(opts.where?.$search).toBeUndefined();
            expect(opts.where?.searchFields).toBeUndefined();
        });

        // [#2926 ⑩] Unknown `$`-prefixed params must fail loudly instead of
        // silently matching zero rows via the implicit-filter bucket (or —
        // pre-$filter alias — being dropped and returning the unfiltered page).
        it('rejects an unknown $-prefixed query param with 400 UNSUPPORTED_QUERY_PARAM', async () => {
            await expect(
                protocol.findData({ object: 'task', query: { $foo: '1' } }),
            ).rejects.toMatchObject({ status: 400, code: 'UNSUPPORTED_QUERY_PARAM' });
            expect(mockEngine.find).not.toHaveBeenCalled();
        });

        it('names the offending params and the supported list in the rejection message', async () => {
            await expect(
                protocol.findData({ object: 'task', query: { $inlinecount: 'allpages', $format: 'json' } }),
            ).rejects.toThrow(/\$inlinecount.*\$format|\$format.*\$inlinecount/s);
        });

        it('still accepts every supported $ alias after the unknown-$ guard', async () => {
            await protocol.findData({
                object: 'task',
                query: { $top: 5, $skip: 2, $orderby: 'name', $select: 'id,name', $search: 'x', $filter: { status: 'open' } },
            });
            expect(mockEngine.find).toHaveBeenCalledTimes(1);
            const opts = mockEngine.find.mock.calls[0][1];
            expect(opts.limit).toBe(5);
            expect(opts.offset).toBe(2);
            expect(opts.where).toEqual({ status: 'open' });
        });

        it('keeps bare unknown params as implicit field-equality filters (unchanged behavior)', async () => {
            await protocol.findData({ object: 'task', query: { status: 'open' } });
            const opts = mockEngine.find.mock.calls[0][1];
            expect(opts.where).toEqual({ status: 'open' });
        });

        it('should normalize $expand (OData) string to expand Record', async () => {
            await protocol.findData({ object: 'order_item', query: { $expand: 'order,product' } });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'order_item',
                expect.objectContaining({
                    expand: { order: { object: 'order' }, product: { object: 'product' } },
                }),
            );
            // $expand should be deleted from options
            const callArgs = mockEngine.find.mock.calls[0][1];
            expect(callArgs.$expand).toBeUndefined();
        });

        it('should normalize $expand (OData) with different fields to expand Record', async () => {
            await protocol.findData({ object: 'task', query: { $expand: 'assignee,project' } });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    expand: { assignee: { object: 'assignee' }, project: { object: 'project' } },
                }),
            );
        });

        it('should normalize populate array to expand Record', async () => {
            await protocol.findData({ object: 'task', query: { populate: ['assignee'] } });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    expand: { assignee: { object: 'assignee' } },
                }),
            );
        });

        it('should normalize populate string to expand Record', async () => {
            await protocol.findData({ object: 'task', query: { populate: 'assignee,project' } });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    expand: { assignee: { object: 'assignee' }, project: { object: 'project' } },
                }),
            );
        });

        it('should prefer populate names over expand string when both provided', async () => {
            await protocol.findData({
                object: 'task',
                query: { populate: ['assignee'], expand: 'project' },
            });

            // populate names take precedence; the non-object expand string is
            // cleaned up first, then populate-derived names create the Record.
            const callArgs = mockEngine.find.mock.calls[0][1];
            expect(callArgs.populate).toBeUndefined();
            expect(callArgs.$expand).toBeUndefined();
            expect(callArgs.expand).toEqual({ assignee: { object: 'assignee' } });
        });

        it('should pass expand Record object through as-is', async () => {
            await protocol.findData({
                object: 'task',
                query: { expand: { owner: { object: 'owner' }, team: { object: 'team' } } },
            });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    expand: { owner: { object: 'owner' }, team: { object: 'team' } },
                }),
            );
        });

        it('should normalize select string to fields array', async () => {
            await protocol.findData({ object: 'task', query: { select: 'name,status,assignee' } });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    fields: ['name', 'status', 'assignee'],
                }),
            );
        });

        it('should pass numeric pagination params correctly', async () => {
            await protocol.findData({ object: 'task', query: { top: '10', skip: '20' } });

            expect(mockEngine.find).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    limit: 10,
                    offset: 20,
                }),
            );
        });

        it('should work with no query options', async () => {
            await protocol.findData({ object: 'task' });

            expect(mockEngine.find).toHaveBeenCalledWith('task', {});
        });

        it('should return records and standard response shape', async () => {
            mockEngine.find.mockResolvedValue([{ id: 't1', name: 'Task 1' }]);

            const result = await protocol.findData({ object: 'task', query: {} });

            expect(result).toEqual(
                expect.objectContaining({
                    object: 'task',
                    records: [{ id: 't1', name: 'Task 1' }],
                    total: 1,
                }),
            );
        });

        // ───────────────────────────────────────────────────────────
        // Pagination metadata (issue #2212): with a `limit`, `total` must be
        // the match total (via engine.count), not the page size; `hasMore`
        // must reflect whether more pages remain.
        // ───────────────────────────────────────────────────────────

        it('returns the real match total (not the page size) when a limit is present', async () => {
            mockEngine.find.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` })));
            mockEngine.count.mockResolvedValue(3125);

            const result = await protocol.findData({ object: 'task', query: { $top: 100, $skip: 0 } });

            expect(mockEngine.count).toHaveBeenCalledWith('task', expect.objectContaining({ where: undefined }));
            expect(result.total).toBe(3125);
            expect(result.hasMore).toBe(true);
        });

        it('forwards the same where filter to engine.count', async () => {
            mockEngine.find.mockResolvedValue([{ id: 'r1' }]);
            mockEngine.count.mockResolvedValue(42);

            await protocol.findData({ object: 'task', query: { $top: 10, filter: { status: 'open' } } });

            expect(mockEngine.count).toHaveBeenCalledWith('task', expect.objectContaining({ where: { status: 'open' } }));
        });

        it('reports hasMore=false on the last page', async () => {
            // offset 3120, 5 returned, total 3125 → 3120 + 5 === 3125 → no more.
            mockEngine.find.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` })));
            mockEngine.count.mockResolvedValue(3125);

            const result = await protocol.findData({ object: 'task', query: { $top: 100, $skip: 3120 } });

            expect(result.total).toBe(3125);
            expect(result.hasMore).toBe(false);
        });

        it('does NOT call engine.count when no limit is given (full result set)', async () => {
            mockEngine.find.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

            const result = await protocol.findData({ object: 'task', query: {} });

            expect(mockEngine.count).not.toHaveBeenCalled();
            expect(result.total).toBe(2);
            expect(result.hasMore).toBe(false);
        });

        it('skips count for search queries and estimates hasMore from a full page', async () => {
            // engine.count() can't reproduce a $search, so we must not call it; a
            // full page (length === limit) implies there may be more.
            mockEngine.find.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `r${i}` })));

            const result = await protocol.findData({ object: 'task', query: { $top: 10, $search: 'foo' } });

            expect(mockEngine.count).not.toHaveBeenCalled();
            expect(result.hasMore).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // getData — expand/select normalization
    // ═══════════════════════════════════════════════════════════════

    describe('getData', () => {
        it('should convert expand string to expand Record', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'oi_1', name: 'Item 1' });

            await protocol.getData({ object: 'order_item', id: 'oi_1', expand: 'order,product' });

            expect(mockEngine.findOne).toHaveBeenCalledWith(
                'order_item',
                expect.objectContaining({
                    where: { id: 'oi_1' },
                    expand: { order: { object: 'order' }, product: { object: 'product' } },
                }),
            );
        });

        it('should convert expand array to expand Record', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 't1' });

            await protocol.getData({ object: 'task', id: 't1', expand: ['assignee', 'project'] });

            expect(mockEngine.findOne).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    where: { id: 't1' },
                    expand: { assignee: { object: 'assignee' }, project: { object: 'project' } },
                }),
            );
        });

        it('should convert select string to fields array', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 't1', name: 'Test' });

            await protocol.getData({ object: 'task', id: 't1', select: 'name,status' });

            expect(mockEngine.findOne).toHaveBeenCalledWith(
                'task',
                expect.objectContaining({
                    where: { id: 't1' },
                    fields: ['name', 'status'],
                }),
            );
        });

        it('should pass both expand and fields together', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'oi_1' });

            await protocol.getData({
                object: 'order_item',
                id: 'oi_1',
                expand: 'order',
                select: ['name', 'total'],
            });

            expect(mockEngine.findOne).toHaveBeenCalledWith(
                'order_item',
                expect.objectContaining({
                    where: { id: 'oi_1' },
                    expand: { order: { object: 'order' } },
                    fields: ['name', 'total'],
                }),
            );
        });

        it('should work without expand or select', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 't1' });

            await protocol.getData({ object: 'task', id: 't1' });

            expect(mockEngine.findOne).toHaveBeenCalledWith(
                'task',
                { where: { id: 't1' } },
            );
        });

        it('should return standard GetDataResponse shape', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'oi_1', name: 'Item 1' });

            const result = await protocol.getData({ object: 'order_item', id: 'oi_1' });

            expect(result).toEqual({
                object: 'order_item',
                id: 'oi_1',
                record: { id: 'oi_1', name: 'Item 1' },
            });
        });

        it('should throw when record not found', async () => {
            mockEngine.findOne.mockResolvedValue(null);

            await expect(
                protocol.getData({ object: 'task', id: 'missing_id' })
            ).rejects.toThrow('not found');
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Optimistic Concurrency Control — updateData / deleteData
    // ═══════════════════════════════════════════════════════════════
    describe('Optimistic Concurrency Control', () => {
        beforeEach(() => {
            // Both update and delete need `update` / `delete` on the
            // engine, plus `findOne` for the version probe.
            mockEngine.update = vi.fn().mockResolvedValue({ id: 'r1', updated_at: '2026-05-22T07:14:33.000Z' });
            mockEngine.delete = vi.fn().mockResolvedValue(true);
        });

        it('updateData proceeds when no expectedVersion is supplied (legacy callers)', async () => {
            await protocol.updateData({ object: 'task', id: 'r1', data: { name: 'New' } });
            // No version probe was issued
            expect(mockEngine.findOne).not.toHaveBeenCalled();
            expect(mockEngine.update).toHaveBeenCalledOnce();
        });

        it('updateData proceeds when expectedVersion matches current updated_at', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'r1', updated_at: '2026-05-22T07:14:00.000Z' });
            await protocol.updateData({
                object: 'task',
                id: 'r1',
                data: { name: 'New' },
                expectedVersion: '2026-05-22T07:14:00.000Z',
            });
            expect(mockEngine.findOne).toHaveBeenCalledOnce();
            expect(mockEngine.update).toHaveBeenCalledOnce();
        });

        it('updateData strips RFC-7232 quotes from the If-Match token', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'r1', updated_at: '2026-05-22T07:14:00.000Z' });
            await protocol.updateData({
                object: 'task',
                id: 'r1',
                data: { name: 'New' },
                expectedVersion: '"2026-05-22T07:14:00.000Z"',
            });
            expect(mockEngine.update).toHaveBeenCalledOnce();
        });

        it('updateData throws ConcurrentUpdateError when versions differ', async () => {
            mockEngine.findOne.mockResolvedValue({
                id: 'r1',
                updated_at: '2026-05-22T07:14:00.000Z',
                name: 'Server side',
            });
            await expect(
                protocol.updateData({
                    object: 'task',
                    id: 'r1',
                    data: { name: 'My change' },
                    expectedVersion: '2026-05-22T07:00:00.000Z',
                })
            ).rejects.toMatchObject({
                name: 'ConcurrentUpdateError',
                code: 'CONCURRENT_UPDATE',
                status: 409,
                currentVersion: '2026-05-22T07:14:00.000Z',
                currentRecord: expect.objectContaining({ id: 'r1', name: 'Server side' }),
            });
            // update was NOT invoked
            expect(mockEngine.update).not.toHaveBeenCalled();
        });

        it('updateData skips the check when the record has no updated_at column', async () => {
            mockEngine.findOne.mockResolvedValue({ id: 'r1', name: 'No timestamps' });
            await protocol.updateData({
                object: 'task',
                id: 'r1',
                data: { name: 'New' },
                expectedVersion: '2026-05-22T07:14:00.000Z',
            });
            expect(mockEngine.update).toHaveBeenCalledOnce();
        });

        it('updateData skips the check when expectedVersion is empty string', async () => {
            await protocol.updateData({
                object: 'task',
                id: 'r1',
                data: { name: 'New' },
                expectedVersion: '   ',
            });
            expect(mockEngine.findOne).not.toHaveBeenCalled();
            expect(mockEngine.update).toHaveBeenCalledOnce();
        });

        it('deleteData throws ConcurrentUpdateError on version mismatch', async () => {
            mockEngine.findOne.mockResolvedValue({
                id: 'r1',
                updated_at: '2026-05-22T07:14:00.000Z',
            });
            await expect(
                protocol.deleteData({
                    object: 'task',
                    id: 'r1',
                    expectedVersion: '2026-05-22T06:00:00.000Z',
                })
            ).rejects.toMatchObject({
                name: 'ConcurrentUpdateError',
                code: 'CONCURRENT_UPDATE',
            });
            expect(mockEngine.delete).not.toHaveBeenCalled();
        });

        it('deleteData proceeds when versions match', async () => {
            mockEngine.findOne.mockResolvedValue({
                id: 'r1',
                updated_at: '2026-05-22T07:14:00.000Z',
            });
            await protocol.deleteData({
                object: 'task',
                id: 'r1',
                expectedVersion: '2026-05-22T07:14:00.000Z',
            });
            expect(mockEngine.delete).toHaveBeenCalledOnce();
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // cloneData — duplicate a record, gated by enable.clone
    // ═══════════════════════════════════════════════════════════════

    describe('cloneData', () => {
        // A richer engine mock: cloneData reads registry.getObject for the
        // schema (enable.clone + field defs), findOne for the source row, and
        // insert for the copy.
        function makeProtocol(opts: {
            schema?: any;
            source?: any;
        } = {}) {
            const insert = vi.fn(async (_obj: string, data: any) => ({ id: 'new-id', ...data }));
            const findOne = vi.fn().mockResolvedValue(
                opts.source === undefined
                    ? { id: 'src-1', name: 'Acme', amount: 100 }
                    : opts.source,
            );
            const engine: any = {
                findOne,
                insert,
                registry: {
                    getObject: vi.fn().mockReturnValue(
                        opts.schema === undefined
                            ? { name: 'account', fields: { name: { type: 'text' }, amount: { type: 'number' } } }
                            : opts.schema,
                    ),
                },
            };
            return { protocol: new ObjectStackProtocolImplementation(engine), engine, insert, findOne };
        }

        it('copies business fields and strips engine-owned audit/id columns', async () => {
            const { protocol, insert } = makeProtocol({
                source: {
                    id: 'src-1', name: 'Acme', amount: 100,
                    created_at: 'x', created_by: 'u1', updated_at: 'y', updated_by: 'u1',
                },
            });
            const result = await protocol.cloneData({ object: 'account', id: 'src-1' });

            const [, inserted] = insert.mock.calls[0];
            expect(inserted).toEqual({ name: 'Acme', amount: 100 });
            expect(inserted).not.toHaveProperty('id');
            expect(inserted).not.toHaveProperty('created_at');
            expect(inserted).not.toHaveProperty('updated_by');
            expect(result).toMatchObject({ object: 'account', id: 'new-id', sourceId: 'src-1' });
        });

        it('drops autonumber / formula / summary / system fields so they re-derive', async () => {
            const { protocol, insert } = makeProtocol({
                schema: {
                    name: 'ticket',
                    fields: {
                        name: { type: 'text' },
                        ref: { type: 'autonumber' },
                        total: { type: 'formula' },
                        rollup: { type: 'summary' },
                        organization_id: { type: 'text', system: true },
                    },
                },
                source: {
                    id: 'src-1', name: 'Bug', ref: 'TKT-0001',
                    total: 42, rollup: 7, organization_id: 'org-9',
                },
            });
            await protocol.cloneData({ object: 'ticket', id: 'src-1' });

            const [, inserted] = insert.mock.calls[0];
            expect(inserted).toEqual({ name: 'Bug' });
        });

        it('applies caller overrides last (they win over copied values)', async () => {
            const { protocol, insert } = makeProtocol({
                source: { id: 'src-1', name: 'Acme', amount: 100 },
            });
            await protocol.cloneData({
                object: 'account',
                id: 'src-1',
                overrides: { name: 'Acme (Copy)', amount: 0 },
            });
            const [, inserted] = insert.mock.calls[0];
            expect(inserted).toEqual({ name: 'Acme (Copy)', amount: 0 });
        });

        it('forwards context to findOne and insert', async () => {
            const { protocol, insert, findOne } = makeProtocol();
            const ctx = { userId: 'u1' };
            await protocol.cloneData({ object: 'account', id: 'src-1', context: ctx });
            expect(findOne).toHaveBeenCalledWith('account', expect.objectContaining({ context: ctx }));
            expect(insert).toHaveBeenCalledWith('account', expect.anything(), { context: ctx });
        });

        it('rejects with 403 CLONE_DISABLED when enable.clone === false', async () => {
            const { protocol, insert } = makeProtocol({
                schema: { name: 'account', enable: { clone: false }, fields: {} },
            });
            await expect(
                protocol.cloneData({ object: 'account', id: 'src-1' }),
            ).rejects.toMatchObject({ code: 'CLONE_DISABLED', status: 403 });
            expect(insert).not.toHaveBeenCalled();
        });

        it('allows clone when enable block is absent (default-on)', async () => {
            const { protocol, insert } = makeProtocol({
                schema: { name: 'account', fields: { name: { type: 'text' } } },
            });
            await protocol.cloneData({ object: 'account', id: 'src-1' });
            expect(insert).toHaveBeenCalledOnce();
        });

        it('rejects with 404 RECORD_NOT_FOUND when the source is missing', async () => {
            const { protocol, insert } = makeProtocol({ source: null });
            await expect(
                protocol.cloneData({ object: 'account', id: 'nope' }),
            ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
            expect(insert).not.toHaveBeenCalled();
        });

        it('rejects with 404 OBJECT_NOT_FOUND for an unknown object', async () => {
            const { protocol } = makeProtocol({ schema: null });
            await expect(
                protocol.cloneData({ object: 'ghost', id: 'src-1' }),
            ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // [#3770] Object-existence gate — the tiering, at unit level
    //
    // The gap itself (an unregistered object whose physical table exists) is
    // pinned against a real engine in `protocol-unregistered-object.test.ts`.
    // What this block pins is the DECISION RULE, which an engine double is the
    // right tool for: registry present ⇒ the registry is the answer; no
    // registry at all ⇒ there is no answer, so the gate stands down.
    // ═══════════════════════════════════════════════════════════════

    describe('object-existence gate (#3770)', () => {
        function makeGateProtocol(known: string[]) {
            const engine: any = {
                find: vi.fn().mockResolvedValue([]),
                findOne: vi.fn().mockResolvedValue(null),
                count: vi.fn().mockResolvedValue(0),
                insert: vi.fn().mockResolvedValue({ id: 'new-id' }),
                update: vi.fn().mockResolvedValue({ id: 'r1' }),
                delete: vi.fn().mockResolvedValue(undefined),
                registry: {
                    getObject: vi.fn((name: string) =>
                        known.includes(name) ? { name, fields: {} } : undefined),
                },
            };
            return { protocol: new ObjectStackProtocolImplementation(engine), engine };
        }

        it('consults the registry, not the driver, and never reaches the engine on a miss', async () => {
            const { protocol, engine } = makeGateProtocol(['task']);
            await expect(
                protocol.findData({ object: 'ghost' }),
            ).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404, object: 'ghost' });
            expect(engine.registry.getObject).toHaveBeenCalledWith('ghost');
            expect(engine.find).not.toHaveBeenCalled();
        });

        it('lets a registered object straight through', async () => {
            const { protocol, engine } = makeGateProtocol(['task']);
            await protocol.findData({ object: 'task' });
            expect(engine.find).toHaveBeenCalledOnce();
        });

        it('stands down when the engine exposes no registry at all — nothing to consult', async () => {
            // The #3545 tiering: "whole registry unavailable" is a cold-start /
            // embedding shape, not a security decision. Failing closed here
            // would break every registry-less host for no gain, so the gate
            // skips (and warns once — see assertObjectRegistered).
            const engine: any = {
                find: vi.fn().mockResolvedValue([]),
                count: vi.fn().mockResolvedValue(0),
            };
            const protocol = new ObjectStackProtocolImplementation(engine);
            await expect(protocol.findData({ object: 'ghost' })).resolves.toMatchObject({
                object: 'ghost',
                records: [],
            });
            expect(engine.find).toHaveBeenCalledOnce();
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // #4134 — unknown query params were silently lowered into field filters
    //
    // `?pageSize=5` on a 10-row object returned 200 + `total: 0`: the param
    // fell into the implicit-filter bucket as `where.pageSize = '5'`, a
    // predicate no row can satisfy. The failure direction is "fewer", not
    // "wrong", so it is indistinguishable from an empty table — and the write
    // path rejects the SAME unknown name loudly (`INVALID_FIELD`). Mirror of
    // #3948's rule for driver-memory: an unapplied filter must not look like a
    // satisfied one.
    // ═══════════════════════════════════════════════════════════════

    describe('unknown query params are rejected, not lowered into filters (#4134)', () => {
        const TASK_FIELDS = {
            title: { type: 'text' },
            status: { type: 'text' },
            due_date: { type: 'date' },
            owner_id: { type: 'lookup', reference: 'sys_user' },
            created_at: { type: 'datetime' },
        };

        function makeProtocol(fields: Record<string, unknown> = TASK_FIELDS) {
            const engine: any = {
                find: vi.fn().mockResolvedValue([]),
                findOne: vi.fn().mockResolvedValue(null),
                count: vi.fn().mockResolvedValue(0),
                registry: {
                    getObject: vi.fn((name: string) => ({ name, fields })),
                },
            };
            return { protocol: new ObjectStackProtocolImplementation(engine), engine };
        }

        it('rejects a param that names no field with 400 INVALID_FIELD, before the engine', async () => {
            const { protocol, engine } = makeProtocol();
            await expect(
                protocol.findData({ object: 'showcase_task', query: { zzzz: '1' } }),
            ).rejects.toMatchObject({
                status: 400,
                code: 'INVALID_FIELD',
                field: 'zzzz',
                object: 'showcase_task',
            });
            expect(engine.find).not.toHaveBeenCalled();
        });

        it('uses the write path\'s wording so one mistake reads the same on both sides', async () => {
            const { protocol } = makeProtocol();
            await expect(
                protocol.findData({ object: 'showcase_task', query: { zzzz: '1' } }),
            ).rejects.toThrow(/Unknown field 'zzzz' on object 'showcase_task'/);
        });

        it.each([
            ['pageSize', 'top'],
            ['page_size', 'top'],
            ['perPage', 'top'],
            ['page', 'skip'],
            ['sortBy', 'sort'],
            ['q', 'search'],
        ])('points %s at the parameter that actually works (%s)', async (bad, canonical) => {
            const { protocol } = makeProtocol();
            await expect(
                protocol.findData({ object: 'showcase_task', query: { [bad]: '5' } }),
            ).rejects.toThrow(new RegExp(`Did you mean the '${canonical}' query parameter`));
        });

        it('only ever suggests spellings the endpoint really accepts', async () => {
            // A hint that hands the caller a second 400 is worse than no hint.
            // The trap here is `$sort`, which does not exist — sorting's OData
            // spelling is `$orderby`, so the suggestion cannot be built by
            // prefixing `$`.
            const { protocol, engine } = makeProtocol();
            const suggested = new Set<string>();
            for (const bad of ['pageSize', 'page', 'sortBy', 'q', 'criteria', 'columns', 'include']) {
                const err: any = await protocol
                    .findData({ object: 'showcase_task', query: { [bad]: 'x' } })
                    .then(() => undefined, (e: any) => e);
                for (const m of String(err?.message).matchAll(/'(\$?[a-zA-Z]+)'/g)) {
                    if (m[1] !== bad) suggested.add(m[1]);
                }
            }
            expect(suggested.size).toBeGreaterThan(0);
            for (const spelling of suggested) {
                await expect(
                    protocol.findData({ object: 'showcase_task', query: { [spelling]: spelling === 'top' || spelling === '$top' || spelling === 'skip' || spelling === '$skip' ? 1 : 'title' } }),
                    `suggested '${spelling}' must be accepted`,
                ).resolves.toBeDefined();
            }
            expect(engine.find).toHaveBeenCalledTimes(suggested.size);
        });

        it('suggests the closest real field when the param reads like a typo', async () => {
            const { protocol } = makeProtocol();
            await expect(
                protocol.findData({ object: 'showcase_task', query: { stauts: 'done' } }),
            ).rejects.toThrow(/Did you mean the field 'status'\?/);
        });

        it('names every offending param, not just the first', async () => {
            const { protocol } = makeProtocol();
            await expect(
                protocol.findData({ object: 'showcase_task', query: { zzzz: '1', yyyy: '2' } }),
            ).rejects.toMatchObject({ field: 'zzzz', fields: ['zzzz', 'yyyy'] });
        });

        it('AND-merges a known field with an explicit filter instead of dropping it (#4164)', async () => {
            // The #4134 pin test used to freeze the drop behavior here; #4164
            // is the deliberate change it was waiting for. Both predicates now
            // apply, and the consumed key no longer rides to the engine as a
            // stray top-level AST key.
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: { status: 'open' }, owner_id: 'usr_1' },
            });
            const opts = engine.find.mock.calls[0][1];
            expect(opts.where).toEqual({ $and: [{ status: 'open' }, { owner_id: 'usr_1' }] });
            expect(opts.owner_id).toBeUndefined();
        });

        it('merges every implicit field as ONE $and arm', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: { status: 'open' }, owner_id: 'usr_1', due_date: '2026-08-01' },
            });
            expect(engine.find.mock.calls[0][1].where).toEqual({
                $and: [{ status: 'open' }, { owner_id: 'usr_1', due_date: '2026-08-01' }],
            });
        });

        it('a contradictory pair applies both sides — an honest empty set, not a silent wide one', async () => {
            // `?filter={"status":"open"}&status=closed` — both predicates run;
            // the intersection being empty is the caller's contradiction, not a
            // dropped filter. No special-casing of same-field collisions.
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: { status: 'open' }, status: 'closed' },
            });
            expect(engine.find.mock.calls[0][1].where).toEqual({
                $and: [{ status: 'open' }, { status: 'closed' }],
            });
        });

        it('a vacuous explicit filter ({} or empty string) lets implicit predicates stand alone', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: {}, owner_id: 'usr_1' },
            });
            expect(engine.find.mock.calls[0][1].where).toEqual({ owner_id: 'usr_1' });
            // `?filter=` — the parse tolerance keeps '' as-is; the old guard
            // treated it as no-filter, and the merge must keep doing so.
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: '', owner_id: 'usr_1' },
            });
            expect(engine.find.mock.calls[1][1].where).toEqual({ owner_id: 'usr_1' });
        });

        it('count() sees the merged where — pagination totals cannot disagree with records (#4164)', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: { status: 'open' }, owner_id: 'usr_1', top: 5 },
            });
            expect(engine.count).toHaveBeenCalledTimes(1);
            expect(engine.count.mock.calls[0][1].where).toEqual({
                $and: [{ status: 'open' }, { owner_id: 'usr_1' }],
            });
        });

        it('merges identically through the $filter JSON-string alias', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { $filter: JSON.stringify({ status: 'open' }), owner_id: 'usr_1' },
            });
            expect(engine.find.mock.calls[0][1].where).toEqual({
                $and: [{ status: 'open' }, { owner_id: 'usr_1' }],
            });
        });

        it('leaves a non-object where (unparseable filter JSON) untouched — pinned until #4181', async () => {
            // `?filter={oops` — the parse tolerance keeps the raw string and it
            // becomes `where`. Folding real predicates into that garbage would
            // neither apply them nor surface the tolerance bug itself (#4181),
            // so this path keeps its pre-#4164 shape: string where forwarded,
            // implicit key left as a stray option.
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: { filter: '{oops', owner_id: 'usr_1' },
            });
            const opts = engine.find.mock.calls[0][1];
            expect(opts.where).toBe('{oops');
            expect(opts.owner_id).toBe('usr_1');
        });

        it('rejects even when an explicit filter rode along — the 400 must not depend on it', async () => {
            // Without this, `?filter={...}&pageSize=5` takes the `options.where`
            // short-circuit: the bad param is neither applied nor reported, so
            // the caller silently gets an unpaginated page.
            const { protocol, engine } = makeProtocol();
            await expect(
                protocol.findData({
                    object: 'showcase_task',
                    query: { filter: { status: 'open' }, pageSize: '5' },
                }),
            ).rejects.toMatchObject({ code: 'INVALID_FIELD', field: 'pageSize' });
            expect(engine.find).not.toHaveBeenCalled();
        });

        it('still lowers a REAL field name into an implicit equality filter', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({ object: 'showcase_task', query: { status: 'done' } });
            expect(engine.find.mock.calls[0][1].where).toEqual({ status: 'done' });
        });

        it('allows `id` — the primary key is not a declared field', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({ object: 'showcase_task', query: { id: 'rec_1' } });
            expect(engine.find.mock.calls[0][1].where).toEqual({ id: 'rec_1' });
        });

        it('judges a dotted path on its head segment, like engine.find() does for projections', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({ object: 'showcase_task', query: { 'owner_id.name': 'Ada' } });
            expect(engine.find.mock.calls[0][1].where).toEqual({ 'owner_id.name': 'Ada' });
        });

        it('never rejects a reserved parameter — every real spelling still works', async () => {
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: {
                    $top: 5, $skip: 2, $orderby: 'title', $select: 'id,title',
                    $search: 'x', $count: 'true', $expand: 'owner_id',
                },
            });
            await protocol.findData({
                object: 'showcase_task',
                query: { top: 5, skip: 2, sort: '-title', select: 'id,title', populate: 'owner_id', search: 'x' },
            });
            expect(engine.find).toHaveBeenCalledTimes(2);
            for (const call of engine.find.mock.calls) expect(call[1].where).toBeUndefined();
        });

        it('accepts the structural QueryAST keys the POST /query body carries', async () => {
            // `client.data.query(object, query)` posts a `Partial<QueryAST>`,
            // whose documented shape includes `object`. Treated as a field
            // filter it would become `where.object` and match zero rows.
            const { protocol, engine } = makeProtocol();
            await protocol.findData({
                object: 'showcase_task',
                query: {
                    object: 'showcase_task',
                    limit: 5,
                    joins: [],
                    having: {},
                    windowFunctions: [],
                    distinct: true,
                    cursor: { id: 'rec_1' },
                },
            });
            expect(engine.find).toHaveBeenCalledOnce();
            expect(engine.find.mock.calls[0][1].where).toBeUndefined();
        });

        it('stands down when the schema carries no field map — nothing to check against', async () => {
            // External datasources / engine doubles whose columns are not
            // mirrored locally. Same tiering as the #3770 object gate one level
            // up: no source of truth ⇒ no verdict, so the old behavior stands.
            const { protocol, engine } = makeProtocol({});
            await protocol.findData({ object: 'external_thing', query: { zzzz: '1' } });
            expect(engine.find.mock.calls[0][1].where).toEqual({ zzzz: '1' });
        });

        it('stands down when the engine exposes no registry at all', async () => {
            const engine: any = {
                find: vi.fn().mockResolvedValue([]),
                count: vi.fn().mockResolvedValue(0),
            };
            const protocol = new ObjectStackProtocolImplementation(engine);
            await protocol.findData({ object: 'showcase_task', query: { zzzz: '1' } });
            expect(engine.find.mock.calls[0][1].where).toEqual({ zzzz: '1' });
        });
    });
});
