// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/**
 * [#28665, ADR-0055 §1] Making a detail `controlled_by_parent` with its
 * `master_detail` turned required: the 409 `DESTRUCTIVE_CHANGE` finding counts
 * the stored rows that hold no master and says they become unreadable to
 * everyone, the admin included. Before, it said only that such rows "may fail
 * validation", and the Studio confirm relayed that.
 *
 * Pinned, through the real `saveMetaItem` gate:
 *  - N masterless rows: the finding (and the 409's message) names N and the
 *    consequence; the count is ONE system-authority `count` on that column;
 *  - zero masterless rows, or a count that fails: today's finding, unchanged;
 *  - `force: true` still saves, and asks nothing;
 *  - every other save issues no count at all.
 *
 * Harness: the shape `protocol-destructive.test.ts` uses (a tenant-authored
 * object in a `SchemaRegistry`, a mock engine), with a `count` that answers
 * from a row list by the `$null` predicate it is handed.
 */

const TODAY = "Field 'project' is now required but has no default value — existing rows with null values may fail validation.";

const masterField = (required: boolean) => ({
    name: 'project', type: 'master_detail', reference: 'qow_project', ...(required ? { required: true } : {}),
});

/** The detail as published: `private`, its master not required. */
const storedTask = (over: Record<string, unknown> = {}) => ({
    name: 'qow_task',
    label: 'Task',
    _provenance: 'org',
    sharingModel: 'private',
    fields: {
        name: { name: 'name', type: 'text' },
        project: masterField(false),
    },
    ...over,
});

/** The body Studio's "Make required and save" sends. */
const controlledTask = (over: Record<string, unknown> = {}) => ({
    name: 'qow_task',
    label: 'Task',
    sharingModel: 'controlled_by_parent',
    fields: {
        name: { name: 'name', type: 'text' },
        project: masterField(true),
    },
    ...over,
});

describe('[#28665] the controlled_by_parent master finding counts the rows with no master', () => {
    let protocol: ObjectStackProtocolImplementation;
    let registry: SchemaRegistry;
    let mockEngine: any;
    let taskRows: Array<Record<string, unknown>>;

    function boot(stored: Record<string, unknown> = storedTask()) {
        registry = new SchemaRegistry({ multiTenant: false });
        registry.registerObject({
            name: 'qow_project', label: 'Project', _provenance: 'org', sharingModel: 'private',
            fields: { name: { name: 'name', type: 'text' } },
        } as any, 'pkg');
        registry.registerObject(stored as any, 'pkg');
        mockEngine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'x' }),
            update: vi.fn().mockResolvedValue({ id: 'x' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            aggregate: vi.fn().mockResolvedValue([]),
            // Answers only the has-no-value question on one column, with system
            // authority; anything else is a shape this gate does not send.
            count: vi.fn(async (object: string, query: any) => {
                if (object !== 'qow_task') throw new Error(`count on unexpected object ${object}`);
                if (query?.context?.isSystem !== true) throw new Error('count without system authority');
                const [[field, predicate]] = Object.entries(query?.where ?? {}) as Array<[string, any]>;
                if (predicate?.$null !== true) throw new Error('count without a $null predicate');
                return taskRows.filter((r) => r[field] === null || r[field] === undefined).length;
            }),
        };
        protocol = new ObjectStackProtocolImplementation(mockEngine);
    }

    const refusalOf = async (run: () => Promise<unknown>): Promise<any> => {
        try {
            await run();
        } catch (err) {
            return err;
        }
        throw new Error('expected the save to be refused');
    };
    const masterFinding = (err: any) => (err.issues as any[]).find((i) => i.code === 'field_required_no_default' && i.field === 'project');

    beforeEach(() => {
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        taskRows = [
            { id: 't1', name: 'orphan-1', project: null },
            { id: 't2', name: 'orphan-2', project: null },
            { id: 't3', name: 'owned', project: 'p1' },
        ];
        boot();
    });

    afterEach(() => {
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    it('names how many stored rows have no master and that they become unreadable through every door', async () => {
        for (const mode of [undefined, 'draft'] as const) {
            mockEngine.count.mockClear();
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'object', name: 'qow_task', item: controlledTask(), ...(mode ? { mode } : {}),
            }));
            expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
            const finding = masterFinding(err);
            expect(finding.message).toContain("2 existing rows have no 'project'");
            expect(finding.message).toContain('unreadable through every door');
            // The 409's own text carries it too: the faces that quote only the message.
            expect(err.message).toContain("2 existing rows have no 'project'");
            expect(mockEngine.count).toHaveBeenCalledTimes(1);
            expect(mockEngine.count).toHaveBeenCalledWith('qow_task', { where: { project: { $null: true } }, context: { isSystem: true } });
        }
    });

    it('counts too when the detail already was controlled_by_parent and its master becomes required now', async () => {
        boot(storedTask({ sharingModel: 'controlled_by_parent' }));
        taskRows = [{ id: 't1', project: null }];
        const err = await refusalOf(() => protocol.saveMetaItem({ type: 'object', name: 'qow_task', item: controlledTask() }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
        expect(masterFinding(err).message).toContain("1 existing row has no 'project'");
    });

    it('with no masterless row the finding is today\'s, unchanged', async () => {
        taskRows = [{ id: 't3', project: 'p1' }];
        const err = await refusalOf(() => protocol.saveMetaItem({ type: 'object', name: 'qow_task', item: controlledTask() }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
        expect(masterFinding(err).message).toBe(TODAY);
        expect(mockEngine.count).toHaveBeenCalledTimes(1);
    });

    it('a count that cannot be answered leaves today\'s finding, and the 409 stands', async () => {
        mockEngine.count.mockRejectedValueOnce(Object.assign(new Error('no such table: qow_task'), { code: 'SQLITE_ERROR' }));
        const err = await refusalOf(() => protocol.saveMetaItem({ type: 'object', name: 'qow_task', item: controlledTask() }));
        expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
        expect(masterFinding(err).message).toBe(TODAY);
    });

    it('force=true still saves, and asks the table nothing', async () => {
        const saved = await protocol.saveMetaItem({ type: 'object', name: 'qow_task', item: controlledTask(), force: true });
        expect(saved).toMatchObject({ success: true });
        expect(mockEngine.count).not.toHaveBeenCalled();
    });

    describe('every other save issues no count', () => {
        it('a master made required on a detail that is not controlled_by_parent: today\'s finding, no count', async () => {
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'object', name: 'qow_task', item: controlledTask({ sharingModel: 'private' }),
            }));
            expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
            expect(masterFinding(err).message).toBe(TODAY);
            expect(mockEngine.count).not.toHaveBeenCalled();
        });

        it('another field made required on a controlled_by_parent detail: no count', async () => {
            boot(storedTask({ sharingModel: 'controlled_by_parent', fields: { name: { name: 'name', type: 'text' }, project: masterField(true) } }));
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'object', name: 'qow_task',
                item: controlledTask({ fields: { name: { name: 'name', type: 'text', required: true }, project: masterField(true) } }),
            }));
            expect(err).toMatchObject({ code: 'DESTRUCTIVE_CHANGE', status: 409 });
            expect((err.issues as any[]).map((i) => i.code)).toEqual(['field_required_no_default']);
            expect(mockEngine.count).not.toHaveBeenCalled();
        });

        it('an ordinary save with no destructive change: no count', async () => {
            const saved = await protocol.saveMetaItem({ type: 'object', name: 'qow_task', item: storedTask({ label: 'Tasks', _provenance: undefined }) });
            expect(saved).toMatchObject({ success: true });
            expect(mockEngine.count).not.toHaveBeenCalled();
        });
    });
});
