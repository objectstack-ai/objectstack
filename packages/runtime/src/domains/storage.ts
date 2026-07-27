// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/storage` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-3).
 * Upload / download bridge to the `file-storage` service. Download results
 * may be a redirect or a stream — those come back as `result:{type:...}` for
 * the HTTP adapter to realize (the dispatcher envelope can't carry them).
 *
 * Routes (path is the sub-path after `/storage`):
 *   POST /upload      → upload (body is the file/stream)
 *   GET  /file/:id    → download (redirect | stream | metadata)
 */

import { CoreServiceName } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createStorageDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/storage',
        handler: (req, context) =>
            handleStorageRequest(deps, req.path.substring(8), req.method, req.body, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleStorage`. */
export async function handleStorageRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    file: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // The legacy body had `getService(...) || this.kernel.services?.['file-storage']`.
    // The second leg was strictly redundant: resolveService's fallback chain
    // already ends at the services map (and when `services` is a Map, the
    // legacy index access returned undefined anyway), so it is dropped here.
    const storageService = await deps.getService(CoreServiceName.enum['file-storage']);
    if (!storageService) {
        return { handled: true, response: deps.error('File storage not configured', 501) };
    }

    const m = method.toUpperCase();
    const parts = path.replace(/^\/+/, '').split('/');

    // POST /storage/upload
    if (parts[0] === 'upload' && m === 'POST') {
        if (!file) {
            return { handled: true, response: deps.error('No file provided', 400) };
        }
        const result = await storageService.upload(file, { request: context.request });
        return { handled: true, response: deps.success(result) };
    }

    // GET /storage/file/:id
    if (parts[0] === 'file' && parts[1] && m === 'GET') {
        const id = parts[1];
        const result = await storageService.download(id, { request: context.request });

        // Result can be URL (redirect), Stream/Blob, or metadata
        if (result.url && result.redirect) {
            // Must be handled by adapter to do actual redirect
            return { handled: true, result: { type: 'redirect', url: result.url } };
        }

        if (result.stream) {
            // Must be handled by adapter to pipe stream
            return {
                handled: true,
                result: {
                    type: 'stream',
                    stream: result.stream,
                    headers: {
                        'Content-Type': result.mimeType || 'application/octet-stream',
                        'Content-Length': result.size
                    }
                }
            };
        }

        return { handled: true, response: deps.success(result) };
    }

    return { handled: false };
}
