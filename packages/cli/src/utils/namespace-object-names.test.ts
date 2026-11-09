// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D6, child K] `findNamespaceObjectNameRefusals` — the walk `os
 * validate` and `os build` hand the spec's predicate
 * (`findNamespaceObjectNameClashes`) over: every namespace and every object
 * one artifact holds, as one incoming catalogue.
 *
 * Each row's message is asserted EQUAL to the predicate's sentence for the
 * same holders — never re-spelled.
 */

import { describe, expect, it } from 'vitest';
import { findNamespaceObjectNameClashes } from '@objectstack/spec/kernel';
import { findNamespaceObjectNameRefusals } from './namespace-object-names.js';

const object = (name: string) => ({ name, label: name, fields: {} });
const body = (id: string, namespace: string, objects: string[] = []) => ({
  id,
  name: id.split('.').pop(),
  version: '1.0.0',
  type: 'app',
  namespace,
  objects: objects.map(object),
});

describe('findNamespaceObjectNameRefusals', () => {
  it('a body\'s namespace equal to another body\'s object is refused, naming both, in the predicate\'s words', () => {
    const rows = findNamespaceObjectNameRefusals({
      packages: [{ manifest: body('com.x.alpha', 'crm', ['crm_lead']) }, { manifest: body('com.x.beta', 'crm_lead') }],
    });
    const [expected] = findNamespaceObjectNameClashes({
      namespaces: [{ namespace: 'crm_lead', packageId: 'com.x.beta' }],
      objects: [{ name: 'crm_lead', namespace: 'crm', packageId: 'com.x.alpha' }],
    });
    expect(rows).toEqual([expected]);
  });

  it('is refused whichever body comes first (both directions inside one artifact)', () => {
    const rows = findNamespaceObjectNameRefusals({
      packages: [{ manifest: body('com.x.beta', 'crm_lead') }, { manifest: body('com.x.alpha', 'crm', ['crm_lead']) }],
    });
    expect(rows.map((r) => [r.kind, r.namespace, r.objectName])).toEqual([['namespace-equals-object', 'crm_lead', 'crm_lead']]);
  });

  it('a stack with no packages[] shipping an object short-named `custom` is refused', () => {
    const rows = findNamespaceObjectNameRefusals({
      manifest: { id: 'com.x.alpha', namespace: 'crm', version: '1.0.0', type: 'app' },
      objects: [object('crm_account'), object('crm_custom')],
    });
    expect(rows.map((r) => [r.kind, r.objectName])).toEqual([['object-short-named-custom', 'crm_custom']]);
  });

  it('a body\'s object short-named `custom` is refused, in the body\'s own namespace', () => {
    const rows = findNamespaceObjectNameRefusals({ packages: [{ manifest: body('com.x.hr', 'hr', ['hr_custom']) }] });
    expect(rows.map((r) => [r.kind, r.objectName])).toEqual([['object-short-named-custom', 'hr_custom']]);
  });

  it('a stack\'s top-level object equal to one body\'s namespace is refused', () => {
    const rows = findNamespaceObjectNameRefusals({
      manifest: { id: 'com.x.release', namespace: 'crm', version: '1.0.0', type: 'app' },
      packages: [{ manifest: body('com.x.beta', 'crm_lead') }],
      objects: [object('crm_lead')],
    });
    expect(rows.map((r) => [r.namespace, r.objectName])).toEqual([['crm_lead', 'crm_lead']]);
  });

  it('CONTROL — distinct namespaces and objects, an object only STARTING with a namespace, and `NS_custom_*` pass', () => {
    expect(findNamespaceObjectNameRefusals({
      packages: [
        { manifest: body('com.x.alpha', 'crm', ['crm_lead_note', 'crm_custom_field']) },
        { manifest: body('com.x.beta', 'crm_lead', ['crm_lead_x']) },
      ],
    })).toEqual([]);
    expect(findNamespaceObjectNameRefusals({
      manifest: { id: 'com.x.alpha', namespace: 'crm', version: '1.0.0', type: 'app' },
      objects: [object('crm_account')],
    })).toEqual([]);
  });

  it('CONTROL — a stack with no namespace and no objects judges nothing', () => {
    expect(findNamespaceObjectNameRefusals({})).toEqual([]);
  });
});
