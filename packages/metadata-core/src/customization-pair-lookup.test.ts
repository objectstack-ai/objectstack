// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { customizationPackageId, isCustomizationPairOf } from '@objectstack/spec/kernel';
import {
  appOf,
  installedManifestsOf,
  isPairOf,
  pairOf,
  pairsOf,
  type InstalledManifestLookup,
} from './customization-pair-lookup.js';

/**
 * The App lookup over the package shapes ADR-0146 D3 merge question 11 names.
 * Every row is asked twice: with nothing installed — every package is then
 * absent, so its own unit, and the lookup answers exactly the old per-package
 * derivation — and with every row installed, where a member answers its App's
 * pair. Each row pins the literal pair, so a resolver that moves a package to
 * another App reds that row by name.
 */
type Manifest = { id: string; type?: string; scope?: string; namespace?: string; dependencies?: Record<string, string> };
const ROWS: ReadonlyArray<{ shape: string; manifest: Manifest; app: string | undefined }> = [
  {
    shape: 'an App package',
    manifest: { id: 'app.objectstack.hotcrm', type: 'app', namespace: 'crm' },
    app: 'app.objectstack.hotcrm',
  },
  {
    shape: 'a module declaring its App (HotCRM)',
    manifest: { id: 'app.objectstack.hotcrm.service', type: 'module', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm': '^6.1.0' } },
    app: 'app.objectstack.hotcrm',
  },
  {
    shape: 'a module declaring its App and a kernel package',
    manifest: { id: 'app.objectstack.hotcrm.o2c', type: 'module', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm': '^6.1.0', 'com.objectstack.audit': '^1' } },
    app: 'app.objectstack.hotcrm',
  },
  {
    shape: 'a module reaching its App through a declared module',
    manifest: { id: 'app.objectstack.hotcrm.service.sla', type: 'module', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm.service': '^6' } },
    app: 'app.objectstack.hotcrm',
  },
  {
    shape: 'a plugin declaring two Apps, one holding its namespace',
    manifest: { id: 'com.acme.bridge', type: 'plugin', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm': '^6', 'com.example.showcase': '^1' } },
    app: 'app.objectstack.hotcrm',
  },
  {
    shape: 'a plugin declaring two Apps, neither holding its namespace',
    manifest: { id: 'com.acme.glue', type: 'plugin', namespace: 'glue', dependencies: { 'app.objectstack.hotcrm': '^6', 'com.example.showcase': '^1' } },
    app: undefined,
  },
  {
    shape: 'a standalone App',
    manifest: { id: 'com.example.showcase', type: 'app', namespace: 'showcase' },
    app: 'com.example.showcase',
  },
  {
    shape: 'a plugin declaring no App (its own unit)',
    manifest: { id: 'com.acme.solo', type: 'plugin', namespace: 'solo', dependencies: { 'com.acme.ring': '^1' } },
    app: 'com.acme.solo',
  },
  {
    shape: 'a module in a declared cycle that reaches no App',
    manifest: { id: 'com.acme.ring', type: 'module', namespace: 'ring', dependencies: { 'com.acme.solo': '^1' } },
    app: 'com.acme.ring',
  },
  {
    shape: 'a module declaring an App that is not installed',
    manifest: { id: 'com.acme.orphan', type: 'module', namespace: 'orph', dependencies: { 'com.acme.absent': '^1' } },
    app: 'com.acme.orphan',
  },
  {
    shape: 'a sys kernel package',
    manifest: { id: 'com.objectstack.plugin-auth', type: 'plugin', scope: 'system', namespace: 'sys' },
    app: 'com.objectstack.plugin-auth',
  },
  {
    shape: 'a kernel package declaring an App (kernel keeps its own answer)',
    manifest: { id: 'com.objectstack.audit', type: 'plugin', scope: 'cloud', namespace: 'sys', dependencies: { 'app.objectstack.hotcrm': '^6' } },
    app: 'com.objectstack.audit',
  },
  {
    shape: 'a manifest with no namespace',
    manifest: { id: 'hotcrm', type: 'app' },
    app: 'hotcrm',
  },
];

const NOTHING_INSTALLED = installedManifestsOf(undefined);
const lookupOf = (manifests: readonly Manifest[]): InstalledManifestLookup => installedManifestsOf({
  getPackage: (id: string) => {
    const manifest = manifests.find((m) => m.id === id);
    return manifest ? { manifest } : undefined;
  },
});
const ALL_INSTALLED = lookupOf(ROWS.map((r) => r.manifest));

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

describe('appOf / pairOf — the pair of a package is the pair of its App (ADR-0146 D3 merge question 11)', () => {
  it.each(ROWS)('$shape, nothing installed: its own unit, the old derivation', ({ manifest }) => {
    expect(appOf(manifest.id, NOTHING_INSTALLED)).toBe(manifest.id);
    expect(pairOf(manifest.id, NOTHING_INSTALLED)).toEqual(customizationPackageId(manifest.id));
  });

  it.each(ROWS)('$shape, every row installed: App $app', ({ manifest, app }) => {
    expect(appOf(manifest.id, ALL_INSTALLED)).toBe(app);
    expect(pairOf(manifest.id, ALL_INSTALLED)).toEqual(app === undefined
      ? { ok: false, reason: 'no_single_app' }
      : { ok: true, value: `${app}.custom` });
  });

  it('HotCRM: the App and its four modules have one pair', () => {
    const app = { id: 'app.objectstack.hotcrm', type: 'app', namespace: 'crm' };
    const modules = ['service', 'revenue', 'marketing', 'o2c'].map((m) => ({
      id: `app.objectstack.hotcrm.${m}`, type: 'module', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm': '^6.1.0' },
    }));
    const installed = lookupOf([app, ...modules]);
    const pairs = new Set([app, ...modules].map((m) => pairOf(m.id, installed)).map((p) => (p.ok ? p.value : p.reason)));
    expect([...pairs]).toEqual(['app.objectstack.hotcrm.custom']);
  });

  it.each([
    { input: undefined, reason: 'base_id_missing' },
    { input: '', reason: 'base_id_missing' },
    { input: 42, reason: 'base_id_missing' },
    { input: 'hotcrm.custom', reason: 'base_is_customization_package' },
    { input: 'Com.Acme', reason: 'base_id_invalid' },
  ])('refuses $input as the id rule does: $reason', ({ input, reason }) => {
    for (const lookup of [NOTHING_INSTALLED, ALL_INSTALLED]) {
      expect(pairOf(input, lookup)).toEqual(customizationPackageId(input));
      expect(pairOf(input, lookup)).toEqual({ ok: false, reason });
    }
  });

  it('a pair id answers itself, installed or not', () => {
    const pair = { id: 'app.objectstack.hotcrm.custom', type: 'module', namespace: 'crm_custom', dependencies: { 'app.objectstack.hotcrm': '^6' } };
    const installed = lookupOf([...ROWS.map((r) => r.manifest), pair]);
    expect(appOf(pair.id, installed)).toBe(pair.id);
    expect(pairOf(pair.id, installed)).toEqual({ ok: false, reason: 'base_is_customization_package' });
  });
});

describe('isPairOf / pairsOf — which packages hold a package\'s customizations', () => {
  it.each(ROWS)('$shape, nothing installed: only the old derivation is its pair', ({ manifest }) => {
    const own = customizationPackageId(manifest.id);
    const candidates = [own.ok ? own.value : null, manifest.id, 'app.objectstack.hotcrm.custom', 'partner.ext', null, undefined];
    for (const candidate of candidates) {
      expect(isPairOf(candidate, manifest.id, NOTHING_INSTALLED)).toBe(isCustomizationPairOf(candidate, manifest.id));
    }
  });

  it('a member: its App\'s pair is its pair; its own derivation is not, while nothing holds it', () => {
    const service = 'app.objectstack.hotcrm.service';
    expect(pairsOf(service, ALL_INSTALLED)).toEqual(['app.objectstack.hotcrm.custom']);
    expect(isPairOf('app.objectstack.hotcrm.custom', service, ALL_INSTALLED)).toBe(true);
    expect(isPairOf(`${service}.custom`, service, ALL_INSTALLED)).toBe(false);
    expect(isPairOf(service, service, ALL_INSTALLED)).toBe(false);
  });

  it('a member: the per-package pair an earlier version created stays its pair while installed (merge question 12)', () => {
    const service = 'app.objectstack.hotcrm.service';
    const legacy = { id: `${service}.custom`, type: 'module', namespace: 'crm_custom', dependencies: { [service]: '^6' } };
    const installed = lookupOf([...ROWS.map((r) => r.manifest), legacy]);
    expect(pairOf(service, installed)).toEqual({ ok: true, value: 'app.objectstack.hotcrm.custom' });
    expect(pairsOf(service, installed)).toEqual(['app.objectstack.hotcrm.custom', legacy.id]);
    expect(isPairOf(legacy.id, service, installed)).toBe(true);
    // …and of its own member only: the App and a sibling do not read it.
    expect(isPairOf(legacy.id, 'app.objectstack.hotcrm', installed)).toBe(false);
    expect(isPairOf(legacy.id, 'app.objectstack.hotcrm.o2c', installed)).toBe(false);
  });

  it('a package with no single App: no pair to land in, a legacy pair still served', () => {
    expect(pairsOf('com.acme.glue', ALL_INSTALLED)).toEqual([]);
    const legacy = { id: 'com.acme.glue.custom', type: 'module', namespace: 'glue_custom', dependencies: { 'com.acme.glue': '^1' } };
    expect(pairsOf('com.acme.glue', lookupOf([...ROWS.map((r) => r.manifest), legacy]))).toEqual([legacy.id]);
  });

  it('a pair has no pair, and a missing base has none', () => {
    for (const lookup of [NOTHING_INSTALLED, ALL_INSTALLED]) {
      expect(isPairOf('hotcrm.custom.custom', 'hotcrm.custom', lookup)).toBe(false);
      expect(isPairOf('.custom', '', lookup)).toBe(false);
      expect(isPairOf('x.custom', undefined, lookup)).toBe(false);
    }
  });
});
