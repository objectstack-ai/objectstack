// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { customizationPackageId, isCustomizationPairOf } from '@objectstack/spec/kernel';
import { appOf, isPairOf, pairOf } from './customization-pair-lookup.js';

/**
 * The lookup answers exactly what the pure id rule answered for every package
 * shape on `main` — an App, a module its artifact brings, a standalone
 * package, a `sys` kernel package, a manifest with no namespace — because
 * `appOf` is the identity until the ensure door resolves a member to its App.
 * Each row pins the literal pair, so a resolver that moves one package to
 * another App reds that row by name.
 */
const ROWS: ReadonlyArray<{ shape: string; manifest: { id: string; type?: string; scope?: string; namespace?: string }; pair: string }> = [
  {
    shape: 'an App package',
    manifest: { id: 'app.objectstack.hotcrm', type: 'app', namespace: 'crm' },
    pair: 'app.objectstack.hotcrm.custom',
  },
  {
    shape: 'a module an App artifact brings (still its own pair today)',
    manifest: { id: 'app.objectstack.hotcrm.service', type: 'module', namespace: 'crm' },
    pair: 'app.objectstack.hotcrm.service.custom',
  },
  {
    shape: 'a standalone package',
    manifest: { id: 'com.example.showcase', type: 'app', namespace: 'showcase' },
    pair: 'com.example.showcase.custom',
  },
  {
    shape: 'a sys kernel package',
    manifest: { id: 'com.objectstack.plugin-auth', type: 'plugin', scope: 'system', namespace: 'sys' },
    pair: 'com.objectstack.plugin-auth.custom',
  },
  {
    shape: 'a manifest with no namespace',
    manifest: { id: 'hotcrm', type: 'app' },
    pair: 'hotcrm.custom',
  },
];

describe('pairOf — the pair of a package, looked up through its App', () => {
  it.each(ROWS)('$shape: answers the old derivation, $pair', ({ manifest, pair }) => {
    expect(appOf(manifest.id)).toBe(manifest.id);
    expect(pairOf(manifest.id)).toEqual(customizationPackageId(manifest.id));
    expect(pairOf(manifest.id)).toEqual({ ok: true, value: pair });
  });

  it.each([
    { input: undefined, reason: 'base_id_missing' },
    { input: '', reason: 'base_id_missing' },
    { input: 42, reason: 'base_id_missing' },
    { input: 'hotcrm.custom', reason: 'base_is_customization_package' },
    { input: 'Com.Acme', reason: 'base_id_invalid' },
  ])('refuses $input as the id rule does: $reason', ({ input, reason }) => {
    expect(pairOf(input)).toEqual(customizationPackageId(input));
    expect(pairOf(input)).toEqual({ ok: false, reason });
  });
});

describe('isPairOf — is this THE pair of that package', () => {
  it.each(ROWS)('$shape: only $pair is its pair', ({ manifest, pair }) => {
    const candidates = [pair, manifest.id, `${pair}.custom`, 'app.objectstack.hotcrm.custom', 'partner.ext', null, undefined];
    for (const candidate of candidates) {
      expect(isPairOf(candidate, manifest.id)).toBe(isCustomizationPairOf(candidate, manifest.id));
    }
    expect(isPairOf(pair, manifest.id)).toBe(true);
    expect(isPairOf(manifest.id, manifest.id)).toBe(false);
  });

  it('a pair has no pair, and a missing base has none', () => {
    expect(isPairOf('hotcrm.custom.custom', 'hotcrm.custom')).toBe(false);
    expect(isPairOf('.custom', '')).toBe(false);
    expect(isPairOf('x.custom', undefined)).toBe(false);
  });
});
