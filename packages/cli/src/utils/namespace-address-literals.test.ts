// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1] `findNamespaceAddressLiteralRefusals` — the walk `os
 * validate` and `os build` hand the spec's judge
 * (`validateNamespaceNotAddressLiteral`) over: every namespace one artifact
 * declares. Each row's message is asserted EQUAL to the judge's sentence for
 * the same namespace — never re-spelled.
 */

import { describe, expect, it } from 'vitest';
import { NAMESPACE_REFUSED_LITERALS, validateNamespaceNotAddressLiteral } from '@objectstack/spec/kernel';
import { findNamespaceAddressLiteralRefusals } from './namespace-address-literals.js';

const body = (id: string, namespace: string) => ({ id, name: id.split('.').pop(), version: '1.0.0', type: 'app', namespace });

describe('findNamespaceAddressLiteralRefusals', () => {
  it.each(NAMESPACE_REFUSED_LITERALS.map((literal) => [literal]))(
    'a stack whose manifest.namespace is `%s` is refused, in the judge\'s words',
    (literal) => {
      expect(findNamespaceAddressLiteralRefusals({ manifest: body('com.x.probe', literal) })).toEqual([
        { namespace: literal, packageId: 'com.x.probe', message: validateNamespaceNotAddressLiteral(literal) },
      ]);
    },
  );

  it('a packages[] body under a literal is refused, naming that body only', () => {
    const rows = findNamespaceAddressLiteralRefusals({
      manifest: body('com.x.release', 'crm'),
      packages: [{ manifest: body('com.x.alpha', 'crm') }, { manifest: body('com.x.hooks', 'hooks') }],
    });
    expect(rows.map((r) => [r.namespace, r.packageId])).toEqual([['hooks', 'com.x.hooks']]);
  });

  it('a literal declared by two bodies is one row', () => {
    const rows = findNamespaceAddressLiteralRefusals({
      packages: [{ manifest: body('com.x.one', 'trigger') }, { manifest: body('com.x.two', 'trigger') }],
    });
    expect(rows.map((r) => r.namespace)).toEqual(['trigger']);
  });

  it('CONTROL — `triggers`, `globals` and a stack with no namespace pass', () => {
    expect(findNamespaceAddressLiteralRefusals({
      manifest: body('com.x.release', 'triggers'),
      packages: [{ manifest: body('com.x.globals', 'globals') }],
    })).toEqual([]);
    expect(findNamespaceAddressLiteralRefusals({})).toEqual([]);
  });
});
