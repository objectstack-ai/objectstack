// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9936 / #9961 — the write-less-transport fallback for streamed dispatcher
 * results implements the IHttpResponse contract's own prescription (#3607,
 * ADR-0076 OQ#10; the JSDoc on `write` in
 * packages/spec/src/contracts/http-server.ts): buffer the SSE frames and
 * deliver them through `send()` under the streaming headers.
 *
 * ## Why these pins are the entire evidentiary basis
 *
 * Both shipped `http.server` providers (plugin-hono-server, the QA node
 * conformance server) construct `res.write`/`res.end` unconditionally, so
 * NEITHER fallback branch is reachable in any in-repo composition — they are
 * live only for an external `Runtime({ server })` transport that omits the
 * contract's optional streaming surface. No composed run and no gate number
 * will ever exercise them; these pins are the only evidence they behave.
 *
 * ## The property pinned — byte identity, not absence-of-json
 *
 * The property that makes the buffered fallback CORRECT is that its body is
 * byte-identical to the concatenation a streaming transport would have
 * written: every reader in the measured population (the client SDK's
 * `parseEventStream`, objectui's @ai-sdk/react DefaultChatTransport) parses
 * raw response bytes for `data:` lines, so identical bytes parse identically,
 * streamed or buffered. Each pin below therefore drives the SAME route twice
 * — once against a streaming `res`, once against a write-less one — and
 * asserts `sent === writes.join('')`. A pin that only asserted `res.json` is
 * absent would stay green if the replacement emitted the wrong bytes.
 *
 * ## The two sites, and what each pin would catch
 *
 * 1. `mountRouteOnServer`'s streaming branch (#9936): used to answer
 *    `res.json({ events })` — an off-envelope JSON dialect of the frames that
 *    decodes to ZERO frames in every SSE reader (a JSON body contains no raw
 *    newline byte). The pin trips on any return to a JSON body (the `json`
 *    spy) and on any byte divergence from the streamed branch.
 * 2. `sendResultBase`'s dispatch-result writer (#9961): used to fall through
 *    to `res.json(result.result)`, serializing the stream DESCRIPTOR with its
 *    `events` AsyncIterable collapsed to `{}` — HTTP 200, payload gone,
 *    iterable never drained. That body is a RELAYED `res.json(...)`,
 *    invisible to check-route-envelope's counters by design, so no gate
 *    number moves for this half: this pin is the only tripwire. It catches a
 *    regression to descriptor-serialization (json fires, send never does, the
 *    drained flag stays false) and any byte divergence from the streamed
 *    branch, error-frame and `null`-skip encoding included.
 */

import { describe, it, expect, vi } from 'vitest';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// ---------------------------------------------------------------------------
// Harness (shape shared with dispatcher-plugin.route-auth-deny-body.test.ts)
// ---------------------------------------------------------------------------

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            delete: rec('DELETE'),
            patch: rec('PATCH'),
        },
    };
}

function makeCtx(fakeServer: any, aiRoutes: Array<Record<string, unknown>>) {
    // The dispatch path only reads the AI route table once an `ai` service
    // resolves (a service-less kernel answers the 501 capability envelope
    // before any route is consulted), so the kernel registers a bare one —
    // the same shape domain-handler-registry.test.ts drives dispatch with.
    const services: Record<string, any> = { ai: { name: 'ai' } };
    const kernel: any = {
        getState: () => 'running',
        getService: (name: string) => services[name] ?? null,
        getServiceAsync: async (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
        // The AIServicePlugin's cross-plugin cache the dispatcher recovers
        // routes from when the `ai:routes` hook fired before it was listening.
        __aiRoutes: aiRoutes,
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer.server : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

/**
 * A recording response. `withWriteEnd: true` models a streaming transport;
 * `false` models the write-less transport both fallbacks exist for — `write`
 * and `end` are then ABSENT (not stubbed), exactly how the sites
 * feature-detect them. `settled` resolves on the first terminal write
 * (`json`, `send`, or `end`) so a regression fails fast instead of timing
 * out, and `terminal` names which one fired.
 */
function recordingRes(withWriteEnd: boolean) {
    const rec: {
        status?: number;
        headers: Record<string, string>;
        writes: string[];
        sent?: string;
        jsonBody?: unknown;
        terminal?: 'json' | 'send' | 'end';
    } = { headers: {}, writes: [] };
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
    const terminal = (kind: 'json' | 'send' | 'end') => {
        if (!rec.terminal) rec.terminal = kind;
        resolveSettled();
    };
    const res: any = {
        status(code: number) { rec.status = code; return res; },
        header(k: string, v: string) { rec.headers[k] = v; return res; },
        json(body: unknown) { rec.jsonBody = body; terminal('json'); return res; },
        send(data: string) { rec.sent = data; terminal('send'); return res; },
    };
    if (withWriteEnd) {
        res.write = (chunk: string) => { rec.writes.push(String(chunk)); };
        res.end = () => { terminal('end'); };
    }
    return { rec, res, settled };
}

/**
 * The reader population's parse, in miniature: the client SDK's
 * `parseEventStream` and @ai-sdk/react's transport both split raw bytes on
 * newlines and decode `data:`-prefixed lines. Identical bytes ⇒ identical
 * frames; this turns the byte-identity assertion into decoded frames too, so
 * a wrong-bytes regression is reported in reader terms.
 */
function decodeSseFrames(body: string): unknown[] {
    const frames: unknown[] = [];
    for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        frames.push(JSON.parse(payload));
    }
    return frames;
}

/** One string frame and one object frame — both arms of the encoding ternary. */
const STRING_FRAME = 'data: {"type":"text-delta","delta":"hi"}\n\n';
const OBJECT_FRAME = { type: 'finish' };
const EXPECTED_FRAMES = [{ type: 'text-delta', delta: 'hi' }, { type: 'finish' }];

// ---------------------------------------------------------------------------
// Site 1 — mountRouteOnServer's streaming branch (#9936)
// ---------------------------------------------------------------------------

describe('mountRouteOnServer write-less fallback (#9936)', () => {
    const ROUTE = '/ai/stream-pin';
    const MOUNTED = `PATCH /api/v1${ROUTE}`;

    async function drive(withWriteEnd: boolean) {
        const fakeServer = makeFakeServer();
        const drained = { value: false };
        const handler = vi.fn(async () => ({
            status: 200,
            stream: true,
            events: (async function* () {
                yield STRING_FRAME;
                yield OBJECT_FRAME;
                drained.value = true;
            })(),
        }));
        // PATCH: a legal RouteDefinition.method that only the concrete
        // hook-route mounts serve (the /ai/* wildcards cover get/post/delete/
        // put), so this pins the same arm that is live unshadowed on the wire.
        const ctx = makeCtx(fakeServer, [{ method: 'PATCH', path: ROUTE, auth: false, handler }]);
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.(ctx);

        const mounted = fakeServer.handlers[MOUNTED];
        expect(mounted).toBeTypeOf('function');
        const { rec, res, settled } = recordingRes(withWriteEnd);
        await mounted({ headers: {}, body: {}, params: {}, query: {} }, res);
        await settled;
        return { rec, drained };
    }

    it('buffers the SAME bytes a streaming transport receives, through send() under text/event-stream', async () => {
        const streamed = await drive(true);
        const buffered = await drive(false);

        // The streamed leg is the reference measurement.
        expect(streamed.rec.terminal).toBe('end');
        expect(streamed.rec.writes.join('')).toContain('data:');

        // ⭐ The property that makes option B correct: byte identity.
        expect(buffered.rec.terminal).toBe('send');
        expect(buffered.rec.sent).toBe(streamed.rec.writes.join(''));

        // And in the reader population's terms: identical decoded frames.
        expect(decodeSseFrames(buffered.rec.sent!)).toEqual(EXPECTED_FRAMES);
        expect(decodeSseFrames(streamed.rec.writes.join(''))).toEqual(EXPECTED_FRAMES);

        // The old body — res.json({ events }) — must not come back.
        expect(buffered.rec.jsonBody).toBeUndefined();

        // Same streaming headers on both legs; the iterable was drained.
        for (const leg of [streamed, buffered]) {
            expect(leg.rec.status).toBe(200);
            expect(leg.rec.headers['Content-Type']).toBe('text/event-stream');
            expect(leg.drained.value).toBe(true);
        }
    });
});

