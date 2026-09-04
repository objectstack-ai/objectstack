// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit contract for the option-B collection seam (#15006).
 *
 * The acceptance probe (`test/option-b-reader-acceptance.pin.test.ts`) measures
 * these same functions over the real two-package zoo; this file pins the edges
 * that fixture has no reason to carry — an EMPTY `objects` array, an already
 * composed engine or driver, a malformed `packages` list — and the one property
 * that makes the whole seam safe to land: for every stack the platform emits
 * today, the answer is byte-for-byte the expression it replaced.
 */

import { describe, expect, it } from 'vitest';

import {
  artifactObjectNames,
  authoringRuleUnionStack,
  bundleDeclaresTranslations,
  resolveStackCollection,
  shouldAutoRegisterObjectQL,
  shouldAutoRegisterStorageDriver,
  stackDeclaresMetadata,
} from './stack-collections.js';

/**
 * A schema-valid object and manifest. `resolveArtifactPackageOrder` parses every
 * `packages[]` entry WHOLE (`ArtifactPackageSchema`), so a shorthand body here
 * would fail on the entry gate rather than on the behaviour under test — which
 * is itself worth knowing: the seam inherits that gate, and these fixtures are
 * what a real composed package body looks like.
 */
const PROBE_OBJECT = {
  name: 'probe_account',
  label: 'Probe Account',
  sharingModel: 'private' as const,
  fields: { name: { name: 'name', type: 'text' as const, label: 'Name' } },
};
const ORDER_OBJECT = {
  name: 'probe_order',
  label: 'Probe Order',
  sharingModel: 'private' as const,
  fields: { name: { name: 'name', type: 'text' as const, label: 'Number' } },
};
const CORE_MANIFEST = {
  id: 'com.example.probe.core',
  name: 'Probe Core',
  version: '1.0.0',
  type: 'app' as const,
};
const TRANSLATIONS = [{ en: { objects: { probe_account: { label: 'Probe Account (translated)' } } } }];

/** Today's shape: collections flattened to the top level AND `packages[]`. */
const additive = () => ({
  manifest: CORE_MANIFEST,
  objects: [PROBE_OBJECT],
  translations: TRANSLATIONS,
  packages: [{ manifest: { ...CORE_MANIFEST, objects: [PROBE_OBJECT], translations: TRANSLATIONS } }],
});

/** The ruled option-B shape: the flattened top level gone. */
const optionB = () => ({
  manifest: CORE_MANIFEST,
  packages: [{ manifest: { ...CORE_MANIFEST, objects: [PROBE_OBJECT], translations: TRANSLATIONS } }],
});

describe('#15006 — the auto-registration gates answer the same on BOTH shapes', () => {
  it('registers the engine and the driver on today\'s additive shape', () => {
    expect(shouldAutoRegisterObjectQL(additive(), [])).toBe(true);
    expect(shouldAutoRegisterStorageDriver(additive(), [])).toBe(true);
  });

  it('registers them on the option-B shape, where the old expression read `undefined`', () => {
    // The whole card in one assertion: before the seam this config booted with
    // NO query engine and NO storage driver, having thrown nothing.
    expect((optionB() as Record<string, unknown>).objects).toBeUndefined();
    expect(shouldAutoRegisterObjectQL(optionB(), [])).toBe(true);
    expect(shouldAutoRegisterStorageDriver(optionB(), [])).toBe(true);
  });

  it('stands down when the composition already carries the plugin', () => {
    expect(shouldAutoRegisterObjectQL(additive(), [{ name: 'com.objectstack.engine.objectql' }])).toBe(false);
    expect(shouldAutoRegisterStorageDriver(
      additive(),
      [{ name: 'com.objectstack.runtime.default-datasource' }],
    )).toBe(false);
    // Keyed on the constructor name too — an instance need not carry `name`.
    class ObjectQLPlugin {}
    class DefaultDatasourcePlugin {}
    expect(shouldAutoRegisterObjectQL(additive(), [new ObjectQLPlugin()])).toBe(false);
    expect(shouldAutoRegisterStorageDriver(additive(), [new DefaultDatasourcePlugin()])).toBe(false);
  });

  it('keeps the old truthiness for an EMPTY top-level `objects` array', () => {
    // `config.objects &&` is truthy for `[]`, so a stack declaring no objects
    // still got an engine and a driver. Re-expressing the gate as
    // `resolve(...).length > 0` would have silently stopped doing that —
    // reintroducing "boots with no query engine" in a different case. The old
    // answer is preserved deliberately, not endorsed.
    const empty = { ...additive(), objects: [] as unknown[] };
    expect(shouldAutoRegisterObjectQL(empty, [])).toBe(true);
    expect(shouldAutoRegisterStorageDriver(empty, [])).toBe(true);
  });

  it('says no when nothing anywhere declares an object', () => {
    expect(shouldAutoRegisterObjectQL({ manifest: { id: 'x', name: 'x' } }, [])).toBe(false);
    expect(shouldAutoRegisterStorageDriver({}, [])).toBe(false);
    expect(shouldAutoRegisterObjectQL(undefined, [])).toBe(false);
  });
});

describe('#15006 — resolveStackCollection', () => {
  it('returns the top-level array whenever the key is present, without unioning `packages[]`', () => {
    // Today's additive artifact carries every definition TWICE. Unioning both
    // copies would double every item, so the top level — which composition
    // already flattened into the union — wins by presence.
    expect(resolveStackCollection(additive(), 'objects')).toHaveLength(1);
  });

  it('concatenates across packages when the top level does not carry the key', () => {
    expect(resolveStackCollection(optionB(), 'objects')).toEqual([PROBE_OBJECT]);
    expect(resolveStackCollection(optionB(), 'jobs')).toEqual([]);
  });

  it('refuses a malformed `packages` loudly, and only on the leg that reaches it', () => {
    const broken = { packages: [{ notAManifestWrapper: true }] };
    // The top level answers first, so a stack that boots today never reaches
    // the refusal — this is what makes the seam additive.
    expect(resolveStackCollection({ ...broken, objects: [PROBE_OBJECT] }, 'objects')).toHaveLength(1);
    // With nothing at the top level, the ADR-0112 envelope is the right answer:
    // the alternative is the silent empty this card exists to remove.
    let raised: unknown;
    try {
      resolveStackCollection(broken, 'objects');
    } catch (e) {
      raised = e;
    }
    expect((raised as { code?: string } | undefined)?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect((raised as { status?: number } | undefined)?.status).toBe(422);
  });
});

describe('#15006 — the wrap gate and the i18n gate', () => {
  it('keeps the AppPlugin wrap on both shapes', () => {
    expect(stackDeclaresMetadata(additive())).toBe(true);
    // MEASURED, not assumed: `manifest` is an artifact-ENVELOPE key, so this
    // predicate survives option B on its own. It is folded into the seam for
    // the other two reasons — one predicate for `serve` and `migrate`, and a
    // callable the probe can watch.
    expect(stackDeclaresMetadata(optionB())).toBe(true);
    expect(stackDeclaresMetadata({ packages: [{ manifest: { ...CORE_MANIFEST, objects: [PROBE_OBJECT] } }] }))
      .toBe(true);
    expect(stackDeclaresMetadata({ plugins: [] })).toBe(false);
  });

  it('auto-registers i18n on both shapes — this one DID lose', () => {
    expect(bundleDeclaresTranslations(additive())).toBe(true);
    expect(bundleDeclaresTranslations(optionB())).toBe(true);
    expect(bundleDeclaresTranslations({ manifest: { id: 'a' } })).toBe(false);
    // The nested-bundle shape a host/aggregator config composes.
    expect(bundleDeclaresTranslations({ manifest: { translations: [{ en: {} }] } })).toBe(true);
    expect(bundleDeclaresTranslations({ i18n: { defaultLocale: 'en' } })).toBe(true);
  });
});

describe('#15006 — the `os dev` object inventory', () => {
  it('unwraps the envelope and resolves both shapes', () => {
    expect(artifactObjectNames(additive())).toEqual(['probe_account']);
    expect(artifactObjectNames(optionB())).toEqual(['probe_account']);
    expect(artifactObjectNames({ metadata: optionB() })).toEqual(['probe_account']);
    expect(artifactObjectNames({ data: { metadata: optionB() } })).toEqual(['probe_account']);
  });

  it('answers empty rather than throwing for an artifact carrying nothing', () => {
    expect(artifactObjectNames({})).toEqual([]);
    expect(artifactObjectNames(null)).toEqual([]);
  });
});

describe('#15006 — the union author-time rule input', () => {
  it('returns a stack that still carries its collections BY IDENTITY', () => {
    // `os build` on every stack the platform emits today must reach the rule
    // table with exactly the object it reaches it with now.
    const stack = additive();
    expect(authoringRuleUnionStack(stack)).toBe(stack);
    const noPackages = { objects: [PROBE_OBJECT] };
    expect(authoringRuleUnionStack(noPackages)).toBe(noPackages);
  });

  it('folds every absent collection back in from `packages[]`', () => {
    const folded = authoringRuleUnionStack(optionB() as Record<string, unknown>);
    expect(folded.objects).toEqual([PROBE_OBJECT]);
    expect(folded.translations).toHaveLength(1);
    // The envelope keys are untouched — the fold adds collections, it does not
    // rewrite the artifact's identity.
    expect(folded.manifest).toEqual(optionB().manifest);
    expect(folded.packages).toEqual(optionB().packages);
  });

  it('folds `functions`, the one collection carried as a record', () => {
    const stack = {
      manifest: CORE_MANIFEST,
      packages: [
        {
          manifest: {
            ...CORE_MANIFEST,
            functions: { probeSweep: { handler: () => undefined, effect: 'writes' } },
          },
        },
        {
          manifest: {
            ...CORE_MANIFEST, id: 'com.example.probe.other', name: 'Probe Other', type: 'module' as const,
            functions: { probeOther: { handler: () => undefined, effect: 'pure' } },
          },
        },
      ],
    };
    const folded = authoringRuleUnionStack(stack as Record<string, unknown>);
    expect(Object.keys(folded.functions as Record<string, unknown>).sort())
      .toEqual(['probeOther', 'probeSweep']);
  });

  it('concatenates in `resolveArtifactPackageOrder` order, not array order', () => {
    // The dependent package is listed FIRST; the topological sort must still
    // put the package it depends on ahead of it.
    const stack = {
      manifest: CORE_MANIFEST,
      packages: [
        {
          manifest: {
            id: 'com.example.orders', name: 'Orders', version: '1.0.0', type: 'module' as const,
            dependencies: { 'com.example.core': '^1.0.0' },
            objects: [ORDER_OBJECT],
          },
        },
        {
          manifest: {
            id: 'com.example.core', name: 'Core', version: '1.0.0', type: 'app' as const,
            objects: [PROBE_OBJECT],
          },
        },
      ],
    };
    const folded = authoringRuleUnionStack(stack as Record<string, unknown>);
    expect((folded.objects as Array<{ name: string }>).map((o) => o.name))
      .toEqual(['probe_account', 'probe_order']);
  });
});
