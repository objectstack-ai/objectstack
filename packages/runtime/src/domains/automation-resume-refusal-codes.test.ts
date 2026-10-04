// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21724] Every resume-refusal row serves its OWN code, and every code it can
 * serve is one the vocabulary registers.
 *
 * The defect: `classifyResumeResult` answered a coded engine refusal with
 * `{ message, status }` and no `details.code`, so the shared error builder
 * derived the code from the status: `INVALID_SIGNAL` and
 * `INVALID_SCREEN_INPUT` both reached the wire as `400 VALIDATION_ERROR`,
 * `RUN_NOT_FOUND` as `404 RESOURCE_NOT_FOUND`, `STORE_UNAVAILABLE` as
 * `503 SERVICE_UNAVAILABLE` and `RESUME_IN_PROGRESS` as
 * `409 RESOURCE_CONFLICT`. Only `PERMISSION_DENIED` survived, because the
 * standard member for 403 happens to be spelled the same.
 *
 * Two pins, both driven from `RESUME_REFUSAL_ROWS` itself so a new row is
 * covered the day it lands, and named in the failure when it is not:
 *
 *  1. **The vocabulary.** Each row's key parses as an `ErrorCode`, which is
 *     the standard catalog together with the ADR-0112 ledger. A row added
 *     without registering its code reds here by name, before any wire test
 *     has to discover it.
 *  2. **The wire.** Each row, returned by a scripted engine, reaches the REST
 *     resume door as that same code and the body parses under the published
 *     `ApiErrorSchema`. A separate case per row holds the row's status, the
 *     engine's message and an empty `details` (the code is promoted out of
 *     it, never duplicated), so the two halves fail apart. The MCP `resume_run` door
 *     shares the classifier; `mcp-resume-run.test.ts` holds it equal to this
 *     door row by row and names the code on each.
 *
 * The real engine, the real door and the real client are driven together in
 * `@objectstack/client`'s `automation-resume-refusal-codes.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';

import { ApiErrorSchema, ErrorCode } from '@objectstack/spec/api';
import type { AutomationResult } from '@objectstack/spec/contracts';

import { HttpDispatcher } from '../http-dispatcher.js';
import { RESUME_REFUSAL_ROWS } from './automation.js';

const CTX = { request: {}, executionContext: { userId: 'user_1' } } as any;
const RESUME = '/flow_a/runs/run_1/resume';

function makeDispatcher(resumeResult: AutomationResult) {
    const resume = vi.fn(async () => resumeResult);
    const services: Record<string, unknown> = { automation: { resume } };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), resume };
}

const ROWS = [...RESUME_REFUSAL_ROWS].map(([code, row]) => [code, row.status] as const);

describe('#21724 — the resume-refusal rows', () => {
    it('the table is the six engine refusals the contract publishes', () => {
        // A floor, so an emptied or truncated table cannot pass the per-row
        // pins below vacuously.
        expect(ROWS.map(([code]) => code).sort()).toEqual([
            'INVALID_SCREEN_INPUT',
            'INVALID_SIGNAL',
            'PERMISSION_DENIED',
            'RESUME_IN_PROGRESS',
            'RUN_NOT_FOUND',
            'STORE_UNAVAILABLE',
        ]);
    });

    it.each(ROWS)('row %s names a code the vocabulary registers', (code) => {
        expect(ErrorCode.safeParse(code).success, `${code} is in neither StandardErrorCode nor ERROR_CODE_LEDGER`)
            .toBe(true);
    });

    it.each(ROWS)('row %s reaches the REST resume door as its own code', async (code) => {
        const { dispatcher } = makeDispatcher({ success: false, code, error: `${code}: refused` } as AutomationResult);

        const result = await dispatcher.handleAutomation(RESUME, 'POST', { inputs: {} }, CTX);

        const error = result.response?.body?.error;
        expect(error?.code).toBe(code);
        const parsed = ApiErrorSchema.safeParse(error);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    // The status half, kept apart from the code half so a regression in one
    // cannot hide behind the other: no status moved under #21724, and the
    // code rides out of `details` rather than being duplicated in it.
    it.each(ROWS)('row %s keeps its status %i, its message, and empty details', async (code, status) => {
        const { dispatcher, resume } = makeDispatcher({ success: false, code, error: `${code}: refused` } as AutomationResult);

        const result = await dispatcher.handleAutomation(RESUME, 'POST', { inputs: {} }, CTX);

        expect(resume).toHaveBeenCalledTimes(1);
        expect(result.response?.status).toBe(status);
        const error = result.response?.body?.error;
        expect(error?.httpStatus).toBe(status);
        expect(error?.message).toBe(`${code}: refused`);
        expect(error?.details).toBeUndefined();
    });
});
