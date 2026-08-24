// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * REST `/actions/:object/:action` — the DOUBLED post-success-navigation
 * diagnostic (#11519, maintainer ruling 2026-08-24).
 *
 * Two channels can name a post-success destination for one `type: 'script'`
 * action: the declared `ActionSchema.onSuccess` block, and the
 * handler-returned `{ redirectUrl }`. The statically-knowable half
 * (`onSuccess` + `opensInNewTab: true`) is refused at parse time by
 * `@objectstack/spec`; this file pins the RUNTIME half — the case no schema
 * can see, because "the handler returns `redirectUrl`" is runtime-only
 * knowledge (`target` names an opaque registry entry, `HookBodySchema`
 * declares no return contract). The seam where the two channels finally meet
 * is the script dispatch: the resolved declaration (carrying `onSuccess`) and
 * the handler's return value are both in hand, so the doubled case is
 * diagnosed LOUDLY there instead of being resolved silently by renderer-side
 * precedence.
 *
 * The diagnostic never alters the wire: the handler's return value still
 * reaches the client intact, and the interim renderer precedence (declared
 * `onSuccess` wins, objectui#5933) still decides the navigation until the
 * author takes the remedy the warning names.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import { doubledPostSuccessNavigationWarning } from './action-execution.js';

const scriptAction = {
    name: 'open_portal',
    label: 'Open portal',
    objectName: 'crm_lead',
    type: 'script',
    target: 'openPortal',
    onSuccess: { navigate: '/apps/crm/leads/${result.id}', openIn: 'self' },
};

function makeDispatcher(opts: { objectDef?: any; handlerResult?: unknown } = {}) {
    const executeAction = vi.fn(async () => opts.handlerResult ?? { ran: 'script' });
    const objectDef = opts.objectDef ?? { name: 'crm_lead', actions: [scriptAction] };
    const ql: any = {
        executeAction,
        getSchema: (name: string) => (name === objectDef.name ? objectDef : undefined),
        registry: {
            getObject: (name: string) => (name === objectDef.name ? objectDef : undefined),
            getItem: () => undefined,
        },
        find: vi.fn(async () => []),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const kernel: any = {
        context: {
            getService: (n: string) =>
                n === 'objectql' || n === 'data' ? ql
                : n === 'metadata' ? metadata
                : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), executeAction };
}

const ctxFor = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u1', systemPermissions: [] },
});

describe('REST /actions — doubled post-success navigation diagnostic (#11519)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('warns LOUDLY when the handler returns redirectUrl while the action declares onSuccess', async () => {
        const { dispatcher } = makeDispatcher({
            handlerResult: { redirectUrl: 'https://idp.example.com/handoff' },
        });

        const res = await dispatcher.handleActions('/crm_lead/open_portal', 'POST', {}, ctxFor());

        expect(res.response.status).toBe(200);
        const doubled = warnSpy.mock.calls
            .map((c) => c.join(' '))
            .filter((line) => line.includes('[action-contract]'));
        expect(doubled).toHaveLength(1);
        // The warning names the action, BOTH channels, the interim winner and
        // the remedy — that is what "loud" means here.
        expect(doubled[0]).toContain("'crm_lead/open_portal'");
        expect(doubled[0]).toContain('onSuccess');
        expect(doubled[0]).toContain('redirectUrl');
        expect(doubled[0]).toContain('objectui#5933');
        expect(doubled[0]).toContain('#11519');
    });

    it('does NOT alter the wire — the handler return value still reaches the client intact', async () => {
        const { dispatcher } = makeDispatcher({
            handlerResult: { redirectUrl: 'https://idp.example.com/handoff', ticket: 't_1' },
        });

        const res = await dispatcher.handleActions('/crm_lead/open_portal', 'POST', {}, ctxFor());

        // Single wrap (#3962): `data` IS the handler's return value. The
        // diagnostic observes; the interim renderer precedence (declared wins,
        // objectui#5933) stays the decider until the remedy is taken.
        expect(res.response.body.data).toEqual({
            redirectUrl: 'https://idp.example.com/handoff',
            ticket: 't_1',
        });
    });

    it('stays SILENT when only onSuccess is declared (handler returns no redirectUrl)', async () => {
        const { dispatcher } = makeDispatcher({ handlerResult: { ok: true } });

        await dispatcher.handleActions('/crm_lead/open_portal', 'POST', {}, ctxFor());

        expect(warnSpy.mock.calls.map((c) => c.join(' '))
            .filter((line) => line.includes('[action-contract]'))).toHaveLength(0);
    });

    it('stays SILENT when only the handler-redirect channel is used (no onSuccess declared)', async () => {
        const single = { ...scriptAction, onSuccess: undefined };
        const { dispatcher } = makeDispatcher({
            objectDef: { name: 'crm_lead', actions: [single] },
            handlerResult: { redirectUrl: 'https://idp.example.com/handoff' },
        });

        await dispatcher.handleActions('/crm_lead/open_portal', 'POST', {}, ctxFor());

        expect(warnSpy.mock.calls.map((c) => c.join(' '))
            .filter((line) => line.includes('[action-contract]'))).toHaveLength(0);
    });
});

describe('doubledPostSuccessNavigationWarning — predicate pins (#11519)', () => {
    const deps: any = {};
    const decl = { name: 'open_portal', onSuccess: { navigate: '/x', openIn: 'self' } };

    it('fires exactly on the doubled pair', () => {
        const msg = doubledPostSuccessNavigationWarning(deps, decl, { redirectUrl: '/y' }, 'crm_lead');
        expect(msg).toBeTruthy();
        expect(msg).toContain('[action-contract]');
    });

    it.each([
        ['no declaration', undefined, { redirectUrl: '/y' }],
        ['declaration without onSuccess', { name: 'a' }, { redirectUrl: '/y' }],
        ['onSuccess without navigate', { onSuccess: {} }, { redirectUrl: '/y' }],
        ['non-object result', decl, 'https://x'],
        ['array result', decl, [{ redirectUrl: '/y' }]],
        ['result without redirectUrl', decl, { ok: true }],
        ['empty redirectUrl', decl, { redirectUrl: '' }],
        ['non-string redirectUrl', decl, { redirectUrl: 42 }],
        ['null result', decl, null],
    ])('stays null on %s', (_label, actionDef, result) => {
        expect(doubledPostSuccessNavigationWarning(deps, actionDef, result, 'crm_lead')).toBeNull();
    });
});
