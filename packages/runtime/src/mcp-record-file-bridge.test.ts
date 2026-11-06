// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30892] The MCP bridge's file members (`read_file` / `create_upload_link`),
 * as `buildMcpBridge` composes them over the storage plugin's caller-scoped
 * verbs.
 *
 * Pinned here: the record is read through the door `get_record` reads it
 * through FIRST, so a record the caller cannot read is refused with that
 * door's answer and the storage service is never asked; the service is asked
 * as the request's own principal; a link this server mints (a local adapter's
 * download path, an upload link's path) comes back absolute, on the request's
 * origin, while an adapter's absolute URL is left as it is; and a bridge built
 * without the seam carries no file member, so neither tool is listed.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a clocked case: the dispatcher reaches
// `standalone-stack.ts`, whose function body `import()`s it (`scripts/check-test-source-alias.mjs`).
import '@objectstack/metadata';
import { HttpDispatcher } from './http-dispatcher.js';
import { buildMcpBridge, type McpRecordFileService } from './domains/mcp.js';

const EC = { userId: 'u1', tenantId: 'org_1', systemPermissions: [] };

function harness(download: { url: string; expiresAt: string } | null = { url: '/api/v1/storage/_local/raw/tok', expiresAt: '2026-11-06T12:05:00.000Z' }) {
    const protocol = {
        getData: vi.fn(async ({ object, id }: { object: string; id: string }) => {
            if (id !== 'r1') {
                throw Object.assign(new Error(`Record "${id}" not found in "${object}"`), { code: 'RECORD_NOT_FOUND', status: 404 });
            }
            return { object, id, record: { id } };
        }),
    };
    const kernel: any = {
        context: { getService: (n: string) => (n === 'protocol' ? protocol : null) },
    };
    const service = {
        listRecordFilesAs: vi.fn(async () => [{ fileId: 'f1', name: 'a.pdf', mimeType: 'application/pdf', size: 3, field: 'policy' }]),
        readRecordFileAs: vi.fn(async () => ({ fileId: 'f1', name: 'a.pdf', size: 3, maxBytes: 10, download })),
        createUploadLinkAs: vi.fn(async () => ({ path: '/api/v1/storage/upload-links/id.secret', expiresAt: '2026-11-06T12:10:00.000Z' })),
    } satisfies McpRecordFileService;
    const ctx: any = {
        request: { method: 'POST', url: '/api/v1/mcp', headers: { host: 'acme.test', 'x-forwarded-proto': 'https' } },
        environmentId: 'platform',
        executionContext: EC,
    };
    const deps = (new HttpDispatcher(kernel) as any).domainDeps;
    return { protocol, service, ctx, deps };
}

describe('#30892 — the MCP bridge\'s file members', () => {
    it('reads the record through get_record\'s door first: unreadable is that door\'s refusal, and storage is never asked', async () => {
        const { service, ctx, deps, protocol } = harness();
        const bridge = buildMcpBridge(deps, ctx, { recordFiles: service });
        for (const call of [
            () => bridge.readRecordFile('claim', 'hidden', { field: 'policy' }, { maxBytes: 10 }),
            () => bridge.listRecordFiles('claim', 'hidden'),
            () => bridge.createUploadLink('claim', 'hidden', { field: 'policy' }),
        ]) {
            await expect(call()).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', status: 404 });
        }
        expect(protocol.getData).toHaveBeenCalledWith(expect.objectContaining({ object: 'claim', id: 'hidden', context: EC }));
        expect(service.readRecordFileAs).not.toHaveBeenCalled();
        expect(service.listRecordFilesAs).not.toHaveBeenCalled();
        expect(service.createUploadLinkAs).not.toHaveBeenCalled();
    });

    it('asks the storage service as the request\'s principal, and makes a local download path absolute on the request\'s origin', async () => {
        const { service, ctx, deps } = harness();
        const bridge = buildMcpBridge(deps, ctx, { recordFiles: service });
        const read = await bridge.readRecordFile('claim', 'r1', { attachmentId: 'a1' }, { maxBytes: 10 });
        expect(service.readRecordFileAs).toHaveBeenCalledWith('claim', 'r1', { attachmentId: 'a1' }, EC, { maxBytes: 10 });
        expect(read.download).toEqual({ url: 'https://acme.test/api/v1/storage/_local/raw/tok', expiresAt: '2026-11-06T12:05:00.000Z' });
        expect(await bridge.listRecordFiles('claim', 'r1')).toHaveLength(1);
        expect(service.listRecordFilesAs).toHaveBeenCalledWith('claim', 'r1', EC);
    });

    it('leaves an adapter\'s absolute download URL as it is, and a missing one missing', async () => {
        const s3 = harness({ url: 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=abc', expiresAt: '2026-11-06T12:05:00.000Z' });
        const read = await buildMcpBridge(s3.deps, s3.ctx, { recordFiles: s3.service })
            .readRecordFile('claim', 'r1', { field: 'policy' }, { maxBytes: 10 });
        expect(read.download.url).toBe('https://bucket.s3.amazonaws.com/k?X-Amz-Signature=abc');
        const none = harness(null);
        const noLink = await buildMcpBridge(none.deps, none.ctx, { recordFiles: none.service })
            .readRecordFile('claim', 'r1', { field: 'policy' }, { maxBytes: 10 });
        expect(noLink.download).toBeNull();
    });

    it('answers an upload link as an absolute URL with its expiry', async () => {
        const { service, ctx, deps } = harness();
        const link = await buildMcpBridge(deps, ctx, { recordFiles: service }).createUploadLink('claim', 'r1', { attachments: true });
        expect(service.createUploadLinkAs).toHaveBeenCalledWith('claim', 'r1', { attachments: true }, EC);
        expect(link).toEqual({ url: 'https://acme.test/api/v1/storage/upload-links/id.secret', expiresAt: '2026-11-06T12:10:00.000Z' });
    });

    it('a bridge built without the seam carries no file member, so neither tool is listed', () => {
        const { ctx, deps } = harness();
        const bridge = buildMcpBridge(deps, ctx);
        expect(bridge.readRecordFile).toBeUndefined();
        expect(bridge.listRecordFiles).toBeUndefined();
        expect(bridge.createUploadLink).toBeUndefined();
    });
});
