// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34730 step 2] The `slack` channel's send and its error classification,
 * over a link store whose Slack answers are scripted: a revoked token is
 * permanent and marks the install revoked, a user Slack cannot DM and a
 * missing link are an invalid recipient (suppressed, never dead-lettered), a
 * rate limit is retried. Plus the DM text and its absolute deep link.
 */

import { describe, it, expect } from 'vitest';
import type { Delivery } from './channel.js';
import { absoluteLink, createSlackChannel, deploymentOrigin, slackDmText } from './slack-channel.js';
import type { SlackAnswer, SlackLinkStore } from './slack-links.js';

const ACCOUNT = { id: 'acc_1', organizationId: 'org_a', displayName: 'Acme', externalId: 'T1', status: 'active' as const };
const LINK = { id: 'l_1', accountId: 'acc_1', userId: 'u_ada', externalUserId: 'UADA', state: 'confirmed' as const };
const ok = (body: Record<string, unknown>): SlackAnswer => ({ ok: true, status: 200, body: { ok: true, ...body } });
const refused = (error: string, status = 200): SlackAnswer => ({ ok: false, status, body: { ok: false, error }, error });

function channelOver(answers: Record<string, SlackAnswer>, opts: { linked?: boolean } = {}) {
    const sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const revoked: string[] = [];
    const store = {
        async account() { return ACCOUNT; },
        async confirmedUsers(_org: string, ids: readonly string[]) { return new Set(ids.filter((id) => id === 'u_ada')); },
        async deliveryTarget(_org: string, user: string) { return opts.linked !== false && user === 'u_ada' ? { account: ACCOUNT, link: LINK } : undefined; },
        async slackFor() {
            return async (method: string, params?: Record<string, unknown>) => { sent.push({ method, params }); return answers[method] ?? ok({}); };
        },
        async markRevoked(a: { id: string }) { revoked.push(a.id); },
    } as unknown as SlackLinkStore;
    const channel = createSlackChannel({ store, getPublicOrigin: () => 'https://os.example.com' });
    const delivery = (recipient = 'u_ada'): Delivery => ({
        channel: 'slack',
        recipient,
        notification: { organizationId: 'org_a', title: 'Approve <PO-7>', body: 'Ada & Bob asked.', recipients: [recipient], actionUrl: '/system/approvals?request=r1' },
    });
    return { channel, sent, revoked, delivery };
}

describe('the slack channel — send', () => {
    it('opens a DM with the linked user and posts the title linked to the absolute deep link, then the body', async () => {
        const t = channelOver({ 'conversations.open': ok({ channel: { id: 'D1' } }), 'chat.postMessage': ok({ ts: '1700.1' }) });
        expect(await t.channel.send({} as never, t.delivery())).toEqual({ ok: true, externalId: '1700.1' });
        expect(t.sent).toEqual([
            { method: 'conversations.open', params: { users: 'UADA' } },
            {
                method: 'chat.postMessage',
                params: {
                    channel: 'D1',
                    text: '*<https://os.example.com/system/approvals?request=r1|Approve &lt;PO-7&gt;>*\nAda &amp; Bob asked.',
                    unfurl_links: false,
                    unfurl_media: false,
                },
            },
        ]);
    });

    it.each([
        ['a revoked token', { 'conversations.open': refused('token_revoked') }, 'permanent', ['acc_1']],
        ['an invalid token on post', { 'conversations.open': ok({ channel: { id: 'D1' } }), 'chat.postMessage': refused('invalid_auth') }, 'permanent', ['acc_1']],
        ['a user Slack cannot find', { 'conversations.open': refused('user_not_found') }, 'invalid_recipient', []],
        ['a rate limit', { 'conversations.open': refused('ratelimited', 429) }, 'rate_limited', []],
        ['any other Slack refusal', { 'conversations.open': ok({ channel: { id: 'D1' } }), 'chat.postMessage': refused('msg_too_long') }, 'retryable', []],
    ] as const)('%s is classified %s', async (_name, answers, expected, revoked) => {
        const t = channelOver(answers as Record<string, SlackAnswer>);
        const result = await t.channel.send({} as never, t.delivery());
        expect(result.ok).toBe(false);
        expect(t.channel.classifyError!(result.error)).toBe(expected);
        expect(t.revoked).toEqual(revoked);
    });

    it('a recipient with no confirmed link by send time is an invalid recipient, and Slack is not called', async () => {
        const t = channelOver({}, { linked: false });
        const result = await t.channel.send({} as never, t.delivery());
        expect(t.channel.classifyError!(result.error)).toBe('invalid_recipient');
        expect(t.sent).toEqual([]);
    });

    it('answers who it can reach, per organization', async () => {
        const t = channelOver({});
        expect(await t.channel.reachableRecipients!({} as never, { organizationId: 'org_a', recipients: ['u_ada', 'u_bob'] })).toEqual(new Set(['u_ada']));
        expect(await t.channel.reachableRecipients!({} as never, { recipients: ['u_ada'] })).toEqual(new Set());
        expect(await t.channel.isAvailable!({} as never, { organizationId: 'org_a' })).toEqual({ available: true });
        expect(await t.channel.isAvailable!({} as never, {})).toEqual({ available: false, reason: 'transport_not_configured' });
    });
});

describe('the slack channel — the deep link', () => {
    it('makes a path absolute under the origin, keeps an absolute http(s) link, and drops what a DM reader cannot open', () => {
        expect(absoluteLink('/a?b=1|2', 'https://os.example.com')).toBe('https://os.example.com/a?b=1%7C2');
        expect(absoluteLink('https://elsewhere.example/x', undefined)).toBe('https://elsewhere.example/x');
        expect(absoluteLink('/a', undefined)).toBeUndefined();
        expect(absoluteLink('//evil.example/a', 'https://os.example.com')).toBeUndefined();
        expect(absoluteLink('javascript:alert(1)', 'https://os.example.com')).toBeUndefined();
        expect(slackDmText({ title: 'T', body: '', actionUrl: '/a' }, undefined)).toBe('*T*');
    });

    it('reads the deployment origin in the order the approval e-mail\'s link does', () => {
        expect(deploymentOrigin({ OS_AUTH_URL: 'https://auth.example.com/', OS_BASE_URL: 'https://base.example.com' })).toBe('https://auth.example.com');
        expect(deploymentOrigin({ BETTER_AUTH_URL: 'https://legacy.example.com' })).toBe('https://legacy.example.com');
        expect(deploymentOrigin({ OS_BASE_URL: 'https://base.example.com/app/' })).toBe('https://base.example.com/app');
        expect(deploymentOrigin({ OS_BASE_URL: 'ftp://base.example.com' })).toBeUndefined();
        expect(deploymentOrigin({})).toBeUndefined();
    });
});
