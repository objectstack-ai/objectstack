// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response compression for the built-in HTTP server: a body above
 * {@link RESPONSE_COMPRESSION_THRESHOLD_BYTES} with a compressible content type
 * goes out brotli- or gzip-encoded when the client accepts one. On by default,
 * mounted once by `HonoHttpServer`'s constructor as the OUTERMOST middleware,
 * so it sees every answer the app produces: adapter routes, raw-app mounts
 * (the CLI's Console asset route among them), static files and the unmatched
 * answer alike.
 *
 * ## What is never encoded
 *
 * - **A stream.** A response written through `res.write()` (SSE, the AI data
 *   stream, streamed exports) is left exactly as it was. A deflate or brotli
 *   encoder holds bytes back until it has enough to emit, so an encoded stream
 *   reaches the client late or in bursts; `isStreamed` is the adapter's own
 *   record of which responses those are. `text/event-stream` is refused by
 *   type as well, and a response that names a `Transfer-Encoding` (Hono's
 *   streaming helpers set one) is left alone.
 * - **An already-encoded response** (`Content-Encoding` set): never encoded
 *   twice.
 * - **A partial response** (`206`), a body-less status (`1xx`, `204`, `304`)
 *   and `HEAD`. Range requests on static files therefore keep answering the
 *   identity bytes the `Content-Range` describes.
 * - **`Cache-Control: no-transform`**, which forbids exactly this.
 *
 * ## The size threshold
 *
 * A declared `Content-Length` decides it outright. Without one (a JSON answer,
 * a `Buffer` a raw route returns), the body is read only until the threshold is
 * reached: a body that ends first goes out as the same bytes, unencoded, and
 * one that reaches it is encoded from the bytes already read onward, so a large
 * body is never held whole in memory.
 *
 * ## `Vary` and `ETag`
 *
 * `Vary: Accept-Encoding` goes on every response this could encode, whatever
 * the request accepted and whatever the body's size, so a shared cache never
 * hands one client's encoding to another. The `ETag` is passed through
 * unchanged: the metadata and record doors compare an `If-Match` token against
 * it strongly, so rewriting it to a weak `W/` form on encoded answers would make
 * every save that pins the version it just read fail its precondition.
 *
 * ## In-process dispatch
 *
 * A caller that dispatches into the app in-process (`app.fetch`,
 * `app.request`) receives an encoded body exactly when it sends an
 * `Accept-Encoding` naming br or gzip, as any HTTP client would, and must
 * decode it. The in-process callers in this repository drop or never forward
 * that header.
 */

import { Buffer } from 'node:buffer';
import type { Transform } from 'node:stream';
import { constants as zlib, createBrotliCompress, createGzip } from 'node:zlib';
import type { Context, MiddlewareHandler } from 'hono';
// One vocabulary of compressible media types, Hono's own: it already excludes
// `text/event-stream`.
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from 'hono/compress';

/** Bodies smaller than this many bytes are sent as they are. */
export const RESPONSE_COMPRESSION_THRESHOLD_BYTES = 1024;

/** The content codings this server produces, in preference order on a tie. */
export type ResponseEncoding = 'br' | 'gzip';

/**
 * Brotli quality for on-the-fly encoding. The library default (11) is a
 * build-time setting and costs tens of times more CPU per byte; 4 keeps a
 * multi-megabyte bundle in the tens of milliseconds while still beating gzip's
 * ratio on text.
 */
const BROTLI_QUALITY = 4;

const NO_TRANSFORM = /(?:^|,)\s*no-transform\s*(?:,|$)/i;
const VARY_ACCEPT_ENCODING = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;
const EVENT_STREAM = /^\s*text\/event-stream(?:[;\s]|$)/i;

/**
 * The coding to answer `Accept-Encoding` with, or `undefined` for identity.
 *
 * Quality values are honoured (`q=0` refuses a coding), `*` stands for every
 * coding not named, and brotli wins a tie. No header means no encoding: a
 * client that says nothing gets the bytes as stored.
 */
export function selectResponseEncoding(acceptEncoding: string | undefined): ResponseEncoding | undefined {
    if (!acceptEncoding) return undefined;
    const weights = new Map<string, number>();
    for (const part of acceptEncoding.split(',')) {
        const [rawCoding, ...params] = part.split(';');
        const coding = rawCoding.trim().toLowerCase();
        if (!coding) continue;
        let weight = 1;
        for (const param of params) {
            const q = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
            if (q) {
                const n = Number(q[1]);
                weight = Number.isFinite(n) ? n : 0;
            }
        }
        weights.set(coding, weight);
    }
    const wildcard = weights.get('*');
    const weightOf = (coding: ResponseEncoding) => weights.get(coding) ?? wildcard ?? 0;
    const br = weightOf('br');
    const gzip = weightOf('gzip');
    if (br <= 0 && gzip <= 0) return undefined;
    return br >= gzip ? 'br' : 'gzip';
}

/** Whether the response in `c` is a kind this server may encode at all. */
function isEncodableKind(c: Context): boolean {
    if (c.req.method === 'HEAD') return false;
    const { status, headers } = c.res;
    if (status < 200 || status === 204 || status === 206 || status === 304) return false;
    if (headers.has('content-encoding') || headers.has('transfer-encoding')) return false;
    const type = headers.get('content-type');
    if (!type || EVENT_STREAM.test(type) || !COMPRESSIBLE_CONTENT_TYPE_REGEX.test(type)) return false;
    const cacheControl = headers.get('cache-control');
    return !(cacheControl && NO_TRANSFORM.test(cacheControl));
}

function declaredLength(headers: Headers): number | undefined {
    const raw = headers.get('content-length');
    if (raw === null || !/^\s*\d+\s*$/.test(raw)) return undefined;
    return Number(raw);
}

function createEncoder(encoding: ResponseEncoding, sizeHint: number | undefined): Transform {
    if (encoding === 'gzip') return createGzip();
    const params: Record<number, number> = {
        [zlib.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_TEXT,
    };
    if (sizeHint !== undefined) params[zlib.BROTLI_PARAM_SIZE_HINT] = sizeHint;
    return createBrotliCompress({ params });
}

/** The bytes already read, then the rest of the body. Cancelling it cancels the body. */
function replay(
    prefix: Uint8Array[],
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onCancel: () => void,
): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = prefix.shift();
            if (next) {
                controller.enqueue(next);
                return;
            }
            const { done, value } = await reader.read();
            if (done) controller.close();
            else controller.enqueue(value);
        },
        cancel(reason) {
            onCancel();
            return reader.cancel(reason);
        },
    });
}

/** A web transform over a Node zlib encoder. */
function encodingTransform(encoder: Transform): TransformStream<Uint8Array, Uint8Array> {
    return new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
            encoder.on('data', (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
            });
            encoder.on('error', (err) => controller.error(err));
        },
        transform(chunk) {
            return new Promise<void>((resolve, reject) => {
                encoder.write(chunk, (err) => (err ? reject(err) : resolve()));
            });
        },
        flush() {
            return new Promise<void>((resolve, reject) => {
                encoder.once('end', resolve);
                encoder.once('error', reject);
                encoder.end();
            });
        },
    });
}

/**
 * The compression middleware. `isStreamed` names the responses the adapter
 * produced from `res.write()`; see the module docblock for every other rule.
 */
export function createResponseCompression(options: {
    isStreamed: (c: Context) => boolean;
    threshold?: number;
}): MiddlewareHandler {
    const threshold = options.threshold ?? RESPONSE_COMPRESSION_THRESHOLD_BYTES;
    return async function responseCompression(c, next) {
        await next();
        if (options.isStreamed(c) || !isEncodableKind(c)) return;

        const vary = c.res.headers.get('vary');
        if (vary !== '*' && !(vary && VARY_ACCEPT_ENCODING.test(vary))) {
            c.header('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
        }

        const length = declaredLength(c.res.headers);
        if (length !== undefined && length < threshold) return;
        const encoding = selectResponseEncoding(c.req.header('accept-encoding'));
        if (!encoding) return;
        const body = c.res.body;
        if (!body) return;

        const reader = body.getReader();
        const prefix: Uint8Array[] = [];
        if (length === undefined) {
            let read = 0;
            while (read < threshold) {
                const { done, value } = await reader.read();
                if (done) {
                    // The whole body is below the threshold: the same bytes, unencoded.
                    c.res = new Response(Buffer.concat(prefix), c.res);
                    return;
                }
                prefix.push(value);
                read += value.byteLength;
            }
        }

        const encoder = createEncoder(encoding, length);
        const encoded = replay(prefix, reader, () => encoder.destroy()).pipeThrough(encodingTransform(encoder));
        const original = c.res;
        c.res = new Response(encoded, {
            status: original.status,
            statusText: original.statusText,
            headers: original.headers,
        });
        // After the assignment: Hono's `res` setter copies the previous
        // response's headers onto the new one, `Content-Length` included.
        const encodedHeaders: Headers = c.res.headers;
        encodedHeaders.delete('content-length');
        // A byte range names offsets in the identity bytes, not the encoded ones.
        encodedHeaders.delete('accept-ranges');
        encodedHeaders.set('content-encoding', encoding);
    };
}
