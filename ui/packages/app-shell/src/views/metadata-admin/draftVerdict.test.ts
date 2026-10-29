// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  draftEnvelopeDiagnostics,
  editedItemDiagnostics,
  serverHoldAt,
  valueAtPath,
  withServerOnlyErrors,
} from './draftVerdict';

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

describe('serverHoldAt — a verdict holds only the text it judged (objectstack#27482)', () => {
  const USING = 'f_total > 5';
  const judged = { name: 'sales_perms', rowLevelSecurity: [{ name: 'hot', using: USING }] };
  const diagnostics = {
    valid: false,
    errors: [{ path: 'rowLevelSecurity.0.using', message: 'cannot filter on f_total', code: 'rls-predicate-unenforceable' }],
  };

  it('reads a dotted path through arrays and objects, and answers undefined off the body', () => {
    expect(valueAtPath(judged, 'rowLevelSecurity.0.using')).toBe(USING);
    expect(valueAtPath(judged, 'rowLevelSecurity.1.using')).toBeUndefined();
    expect(valueAtPath(judged, 'rowLevelSecurity.x.using')).toBeUndefined();
    expect(valueAtPath(judged, 'name.length')).toBeUndefined();
  });

  it('holds on the judged text, and not on any other', () => {
    expect(serverHoldAt(diagnostics, judged, 'rowLevelSecurity.0.using', USING)).toEqual(diagnostics.errors);
    expect(serverHoldAt(diagnostics, judged, 'rowLevelSecurity.0.using', 'f_total > 7')).toEqual([]);
  });

  it('holds nothing without a judged body, a path, or an error at that exact path', () => {
    expect(serverHoldAt(diagnostics, undefined, 'rowLevelSecurity.0.using', USING)).toEqual([]);
    expect(serverHoldAt(diagnostics, judged, undefined, USING)).toEqual([]);
    expect(serverHoldAt(diagnostics, judged, 'rowLevelSecurity.0.check', '')).toEqual([]);
    expect(serverHoldAt({ valid: true }, judged, 'rowLevelSecurity.0.using', USING)).toEqual([]);
  });

  it('reads an absent judged value as the empty text an editor shows', () => {
    const atCheck = { valid: false, errors: [{ path: 'rowLevelSecurity.0.check', message: 'needed' }] };
    expect(serverHoldAt(atCheck, judged, 'rowLevelSecurity.0.check', '')).toEqual(atCheck.errors);
  });
});
