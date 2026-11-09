// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_ADDRESS_SEGMENT,
  NAMESPACE_PATTERN,
  NAMESPACE_POSITION_LITERALS,
  NAMESPACE_REFUSED_LITERALS,
  ROUTER_ADDRESSABLE_NAME_PATTERN,
  ROUTER_RESERVED_NAME_PREFIX,
  readNamespacePositionSegment,
  validateNamespaceNotAddressLiteral,
} from './address-grammar';
import { ManifestSchema } from './manifest.zod';

describe('address grammar (ADR-0150 D5)', () => {
  it('the manifest binds the one namespace pattern', () => {
    for (const ns of ['crm', 'hr_leave', 'a1', 'x'.repeat(20)]) {
      expect(NAMESPACE_PATTERN.test(ns)).toBe(true);
      expect(ManifestSchema.shape.namespace.safeParse(ns).success).toBe(true);
    }
    for (const ns of ['c', '_env', '1crm', 'crm-x', 'Crm', 'x'.repeat(21), '']) {
      expect(NAMESPACE_PATTERN.test(ns)).toBe(false);
      expect(ManifestSchema.shape.namespace.safeParse(ns).success).toBe(false);
    }
  });

  it('no namespace and no router-addressable name can spell a `_`-led segment', () => {
    expect(ENVIRONMENT_ADDRESS_SEGMENT.startsWith(ROUTER_RESERVED_NAME_PREFIX)).toBe(true);
    expect(NAMESPACE_PATTERN.test(ENVIRONMENT_ADDRESS_SEGMENT)).toBe(false);
    expect(ROUTER_ADDRESSABLE_NAME_PATTERN.test(ENVIRONMENT_ADDRESS_SEGMENT)).toBe(false);
    for (const position of Object.values(NAMESPACE_POSITION_LITERALS)) {
      for (const literal of position.literals.filter((l) => l.startsWith(ROUTER_RESERVED_NAME_PREFIX))) {
        expect(NAMESPACE_PATTERN.test(literal)).toBe(false);
        expect(ROUTER_ADDRESSABLE_NAME_PATTERN.test(literal)).toBe(false);
      }
    }
  });

  it('lists each door\'s namespace-position literals in code-unit order', () => {
    for (const position of Object.values(NAMESPACE_POSITION_LITERALS)) {
      expect([...position.literals]).toEqual([...position.literals].sort());
    }
  });

  it('derives the install-refused set from the literals the namespace grammar admits', () => {
    expect(NAMESPACE_REFUSED_LITERALS).toEqual(['actions', 'connectors', 'global', 'hooks', 'oauth', 'trigger']);
  });

  it('refuses a namespace that spells a literal, naming the address it would shadow', () => {
    expect(validateNamespaceNotAddressLiteral('crm')).toBeNull();
    expect(validateNamespaceNotAddressLiteral(undefined)).toBeNull();
    const refusal = validateNamespaceNotAddressLiteral('global');
    expect(refusal).toMatch(/Namespace 'global' spells a literal segment/);
    expect(refusal).toContain('/actions/global');
    expect(validateNamespaceNotAddressLiteral('trigger')).toContain('/automation/trigger');
    expect(validateNamespaceNotAddressLiteral('oauth')).toContain('/automation/connectors/oauth');
  });

  describe('readNamespacePositionSegment — the router precedence', () => {
    const installed = new Set(['crm', 'trigger', 'global']);
    const isInstalled = (s: string) => installed.has(s);

    it('step 1: a literal wins over an installed namespace of the same spelling', () => {
      expect(readNamespacePositionSegment('automation', 'trigger', isInstalled)).toEqual({ reading: 'literal', literal: 'trigger' });
      expect(readNamespacePositionSegment('actions', 'global', isInstalled)).toEqual({ reading: 'literal', literal: 'global' });
      expect(readNamespacePositionSegment('automation', '_status', isInstalled)).toEqual({ reading: 'literal', literal: '_status' });
      expect(readNamespacePositionSegment('actions', '', isInstalled)).toEqual({ reading: 'literal', literal: '' });
    });

    it('step 1: the reserved environment segment', () => {
      expect(readNamespacePositionSegment('automation', '_env', isInstalled)).toEqual({ reading: 'environment' });
      expect(readNamespacePositionSegment('meta', '_env', isInstalled)).toEqual({ reading: 'environment' });
    });

    it('step 2: an installed namespace', () => {
      expect(readNamespacePositionSegment('automation', 'crm', isInstalled)).toEqual({ reading: 'namespace', namespace: 'crm' });
      // `trigger` is a literal only where a door serves it.
      expect(readNamespacePositionSegment('actions', 'trigger', isInstalled)).toEqual({ reading: 'namespace', namespace: 'trigger' });
    });

    it('step 3: anything else is the bare grammar, never a guess', () => {
      expect(readNamespacePositionSegment('automation', 'send_welcome', isInstalled)).toEqual({ reading: 'bare' });
      expect(readNamespacePositionSegment('automation', 'hr', isInstalled)).toEqual({ reading: 'bare' });
      expect(readNamespacePositionSegment('automation', '_drafts', isInstalled)).toEqual({ reading: 'bare' });
      // A catalogue that answers yes to an ungrammatical segment is not believed.
      expect(readNamespacePositionSegment('automation', 'Crm', () => true)).toEqual({ reading: 'bare' });
    });
  });
});
