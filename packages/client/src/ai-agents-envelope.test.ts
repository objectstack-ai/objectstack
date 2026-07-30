// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `client.ai.agents.list()` against both shapes of `GET /api/v1/ai/agents` (#4053).
 *
 * This route has two producers — the framework dispatcher's degraded fallback when
 * no AI service is registered, and cloud's `service-ai` — and it is mid-migration
 * onto the declared envelope. The framework side converted first; cloud's has not
 * yet, so both shapes are live in the fleet and the SDK has to read either.
 *
 * That is only true because the conversion RELOCATES the declared payload under
 * `data` (`data: { agents }`) rather than flattening it to the bare array
 * (`data: [...]`). The distinction is the whole reason this file exists:
 *
 *   • `unwrapResponse` returns `body.data` when a body has a boolean `success`
 *     AND a `data` key, so `list()` reads `.agents` off `{ agents }` either way.
 *   • Flattening would make `unwrapResponse` return the array, `.agents` read
 *     `undefined`, and `list()` answer `[]`.
 *
 * An empty list is not a visible failure here. `useAiSurfaceEnabled` gates the
 * ENTIRE AI surface on `agents.length > 0`, and an empty catalog is the CORRECT
 * answer for a seat-less user (ADR-0068) or a Community-Edition deployment with no
 * `service-ai`. So the broken state and the legitimate one look identical — no
 * error, no 403, no log — which is why the shape is pinned here rather than left
 * to be noticed.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

function clientAnswering(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        headers: new Headers(),
    });
    return {
        client: new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock }),
        fetchMock,
    };
}

const ASK = { name: 'ask', label: 'Ask', role: 'assistant' };
const BUILD = { name: 'build', label: 'Build', role: 'assistant' };

describe('client.ai.agents.list — both producers', () => {
    it('reads the UNENVELOPED body (cloud service-ai, pre-#4053)', async () => {
        const { client, fetchMock } = clientAnswering({ agents: [ASK, BUILD] });
        const agents = await client.ai.agents.list();
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:3000/api/v1/ai/agents');
        expect(agents.map((a: any) => a.name)).toEqual(['ask', 'build']);
    });

    it('reads the ENVELOPED body with `data: { agents }` (the framework fallback, #4053)', async () => {
        const { client } = clientAnswering({ success: true, data: { agents: [ASK, BUILD] } });
        const agents = await client.ai.agents.list();
        expect(agents.map((a: any) => a.name)).toEqual(['ask', 'build']);
    });

    it('answers identically either way — which is what lets the surfaces convert independently', async () => {
        const bare = await clientAnswering({ agents: [ASK] }).client.ai.agents.list();
        const enveloped = await clientAnswering({ success: true, data: { agents: [ASK] } }).client.ai.agents.list();
        expect(enveloped).toEqual(bare);
    });

    it('an empty catalog stays empty in both shapes — a seat-less caller answers this legitimately', async () => {
        expect(await clientAnswering({ agents: [] }).client.ai.agents.list()).toEqual([]);
        expect(await clientAnswering({ success: true, data: { agents: [] } }).client.ai.agents.list()).toEqual([]);
    });

    it('the FLATTENED variant is why `data` keeps the `{ agents }` wrapper', async () => {
        // Pinning the road not taken. #3983 set the precedent that `data` carries
        // the payload directly, and following it here would look consistent — but
        // `AiAgentsResponseSchema` is a DECLARED payload schema (share-links'
        // `{ links }` was an ad-hoc wrapper with none), so the #3843 relocation
        // reading applies instead. This asserts the cost of getting it wrong:
        // a silently empty agent list, not a parse error.
        const { client } = clientAnswering({ success: true, data: [ASK, BUILD] });
        expect(await client.ai.agents.list()).toEqual([]);
    });
});
