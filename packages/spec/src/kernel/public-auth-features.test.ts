// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  PUBLIC_AUTH_FEATURES,
  PUBLIC_AUTH_FEATURES_NOT_ADVERTISED,
  PUBLIC_AUTH_FEATURE_NAMES,
  featureGatePredicate,
  lowerRequiresFeature,
} from './public-auth-features';

// Registry invariants (#2874 P0). The key-set ≡ getPublicConfig().features
// drift guard lives with the producer, in plugin-auth
// (public-feature-registry.test.ts) — this file checks the registry's own
// internal consistency.
describe('PUBLIC_AUTH_FEATURES registry', () => {
  const entries = Object.entries(PUBLIC_AUTH_FEATURES);

  it('classifies all 11 public flags', () => {
    expect(PUBLIC_AUTH_FEATURE_NAMES).toHaveLength(11);
    expect([...PUBLIC_AUTH_FEATURE_NAMES].sort()).toEqual(
      [
        'admin',
        'degradedTenancy',
        'deviceAuthorization',
        'multiOrgEnabled',
        'oidcProvider',
        'organization',
        'phoneNumber',
        'phoneNumberOtp',
        'sso',
        'ssoEnforced',
        'twoFactor',
      ].sort(),
    );
  });

  // #7481. The negative record has to be pinned as a negative: an entry in
  // PUBLIC_AUTH_FEATURES is what makes a flag servable AND `requiresFeature`-
  // gateable, so re-adding one of these ahead of its UI is exactly the
  // regression the ruling withdrew them to prevent — and it would otherwise be
  // a green two-line change.
  it('reserved-but-unadvertised capabilities are absent from the registry', () => {
    expect([...PUBLIC_AUTH_FEATURES_NOT_ADVERTISED].sort()).toEqual(['magicLink', 'passkeys']);
    for (const name of PUBLIC_AUTH_FEATURES_NOT_ADVERTISED) {
      expect(PUBLIC_AUTH_FEATURES, `${name} must not be classified while nothing consumes it`)
        .not.toHaveProperty(name);
      expect(PUBLIC_AUTH_FEATURE_NAMES as readonly string[]).not.toContain(name);
    }
  });

  it.each(entries)('%s declares gatedInputs XOR an exemption reason', (_name, entry) => {
    const hasGates = entry.gatedInputs !== undefined && entry.gatedInputs.length > 0;
    const hasExempt = entry.exempt !== undefined && entry.exempt.reason.length > 0;
    expect(hasGates !== hasExempt, 'exactly one of gatedInputs / exempt must be set').toBe(true);
  });

  it('gatedInputs paths follow the <object>.actions.<action>[.params.<name>] grammar', () => {
    const PATH = /^[a-z][a-z0-9_]*\.actions\.[a-z][a-z0-9_]*(\.params\.[A-Za-z][A-Za-z0-9_]*)?$/;
    for (const [name, entry] of entries) {
      for (const path of entry.gatedInputs ?? []) {
        expect(path, `${name}: ${path}`).toMatch(PATH);
      }
    }
  });

  it('status-surface flags never gate inputs', () => {
    for (const [, entry] of entries) {
      if (entry.surface === 'status') expect(entry.gatedInputs).toBeUndefined();
    }
  });
});

describe('featureGatePredicate', () => {
  it('opt-in flags gate with == true', () => {
    expect(featureGatePredicate('phoneNumber')).toBe('features.phoneNumber == true');
    expect(featureGatePredicate('admin')).toBe('features.admin == true');
  });

  it('default-on flags gate with != false (absent flag fails open)', () => {
    expect(featureGatePredicate('organization')).toBe('features.organization != false');
    expect(featureGatePredicate('multiOrgEnabled')).toBe('features.multiOrgEnabled != false');
  });
});

describe('lowerRequiresFeature', () => {
  const noIssues = () => {
    const issues: unknown[] = [];
    return {
      ctx: { addIssue: (i: unknown) => issues.push(i) } as never,
      issues,
    };
  };

  it('passes through untouched when the sugar is absent', () => {
    const { ctx } = noIssues();
    const input = { name: 'x', visible: { dialect: 'cel', source: 'record.a == 1' } };
    expect(lowerRequiresFeature(input, ctx)).toEqual(input);
  });

  it('emits the bare gate when no visible exists, and strips the sugar key', () => {
    const { ctx } = noIssues();
    const out = lowerRequiresFeature({ name: 'x', requiresFeature: 'phoneNumber' as const }, ctx);
    expect(out).toEqual({ name: 'x', visible: { dialect: 'cel', source: 'features.phoneNumber == true' } });
    expect('requiresFeature' in out).toBe(false);
  });

  it('composes with an existing CEL visible — existing first, gate last', () => {
    const { ctx } = noIssues();
    const out = lowerRequiresFeature(
      {
        requiresFeature: 'organization' as const,
        visible: { dialect: 'cel', source: "record.role != 'owner'" },
      },
      ctx,
    );
    expect(out.visible).toEqual({
      dialect: 'cel',
      source: "(record.role != 'owner') && features.organization != false",
    });
  });

  it('preserves envelope extras (meta) when composing', () => {
    const { ctx } = noIssues();
    const out = lowerRequiresFeature(
      {
        requiresFeature: 'admin' as const,
        visible: { dialect: 'cel', source: 'a', meta: { rationale: 'r' } },
      },
      ctx,
    );
    expect(out.visible).toEqual({
      dialect: 'cel',
      source: '(a) && features.admin == true',
      meta: { rationale: 'r' },
    });
  });

  it('rejects an AST-only or non-CEL visible loudly (ADR-0078)', () => {
    for (const visible of [
      { dialect: 'cel', ast: { kind: 'literal' } },
      { dialect: 'js', source: 'true' },
    ]) {
      const { ctx, issues } = noIssues();
      lowerRequiresFeature({ requiresFeature: 'admin' as const, visible }, ctx);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ code: 'custom', path: ['requiresFeature'] });
    }
  });
});
