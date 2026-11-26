// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37526] A required text field holding only spaces is refused, and the
 * refusal carries its findings one per field.
 *
 * The engine's `required` check trims (`isPresent`, `../screen-input-contract.ts`),
 * so `'   '` is no answer. The refusal's `error` sentence names the screen's
 * declared fields by their API names, which is what a log and an API caller
 * read; a runner reads `fields` instead, the `{ field, code, message }` entries
 * the transport serves as `error.details.fields`, and places each at its field
 * in its own language.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger() {
    return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}

function ctx() {
    return { logger: silentLogger(), getService() { return undefined; } } as any;
}

/** HotCRM's Close Case screen, as the card measured it. */
const CLOSE_CASE = {
    name: 'close_case',
    label: 'Close Case',
    type: 'screen',
    status: 'active',
    version: 1,
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
            id: 'ask',
            type: 'screen',
            label: 'Resolve',
            config: {
                fields: [
                    { name: 'resolution', label: 'Resolution', type: 'textarea', required: true },
                    { name: 'resolved_by_article', label: 'Resolved by article', type: 'text' },
                    { name: 'hours', label: 'Hours', type: 'number', min: 0 },
                ],
            },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
        { id: 'e1', source: 'start', target: 'ask', type: 'default' },
        { id: 'e2', source: 'ask', target: 'end', type: 'default' },
    ],
};

describe('#37526 — a whitespace-only required value, and the refusal\'s findings', () => {
    let engine: AutomationEngine;

    beforeEach(() => {
        engine = new AutomationEngine(silentLogger());
        installBuiltinNodes(engine, ctx());
        engine.registerFlow('close_case', CLOSE_CASE as any);
    });

    async function pause(): Promise<string> {
        const started = await engine.execute('close_case', {} as any);
        expect(started.status).toBe('paused');
        return started.runId!;
    }

    it('refuses three spaces as `required`, names the field in `fields`, and keeps the pause', async () => {
        const runId = await pause();

        const res = await engine.resume(runId, { variables: { resolution: '   ' } });

        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.fields).toEqual([
            { field: 'resolution', code: 'required', message: 'Screen field "resolution" is required' },
        ]);
        // The sentence is unchanged for the callers it is written for.
        expect(res.error).toBe(
            'Invalid screen input: Screen field "resolution" is required — declared fields: '
                + "'resolution', 'resolved_by_article', 'hours'",
        );
        expect(await engine.hasSuspendedRun(runId)).toBe(true);
    });

    it('carries one entry per violated field, each with its own code', async () => {
        const runId = await pause();

        const res = await engine.resume(runId, { variables: { resolution: '', hours: -1, nickname: 'x' } });

        expect(res.code).toBe('INVALID_SCREEN_INPUT');
        expect(res.fields?.map(({ field, code }) => ({ field, code }))).toEqual([
            { field: 'resolution', code: 'required' },
            { field: 'hours', code: 'min_value' },
            { field: 'nickname', code: 'unknown_field' },
        ]);
    });

    it('a real answer resumes the run, and no refusal carries `fields` there', async () => {
        const runId = await pause();

        const res = await engine.resume(runId, { variables: { resolution: '  Replaced the router  ' } });

        expect(res.success).toBe(true);
        expect(res.fields).toBeUndefined();
    });
});
