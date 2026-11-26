/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The `/actions` envelope rule, once (objectstack#3913). Four hand-rolled
 * copies of this produced three distinct bugs; these cases pin all three.
 */

import { describe, it, expect } from 'vitest';
import { interpretActionResponse, readActionPayload } from '../actionResponse';

const ok = { ok: true, status: 200 };

describe('interpretActionResponse — failure shapes', () => {
    it('catches a LEGACY business rejection hiding under HTTP 200 (the reported bug)', () => {
        // Pre-objectstack#3962 servers only: `res.ok` is TRUE and the OUTER
        // `success` is TRUE. Current servers answer 400, which `res.ok`
        // catches — this branch keeps the console honest against older
        // runtimes.
        const out = interpretActionResponse(ok, {
            success: true,
            data: { success: false, error: "Action 'log_call' on object '*' not found" },
        }, 'Action "log_call"');

        expect(out.ok).toBe(false);
        expect(out.error).toBe("Action 'log_call' on object '*' not found");
    });

    it('catches a 400 rejection (#3962) and resolves the nested {message} to a STRING', () => {
        const rejection = interpretActionResponse({ ok: false, status: 400 }, {
            success: false,
            error: {
                message: 'ValidationError: issued_on is required',
                code: 400,
                details: { code: 'VALIDATION_FAILED', fields: [{ field: 'issued_on' }] },
            },
        }, 'Action "submit_signoff"');
        expect(rejection.ok).toBe(false);
        expect(rejection.error).toBe('ValidationError: issued_on is required');
    });

    it('catches a dispatch failure and resolves the nested {message} to a STRING', () => {
        // Handing the `{message, code}` OBJECT to toast.error() as a React
        // child crashes the page (React #31).
        const out = interpretActionResponse({ ok: false, status: 404 }, {
            success: false,
            error: { message: "Action 'log_call' on object 'global' not found", code: 404 },
        }, 'Action "log_call"');

        expect(out.ok).toBe(false);
        expect(typeof out.error).toBe('string');
        expect(out.error).toBe("Action 'log_call' on object 'global' not found");
    });

    it('catches a transport-level success:false', () => {
        const out = interpretActionResponse(ok, { success: false, error: 'nope' }, 'Action "x"');
        expect(out).toMatchObject({ ok: false, error: 'nope' });
    });

    it('falls back to a labelled message when the body carries none', () => {
        const out = interpretActionResponse({ ok: false, status: 500 }, null, 'Action "x"');
        expect(out.ok).toBe(false);
        expect(out.error).toBe('Action "x" failed (HTTP 500)');
    });
});

describe('interpretActionResponse — success', () => {
    it('reports ok and exposes both envelope levels', () => {
        const out = interpretActionResponse(ok, {
            success: true,
            data: { success: true, data: { id: 'call_1' } },
        }, 'Action "log_call"');

        expect(out.ok).toBe(true);
        // `envelope` is the ACTION envelope — the level ActionResult.data has
        // always carried.
        expect(out.envelope).toEqual({ success: true, data: { id: 'call_1' } });
        // `payload` is what the handler actually returned.
        expect(out.payload).toEqual({ id: 'call_1' });
    });
});

describe('readActionPayload — legacy double wrap vs #3962 single wrap', () => {
    it('unwraps the LEGACY double envelope to reach the handler value', () => {
        // Pre-#3962 servers double-wrapped; an action returning
        // `{ redirectUrl }` lived one level below where every reader looked.
        const envelope = { success: true, data: { redirectUrl: 'https://example.test/sso' } };

        expect((envelope as any).redirectUrl).toBeUndefined();       // the old read
        expect(readActionPayload(envelope)).toEqual({ redirectUrl: 'https://example.test/sso' });
    });

    it('passes a #3962 single-wrapped handler value through — even one with success-ish keys', () => {
        // Current servers put the handler value directly in `body.data`. Only
        // the EXACT legacy shape is unwrapped; a handler value that merely
        // contains a boolean `success` plus its own keys is handler-owned.
        const payload = { success: true, rows: 3, data: { id: 'x' }, extra: 'mine' };
        expect(readActionPayload(payload)).toEqual(payload);
    });

    it('passes a non-enveloped body through rather than inventing undefined', () => {
        expect(readActionPayload({ id: 'x' })).toEqual({ id: 'x' });
        expect(readActionPayload(null)).toBeNull();
    });

    it('does not mistake an array for an envelope', () => {
        expect(readActionPayload([1, 2])).toEqual([1, 2]);
    });
});

/**
 * A refusal that names several reasons (objectstack#36877) answers each
 * reason's sentence on `error.details.refusals`; the outcome carries the list
 * so the console can show every reason (objectstack#37403). The list is read
 * whole or not at all, as the server's own reader reads it.
 */
describe('interpretActionResponse — a refusal with several reasons (objectstack#37403)', () => {
    const refusals = [
        { reason: 'on_report', message: 'Expense Taxi 12 is already on an expense report.' },
        { reason: 'approved', message: 'Expense Hotel 7 is already approved.' },
    ];
    const text = `${refusals[0].message}\n${refusals[1].message}\nNothing was submitted.`;
    const refused = (details: unknown) => interpretActionResponse({ ok: false, status: 409 }, {
        success: false,
        error: { code: 'NOT_SUBMITTED', message: text, userMessage: text, details },
    }, 'Action "submit_expenses"');

    it('carries error.details.refusals in order, each copied to reason and message', () => {
        const out = refused({ refusals: refusals.map((r) => ({ ...r, extra: 1 })) });
        expect(out).toMatchObject({ ok: false, error: text, userMessage: text });
        expect(out.refusals).toEqual(refusals);
    });

    it('CONTROL: no list, an empty list or a list with a malformed element carries none', () => {
        for (const details of [undefined, {}, { refusals: [] }, { refusals: [refusals[0], { reason: 'approved' }] }, { refusals: 'x' }]) {
            expect('refusals' in refused(details)).toBe(false);
        }
    });
});
