// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The request-body limit both Hono doors hold: one platform-wide bound, read
 * nowhere past it, answered `413 PAYLOAD_TOO_LARGE`.
 *
 * `@objectstack/plugin-hono-server` installs it on its app at construction,
 * and `@objectstack/hono`'s `createHonoApp` installs the same function on its
 * own app, so the two doors bound a body by one rule
 * (`hono-body-refusal.test.ts` drives both over one table).
 *
 * ## The rule
 *
 * - **The limit** is {@link DEFAULT_MAX_REQUEST_BODY_BYTES} (10 MiB) unless the
 *   operator sets another: the transport option (`HonoPluginOptions`
 *   `maxRequestBodyBytes`, `HonoHttpServer.setMaxRequestBodyBytes`,
 *   `createHonoApp`'s `maxRequestBodyBytes`), else
 *   {@link MAX_REQUEST_BODY_BYTES_ENV}. A value that is not a positive whole
 *   number of bytes is refused where it is configured, so a typo fails the
 *   boot instead of serving with no bound or the wrong one.
 * - **A declared length over the limit is never read.** The guard replaces the
 *   request's body with one that refuses on its first read without touching
 *   the client's bytes.
 * - **A body with no declared length is counted while it is read**, and the
 *   read stops once it passes the limit. Exactly the limit is read as before.
 * - **Once a read is refused, the request answers 413**, whatever the code
 *   that read it answered: the body it acted on was never there.
 *
 * ## Why the guard wraps the body instead of answering before the route
 *
 * The transport cannot tell, before the route runs, whether the route is an
 * upload door. A byte door (`service-storage`'s chunk, upload-link and local
 * raw PUTs) takes a file of any media type and bounds it by its own
 * `max_upload_mb`, which may be far above this limit. So the guard bounds what
 * is READ: every reader of the request's body (the doors' own pre-reads, a
 * raw-app route reading `c.req`, a request forwarded whole to the auth
 * service or a domain) reads through it, and a route that never reads the
 * body reads nothing. The byte doors read through `IHttpRequest.rawBody()`,
 * which `plugin-hono-server` serves from the ORIGINAL body (see
 * {@link RequestBodyGuard.readOriginal}), so they keep their own bound.
 *
 * ## A byte door's own bound
 *
 * A door states its bound as `rawBody({ maxBytes })`, and it is held exactly
 * as this limit is: a declared length over it is refused unread, a body with
 * no declared length is counted while it is read and refused once it passes
 * the bound, with its source cancelled so the rest is never read, and exactly
 * the bound is read whole. The refusal is {@link RawBodyTooLarge}.
 *
 * Nothing here echoes the body.
 */

import type { Context, Hono } from 'hono';

/** The default request-body limit: 10 MiB. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/** The environment variable an operator sets the limit with, in bytes. */
export const MAX_REQUEST_BODY_BYTES_ENV = 'OS_HTTP_MAX_BODY_BYTES';

/** The registered ADR-0112 code a body over the limit is answered with. */
export const PAYLOAD_TOO_LARGE_CODE = 'PAYLOAD_TOO_LARGE';

function positiveWholeBytes(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Judge a configured limit: a positive whole number of bytes, or a thrown
 * `TypeError` naming where it was set.
 */
export function assertMaxRequestBodyBytes(value: unknown, where: string): number {
    const bytes = positiveWholeBytes(value);
    if (bytes === undefined) {
        throw new TypeError(
            `${where} must be a positive whole number of bytes (got ${JSON.stringify(value) ?? String(value)}). `
            + `Leave it unset for the default of ${DEFAULT_MAX_REQUEST_BODY_BYTES} bytes (10 MiB).`,
        );
    }
    return bytes;
}

/**
 * The limit a door serves under: the transport option when given, else
 * {@link MAX_REQUEST_BODY_BYTES_ENV}, else the default. Either source holding
 * something that is not a positive whole number of bytes throws.
 */
export function resolveMaxRequestBodyBytes(
    option?: number,
    env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): number {
    if (option !== undefined) return assertMaxRequestBodyBytes(option, 'maxRequestBodyBytes');
    const raw = env[MAX_REQUEST_BODY_BYTES_ENV];
    if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_REQUEST_BODY_BYTES;
    const parsed = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
    return assertMaxRequestBodyBytes(Number.isNaN(parsed) ? raw : parsed, MAX_REQUEST_BODY_BYTES_ENV);
}

/**
 * The refusal of a body over the limit, as a declared throw: status `413` and
 * the registered `PAYLOAD_TOO_LARGE`. `413` is not a status
 * `HttpStatusErrorCodeMap` names, so both doors render it with
 * {@link requestBodyTooLargeEnvelope} rather than through
 * `declaredEnvelopeForThrow`.
 */
export class RequestBodyTooLarge extends Error {
    readonly status = 413;
    readonly statusCode = 413;
    readonly code = PAYLOAD_TOO_LARGE_CODE;

    constructor(readonly limit: number) {
        super(
            `The request body is larger than this server accepts (${limit} bytes). It was refused, and not read `
            + 'past the limit: send a smaller body. An operator raises the limit with maxRequestBodyBytes or '
            + `${MAX_REQUEST_BODY_BYTES_ENV}.`,
        );
        this.name = 'RequestBodyTooLarge';
    }
}

/**
 * A byte door's read refused past the door's OWN bound (`rawBody({ maxBytes })`),
 * not the transport's limit: status `413`, code `PAYLOAD_TOO_LARGE`. The door
 * answers it with its own refusal; when it escapes the door, the request is
 * answered with {@link requestBodyTooLargeAnswer}'s envelope for it.
 */
export class RawBodyTooLarge extends Error {
    readonly status = 413;
    readonly statusCode = 413;
    readonly code = PAYLOAD_TOO_LARGE_CODE;

    constructor(readonly maxBytes: number) {
        super(
            `The request body is larger than this endpoint accepts (${maxBytes} bytes). It was refused, and not read `
            + 'past that bound: send a smaller body.',
        );
        this.name = 'RawBodyTooLarge';
    }
}

/**
 * The bound a `rawBody({ maxBytes })` call states: `undefined` when it states
 * none, else a non-negative whole number of bytes. Anything else is the
 * calling door's bug and throws a `TypeError`, so a bad bound never reads as
 * no bound.
 */
export function rawBodyMaxBytes(options: { maxBytes?: number } | undefined): number | undefined {
    const maxBytes = options?.maxBytes;
    if (maxBytes === undefined) return undefined;
    if (typeof maxBytes !== 'number' || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        throw new TypeError(
            `rawBody({ maxBytes }) must be a non-negative whole number of bytes (got ${JSON.stringify(maxBytes) ?? String(maxBytes)}).`,
        );
    }
    return maxBytes;
}

/** The ADR-0112 envelope both doors answer a body over the limit with. */
export function requestBodyTooLargeEnvelope(limit: number): {
    status: 413;
    body: { success: false; error: { code: typeof PAYLOAD_TOO_LARGE_CODE; message: string } };
} {
    return {
        status: 413,
        body: { success: false, error: { code: PAYLOAD_TOO_LARGE_CODE, message: new RequestBodyTooLarge(limit).message } },
    };
}

/**
 * The envelope for `thrown` when it is a {@link RequestBodyTooLarge} or a
 * {@link RawBodyTooLarge}; `undefined` otherwise.
 */
export function requestBodyTooLargeAnswer(thrown: unknown): ReturnType<typeof requestBodyTooLargeEnvelope> | undefined {
    if (thrown instanceof RequestBodyTooLarge) return requestBodyTooLargeEnvelope(thrown.limit);
    if (thrown instanceof RawBodyTooLarge) {
        return { status: 413, body: { success: false, error: { code: PAYLOAD_TOO_LARGE_CODE, message: thrown.message } } };
    }
    return undefined;
}

/** The `Content-Length` a request declares, as a number; `undefined` when it declares none. */
export function declaredLength(request: Request): number | undefined {
    const value = request.headers.get('content-length');
    if (value === null || value.trim() === '') return undefined;
    const length = Number(value.trim());
    return Number.isFinite(length) && length >= 0 ? length : undefined;
}

/**
 * The bytes of a body read up to a bound and KEPT, so that a reader which
 * stopped at the bound can still hand the whole body to a byte door.
 */
export interface HeldRequestBody {
    /** The bytes read, when the whole body fit within the bound. */
    readonly bytes: Uint8Array | undefined;
    /** Whether the body passed the bound (and so `bytes` is undefined). */
    readonly overLimit: boolean;
    /**
     * Every byte of the body: those held, then the rest of the stream. With
     * `maxBytes`, refused with {@link RawBodyTooLarge} once the body passes it,
     * the source cancelled so the rest is never read.
     */
    readAll(maxBytes?: number): Promise<Uint8Array>;
}

/**
 * Read `reader` to its end into `chunks` (which may already hold bytes). With
 * `maxBytes`, stop once the bytes held pass it: the source is cancelled, so the
 * rest is never read, and the read answers `false`. `true` once the body ended.
 */
async function readInto(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    chunks: Uint8Array[],
    maxBytes: number | undefined,
): Promise<boolean> {
    let total = 0;
    for (const chunk of chunks) total += chunk.byteLength;
    for (;;) {
        if (maxBytes !== undefined && total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return false;
        }
        const next = await reader.read();
        if (next.done) return true;
        chunks.push(next.value);
        total += next.value.byteLength;
    }
}

function concat(chunks: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks) total += chunk.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

/** One request's guard state. */
export interface RequestBodyGuard {
    /** The limit this request is served under. */
    readonly limit: number;
    /** The request as the client sent it, before the guard wrapped its body. */
    readonly original: Request;
    /** Whether the request declares a `Content-Length` over the limit. */
    readonly declaredOverLimit: boolean;
    /** Whether the request declares a `Content-Length` (within the limit or not). */
    readonly declaresLength: boolean;
    /** Whether a read through the guard was refused for passing the limit. */
    tripped(): boolean;
    /** Whether anything has read through the guard. */
    pulled(): boolean;
    /**
     * Read the ORIGINAL body up to the limit and keep what was read. For a door's
     * own pre-read of a body with no declared length: the read stops past the
     * limit, and the held bytes still reach a byte door through {@link readOriginal}.
     */
    hold(): Promise<HeldRequestBody>;
    /**
     * Every byte of the ORIGINAL body, unbounded by this limit: the reader is a
     * byte door that bounds the body by its own limit, `maxBytes`, held as this
     * limit is (refused with {@link RawBodyTooLarge} once passed, the source
     * cancelled). `undefined` when the original can no longer be read here
     * (something read through the guard).
     */
    readOriginal(maxBytes?: number): Promise<Uint8Array> | undefined;
    /**
     * At the end of the request: a held body that passed the limit and that no
     * byte door went on to read whole has its source cancelled, as a read
     * refused through the guard has, so the rest of it is never read.
     */
    release(): Promise<void>;
}

const guards = new WeakMap<Request, RequestBodyGuard>();

/** The guard {@link installRequestBodyLimit} put on this request; `undefined` on an app without one. */
export function requestBodyGuardOf(c: Context): RequestBodyGuard | undefined {
    return guards.get(c.req.raw);
}

function guardRequest(original: Request, limit: number): { guard: RequestBodyGuard; guarded: Request | undefined } {
    const declared = declaredLength(original);
    const declaredOverLimit = original.body !== null && !original.bodyUsed && declared !== undefined && declared > limit;
    let tripped = false;
    let pulled = false;
    let held: Promise<HeldRequestBody> | undefined;
    let heldReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let heldOpen = false;
    let sourceReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const guard: RequestBodyGuard = {
        limit,
        original,
        declaredOverLimit,
        declaresLength: declared !== undefined,
        tripped: () => tripped,
        pulled: () => pulled,
        hold() {
            held ??= (async (): Promise<HeldRequestBody> => {
                const reader = original.body!.getReader();
                heldReader = reader;
                const chunks: Uint8Array[] = [];
                let total = 0;
                let done = false;
                while (total <= limit) {
                    const next = await reader.read();
                    if (next.done) {
                        done = true;
                        break;
                    }
                    chunks.push(next.value);
                    total += next.value.byteLength;
                }
                const overLimit = !done && total > limit;
                heldOpen = !done;
                return {
                    bytes: overLimit ? undefined : concat(chunks),
                    overLimit,
                    async readAll(maxBytes?: number) {
                        // A byte door claimed the rest: `release` leaves it to this read.
                        heldOpen = false;
                        if (!done) {
                            if (!(await readInto(reader, chunks, maxBytes))) throw new RawBodyTooLarge(maxBytes!);
                            done = true;
                        }
                        const all = concat(chunks);
                        if (maxBytes !== undefined && all.byteLength > maxBytes) throw new RawBodyTooLarge(maxBytes);
                        return all;
                    },
                };
            })();
            return held;
        },
        readOriginal(maxBytes?: number) {
            if (held) return held.then((h) => h.readAll(maxBytes));
            if (pulled || original.bodyUsed || original.body?.locked) return undefined;
            if (maxBytes === undefined) return original.arrayBuffer().then((buffer) => new Uint8Array(buffer));
            if (declared !== undefined && declared > maxBytes) return Promise.reject(new RawBodyTooLarge(maxBytes));
            if (!original.body) return Promise.resolve(new Uint8Array(0));
            const reader = original.body.getReader();
            const chunks: Uint8Array[] = [];
            return readInto(reader, chunks, maxBytes).then((complete) => {
                if (!complete) throw new RawBodyTooLarge(maxBytes);
                return concat(chunks);
            });
        },
        async release() {
            if (!held) return;
            const reading = await held.catch(() => undefined);
            if (reading?.overLimit && heldOpen && heldReader) {
                heldOpen = false;
                await heldReader.cancel().catch(() => undefined);
            }
        },
    };

    // No body, or one something upstream of this app already consumed (a host
    // that mounts this app under its own and read the body first): there is
    // nothing left here to bound, and Hono's body cache holds the only copy.
    if (!original.body || original.bodyUsed || original.body.locked) return { guard, guarded: undefined };

    const refusal = () => {
        tripped = true;
        return new RequestBodyTooLarge(limit);
    };

    // `highWaterMark: 0` so the stream pulls only when something reads it: a
    // route that never reads the body reads nothing, and is not refused.
    let count = 0;
    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            pulled = true;
            if (declaredOverLimit) {
                controller.error(refusal());
                return;
            }
            sourceReader ??= original.body!.getReader();
            const next = await sourceReader.read();
            if (next.done) {
                controller.close();
                return;
            }
            count += next.value.byteLength;
            if (count > limit) {
                controller.error(refusal());
                await sourceReader.cancel().catch(() => undefined);
                return;
            }
            controller.enqueue(next.value);
        },
        async cancel(reason) {
            await sourceReader?.cancel(reason).catch(() => undefined);
        },
    }, { highWaterMark: 0 });

    const guarded = new Request(original, { body, duplex: 'half' } as RequestInit);
    return { guard, guarded };
}

/**
 * Install the limit on `app`, as early as possible so every route and every
 * later middleware reads the body through it. `limit` is asked per request, so
 * a host that changes it after construction is served the new value.
 */
export function installRequestBodyLimit(app: Hono<any, any, any>, limit: () => number): void {
    app.use('*', async (c, next) => {
        const { guard, guarded } = guardRequest(c.req.raw, limit());
        guards.set(c.req.raw, guard);
        if (guarded) {
            c.req.raw = guarded;
            guards.set(guarded, guard);
        }
        try {
            await next();
        } finally {
            await guard.release();
        }
        if (guard.tripped()) {
            const envelope = requestBodyTooLargeEnvelope(guard.limit);
            c.res = c.json(envelope.body, envelope.status);
        }
    });
}
