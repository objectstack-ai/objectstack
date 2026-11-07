// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ruling 6677709817, step (c): `historySnapshotBody` drops exactly the
 * positions the type's redactor names in `notCarriedForwardKeys`, reading that
 * answer from the redactor itself (one predicate with the save's drain), and
 * hands every other body back by reference.
 *
 * The placeholders below are fixture strings, not credentials.
 */

import { describe, it, expect } from 'vitest';
import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import { historySnapshotBody } from './history-snapshot-body.js';

const LEGACY_AUTH_VALUE = 'TEST_PLACEHOLDER_LEGACY_AUTH_VALUE';

function connector(auth: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { name: 'vendor_api', label: 'Vendor API', type: 'api', provider: 'rest', auth, ...extra };
}

describe('[ruling 6677709817 (c)] historySnapshotBody', () => {
  it('drops each position the connector redactor marks not carried forward, and nothing else', () => {
    const body = connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', token: LEGACY_AUTH_VALUE });
    // The predicate is the redactor's: pin that it names this position, so the
    // drop below is the shared answer and not a copy of it.
    expect(getMetadataTypeRedactor('connector')!(body).notCarriedForwardKeys).toEqual(['auth.token']);

    const out = historySnapshotBody('connector', body);
    expect(out).toEqual(connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' }));
    // The input is not mutated: the live row is written from it.
    expect(body.auth).toHaveProperty('token', LEGACY_AUTH_VALUE);
  });

  it('reads the plural spelling the same way', () => {
    const body = connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', token: LEGACY_AUTH_VALUE });
    expect(historySnapshotBody('connectors', body)).toEqual(historySnapshotBody('connector', body));
  });

  it('drops an undeclared `auth` key whose own name carries a dot', () => {
    const body = connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', 'legacy.token': LEGACY_AUTH_VALUE });
    expect(historySnapshotBody('connector', body)).toEqual(connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' }));
  });

  it('drops a cleared undeclared `auth` key too (the save drains it whatever it holds)', () => {
    const body = connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', token: null });
    expect(historySnapshotBody('connector', body)).toEqual(connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' }));
  });

  it('drops an undeclared key inside an object `retryConfig`, the other position the save drains', () => {
    const body = connector(
      { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' },
      { retryConfig: { maxAttempts: 3, legacyKey: 'x' } },
    );
    const positions = getMetadataTypeRedactor('connector')!(body).notCarriedForwardKeys;
    expect(positions).toEqual(['retryConfig.legacyKey']);
    expect(historySnapshotBody('connector', body)).toEqual(
      connector({ type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' }, { retryConfig: { maxAttempts: 3 } }),
    );
  });

  it('CONTROL: a connector with nothing not-carried-forward comes back by reference', () => {
    // A declared credential position (a header map, withheld on read and
    // carried forward on save) is not a drained one.
    const body = connector(
      { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' },
      { providerConfig: { baseUrl: 'https://api.vendor.example/v1', headers: { Authorization: 'Bearer x' } } },
    );
    expect(historySnapshotBody('connector', body)).toBe(body);
  });

  it('CONTROL: a type with no such redactor answer comes back by reference', () => {
    const object = { name: 'invoice', fields: { token: { type: 'text' } } };
    expect(historySnapshotBody('object', object)).toBe(object);
    const datasource = { name: 'warehouse', driver: 'postgres', config: { password: 'x' } };
    expect(historySnapshotBody('datasource', datasource)).toBe(datasource);
  });

  it('CONTROL: a non-object body comes back as it is', () => {
    expect(historySnapshotBody('connector', null)).toBeNull();
    const list = [1, 2];
    expect(historySnapshotBody('connector', list)).toBe(list);
  });
});
