// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MarketplaceProxyPlugin is a BROWSE-ONLY mechanism (ADR §5.2): it forwards
 * GET/HEAD marketplace reads and must NOT own install *policy*. Non-GET
 * requests pass through (`next()`) so a host-supplied install route (mounted
 * via the createObjectOSStack `extraPlugins` seam) can claim them — instead of
 * the old 405 "install via cloud" dead-end (framework#1548).
 *
 * The catalog list door (`GET /api/v1/marketplace/packages`) filters by the
 * spec's taxonomy facets on the server — `businessFunctions`, `industries`,
 * `solutionTypes` (each one comma-separated value) and `maturity` — OR inside a
 * facet, AND across, and pages the filtered set. The retired `?category=`
 * filter is refused with the spec's prescription, and so is a facet the
 * catalog cannot answer, before either path (public snapshot or cloud) is asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retiredCategoryGuidance } from '@objectstack/spec/marketplace';
import { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';

/** Drive the plugin's kernel:ready wiring and capture the registered handler. */
async function captureHandler(plugin: MarketplaceProxyPlugin) {
    let handler: any;
    let readyFn: any;
    const rawApp = {
        all: (_path: string, h: any) => { handler = h; },
        get: () => {}, post: () => {}, head: () => {},
    };
    const ctx: any = {
        hook: (ev: string, fn: any) => { if (ev === 'kernel:ready') readyFn = fn; },
        getService: (name: string) => (name === 'http-server' ? { getRawApp: () => rawApp } : undefined),
        logger: { info() {}, warn() {}, error() {} },
    };
    await plugin.start(ctx);
    await readyFn();
    return handler;
}

function fakeCtx(method: string, path: string) {
    return {
        req: {
            url: `http://env.test${path}`,
            method,
            header: () => undefined,
            raw: {},
        },
        json: (body: any, status: number) => ({ __status: status, __body: body }),
    };
}

describe('MarketplaceProxyPlugin — browse-only (no install dead-end)', () => {
    it('passes through a non-GET marketplace request (next()) instead of 405', async () => {
        const plugin = new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true });
        const handler = await captureHandler(plugin);
        expect(typeof handler).toBe('function');

        let nextCalled = false;
        const result = await handler(
            fakeCtx('POST', '/api/v1/marketplace/packages/pkg_1/install'),
            async () => { nextCalled = true; return 'PASSED_THROUGH'; },
        );

        // The handler delegates to the next route rather than emitting a 405.
        expect(nextCalled).toBe(true);
        expect(result).toBe('PASSED_THROUGH');
    });

    it('still passes install-local through (owned by the local install plugin)', async () => {
        const plugin = new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true });
        const handler = await captureHandler(plugin);

        let nextCalled = false;
        await handler(
            fakeCtx('POST', '/api/v1/marketplace/install-local'),
            async () => { nextCalled = true; return 'LOCAL'; },
        );
        expect(nextCalled).toBe(true);
    });

    it('503s when no control plane is configured (unchanged behaviour)', async () => {
        const plugin = new MarketplaceProxyPlugin({ controlPlaneUrl: 'off', cacheDisabled: true });
        const handler = await captureHandler(plugin);
        const result: any = await handler(fakeCtx('GET', '/api/v1/marketplace/packages'), async () => 'NEXT');
        expect(result.__status).toBe(503);
        expect(result.__body?.error?.code).toBe('MARKETPLACE_UNAVAILABLE');
    });
});

// ── The catalog list door: facet filters on the server ──────────────────────

const PUBLIC_BASE = 'https://public.test';
const CLOUD = 'http://cloud.test';
const LIST = '/api/v1/marketplace/packages';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    manifest_id: `com.test.${id}`,
    display_name: id.toUpperCase(),
    latest_version: null,
    ...extra,
});

/** A catalog snapshot: three taxonomy rows, one row from before the taxonomy. */
const ROWS = [
    row('crm', {
        business_functions: ['sales', 'marketing'], industries: ['retail'],
        solution_type: 'app', maturity: 'stable', category: 'crm',
    }),
    row('helpdesk', {
        business_functions: ['customer_service'], industries: ['retail', 'logistics'],
        solution_type: 'template', maturity: 'beta', category: 'crm',
    }),
    row('ledger', {
        business_functions: ['finance', 'sales'], industries: [],
        solution_type: 'connector', category: 'finance',
    }),
    row('legacy', { category: 'crm' }),
];

let fetchCalls: string[];

beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
        const url = String(input);
        fetchCalls.push(url);
        if (url === `${PUBLIC_BASE}/packages.json`) {
            return new Response(JSON.stringify({
                success: true,
                data: { items: ROWS, total: ROWS.length, limit: 100, offset: 0 },
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.startsWith(CLOUD)) {
            return new Response(JSON.stringify({ success: true, data: { items: [], total: 0 } }), {
                status: 200, headers: { 'content-type': 'application/json' },
            });
        }
        return new Response('not found', { status: 404 });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function list(query: string, opts: { publicBase?: string } = { publicBase: PUBLIC_BASE }) {
    const plugin = new MarketplaceProxyPlugin({
        controlPlaneUrl: CLOUD,
        cacheDisabled: true,
        publicMarketplaceBaseUrl: opts.publicBase ?? '',
    });
    const handler = await captureHandler(plugin);
    return handler(fakeCtx('GET', `${LIST}${query}`), async () => 'NEXT');
}

async function listIds(query: string): Promise<{ ids: string[]; total: number; limit: number; offset: number }> {
    const res: Response = await list(query);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    return {
        ids: body.data.items.map((r: any) => r.id),
        total: body.data.total,
        limit: body.data.limit,
        offset: body.data.offset,
    };
}

describe('catalog list — facet filters on the public snapshot', () => {
    it('ORs the values inside one facet', async () => {
        const { ids, total } = await listIds('?businessFunctions=marketing,finance');
        expect(ids).toEqual(['crm', 'ledger']);
        expect(total).toBe(2);
    });

    it('ANDs across facets', async () => {
        const { ids } = await listIds('?businessFunctions=sales,customer_service&industries=logistics');
        expect(ids).toEqual(['helpdesk']);
    });

    it('reads a row with no solution type as the spec default (app) and no maturity as stable', async () => {
        expect((await listIds('?solutionTypes=app')).ids).toEqual(['crm', 'legacy']);
        expect((await listIds('?solutionTypes=template,connector')).ids).toEqual(['helpdesk', 'ledger']);
        expect((await listIds('?maturity=beta')).ids).toEqual(['helpdesk']);
        expect((await listIds('?maturity=stable')).ids).toEqual(['crm', 'ledger', 'legacy']);
    });

    it('a row without the taxonomy columns passes no business-function or industry filter', async () => {
        expect((await listIds('?businessFunctions=sales')).ids).toEqual(['crm', 'ledger']);
        expect((await listIds('?industries=retail')).ids).toEqual(['crm', 'helpdesk']);
    });

    it('folds repeats and trims values', async () => {
        expect((await listIds('?businessFunctions=%20sales%20,sales,')).ids).toEqual(['crm', 'ledger']);
    });

    it('combines with q and pages the filtered set on the server', async () => {
        const page = await listIds('?businessFunctions=sales,customer_service,finance&limit=2&offset=1');
        expect(page).toEqual({ ids: ['helpdesk', 'ledger'], total: 3, limit: 2, offset: 1 });
        expect((await listIds('?q=help&industries=retail')).ids).toEqual(['helpdesk']);
    });
});

describe('catalog list — the retired ?category= filter', () => {
    it('is refused with the spec prescription, before either path is asked', async () => {
        const res: any = await list('?category=crm');
        expect(res.__status).toBe(400);
        expect(res.__body?.success).toBe(false);
        expect(res.__body?.error?.code).toBe('VALIDATION_ERROR');
        expect(res.__body?.error?.message).toContain(retiredCategoryGuidance('MarketplaceSearchRequest.category'));
        expect(fetchCalls).toEqual([]);
    });

    it('is refused beside a filter the door reads, and on the cloud-only configuration', async () => {
        const beside: any = await list('?category=finance&solutionTypes=app,template');
        expect(beside.__status).toBe(400);
        expect(beside.__body?.error?.code).toBe('VALIDATION_ERROR');
        const cloudOnly: any = await list('?category=', { publicBase: '' });
        expect(cloudOnly.__status).toBe(400);
        expect(cloudOnly.__body?.error?.code).toBe('VALIDATION_ERROR');
        expect(fetchCalls).toEqual([]);
    });
});

describe('catalog list — refused facets', () => {
    const refusal = async (query: string, opts?: { publicBase?: string }) => {
        const res: any = await list(query, opts);
        expect(res.__status).toBe(400);
        expect(res.__body?.success).toBe(false);
        expect(res.__body?.error?.code).toBe('VALIDATION_ERROR');
        return String(res.__body?.error?.message);
    };

    it('refuses a value the spec does not declare for the facet, naming it', async () => {
        expect(await refusal('?businessFunctions=sales,crm')).toContain('"crm"');
        await refusal('?industries=Retail');
        await refusal('?solutionTypes=theme');
        await refusal('?maturity=preview');
        expect(fetchCalls).toEqual([]);
    });

    it('refuses a facet supplied twice instead of choosing one occurrence', async () => {
        expect(await refusal('?businessFunctions=sales&businessFunctions=marketing')).toContain('2 times');
        await refusal('?maturity=beta&maturity=stable');
    });

    it('refuses a facet that names no value', async () => {
        await refusal('?industries=');
        await refusal('?solutionTypes=,');
    });

    it('refuses the same way when only the cloud path is configured', async () => {
        await refusal('?businessFunctions=crm', { publicBase: '' });
        expect(fetchCalls).toEqual([]);
    });
});

describe('catalog list — cloud path', () => {
    it('forwards the facet query to the cloud verbatim', async () => {
        const query = '?businessFunctions=sales,finance&solutionTypes=template&maturity=beta&limit=20';
        const res: Response = await list(query, { publicBase: '' });
        expect(res.status).toBe(200);
        expect(fetchCalls).toEqual([`${CLOUD}${LIST}${query}`]);
    });
});
