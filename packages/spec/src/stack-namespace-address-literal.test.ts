// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1] `defineStack` refuses a namespace that spells a
 * literal segment of the address grammar (`actions`, `connectors`, `global`,
 * `hooks`, `oauth`, `trigger`), over every namespace ONE artifact declares: its
 * own manifest's and each `packages[]` body's. The verdict and its sentence are
 * the install door's own judge (`validateNamespaceNotAddressLiteral`), asserted
 * verbatim, never re-spelled.
 */

import { describe, expect, it } from 'vitest';

import { defineStack } from './stack.zod';
import { NAMESPACE_REFUSED_LITERALS, validateNamespaceNotAddressLiteral } from './kernel/address-grammar';

const object = (name: string) => ({ name, label: name, fields: { title: { type: 'text' as const } } });

const stack = (namespace: string) => ({
  manifest: { id: 'com.x.probe', name: 'probe', version: '1.0.0', type: 'app' as const, namespace },
  objects: [object(`${namespace}_task`)],
});

const body = (id: string, namespace: string) => ({
  manifest: {
    id,
    name: id.split('.').pop()!,
    version: '1.0.0',
    type: 'module' as const,
    namespace,
    objects: [object(`${namespace}_item`)],
  },
});

type Refusal = Error & { code?: string; status?: number; issues?: string[] };

const refusal = (config: unknown): Refusal | undefined => {
  try {
    defineStack(config as Parameters<typeof defineStack>[0], { strict: true });
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

describe('defineStack — a namespace never spells an address literal', () => {
  it('the six refused literals are the ones this file pins', () => {
    expect([...NAMESPACE_REFUSED_LITERALS]).toEqual(['actions', 'connectors', 'global', 'hooks', 'oauth', 'trigger']);
  });

  it.each(NAMESPACE_REFUSED_LITERALS.map((literal) => [literal]))(
    'a stack whose manifest.namespace is `%s` is refused with the install door\'s sentence',
    (literal) => {
      const err = refusal(stack(literal));
      expect(err?.code).toBe('STACK_NAMESPACE_PREFIX_INVALID');
      expect(err?.status).toBe(422);
      expect(err?.issues).toEqual([validateNamespaceNotAddressLiteral(literal)]);
      expect(err?.message).toContain(`Namespace '${literal}' spells a literal segment of the address grammar`);
      expect(err?.message).toContain('Choose another namespace.');
    },
  );

  it('a packages[] body whose namespace is a literal is refused, naming that literal only', () => {
    const err = refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.alpha', 'crm'), body('com.x.hooks', 'hooks')],
    });
    expect(err?.code).toBe('STACK_NAMESPACE_PREFIX_INVALID');
    expect(err?.status).toBe(422);
    expect(err?.issues).toEqual([validateNamespaceNotAddressLiteral('hooks')]);
  });
});

describe('defineStack — what stays accepted', () => {
  it('CONTROL — `triggers` (a literal plus one letter) passes', () => {
    expect(refusal(stack('triggers'))?.message).toBeUndefined();
  });

  it('CONTROL — a packages[] body under `globals` passes', () => {
    expect(refusal({
      manifest: { id: 'com.x.release', name: 'release', version: '1.0.0', type: 'app', namespace: 'crm' },
      packages: [body('com.x.alpha', 'crm'), body('com.x.globals', 'globals')],
    })?.message).toBeUndefined();
  });
});
