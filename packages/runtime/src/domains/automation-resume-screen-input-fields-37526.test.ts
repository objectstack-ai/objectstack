// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#37526] A screen refusal's findings reach the wire in `error.details.fields`.
 *
 * The engine answers `INVALID_SCREEN_INPUT` with `fields`, one
 * `{ field, code, message }` per violated screen field, beside the `error`
 * sentence. The resume door serves them where `VALIDATION_FAILED` serves the
 * same entries, so a runner places each at its field instead of showing the
 * sentence. `error.message` is unchanged, and the other refusal rows still
 * carry no details (`automation-resume-refusal-codes.test.ts`).
 */

import { describe, it, expect, vi } from 'vitest';

import { ApiErrorSchema, FieldErrorSchema } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;
const RESUME = '/close_case/runs/run_1/resume';

function makeDispatcher(resumeResult: AutomationResult) {
    const resume = vi.fn(async () => resumeResult);
    const services: Record<string, unknown> = { automation: { resume } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel);
}

const SENTENCE =
    'Invalid screen input: Screen field "resolution" is required — declared fields: '
    + "'resolution', 'resolved_by_article'";

const FIELDS = [{ field: 'resolution', code: 'required', message: 'Screen field "resolution" is required' }] as const;

describe('#37526 — INVALID_SCREEN_INPUT serves its findings in details.fields', () => {
    it('serves the engine\'s findings, the sentence unchanged, under the published envelope', async () => {
        const dispatcher = makeDispatcher({
            success: false,
            code: 'INVALID_SCREEN_INPUT',
            error: SENTENCE,
            fields: [...FIELDS],
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', { inputs: { resolution: '   ' } }, CTX);

        expect(result.response?.status).toBe(400);
        const error = result.response?.body?.error;
        expect(error?.code).toBe('INVALID_SCREEN_INPUT');
        expect(error?.message).toBe(SENTENCE);
        expect(error?.details).toEqual({ fields: FIELDS });
        expect(ApiErrorSchema.safeParse(error).success).toBe(true);
        for (const entry of error.details.fields) {
            const parsed = FieldErrorSchema.safeParse(entry);
            expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        }
    });

    it('serves no details when the engine sent no findings', async () => {
        const dispatcher = makeDispatcher({ success: false, code: 'INVALID_SCREEN_INPUT', error: SENTENCE, fields: [] });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', { inputs: {} }, CTX);

        expect(result.response?.body?.error?.details).toBeUndefined();
    });

    it('does not carry `fields` on another refusal row', async () => {
        const dispatcher = makeDispatcher({
            success: false,
            code: 'INVALID_SIGNAL',
            error: 'Invalid resume signal',
            fields: [...FIELDS],
        });

        const result = await dispatcher.handleAutomation(RESUME, 'POST', { inputs: {} }, CTX);

        expect(result.response?.body?.error?.code).toBe('INVALID_SIGNAL');
        expect(result.response?.body?.error?.details).toBeUndefined();
    });
});
