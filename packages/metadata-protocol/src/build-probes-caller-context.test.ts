// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25484] The dashboard-widget plane reads as the caller it is handed.
 *
 * `queryDataset` receives the caller's context (the renderer's path), and the
 * "empty although the object has rows" comparison counts the rows THAT caller
 * can see. A system count beside a caller-scoped query would call a row-scoped
 * empty answer broken. With no context the plane is unchanged: a context-less
 * query, and a system count.
 *
 * The door-to-admission leg is pinned in `@objectstack/runtime`
 * (`packages-publish-drafts-probe-caller-context.test.ts`).
 */

import { describe, expect, it, vi } from 'vitest';
import { runBuildProbes, type ProbeEngine } from './build-probes.js';

const ITEMS: Record<string, unknown> = {
    'dashboard board': { name: 'board', widgets: [{ id: 'w1', dataset: 'ds', values: ['total'] }] },
    'dataset ds': { name: 'ds', object: 'task_item', measures: [{ name: 'total', aggregate: 'count' }] },
};
const getItem = async (type: string, name: string) => ITEMS[`${type} ${name}`];

const CALLER = { userId: 'u_row_scoped' };

/** Rows exist for the system; the row-scoped caller sees none. Honours `limit`. */
function engineVisibleToSystemOnly(): ProbeEngine & { contexts: unknown[] } {
    const contexts: unknown[] = [];
    return {
        contexts,
        find: async (_object: string, query: unknown) => {
            const q = query as { limit?: unknown; context?: { isSystem?: boolean } } | undefined;
            contexts.push(q?.context);
            const rows = q?.context?.isSystem ? [{ id: 'r1' }, { id: 'r2' }] : [];
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
}

describe('runBuildProbes — the widget plane reads as the caller (#25484)', () => {
    it('hands queryDataset the caller context and counts the rows that caller sees', async () => {
        const engine = engineVisibleToSystemOnly();
        const analytics = { queryDataset: vi.fn(async () => ({ rows: [] })) };
        const report = await runBuildProbes({
            engine, getItem, analytics, context: CALLER,
            published: [{ type: 'dashboard', name: 'board' }],
        });

        expect(analytics.queryDataset).toHaveBeenCalledOnce();
        expect(analytics.queryDataset.mock.calls[0]![2]).toBe(CALLER);
        expect(engine.contexts).toEqual([CALLER]);
        expect(report.checked.widgets).toBe(1);
        expect(report.issues).toEqual([]);
    });

    it('with no context: a context-less query and a system count, as before', async () => {
        const engine = engineVisibleToSystemOnly();
        const analytics = { queryDataset: vi.fn(async () => ({ rows: [] })) };
        const report = await runBuildProbes({
            engine, getItem, analytics,
            published: [{ type: 'dashboard', name: 'board' }],
        });

        expect(analytics.queryDataset.mock.calls[0]![2]).toBeUndefined();
        expect(engine.contexts).toEqual([{ isSystem: true }]);
        expect(report.issues.map((i) => [i.code, i.severity])).toEqual([['empty_query', 'error']]);
    });
});
