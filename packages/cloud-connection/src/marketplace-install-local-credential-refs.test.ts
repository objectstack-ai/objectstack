// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27237] The install answer says which connector credentials the package
 * names and which are not set (ruling A on #27230) — and a reference that is
 * not set never refuses the install: the instance naming it installs degraded,
 * and the answer says how to set it.
 *
 * Statuses come from the automation service's credential listing; the answer
 * carries a reference, its status and source and the instances naming it,
 * never a value.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// The first load of the runtime's dist paid at module top, never inside a
// clocked `it` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin, installedCredentialNote } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

const APP_ID = 'com.example.billingapp';

function artifact(connectors: unknown[]) {
    return {
        manifest: { id: APP_ID, namespace: 'billing_app', version: '0.1.0', type: 'app', name: 'Billing App' },
        objects: [{ name: 'billing_app_invoice', label: 'Invoice', fields: { name: { type: 'text', label: 'Name' } } }],
        connectors,
    };
}

const bearer = (name: string, credentialRef: string) => ({
    name,
    label: name,
    type: 'api',
    provider: 'rest',
    providerConfig: { baseUrl: 'https://billing.example.test' },
    auth: { type: 'bearer', credentialRef },
});

type Handler = (c: any) => Promise<any>;

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-credrefs-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function bootPlugin(automation?: Record<string, unknown>) {
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, any>();
    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: async () => undefined }),
        ...(automation ? { automation } : {}),
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        trigger: async () => undefined,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    return async (connectors: unknown[]) =>
        routes.get('POST /api/v1/marketplace/install-local')!(makeC({ manifest: artifact(connectors) }));
}

describe('[#27237] the install answer names the connector credentials the package declares', () => {
    it('reports each reference with its status, and a missing one installs — degraded — with the note saying how to set it', async () => {
        const listConnectorCredentialRefs = vi.fn(async () => [
            { ref: 'BILLING_SET_REF', status: 'set', source: 'object', writable: true, declared: true, connectors: [] },
            { ref: 'BILLING_MISSING_REF', status: 'missing', source: null, writable: true, declared: true, connectors: [] },
        ]);
        const install = await bootPlugin({ listConnectorCredentialRefs });

        const res = await install([
            bearer('billing', 'BILLING_SET_REF'),
            bearer('billing_eu', 'BILLING_MISSING_REF'),
            bearer('billing_us', 'BILLING_MISSING_REF'),
            { name: 'catalog_only', label: 'Catalog', type: 'api' },
        ]);

        expect(res.status).toBe(200);
        expect(res.payload?.success, JSON.stringify(res.payload)).toBe(true);
        expect(res.payload.data.credentialRefs).toEqual([
            { ref: 'BILLING_MISSING_REF', connectors: ['billing_eu', 'billing_us'], status: 'missing', source: null },
            { ref: 'BILLING_SET_REF', connectors: ['billing'], status: 'set', source: 'object' },
        ]);
        expect(res.payload.data.credentialNote).toBe(installedCredentialNote(['BILLING_MISSING_REF']));
        expect(res.payload.data.credentialNote).toContain('/api/v1/automation/connectors/credential-refs/:ref');
        expect(res.payload.data.credentialNote).not.toContain('BILLING_SET_REF');
    });

    it('with no automation service to ask, each reference is `unknown`, never assumed set', async () => {
        const install = await bootPlugin();
        const res = await install([bearer('billing', 'BILLING_SET_REF')]);
        expect(res.payload?.success).toBe(true);
        expect(res.payload.data.credentialRefs).toEqual([
            { ref: 'BILLING_SET_REF', connectors: ['billing'], status: 'unknown', source: null },
        ]);
        expect(res.payload.data.credentialNote).toBe(installedCredentialNote(['BILLING_SET_REF']));
    });

    it('a package whose connectors name no credential keeps the answer key set unchanged', async () => {
        const install = await bootPlugin({ listConnectorCredentialRefs: async () => [] });
        const res = await install([{ name: 'catalog_only', label: 'Catalog', type: 'api' }]);
        expect(res.payload?.success).toBe(true);
        expect('credentialRefs' in res.payload.data).toBe(false);
        expect('credentialNote' in res.payload.data).toBe(false);
    });
});
