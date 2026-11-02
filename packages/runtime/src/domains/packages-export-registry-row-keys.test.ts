// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29617, ADR-0141 D5 / ADR-0146 D2] `GET /packages/:id/export` writes the
 * two install-manifest keys an install of the export decides by, read off the
 * package's registry row: `namespace` and `dependencies`
 * (`PackageExportManifestSchema`). Without them a reinstalled `.custom` pair
 * lands under the namespace derived from its id (`custom`) and without the
 * edge to its base that orders its install and admits its overrides.
 *
 * The door is the real dispatcher over a registry and protocol double: what
 * is pinned is what the door writes from the row. The round trip through
 * install-local is pinned on two real showcase boots in
 * `packages/qa/dogfood/test/package-export-reinstall-custom-pair.dogfood.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { PackageExportManifestSchema } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

const BASE = 'com.example.crm';
const PAIR = 'com.example.crm.custom';

const system = (): any => ({ request: {}, environmentId: 'platform', executionContext: { isSystem: true } });

async function exported(row: Record<string, unknown>): Promise<Record<string, any>> {
    const registry = { getPackage: vi.fn(() => row), getAllPackages: vi.fn().mockReturnValue([]) };
    const protocol = { getMetaItemsPerPackage: vi.fn(async () => ({ items: [] })), getMetaItems: vi.fn(async () => ({ items: [] })) };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? { registry } : name === 'protocol' ? protocol : null) },
    };
    const r = await new HttpDispatcher(kernel).handlePackages(`/${encodeURIComponent(PAIR)}/export`, 'GET', undefined, {}, system());
    expect(r.response?.status, JSON.stringify(r.response?.body)).toBe(200);
    const body: any = r.response?.body;
    return body?.data ?? body;
}

describe('[#29617] GET /packages/:id/export writes the namespace and the dependencies its registry row declares', () => {
    it('a `.custom` pair\'s export carries its namespace and its edge to its base, and parses as the declared export', async () => {
        const dependencies = { [BASE]: '^1' };
        const row = { id: PAIR, manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom', dependencies } };
        const manifest = await exported(row);
        expect(manifest).toMatchObject({ id: PAIR, namespace: 'crm_custom', dependencies: { [BASE]: '^1' } });
        expect(manifest.dependencies, 'a copy of the row\'s map, never the row\'s own object').not.toBe(dependencies);
        expect(PackageExportManifestSchema.safeParse(manifest).success).toBe(true);
    });

    it('a row that declares neither writes neither — no key is invented', async () => {
        const manifest = await exported({ id: PAIR, manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0' } });
        expect(manifest).toEqual({ id: PAIR, name: 'crm-custom', version: '0.1.0' });
    });

    it('`type` stays out of the export: it is not one of the keys this door writes', async () => {
        const manifest = await exported({ id: PAIR, manifest: { id: PAIR, name: 'crm-custom', version: '0.1.0', type: 'app', namespace: 'crm_custom' } });
        expect(Object.keys(manifest).sort()).toEqual(['id', 'name', 'namespace', 'version']);
    });
});
