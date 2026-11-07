// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { customizationPackageId, isCustomizationPairOf } from '@objectstack/spec/kernel';
import {
  appOf,
  installedManifestsOf,
  isPairOf,
  pairOf,
  type InstalledManifestLookup,
} from './customization-pair-lookup.js';

/**
 * The lookup answers exactly what the pure id rule answered for every package
 * shape on `main` — an App, a module its artifact brings, a standalone
 * package, a `sys` kernel package, a manifest with no namespace — because
 * `appOf` is the identity until the ensure door resolves a member to its App.
 * Each row pins the literal pair, so a resolver that moves one package to
 * another App reds that row by name. Every row is asked twice: with nothing
 * installed, and with all the rows installed — the module declaring its App
 * the way HotCRM's modules do — so the lookup the callers now hand in is
 * proven to move nothing while `appOf` stays the identity.
 */
const ROWS: ReadonlyArray<{
  shape: string;
  manifest: { id: string; type?: string; scope?: string; namespace?: string; dependencies?: Record<string, string> };
  pair: string;
}> = [
  {
    shape: 'an App package',
    manifest: { id: 'app.objectstack.hotcrm', type: 'app', namespace: 'crm' },
    pair: 'app.objectstack.hotcrm.custom',
  },
  {
    shape: 'a module an App artifact brings (still its own pair today)',
    manifest: {
      id: 'app.objectstack.hotcrm.service',
      type: 'module',
      namespace: 'crm',
      dependencies: { 'app.objectstack.hotcrm': '^6.1.0' },
    },
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

const NOTHING_INSTALLED = installedManifestsOf(undefined);
const ALL_INSTALLED = installedManifestsOf({
  getPackage: (id: string) => {
    const row = ROWS.find((r) => r.manifest.id === id);
    return row ? { manifest: row.manifest } : undefined;
  },
});
const LOOKUPS: ReadonlyArray<{ installed: string; lookup: InstalledManifestLookup }> = [
  { installed: 'nothing installed', lookup: NOTHING_INSTALLED },
  { installed: 'every row installed', lookup: ALL_INSTALLED },
];
const ROWS_BY_LOOKUP = LOOKUPS.flatMap(({ installed, lookup }) => ROWS.map((row) => ({ ...row, installed, lookup })));

describe('installedManifestsOf — the registry read the lookup is', () => {
  it('reads the installed manifest by id, and nothing for an id not installed', () => {
    const service = ROWS[1]!.manifest;
    expect(ALL_INSTALLED(service.id)).toBe(service);
    expect(ALL_INSTALLED('com.example.absent')).toBeUndefined();
  });

  it.each([
    { source: 'no registry', registry: undefined },
    { source: 'a null registry', registry: null },
    { source: 'a registry with no getPackage', registry: {} },
    { source: 'a package with no manifest', registry: { getPackage: () => ({}) } },
    { source: 'a manifest that is not an object', registry: { getPackage: () => ({ manifest: 'app' }) } },
    { source: 'a null manifest', registry: { getPackage: () => ({ manifest: null }) } },
  ])('answers undefined for $source', ({ registry }) => {
    expect(installedManifestsOf(registry)('app.objectstack.hotcrm')).toBeUndefined();
  });
});

describe('pairOf — the pair of a package, looked up through its App', () => {
  it.each(ROWS_BY_LOOKUP)('$shape, $installed: answers the old derivation, $pair', ({ manifest, pair, lookup }) => {
    expect(appOf(manifest.id, lookup)).toBe(manifest.id);
    expect(pairOf(manifest.id, lookup)).toEqual(customizationPackageId(manifest.id));
    expect(pairOf(manifest.id, lookup)).toEqual({ ok: true, value: pair });
  });

  it.each([
    { input: undefined, reason: 'base_id_missing' },
    { input: '', reason: 'base_id_missing' },
    { input: 42, reason: 'base_id_missing' },
    { input: 'hotcrm.custom', reason: 'base_is_customization_package' },
    { input: 'Com.Acme', reason: 'base_id_invalid' },
  ])('refuses $input as the id rule does: $reason', ({ input, reason }) => {
    for (const { lookup } of LOOKUPS) {
      expect(pairOf(input, lookup)).toEqual(customizationPackageId(input));
      expect(pairOf(input, lookup)).toEqual({ ok: false, reason });
    }
  });
});

describe('isPairOf — is this THE pair of that package', () => {
  it.each(ROWS_BY_LOOKUP)('$shape, $installed: only $pair is its pair', ({ manifest, pair, lookup }) => {
    const candidates = [pair, manifest.id, `${pair}.custom`, 'app.objectstack.hotcrm.custom', 'partner.ext', null, undefined];
    for (const candidate of candidates) {
      expect(isPairOf(candidate, manifest.id, lookup)).toBe(isCustomizationPairOf(candidate, manifest.id));
    }
    expect(isPairOf(pair, manifest.id, lookup)).toBe(true);
    expect(isPairOf(manifest.id, manifest.id, lookup)).toBe(false);
  });

  it.each(LOOKUPS)('$installed: a pair has no pair, and a missing base has none', ({ lookup }) => {
    expect(isPairOf('hotcrm.custom.custom', 'hotcrm.custom', lookup)).toBe(false);
    expect(isPairOf('.custom', '', lookup)).toBe(false);
    expect(isPairOf('x.custom', undefined, lookup)).toBe(false);
  });
});
