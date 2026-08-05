// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declarative-endpoint seam's ABSENCE is announced at `warn` (#5400).
 *
 * ## Why a whole file exists to hold one log level
 *
 * `packages/runtime/src/dispatcher-plugin.ts` mounts declarative `apis:`
 * endpoints through exactly one seam — `IHttpServer.setFallbackHandler`, which
 * is OPTIONAL on the contract and feature-detected with `typeof === 'function'`.
 * On an adapter that omits it there is no second path: every endpoint a stack
 * declared in metadata is unreachable, forever, and the transport answers the
 * bare 404 it would answer for a typo.
 *
 * That line used to be `debug`, and correctly so — while a non-empty `apis:`
 * was rejected WHOLESALE at publish (#4936), no deployment could be missing
 * anything, because no deployment could declare anything. The #5040 E7 publish
 * flip (`packages/spec/src/api/endpoint-publish-gate.ts`, "This module is that
 * flip") ended that premise: declarations publish now and stacks ship them.
 * A `debug` under the default `level: 'info'` is not printed at all
 * (`isEnabled`, `packages/core/src/logger.ts`), so the operator's signal for a
 * silently-dead surface was nothing whatsoever — the exact outcome AGENTS.md's
 * "Absence must be loud" (Route & surface ownership §3) forbids.
 *
 * ## The level is the assertion, so it is welded here
 *
 * A log level is one identifier away from silence and nothing else in the
 * build notices it change. Following #5226's posture — "the level is held by a
 * gate, not by the comment next to it" — these tests fail if the line slides
 * back to `debug` (invisible again) AND if it is escalated to `error` (wrong
 * class). `warn` is what AGENTS.md's "Degradation log levels" question yields:
 * nothing here claims to have PERSISTED anything, so this is a functional
 * degradation — a capability that is not mounted, whose next caller finds out —
 * not a durability one.
 *
 * Reverse verification, direction predicted BEFORE running: restoring
 * `ctx.logger.debug` in the seam-absent branch must turn the level pins RED
 * (this is the ordinary direction — the pins read a predicate on the emitted
 * level, not a count that can pass by producing nothing). Confirmed: with
 * `debug` restored, `emitted at warn` and `never at debug` both fail on the
 * captured line, and the consequence/remedy pins fail with "no warn line".
 *
 * Harness note: the fake server is the `dispatcher-plugin.routes.test.ts`
 * shape. It is the honest one for this branch — the absent member is spelled
 * by simply not being there, which is what the contract tells consumers to
 * probe for, and a real adapter cannot express "I omit this" any better.
 */

import { describe, it, expect } from 'vitest';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

interface LogLine { level: string; message: string; meta?: Record<string, any> }

/**
 * A server WITHOUT `setFallbackHandler` — the member simply absent, the shape
 * the contract documents (`packages/spec/src/contracts/http-server.ts`: "an
 * adapter that cannot express a not-found hook simply omits it").
 */
function makeFallbacklessServer() {
    const noop = () => { /* route registration is not what this file tests */ };
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop,
    } as any;
}

/** The same server, plus the seam — the control case. */
function makeSeamedServer() {
    const server = makeFallbacklessServer();
    server.setFallbackHandler = () => { /* installed, never invoked here */ };
    return server;
}

function makeCtx(fakeServer: any) {
    const logs: LogLine[] = [];
    const kernel = {
        getService: () => undefined,
        getServiceAsync: async () => undefined,
    };
    const ctx = {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: {
            info(message: string, meta?: any) { logs.push({ level: 'info', message, meta }); },
            warn(message: string, meta?: any) { logs.push({ level: 'warn', message, meta }); },
            error(message: string, meta?: any) { logs.push({ level: 'error', message, meta }); },
            debug(message: string, meta?: any) { logs.push({ level: 'debug', message, meta }); },
        },
        hook: () => {},
        on: () => {},
    } as any;
    return { ctx, logs };
}

/** Every line that talks about the missing seam, at whatever level it came out. */
const seamLines = (logs: LogLine[]) => logs.filter((l) => l.message.includes('setFallbackHandler'));

async function bootWith(server: any) {
    const { ctx, logs } = makeCtx(server);
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(ctx);
    return logs;
}

describe('dispatcher declarative-endpoint seam — absence is loud (#5400)', () => {
    it('announces the missing seam at `warn` — never `debug`, never `error`', async () => {
        const logs = await bootWith(makeFallbacklessServer());

        const lines = seamLines(logs);
        // Said ONCE, at boot, not once per anything.
        expect(lines).toHaveLength(1);
        // The level IS the fix. `debug` is the pre-#5400 state and is invisible
        // under the default `info`; `error` is the over-escalation AGENTS.md's
        // durability question rules out (nothing here claims persistence).
        expect(lines[0].level).toBe('warn');
        expect(logs.filter((l) => l.level === 'debug' && l.message.includes('setFallbackHandler'))).toEqual([]);
        expect(logs.filter((l) => l.level === 'error')).toEqual([]);
    }, 60_000);

    it('names the CONSEQUENCE: declared endpoints are unreachable and answer a bare 404', async () => {
        const logs = await bootWith(makeFallbacklessServer());

        const line = seamLines(logs).find((l) => l.level === 'warn');
        expect(line).toBeDefined();
        const msg = line!.message;
        // What is lost: not "some routes", but every endpoint declared in
        // metadata, on this transport.
        expect(msg).toMatch(/metadata-declared/);
        expect(msg).toMatch(/`apis:`/);
        expect(msg).toMatch(/UNREACHABLE/);
        // And what the caller sees instead — the bare 404 that reads like a
        // typo and sends operators hunting in the wrong place.
        expect(msg).toMatch(/bare 404/);
    }, 60_000);

    it('names the REMEDY: compose an adapter that implements the seam', async () => {
        const logs = await bootWith(makeFallbacklessServer());

        const msg = seamLines(logs).find((l) => l.level === 'warn')!.message;
        // The member to implement...
        expect(msg).toMatch(/setFallbackHandler/);
        // ...and a concrete adapter that already does, so the remedy is
        // actionable without reading the contract first.
        expect(msg).toMatch(/@objectstack\/plugin-hono-server/);
    }, 60_000);

    it('carries the affected mount prefix as structured meta', async () => {
        const logs = await bootWith(makeFallbacklessServer());

        const line = seamLines(logs).find((l) => l.level === 'warn')!;
        expect(line.meta).toMatchObject({
            mount: '/api/v1/apps/',
            declarativeEndpoints: 'unreachable',
        });
    }, 60_000);

    it('stays SILENT when the adapter does expose the seam', async () => {
        const logs = await bootWith(makeSeamedServer());

        // The counter-case that keeps the warn a signal instead of boot noise:
        // on a conforming adapter nothing is missing, so nothing is announced.
        expect(seamLines(logs)).toEqual([]);
        // And the positive line is the one that gets printed instead.
        expect(logs.some((l) => l.level === 'info' && l.message.includes('Declarative endpoint dispatch step armed')))
            .toBe(true);
    }, 60_000);
});
