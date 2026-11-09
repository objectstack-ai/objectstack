// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D6, child K] `defineStack` refuses a namespace equal to an object
 * name, in either direction, and an object short-named `custom` (`NS_custom`)
 * — P's predicate (`findNamespaceObjectNameClashes`) over every namespace and
 * object ONE artifact holds: its own manifest and top-level objects, and each
 * `packages[]` body's. Each refusal is asserted to carry the predicate's own
 * sentence, never a re-spelling.
 *
 * Bound: packages outside the artifact (declared dependencies carry an id and a
 * range, never a namespace) are the install door's to judge, not this one's.
 */

import { describe, expect, it } from 'vitest';

import { defineStack } from './stack.zod';
import { findNamespaceObjectNameClashes } from './kernel/namespace-prefix';

const object = (name: string) => ({ name, label: name, fields: { title: { type: 'text' as const } } });

const body = (id: string, namespace: string, objects: string[] = []) => ({
  manifest: {
    id,
    name: id.split('.').pop()!,
    version: '1.0.0',
    type: 'module' as const,
    namespace,
    ...(objects.length > 0 ? { objects: objects.map(object) } : {}),
  },
});

const refusal = (config: unknown): (Error & { issues?: string[] }) | undefined => {
  try {
    defineStack(config as Parameters<typeof defineStack>[0], { strict: true });
    return undefined;
  } catch (e) {
    return e as Error & { issues?: string[] };
  }
};

describe('defineStack — a namespace never equals an object name', () => {
  it('a body\'s namespace equal to another body\'s object is refused, in the predicate\'s sentence', () => {
    const err = refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.alpha', 'crm', ['crm_lead']), body('com.x.beta', 'crm_lead')],
    });
    const [expected] = findNamespaceObjectNameClashes({
      namespaces: [{ namespace: 'crm_lead', packageId: 'com.x.beta' }],
      objects: [{ name: 'crm_lead', namespace: 'crm', packageId: 'com.x.alpha' }],
    });
    expect(err?.issues).toEqual([expected.message]);
    expect(err?.message).toContain("Namespace 'crm_lead' of package 'com.x.beta'");
    expect(err?.message).toContain("the object 'crm_lead' of package 'com.x.alpha'");
  });

  it('is refused whichever body comes first (both directions inside one artifact)', () => {
    const err = refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.beta', 'crm_lead'), body('com.x.alpha', 'crm', ['crm_lead'])],
    });
    expect(err?.issues).toHaveLength(1);
    expect(err?.issues?.[0]).toContain("'crm_lead'");
  });

  it('a top-level object equal to a body\'s namespace is refused', () => {
    const err = refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.beta', 'crm_lead')],
      objects: [object('crm_lead')],
    });
    expect(err?.issues).toHaveLength(1);
    expect(err?.issues?.[0]).toContain("Namespace 'crm_lead' of package 'com.x.beta'");
  });

  it('a stack shipping an object short-named `custom` is refused', () => {
    const err = refusal({
      manifest: { id: 'com.x.alpha', name: 'alpha', version: '1.0.0', type: 'app', namespace: 'crm' },
      objects: [object('crm_account'), object('crm_custom')],
    });
    const [expected] = findNamespaceObjectNameClashes({
      objects: [{ name: 'crm_custom', namespace: 'crm', packageId: 'com.x.alpha' }],
    });
    expect(err?.issues).toEqual([expected.message]);
    expect(err?.message).toContain("short-named 'custom'");
  });

  it('a body\'s object short-named `custom` is refused', () => {
    const err = refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.hr', 'hr', ['hr_custom'])],
    });
    expect(err?.issues).toHaveLength(1);
    expect(err?.issues?.[0]).toContain("'hr_custom'");
  });
});

describe('defineStack — what stays accepted', () => {
  it('CONTROL — an object only STARTING with a namespace, and `NS_custom_*`, pass', () => {
    expect(refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.alpha', 'crm', ['crm_lead_note', 'crm_custom_field']), body('com.x.beta', 'crm_lead', ['crm_lead_x'])],
    })?.message).toBeUndefined();
  });

  it('CONTROL — a stack with no namespace still passes (no prefix, no pair to collide with)', () => {
    expect(refusal({
      manifest: { id: 'com.x.legacy', name: 'legacy', version: '1.0.0', type: 'app' },
      objects: [object('account')],
    })?.message).toBeUndefined();
  });
});
