// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `useObject` / `useFields` read the `GET /meta/:type/:name` response as the
 * spec-declared `{ type, name, item }` envelope — on BOTH of the hook's fetch
 * branches (#5563).
 *
 * The hook has always had two: `useCache: true` (the default) goes through
 * `client.meta.getCached`, `useCache: false` through `client.meta.getItem`.
 * Both address the same route, but the route used to answer two different body
 * structures depending on the server's `enableCache` setting — the bare
 * metadata document on the cached path (the default), the envelope otherwise —
 * and this hook fed whichever it got into one `data` state. A component reading
 * `data.fields` therefore worked or silently read `undefined` according to a
 * server config it cannot see.
 *
 * These tests are shape-carrying on purpose: each asserts a value that lives
 * INSIDE `item`, so re-flattening the envelope (or the hook quietly unwrapping
 * it again) fails on the value, not merely on a key's presence.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { ObjectStackClient } from '@objectstack/client';
import { ObjectStackProvider } from './context';
import { useObject, useFields } from './metadata-hooks';

// `globals: false` in this package's vitest config, so testing-library's
// auto-cleanup never registers: without this the previous test's DOM is still
// mounted and `screen` matches two elements per test id.
afterEach(cleanup);

const CUSTOMER = {
    name: 'customer',
    label: 'Customer',
    fields: {
        id: { type: 'text', label: 'ID' },
        email: { type: 'email', label: 'Email' },
    },
};

/** The one body shape `GET /meta/object/customer` answers. */
const ENVELOPE = { type: 'object', name: 'customer', item: CUSTOMER, lock: 'none', editable: true };

function fakeClient() {
    const getCached = vi.fn(async () => ({
        data: ENVELOPE,
        etag: { value: 'W/"1"' },
        notModified: false,
    }));
    const getItem = vi.fn(async () => ENVELOPE);
    const client = {
        data: { find: vi.fn(), query: vi.fn() },
        meta: { getCached, getItem, getView: vi.fn() },
        events: {
            subscribeData: vi.fn(() => vi.fn()),
            subscribeBulkData: vi.fn(() => vi.fn()),
            subscribeMetadata: vi.fn(() => vi.fn()),
        },
        setLocale: vi.fn(),
    } as unknown as ObjectStackClient;
    return { client, getCached, getItem };
}

function mount(client: ObjectStackClient, Component: React.ComponentType) {
    return render(
        <ObjectStackProvider client={client}>
            <Component />
        </ObjectStackProvider>,
    );
}

describe('#5563 useObject surfaces the meta envelope on both fetch branches', () => {
    it('cached branch (the default): data is the envelope, the schema is under item', async () => {
        const { client, getCached } = fakeClient();
        mount(client, () => {
            const { data } = useObject('customer');
            if (!data) return null;
            return (
                <div>
                    <span data-testid="type">{data.type}</span>
                    <span data-testid="name">{data.name}</span>
                    <span data-testid="label">{data.item.label}</span>
                    <span data-testid="fields">{Object.keys(data.item.fields).join(',')}</span>
                    <span data-testid="flat-label">{String(data.label)}</span>
                </div>
            );
        });

        await waitFor(() => expect(screen.getByTestId('label')).toBeTruthy());
        expect(getCached).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('type').textContent).toBe('object');
        expect(screen.getByTestId('name').textContent).toBe('customer');
        // The document's own values are reachable only through `item`.
        expect(screen.getByTestId('label').textContent).toBe('Customer');
        expect(screen.getByTestId('fields').textContent).toBe('id,email');
        expect(screen.getByTestId('flat-label').textContent).toBe('undefined');
    });

    it('uncached branch answers the identical shape — the two no longer disagree', async () => {
        const { client, getItem, getCached } = fakeClient();
        mount(client, () => {
            const { data } = useObject('customer', { useCache: false });
            if (!data) return null;
            return (
                <div>
                    <span data-testid="type">{data.type}</span>
                    <span data-testid="label">{data.item.label}</span>
                </div>
            );
        });

        await waitFor(() => expect(screen.getByTestId('label')).toBeTruthy());
        expect(getItem).toHaveBeenCalledWith('object', 'customer');
        expect(getCached).not.toHaveBeenCalled();
        expect(screen.getByTestId('type').textContent).toBe('object');
        expect(screen.getByTestId('label').textContent).toBe('Customer');
    });

    it('useFields reaches through the envelope to the document`s field map', async () => {
        const { client } = fakeClient();
        mount(client, () => {
            const { data } = useFields('customer');
            if (!data) return null;
            return (
                <ul>
                    {data.map((f: any) => (
                        <li key={f.name} data-testid={`field-${f.name}`}>{f.label}:{f.type}</li>
                    ))}
                </ul>
            );
        });

        // A `useFields` that still read `data.fields` off the envelope would
        // render nothing at all — `null`, forever — so this waits on a real row.
        await waitFor(() => expect(screen.getByTestId('field-email')).toBeTruthy());
        expect(screen.getByTestId('field-id').textContent).toBe('ID:text');
        expect(screen.getByTestId('field-email').textContent).toBe('Email:email');
    });
});
