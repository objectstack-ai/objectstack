// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog list door (`GET /api/v1/marketplace/packages`) filters by the
 * spec's taxonomy facets on the server — `businessFunctions`, `industries`,
 * `solutionTypes` (each one comma-separated value) and `maturity` — OR inside a
 * facet, AND across, and pages the filtered set. The retired `?category=`
 * filter is gone: the parameter is read as no filter, like any parameter the
 * door does not know. A facet the catalog cannot answer is refused before
 * either path (public snapshot or cloud) is asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceProxyPlugin } from './marketplace-proxy-plugin.js';

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

function fakeCtx(path: string) {
    return {
        req: { url: `http://env.test${path}`, method: 'GET', header: () => undefined, raw: {} },
        json: (body: any, status: number) => ({ __status: status, __body: body }),
    };
}

async function list(query: string, opts: { publicBase?: string } = { publicBase: PUBLIC_BASE }) {
    const plugin = new MarketplaceProxyPlugin({
        controlPlaneUrl: CLOUD,
        cacheDisabled: true,
        publicMarketplaceBaseUrl: opts.publicBase ?? '',
    });
    const handler = await captureHandler(plugin);
    return handler(fakeCtx(`${LIST}${query}`), async () => 'NEXT');
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
    it('is no filter: the snapshot is served whole', async () => {
        const res: Response = await list('?category=crm');
        expect(res.status).toBe(200);
        expect(res.headers.get('x-cache')).toBe('PUBLIC-R2');
        const body: any = await res.json();
        expect(body.data.items.map((r: any) => r.id)).toEqual(['crm', 'helpdesk', 'ledger', 'legacy']);
    });

    it('narrows nothing beside a filter that does', async () => {
        const { ids, total } = await listIds('?category=finance&solutionTypes=app,template');
        expect(ids).toEqual(['crm', 'helpdesk', 'legacy']);
        expect(total).toBe(3);
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
