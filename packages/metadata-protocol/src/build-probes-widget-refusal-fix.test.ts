// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `widget_query_failed` issue's `fix` names the remedy for the failure that
 * actually happened.
 *
 * The widget plane runs `queryDataset` as the publishing caller, so read
 * admission can refuse a dataset that is correct. That refusal is told apart
 * by the thrown error's ADR-0112 `code` (`PERMISSION_DENIED`), and its `fix`
 * names the caller's read access — never a dataset edit. Every other throw
 * (a selection the dataset does not declare, an unjudgeable member) keeps the
 * dataset fix. `code`, `severity` and `message` are the same on both arms.
 *
 * The errors below are the analytics service's envelopes field for field
 * (`read-admission.ts`, `field-read-admission.ts`, `dataset-refusal.ts`); the
 * same leg through a real `AnalyticsService` is pinned in `@objectstack/runtime`
 * (`packages-publish-drafts-probe-caller-context.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { runBuildProbes, type ProbeEngine } from './build-probes.js';

const ITEMS: Record<string, unknown> = {
    'dashboard board': { name: 'board', widgets: [{ id: 'w1', dataset: 'ds', values: ['total'] }] },
    'dataset ds': { name: 'ds', object: 'task_item', measures: [{ name: 'total', aggregate: 'count' }] },
};
const getItem = async (type: string, name: string) => ITEMS[`${type} ${name}`];
const engine: ProbeEngine = { find: async () => [{ id: 'r1' }] };

const DATASET_FIX = `Fix the dataset definition (or the widget's values/dimensions) so the query compiles, then republish.`;

function envelope(message: string, fields: Record<string, unknown>): Error {
    return Object.assign(new Error(message), fields);
}

async function probeThrowing(err: Error) {
    const report = await runBuildProbes({
        engine,
        getItem,
        analytics: { queryDataset: async () => { throw err; } },
        context: { userId: 'u_publisher' },
        published: [{ type: 'dashboard', name: 'board' }],
    });
    expect(report.checked.widgets).toBe(1);
    expect(report.issues).toHaveLength(1);
    const issue = report.issues[0]!;
    // Unchanged on every arm: the code, the tier and the message the error carries.
    expect(issue).toMatchObject({
        layer: 'runtime',
        severity: 'error',
        code: 'widget_query_failed',
        artifact: { type: 'dashboard', name: 'board' },
        ref: { type: 'dataset', name: 'ds', member: 'w1' },
    });
    expect(issue.message).toContain(err.message);
    return issue;
}

describe('widget_query_failed — the fix follows the failure', () => {
    it('an object read-admission refusal names the caller\'s read access, not the dataset', async () => {
        const issue = await probeThrowing(envelope(
            '[Analytics] Access denied: reading "task_item" is not permitted for this user.',
            { code: 'PERMISSION_DENIED', status: 403, object: 'task_item' },
        ));
        expect(issue.fix).toContain('read access to object "task_item"');
        expect(issue.fix).toContain('Dataset "ds" is not the cause');
        expect(issue.fix).not.toContain(DATASET_FIX);
    });

    it('names the object the refusal names — a joined object, not the dataset\'s base', async () => {
        const issue = await probeThrowing(envelope(
            '[Analytics] Access denied: reading "project" is not permitted for this user.',
            { code: 'PERMISSION_DENIED', status: 403, object: 'project' },
        ));
        expect(issue.fix).toContain('read access to object "project"');
        expect(issue.fix).not.toContain('"task_item"');
    });

    it('a field-level read refusal names the refused fields', async () => {
        const issue = await probeThrowing(envelope(
            "[Security] Field read denied: not permitted to aggregate [salary] on 'task_item'",
            { code: 'PERMISSION_DENIED', status: 403, object: 'task_item', fields: ['salary'] },
        ));
        expect(issue.fix).toContain('read access to object "task_item" and its field(s) salary');
    });

    it('a selection the dataset does not declare keeps the dataset fix', async () => {
        const issue = await probeThrowing(envelope(
            'Dataset "ds" does not declare measure "nope".',
            { code: 'DATASET_INVALID', status: 400 },
        ));
        expect(issue.fix).toBe(DATASET_FIX);
    });

    it('an unjudgeable member — PERMISSION_DENIED whose remedy IS the dataset — keeps the dataset fix', async () => {
        const issue = await probeThrowing(envelope(
            "[Analytics] Access denied: member 'total' on 'task_item' is not a column reference",
            { code: 'PERMISSION_DENIED', status: 403, object: 'task_item', member: 'total' },
        ));
        expect(issue.fix).toBe(DATASET_FIX);
    });

    it('a bare Error keeps the dataset fix', async () => {
        const issue = await probeThrowing(new Error('RAW_SQL_UNSUPPORTED'));
        expect(issue.fix).toBe(DATASET_FIX);
    });
});
