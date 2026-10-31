// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { countServerTiming, perfNow } from '@objectstack/observability';

/**
 * [#27627] Time one metadata protocol read into the request's `meta`
 * `Server-Timing` mark — the time the request spent waiting on the metadata
 * store, beside `db` (SQL) and `total`, so a slow `/meta` answer says which
 * of the two it was waiting on.
 *
 * Every read a request makes folds into ONE aggregate mark
 * (`meta;dur=<sum>;desc="<n> reads"`) — a list read, an item read and the
 * reads a gate makes stay one member rather than one per call. A no-op beyond
 * one ambient lookup when the request opened no collector, and disclosure
 * stays the existing gate's decision: this only measures.
 */
export async function measureMetaRead<T>(read: () => T | Promise<T>): Promise<T> {
    const t0 = perfNow();
    try {
        return await read();
    } finally {
        countServerTiming('meta', perfNow() - t0, 'reads');
    }
}
