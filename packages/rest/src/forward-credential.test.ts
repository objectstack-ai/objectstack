// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [ADR-0090 D10 rule 5, #28367] The agent forward credential's four
// properties, pinned on the one module that mints and redeems it: server-minted
// (the handle is random and names nothing), bound to one forward (method and
// route), single-use and short-lived (spent by the first presentation, revoked
// when the forward answers, expired after the bound), and unreachable out of
// process (a presentation outside the forward's own async chain redeems to
// nothing).

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    FORWARD_CREDENTIAL_HEADER,
    FORWARD_CREDENTIAL_TTL_MS,
    withForwardCredential,
    redeemForwardCredential,
    presentedForwardCredential,
    type ForwardCredentialBinding,
} from './forward-credential.js';

const agent = { userId: 'u_delegator', clientId: 'c_agent', scopes: ['actions:execute', 'data:write'], organizationId: 'org_1' };
const binding = (over: Partial<ForwardCredentialBinding> = {}): ForwardCredentialBinding => ({
    method: 'POST',
    path: '/api/v1/auth/update-user',
    run: { objectName: 'sys_user', actionName: 'update_my_profile', recordId: 'u_delegator' },
    agent,
    ...over,
});

afterEach(() => {
    vi.useRealTimers();
});

describe('[ADR-0090 D10 rule 5] the agent forward credential', () => {
    it('redeems, inside the forward, to the agent it was minted with — a copy, never the binding itself', async () => {
        const got = await withForwardCredential(binding(), async (handle) =>
            redeemForwardCredential(handle, 'post', 'http://localhost/api/v1/auth/update-user'));
        expect(got).toEqual(agent);
        expect(got).not.toBe(agent);
    });

    it('the handle is 256 random bits that name nothing: no user, client, scope or route in it', async () => {
        const handles: string[] = [];
        await withForwardCredential(binding(), async (h) => { handles.push(h); });
        await withForwardCredential(binding(), async (h) => { handles.push(h); });
        expect(handles[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(handles[0]).not.toBe(handles[1]);
        for (const fragment of ['u_delegator', 'c_agent', 'actions', 'update-user', 'org_1']) {
            expect(Buffer.from(handles[0]!, 'base64url').toString('latin1')).not.toContain(fragment);
        }
    });

    it('a second presentation is refused, whether the first was accepted or refused', async () => {
        const accepted = await withForwardCredential(binding(), async (h) => [
            redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user'),
            redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user'),
        ]);
        expect(accepted[0]).toEqual(agent);
        expect(accepted[1]).toBeUndefined();

        const refusedFirst = await withForwardCredential(binding(), async (h) => [
            redeemForwardCredential(h, 'GET', '/api/v1/auth/update-user'),
            redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user'),
        ]);
        expect(refusedFirst).toEqual([undefined, undefined]);
    });

    it('another method, or another route, is refused; the query is not part of the route', async () => {
        const run = (method: string, url: string) =>
            withForwardCredential(binding({ path: '/api/v1/data/thing/r1' }), async (h) => redeemForwardCredential(h, method, url));
        expect(await run('PATCH', '/api/v1/data/thing/r1')).toBeUndefined();
        expect(await run('POST', '/api/v1/data/thing/r2')).toBeUndefined();
        expect(await run('POST', '/api/v1/data/thing/r1/extra')).toBeUndefined();
        expect(await run('POST', '/api/v1/data/thing')).toBeUndefined();
        expect(await run('POST', 'http://localhost/api/v1/data/thing/r1?x=1')).toEqual(agent);
    });

    it('expires after the fixed bound even while its forward is still running', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const got = await withForwardCredential(binding(), async (h) => {
            vi.setSystemTime(Date.now() + FORWARD_CREDENTIAL_TTL_MS + 1);
            return redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user');
        });
        expect(got).toBeUndefined();
        expect(FORWARD_CREDENTIAL_TTL_MS).toBe(30_000);
    });

    it('is revoked when its forward answers: work the forward left running, still in its async chain, cannot present it afterwards', async () => {
        let kept = '';
        let lingering!: Promise<unknown>;
        await withForwardCredential(binding(), async (h) => {
            kept = h;
            // A task the target scheduled and did not await: it keeps the
            // forward's async context, and runs after the forward has answered.
            lingering = new Promise((resolve) => {
                setTimeout(() => resolve(redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user')), 5);
            });
        });
        expect(await lingering).toBeUndefined();
        expect(redeemForwardCredential(kept, 'POST', '/api/v1/auth/update-user')).toBeUndefined();
    });

    it('is unreachable out of process: a presentation from another async chain redeems to nothing, even with the live handle', async () => {
        // A request that arrives over the network is served in an async chain
        // that did not start inside the forward. This one is registered BEFORE
        // the forward exists, then handed the live handle while it runs.
        let deliver!: (handle: string) => void;
        const networkSide = new Promise<string>((resolve) => { deliver = resolve; })
            .then((handle) => redeemForwardCredential(handle, 'POST', '/api/v1/auth/update-user'));
        const insideAfterwards = await withForwardCredential(binding(), async (h) => {
            deliver(h);
            const fromOutside = await networkSide;
            expect(fromOutside).toBeUndefined();
            // The outside presentation found no slot, so it spent nothing: the
            // forward's own presentation still redeems.
            return redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user');
        });
        expect(insideAfterwards).toEqual(agent);
        // And no chain outside a forward carries a credential at all.
        expect(redeemForwardCredential('A'.repeat(43), 'POST', '/api/v1/auth/update-user')).toBeUndefined();
    });

    it('a guessed or malformed handle inside a live forward redeems to nothing and does not spend the real one', async () => {
        const got = await withForwardCredential(binding(), async (h) => [
            redeemForwardCredential('A'.repeat(43), 'POST', '/api/v1/auth/update-user'),
            redeemForwardCredential('', 'POST', '/api/v1/auth/update-user'),
            redeemForwardCredential(42, 'POST', '/api/v1/auth/update-user'),
            redeemForwardCredential(h, 'POST', '/api/v1/auth/update-user'),
        ]);
        expect(got.slice(0, 3)).toEqual([undefined, undefined, undefined]);
        expect(got[3]).toEqual(agent);
    });

    it('reads the presented handle off a Headers or a plain record, in either case', () => {
        expect(presentedForwardCredential(new Headers({ [FORWARD_CREDENTIAL_HEADER]: 'h1' }))).toBe('h1');
        expect(presentedForwardCredential({ 'X-ObjectStack-Forward-Credential': 'h2' })).toBe('h2');
        expect(presentedForwardCredential({ [FORWARD_CREDENTIAL_HEADER]: ['h3'] })).toBe('h3');
        expect(presentedForwardCredential({ authorization: 'Bearer x' })).toBeUndefined();
        expect(presentedForwardCredential(undefined)).toBeUndefined();
    });
});
