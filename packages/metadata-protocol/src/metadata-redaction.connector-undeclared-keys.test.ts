// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The write-path inverse of the connector read projection, for the keys a
// connector does not declare: a save of the served form keeps what the read
// withheld (top level, `retryConfig`, and an `actions` element addressed by
// its `key`), and a container the author removed is never minted back.
//
// Every value below is an obviously-fake placeholder.

import { describe, it, expect } from 'vitest';
import {
  carryForwardRedactedValues,
  carryForwardRedactedValuesReportingDrops,
  redactMetadataItem,
  redactedPathsCarriedForward,
} from './metadata-redaction.js';

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

  it('a malformed `retryConfig` or `actions` withheld whole is kept at rest by a save of the served form', () => {
    const malformed = { ...stored, retryConfig: P(4), actions: [stored.actions[0], P(5)] };
    const body = JSON.parse(JSON.stringify(redactMetadataItem('connector', malformed))) as Record<string, any>;
    expect(body).not.toHaveProperty('retryConfig');
    expect(body).not.toHaveProperty('actions');
    expect(JSON.stringify(body)).not.toContain('TEST_PLACEHOLDER_UNDECLARED_');
    const out = carryForwardRedactedValues('connector', { ...body, label: 'Vendor catalog (edited)' }, malformed);
    expect(out).toEqual({ ...malformed, label: 'Vendor catalog (edited)' });
  });
});

// [#28640 ②B] An undeclared `auth` key is withheld AND not carried forward: a
// save of the served form drops it, and the drop is reported.
describe('an undeclared `auth` key is not carried forward', () => {
  const legacy = {
    name: 'vendor_catalog',
    label: 'Vendor catalog',
    type: 'api',
    provider: 'rest',
    apiKey: P(1),
    providerConfig: { baseUrl: 'https://api.vendor.example/v1', headers: { Authorization: P(6) } },
    auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', token: P(7) },
  };
  const servedLegacy = () => JSON.parse(JSON.stringify(redactMetadataItem('connector', legacy))) as Record<string, any>;

  it('the save drops it, names it, and still carries every other withheld position (undeclared root key, header map)', () => {
    const { item, dropped } = carryForwardRedactedValuesReportingDrops('connector', servedLegacy(), legacy);
    expect(item).toEqual({ ...legacy, auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN' } });
    expect(dropped).toEqual(['auth.token']);
    expect(carryForwardRedactedValues('connector', servedLegacy(), legacy)).toEqual(item);
  });

  it('the runtime gate is never told it will be restored', () => {
    expect(redactedPathsCarriedForward('connector', servedLegacy(), legacy).sort())
      .toEqual(['apiKey', 'providerConfig.headers']);
  });

  it('a value the incoming body holds at that position is the author\'s word, not a drop', () => {
    // `headerName` is undeclared on `bearer` and declared on `api-key`: the
    // author switched kinds and wrote it.
    const atRest = { ...legacy, auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN', headerName: P(8) } };
    const body = JSON.parse(JSON.stringify(redactMetadataItem('connector', atRest))) as Record<string, any>;
    expect(body.auth).toEqual({ type: 'bearer', credentialRef: 'VENDOR_TOKEN' });
    body.auth = { type: 'api-key', credentialRef: 'VENDOR_KEY', headerName: 'X-Key' };
    const { item, dropped } = carryForwardRedactedValuesReportingDrops('connector', body, atRest);
    expect(dropped).toEqual([]);
    expect((item as Record<string, any>).auth).toEqual({ type: 'api-key', credentialRef: 'VENDOR_KEY', headerName: 'X-Key' });
  });

  it('a body that removes `auth` drops it too, and says so', () => {
    const body = servedLegacy();
    delete body.auth;
    const { item, dropped } = carryForwardRedactedValuesReportingDrops('connector', body, legacy);
    expect(item).not.toHaveProperty('auth');
    expect(dropped).toEqual(['auth.token']);
  });

  it('CONTROL: a row with no undeclared `auth` key reports no drop', () => {
    const { dropped } = carryForwardRedactedValuesReportingDrops('connector', served(), stored);
    expect(dropped).toEqual([]);
  });
});
