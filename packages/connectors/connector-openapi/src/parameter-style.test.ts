// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A parameter value is sent by the `style` / `explode` its OpenAPI 3.x
// Parameter Object declares (or its location's default) — never through
// `String()`, which sent an object as `[object Object]` and an array as a comma
// list whatever the document said. Each case asserts the exact URL the
// upstream received, recorded by a fake `fetchImpl`.

import { describe, it, expect } from 'vitest';
import { createOpenApiConnector, type OpenApiDocument, type OpenApiParameter } from './openapi-connector.js';
import { createOpenApiProviderFactory } from './openapi-provider.js';
import { ParameterValueError } from './parameter-serialization.js';

/**
 * `GET /v1/invoices` (GetInvoices) with five of its query parameters, each
 * Parameter Object copied verbatim from Stripe's OpenAPI document
 * (`stripe/openapi` `spec3.json`, MIT License, Copyright (c) 2011- Stripe,
 * Inc.), as packaged by the Stripe connector app — `created` / `due_date`
 * (`deepObject`, an object of range bounds or an integer), `expand`
 * (`deepObject` on an array) and the scalar `customer` / `limit` (`form`).
 */
const STRIPE_INVOICE_PARAMETERS: OpenApiParameter[] = [
    {
        description: 'Only return invoices that were created during the given date interval.',
        explode: true,
        in: 'query',
        name: 'created',
        required: false,
        schema: {
            anyOf: [
                {
                    properties: { gt: { type: 'integer' }, gte: { type: 'integer' }, lt: { type: 'integer' }, lte: { type: 'integer' } },
                    title: 'range_query_specs',
                    type: 'object',
                },
                { type: 'integer' },
            ],
        },
        style: 'deepObject',
    },
    {
        description: 'Only return invoices for the customer specified by this customer ID.',
        in: 'query',
        name: 'customer',
        required: false,
        schema: { maxLength: 5000, type: 'string' },
        style: 'form',
    },
    {
        explode: true,
        in: 'query',
        name: 'due_date',
        required: false,
        schema: {
            anyOf: [
                {
                    properties: { gt: { type: 'integer' }, gte: { type: 'integer' }, lt: { type: 'integer' }, lte: { type: 'integer' } },
                    title: 'range_query_specs',
                    type: 'object',
                },
                { type: 'integer' },
            ],
        },
        style: 'deepObject',
    },
    {
        description: 'Specifies which fields in the response should be expanded.',
        explode: true,
        in: 'query',
        name: 'expand',
        required: false,
        schema: { items: { maxLength: 5000, type: 'string' }, type: 'array' },
        style: 'deepObject',
    },
    {
        description: 'A limit on the number of objects to be returned. Limit can range between 1 and 100, and the default is 10.',
        in: 'query',
        name: 'limit',
        required: false,
        schema: { type: 'integer' },
        style: 'form',
    },
];

const stripe: OpenApiDocument = {
    openapi: '3.0.0',
    info: { title: 'Stripe API' },
    servers: [{ url: 'https://api.stripe.com/' }],
    paths: {
        '/v1/invoices': { get: { operationId: 'GetInvoices', parameters: STRIPE_INVOICE_PARAMETERS } },
    },
};

/** A fake fetch that records every URL and header set it was asked to send. */
function recordingFetch() {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: init.headers ?? {} });
        return {
            status: 200,
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({}),
            text: async () => '{}',
        };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
}

async function urlFor(doc: OpenApiDocument, action: string, input: Record<string, unknown>): Promise<string> {
    const { calls, fetchImpl } = recordingFetch();
    const { handlers } = createOpenApiConnector({ document: doc, fetchImpl });
    await handlers[action](input, {});
    expect(calls).toHaveLength(1);
    return calls[0].url;
}

describe('Stripe list parameters — deepObject is sent as the document declares', () => {
    it('a `created` range object goes out bracketed, not as [object Object]', async () => {
        expect(await urlFor(stripe, 'GetInvoices', { query: { created: { gte: 1700000000 } } })).toBe(
            'https://api.stripe.com/v1/invoices?created%5Bgte%5D=1700000000',
        );
    });

    it('an `expand` array goes out one bracketed index per element, not as a comma list', async () => {
        expect(await urlFor(stripe, 'GetInvoices', { query: { expand: ['data.customer', 'data.subscription'] } })).toBe(
            'https://api.stripe.com/v1/invoices?expand%5B0%5D=data.customer&expand%5B1%5D=data.subscription',
        );
    });

    it('a `due_date` range with two bounds goes out as two bracketed pairs, in order', async () => {
        expect(await urlFor(stripe, 'GetInvoices', { query: { due_date: { gte: 1700000000, lt: 1702592000 } } })).toBe(
            'https://api.stripe.com/v1/invoices?due_date%5Bgte%5D=1700000000&due_date%5Blt%5D=1702592000',
        );
    });

    it('control: scalar values are sent exactly as before — `form` pairs, and an integer under deepObject', async () => {
        expect(await urlFor(stripe, 'GetInvoices', { query: { customer: 'cus 123/&', limit: 10, created: 1700000000 } })).toBe(
            'https://api.stripe.com/v1/invoices?customer=cus+123%2F%26&limit=10&created=1700000000',
        );
    });
});

/** One operation per location under test, each parameter given the style the case reads. */
function docWith(path: string, parameters: OpenApiParameter[]): OpenApiDocument {
    return {
        openapi: '3.0.3',
        info: { title: 'Styles' },
        servers: [{ url: 'https://api.example.com' }],
        paths: { [path]: { get: { operationId: 'op', parameters } } },
    };
}

describe('query styles', () => {
    it('`form` defaults to explode: an undeclared style repeats the name per array element', async () => {
        const doc = docWith('/items', [{ name: 'id', in: 'query', schema: { type: 'array', items: { type: 'string' } } }]);
        expect(await urlFor(doc, 'op', { query: { id: ['a', 'b'] } })).toBe('https://api.example.com/items?id=a&id=b');
    });

    it('`form` with explode false joins an array and an object with commas', async () => {
        const doc = docWith('/items', [
            { name: 'id', in: 'query', style: 'form', explode: false },
            { name: 'color', in: 'query', style: 'form', explode: false },
        ]);
        expect(await urlFor(doc, 'op', { query: { id: ['a', 'b'], color: { R: 100, G: 200 } } })).toBe(
            'https://api.example.com/items?id=a%2Cb&color=R%2C100%2CG%2C200',
        );
    });

    it('exploded `form` sends an object as one pair per key', async () => {
        const doc = docWith('/items', [{ name: 'color', in: 'query' }]);
        expect(await urlFor(doc, 'op', { query: { color: { R: 100, G: 200 } } })).toBe('https://api.example.com/items?R=100&G=200');
    });

    it('`spaceDelimited` and `pipeDelimited` join an array with their delimiter', async () => {
        const doc = docWith('/items', [
            { name: 's', in: 'query', style: 'spaceDelimited', explode: false },
            { name: 'p', in: 'query', style: 'pipeDelimited', explode: false },
        ]);
        expect(await urlFor(doc, 'op', { query: { s: ['a', 'b'], p: ['a', 'b'] } })).toBe('https://api.example.com/items?s=a+b&p=a%7Cb');
    });

    it('a static api-key query credential still replaces an input pair of the same name', async () => {
        const doc = docWith('/items', [{ name: 'q', in: 'query' }]);
        const { calls, fetchImpl } = recordingFetch();
        const { handlers } = createOpenApiConnector({ document: doc, fetchImpl, auth: { type: 'api-key', key: 'k1', paramName: 'key' } });
        await handlers.op({ query: { q: ['x', 'y'], key: 'forged' } }, {});
        expect(calls[0].url).toBe('https://api.example.com/items?q=x&q=y&key=k1');
    });
});

describe('path and header styles', () => {
    it('`simple` path values keep the comma delimiter literal and encode each element', async () => {
        const doc = docWith('/items/{ids}', [{ name: 'ids', in: 'path', required: true }]);
        expect(await urlFor(doc, 'op', { path: { ids: ['a/1', 'b'] } })).toBe('https://api.example.com/items/a%2F1,b');
    });

    it('`label` and `matrix` path values follow the style table', async () => {
        const doc = docWith('/a/{l}/b/{m}', [
            { name: 'l', in: 'path', required: true, style: 'label', explode: true },
            { name: 'm', in: 'path', required: true, style: 'matrix', explode: true },
        ]);
        expect(await urlFor(doc, 'op', { path: { l: ['x', 'y'], m: { R: 1, G: 2 } } })).toBe('https://api.example.com/a/.x.y/b/;R=1;G=2');
    });

    it('control: a scalar path value is encoded exactly as before', async () => {
        const doc = docWith('/items/{id}', [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
        expect(await urlFor(doc, 'op', { path: { id: 'a b/c' } })).toBe('https://api.example.com/items/a%20b%2Fc');
    });

    it('a `simple` header object goes out as key,value pairs, not [object Object]', async () => {
        const doc = docWith('/items', [
            { name: 'X-Flat', in: 'header' },
            { name: 'X-Exploded', in: 'header', explode: true },
        ]);
        const { calls, fetchImpl } = recordingFetch();
        const { handlers } = createOpenApiConnector({ document: doc, fetchImpl });
        await handlers.op({ header: { 'X-Flat': { a: 1, b: 2 }, 'X-Exploded': { a: 1, b: 2 } } }, {});
        expect(calls[0].headers).toMatchObject({ 'X-Flat': 'a,1,b,2', 'X-Exploded': 'a=1,b=2' });
    });
});

describe('refusals — never a guessed encoding', () => {
    it('a style OpenAPI 3.x does not define for the location refuses the operation at materialization', () => {
        const doc = docWith('/items/{id}', [{ name: 'id', in: 'path', required: true, style: 'deepObject' }]);
        // The named subjects — operation, location, parameter, style — not the prose.
        expect(() => createOpenApiConnector({ document: doc })).toThrow(/GET \/items\/\{id\} \(op\) path parameter 'id'.*"deepObject"/);
    });

    it('the declarative provider fails the boot on it, and an include that leaves the operation out clears it', async () => {
        const doc = {
            ...docWith('/items', [{ name: 'tags', in: 'header', style: 'form' }]),
            paths: {
                '/items': { get: { operationId: 'bad', parameters: [{ name: 'tags', in: 'header', style: 'form' }] } },
                '/ok': { get: { operationId: 'good' } },
            },
        };
        const factory = createOpenApiProviderFactory();
        const base = { name: 'styles', label: 'Styles', type: 'api' as const };
        await expect(Promise.resolve(factory({ ...base, providerConfig: { spec: doc } }))).rejects.toThrow(
            /\(bad\) header parameter 'tags'.*"form"/,
        );
        const bundle = await factory({ ...base, providerConfig: { spec: doc, include: ['good'] } });
        expect((bundle.def.actions ?? []).map((a) => a.key)).toEqual(['good']);
    });

    it('a value the declared style cannot carry fails the dispatch and sends nothing', async () => {
        const doc = docWith('/items', [{ name: 'f', in: 'query', style: 'form' }]);
        const { calls, fetchImpl } = recordingFetch();
        const { handlers } = createOpenApiConnector({ document: doc, fetchImpl });
        const refusal = await handlers.op({ query: { f: [{ a: 1 }] } }, {}).catch((err: unknown) => err);
        expect(refusal).toBeInstanceOf(ParameterValueError);
        expect((refusal as Error).message).toMatch(/query parameter 'f'/);
        expect(calls).toHaveLength(0);
    });

    it('a content-typed parameter sends a scalar as is and refuses an object', async () => {
        const doc = docWith('/items', [{ name: 'filter', in: 'query', content: { 'application/json': { schema: { type: 'object' } } } }]);
        expect(await urlFor(doc, 'op', { query: { filter: '{"a":1}' } })).toBe('https://api.example.com/items?filter=%7B%22a%22%3A1%7D');
        const { calls, fetchImpl } = recordingFetch();
        const { handlers } = createOpenApiConnector({ document: doc, fetchImpl });
        const refusal = await handlers.op({ query: { filter: { a: 1 } } }, {}).catch((err: unknown) => err);
        expect(refusal).toBeInstanceOf(ParameterValueError);
        expect((refusal as Error).message).toMatch(/query parameter 'filter'/);
        expect(calls).toHaveLength(0);
    });
});
