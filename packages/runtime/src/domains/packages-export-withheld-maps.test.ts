// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28640 ruling ③A] `GET /packages/:id/export` writes `withheldMaps`: each
 * header or environment-variable map of an exported connector that the served
 * read withheld whole, as `{ type: 'connector', name, path }`.
 *
 * The protocol is a double and the door is the real dispatcher. The double's
 * per-package list serves each connector the way the real served read does —
 * through the real `connector` redactor — and its by-name execution read
 * answers the stored body, so the export's verdict is judged against the same
 * redaction the served read ran.
 *
 *  - all four positions, in declaration order per connector, in export order;
 *  - a connector with no map, and one whose map is CLEARED (`{}`, served as
 *    written), are not listed; a package withholding nothing carries no key;
 *  - the stored body never reaches the export: no header or variable name;
 *  - no verdict is guessed: a protocol without the execution face, or a
 *    connector the face answers no body for, fails the export.
 */
import { describe, expect, it, vi } from 'vitest';
import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { PackageExportManifestSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.example.crm';
const redact = getMetadataTypeRedactor('connector')!;

const REST = {
    name: 'crm_billing', label: 'Billing', type: 'api', provider: 'rest',
    providerConfig: {
        baseUrl: 'https://billing.example.com',
        headers: { 'X-Billing-Key': 'sk_live_secret' },
        defaultHeaders: { Accept: 'application/json' },
    },
};
const MCP_HTTP = {
    name: 'crm_assist', label: 'Assist', type: 'api', provider: 'mcp',
    providerConfig: { transport: { kind: 'http', url: 'https://assist.example.com/mcp', headers: { Authorization: 'Bearer tok_secret' } } },
};
const MCP_STDIO = {
    name: 'crm_tools', label: 'Tools', type: 'api', provider: 'mcp',
    providerConfig: { transport: { kind: 'stdio', command: 'crm-tools', env: { CRM_TOKEN: 'env_secret' } } },
};
const PLAIN = { name: 'crm_status', label: 'Status', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://status.example.com' } };
const CLEARED = { name: 'crm_cleared', label: 'Cleared', type: 'api', provider: 'rest', providerConfig: { baseUrl: 'https://c.example.com', headers: {} } };

const system = (): any => ({ request: {}, environmentId: 'platform', executionContext: { isSystem: true } });

/** A protocol whose served list redacts as the real one does, and whose execution face answers the stored body. */
function protocolOf(stored: Record<string, any>[], opts: { executionFace?: boolean; missing?: string } = {}) {
    const byName = new Map(stored.map((c) => [c.name, { ...c, _packageId: PKG }]));
    return {
        getMetaItems: vi.fn(async () => ({ items: [] })),
        getMetaItemsPerPackage: vi.fn(async (req: { type: string }) => ({
            items: req.type === 'connector' ? [...byName.values()].map((c) => redact(c).item) : [],
        })),
        ...(opts.executionFace === false ? {} : {
            getMetaItemForExecution: vi.fn(async (req: { type: string; name: string; packageId?: string }) => ({
                type: req.type,
                name: req.name,
                item: req.name === opts.missing ? undefined : byName.get(req.name),
            })),
        }),
    };
}

function make(protocol: any) {
    const registry = {
        getPackage: vi.fn((id: string) => ({ id, manifest: { id, name: 'crm', version: '1.0.0' } })),
        getAllPackages: vi.fn().mockReturnValue([]),
    };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? { registry } : name === 'protocol' ? protocol : null) },
    };
    return new HttpDispatcher(kernel);
}

async function exportOf(protocol: any) {
    const r = await make(protocol).handlePackages(`/${encodeURIComponent(PKG)}/export`, 'GET', undefined, {}, system());
    const body: any = r.response?.body;
    return { status: r.response?.status, manifest: body?.data ?? body };
}

describe('[#28640 ruling ③A] GET /packages/:id/export names each connector map the served read withheld', () => {
    it('lists every withheld position — the four, per connector in declaration order, connectors in export order', async () => {
        const protocol = protocolOf([REST, PLAIN, MCP_HTTP, MCP_STDIO]);
        const { status, manifest } = await exportOf(protocol);
        expect(status, JSON.stringify(manifest)).toBe(200);
        expect(manifest.withheldMaps).toEqual([
            { type: 'connector', name: 'crm_billing', path: 'providerConfig.headers' },
            { type: 'connector', name: 'crm_billing', path: 'providerConfig.defaultHeaders' },
            { type: 'connector', name: 'crm_assist', path: 'providerConfig.transport.headers' },
            { type: 'connector', name: 'crm_tools', path: 'providerConfig.transport.env' },
        ]);
        // The verdict was read on the execution face, under the package's id.
        expect(protocol.getMetaItemForExecution).toHaveBeenCalledWith({ type: 'connector', name: 'crm_billing', packageId: PKG });
        // The export parses through its own declaration, the list preserved.
        const parsed = PackageExportManifestSchema.safeParse(manifest);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it('the exported items stay as served — each withheld map absent — and no header or variable name leaves', async () => {
        const { manifest } = await exportOf(protocolOf([REST, MCP_HTTP, MCP_STDIO]));
        const billing = manifest.connectors.find((c: any) => c.name === 'crm_billing');
        expect(billing.providerConfig).toEqual({ baseUrl: 'https://billing.example.com' });
        const text = JSON.stringify(manifest);
        for (const secret of ['X-Billing-Key', 'sk_live_secret', 'Authorization', 'tok_secret', 'CRM_TOKEN', 'env_secret']) {
            expect(text).not.toContain(secret);
        }
    });

    it('a connector with no map, or a CLEARED one, is not listed; a package withholding nothing carries no key', async () => {
        const { status, manifest } = await exportOf(protocolOf([PLAIN, CLEARED]));
        expect(status).toBe(200);
        expect(manifest.connectors.map((c: any) => c.name)).toEqual(['crm_status', 'crm_cleared']);
        expect(manifest).not.toHaveProperty('withheldMaps');
    });

    it('a package with no connectors asks the execution face nothing and carries no key', async () => {
        const protocol = protocolOf([]);
        const { status, manifest } = await exportOf(protocol);
        expect(status).toBe(200);
        expect(manifest).not.toHaveProperty('withheldMaps');
        expect(protocol.getMetaItemForExecution).not.toHaveBeenCalled();
    });

    it('guesses no verdict: a protocol without the execution face fails the export instead of omitting the key', async () => {
        const { status, manifest } = await exportOf(protocolOf([REST], { executionFace: false }));
        expect(status).toBe(500);
        expect(manifest?.connectors).toBeUndefined();
    });

    it('guesses no verdict: a connector the execution face answers no body for fails the export', async () => {
        const { status, manifest } = await exportOf(protocolOf([PLAIN, REST], { missing: 'crm_billing' }));
        expect(status).toBe(500);
        expect(manifest?.withheldMaps).toBeUndefined();
    });
});
