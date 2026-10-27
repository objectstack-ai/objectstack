// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { draftEnvelopeDiagnostics, editedItemDiagnostics, withServerOnlyErrors } from './draftVerdict';

const refused = {
  valid: false,
  errors: [{ path: 'edges.1.condition', message: 'invalid CEL predicate', code: 'expression-invalid' }],
};

describe('draftVerdict (objectstack#26707)', () => {
  it('reads `_diagnostics` off a served draft envelope, before the strip', () => {
    expect(draftEnvelopeDiagnostics({ type: 'flow', name: 'f', item: { name: 'f', _draft: true, _diagnostics: refused } })).toBe(refused);
    expect(draftEnvelopeDiagnostics({ type: 'flow', name: 'f', item: { name: 'f' } })).toBeUndefined();
    expect(draftEnvelopeDiagnostics(null)).toBeUndefined();
  });

  it('a pending draft is judged by its own verdict; without one the layered verdict stands', () => {
    const layered = { _diagnostics: { valid: true } };
    expect(editedItemDiagnostics({ hasDraft: true, draftDiagnostics: refused, layered })).toBe(refused);
    expect(editedItemDiagnostics({ hasDraft: false, draftDiagnostics: refused, layered })).toEqual({ valid: true });
    expect(editedItemDiagnostics({ hasDraft: true, draftDiagnostics: undefined, layered })).toEqual({ valid: true });
  });

  it('adds the server errors the client parse did not raise, once', () => {
    const client = [{ path: 'label', message: 'Required' }];
    const server = [{ path: 'label', message: 'Required' }, ...refused.errors];
    expect(withServerOnlyErrors(client, server)).toEqual([client[0], refused.errors[0]]);
    expect(withServerOnlyErrors(client, undefined)).toEqual(client);
  });
});
