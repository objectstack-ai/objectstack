// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The write-path inverse of the connector read projection, for the keys a
// connector does not declare: a save of the served form keeps what the read
// withheld (top level, `retryConfig`, and an `actions` element addressed by
// its `key`), and a container the author removed is never minted back.
//
// Every value below is an obviously-fake placeholder.

import { describe, it, expect } from 'vitest';
import { carryForwardRedactedValues, redactMetadataItem } from './metadata-redaction.js';

const P = (n: number) => `TEST_PLACEHOLDER_UNDECLARED_${n}`;

const stored = {
  name: 'vendor_catalog',
  label: 'Vendor catalog',
  type: 'api',
  apiKey: P(1),
  retryConfig: { strategy: 'exponential_backoff', secret: P(2) },
  actions: [
    { key: 'get_invoice', label: 'Get invoice', token: P(3) },
    { key: 'list_invoices', label: 'List invoices' },
  ],
};

/** What a read exit serves for `stored`: the projection, as a client would send it back. */
const served = () => JSON.parse(JSON.stringify(redactMetadataItem('connector', stored))) as Record<string, any>;

describe('carry-forward of the keys a connector does not declare', () => {
  it('the served form withholds them (positive control for every case below)', () => {
    const body = served();
    expect(JSON.stringify(body)).not.toContain('TEST_PLACEHOLDER_UNDECLARED_');
    expect(body.retryConfig).toEqual({ strategy: 'exponential_backoff' });
    expect(body.actions[0]).toEqual({ key: 'get_invoice', label: 'Get invoice' });
  });

  it('a save of the served form keeps every withheld value, the edited label included', () => {
    const out = carryForwardRedactedValues('connector', { ...served(), label: 'Vendor catalog (edited)' }, stored);
    expect(out).toEqual({ ...stored, label: 'Vendor catalog (edited)' });
  });

  it('an `actions` element is followed by its `key` when the author reorders the list', () => {
    const body = served();
    body.actions.reverse();
    const out = carryForwardRedactedValues('connector', body, stored) as Record<string, any>;
    expect(out.actions).toEqual([
      { key: 'list_invoices', label: 'List invoices' },
      { key: 'get_invoice', label: 'Get invoice', token: P(3) },
    ]);
  });

  it('the author\'s own value at a withheld nested position wins', () => {
    const body = served();
    body.retryConfig.secret = 'author-value';
    const out = carryForwardRedactedValues('connector', body, stored) as Record<string, any>;
    expect(out.retryConfig.secret).toBe('author-value');
  });

  it('a removed `retryConfig` or `actions` element is not minted back', () => {
    const body = served();
    delete body.retryConfig;
    body.actions = body.actions.filter((a: { key: string }) => a.key !== 'get_invoice');
    const out = carryForwardRedactedValues('connector', body, stored) as Record<string, any>;
    expect(out).not.toHaveProperty('retryConfig');
    expect(out.actions).toEqual([{ key: 'list_invoices', label: 'List invoices' }]);
    expect(out.apiKey).toBe(P(1));
  });

  it('two `actions` elements sharing a `key` cannot be told apart: neither is carried', () => {
    const twin = { ...stored, actions: [stored.actions[0], { key: 'get_invoice', label: 'Twin' }] };
    const body = JSON.parse(JSON.stringify(redactMetadataItem('connector', twin)));
    const out = carryForwardRedactedValues('connector', body, twin) as Record<string, any>;
    expect(JSON.stringify(out.actions)).not.toContain(P(3));
  });
});
