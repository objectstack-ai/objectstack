// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `kernel:listening` warns about a busy port only when a port was busy.
 *
 * Port `0` is a legal request: `listen(0)` binds whatever port the kernel hands
 * out, so the bound port can never equal the request and nothing was in use.
 * The hook used to compare the two numbers and warn whenever they differed, so
 * every kernel-assigned boot (`os serve --port 0`, and every CLI test that boots
 * that way) printed a busy-port warning under the banner's Boot diagnostics,
 * at the CLI's default kernel log level (`warn`) and at `info`.
 *
 * Both arms run the plugin's real `init()` / `start()`, the REAL adapter (a
 * real socket is bound) and the REAL core logger at the levels the CLI runs it
 * at. They read the records the hook emits by KIND and COUNT, never by wording:
 *
 *   - a request for `0` that binds port N: no record at the default level, and
 *     at `info` exactly one record, the one that names N;
 *   - a non-zero request whose port is HELD: one `warn` record that names both
 *     the requested port and the port actually bound.
 *
 * The neighbour holding the port in the second arm is a plain TCP listener on
 * the same wildcard address the adapter binds, so the adapter's own
 * EADDRINUSE walk is what moves the port. Nothing here simulates the shift.
 */

import { createServer, type Server } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@objectstack/core';
import { HonoServerPlugin } from './hono-plugin';

/** The CLI's default kernel log level (`os serve --log-level`'s documented default). */
const CLI_DEFAULT_LEVEL = 'warn';

const LEVEL_RANK: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

interface LogRecord {
    level: string;
    msg: string;
    [key: string]: unknown;
}

interface Booted {
    /** The records the `kernel:listening` hook wrote, as the real logger serialised them. */
    records: LogRecord[];
    /** The port the adapter really bound, read from the transport itself. */
    bound: number;
}

/**
 * Boot the plugin through `init()` / `start()` under a silent context, then
 * fire its `kernel:listening` hooks under a real core logger at `level`,
 * capturing exactly what that logger writes while the hooks run.
 */
async function listenAt(port: number, level: 'warn' | 'info'): Promise<Booted> {
    const plugin = new HonoServerPlugin({ port, cors: false });
    const services = new Map<string, unknown>();
    const listeningHooks: Array<() => unknown> = [];
    const silent = { debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
    const ctx: any = {
        logger: silent,
        getKernel: () => ({ hasPlugin: () => false, getService: () => undefined }),
        registerService: (name: string, service: unknown) => services.set(name, service),
        hook: (event: string, fn: () => unknown) => {
            if (event === 'kernel:listening') listeningHooks.push(fn);
        },
        getService: () => undefined,
    };

    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(listeningHooks, 'the plugin registered no kernel:listening hook').toHaveLength(1);

    const server = services.get('http.server') as { getPort(): number; close(): Promise<void> };
    ctx.logger = createLogger({ level, format: 'json' });

    const chunks: string[] = [];
    const capture = ((chunk: unknown) => {
        chunks.push(String(chunk));
        return true;
    }) as never;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    try {
        for (const fn of listeningHooks) await fn();
    } finally {
        stdout.mockRestore();
        stderr.mockRestore();
    }

    const bound = server.getPort();
    await server.close();

    const records = chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as LogRecord);
    return { records, bound };
}

/** Records at `warn` or above: what the default level shows. */
const warnings = (records: LogRecord[]) =>
    records.filter((record) => (LEVEL_RANK[record.level] ?? 0) >= LEVEL_RANK.warn);

/** A whole-number mention of `port` in a record's message. */
const names = (record: LogRecord, port: number) => new RegExp(`\\b${port}\\b`).test(record.msg);

function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
    return new Promise((resolveHold, rejectHold) => {
        const holder: Server = createServer();
        holder.on('error', rejectHold);
        // No host: the same wildcard address the adapter's `serve()` binds.
        holder.listen(0, () => {
            const address = holder.address();
            if (address === null || typeof address === 'string') {
                rejectHold(new Error(`listen(0) produced no numeric address: ${String(address)}`));
                return;
            }
            resolveHold({
                port: address.port,
                release: () => new Promise<void>((done) => holder.close(() => done())),
            });
        });
    });
}

describe('kernel:listening names a busy port only when one was busy', () => {
    it('a request for port 0 says nothing at the default level', async () => {
        const { records, bound } = await listenAt(0, CLI_DEFAULT_LEVEL);

        // The control: the kernel really assigned a port.
        expect(bound, 'listen(0) bound no port').toBeGreaterThan(0);
        expect(records, JSON.stringify(records, null, 2)).toEqual([]);
    });

    it('a request for port 0 prints one line at info, the one naming the bound port', async () => {
        const { records, bound } = await listenAt(0, 'info');
        const seen = JSON.stringify(records, null, 2);

        expect(bound, 'listen(0) bound no port').toBeGreaterThan(0);
        expect(warnings(records), seen).toEqual([]);
        // The existing started line already names the bound port, so no second
        // line is owed, and none may say anything about a port in use.
        expect(records, seen).toHaveLength(1);
        expect(records[0]!.level, seen).toBe('info');
        expect(records[0]!.port, seen).toBe(bound);
    });

    it('a held non-zero port still warns, naming the requested and the bound port', async () => {
        const neighbour = await holdPort();
        try {
            const { records, bound } = await listenAt(neighbour.port, CLI_DEFAULT_LEVEL);
            const seen = JSON.stringify(records, null, 2);

            // The control: the port really moved, or there is nothing to announce.
            expect(bound, `the adapter bound the held port ${neighbour.port}${seen}`).not.toBe(neighbour.port);

            const warned = warnings(records);
            expect(warned, seen).toHaveLength(1);
            expect(warned[0]!.level, seen).toBe('warn');
            expect(names(warned[0]!, neighbour.port), `the warning does not name the requested port${seen}`).toBe(true);
            expect(names(warned[0]!, bound), `the warning does not name the bound port${seen}`).toBe(true);
        } finally {
            await neighbour.release();
        }
    });
});
