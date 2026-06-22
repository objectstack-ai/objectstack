// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

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
});
