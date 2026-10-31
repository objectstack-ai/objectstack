// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D2, D3, D6, D9, D10 — the paired `<base>.custom` package's identity
 * rules and the closed overridable-type list, as table tests.
 */

import { describe, expect, it } from 'vitest';
import {
  CUSTOMIZATION_NAMESPACE_SUFFIX,
  MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
  OVERRIDABLE_METADATA_TYPES,
  OVERRIDE_TYPE_CLASSIFICATION,
  customizationBasePackageId,
  customizationDependencyRange,
  customizationNamespace,
  customizationPackageId,
  getOverrideTypeClassification,
  isCustomizationPackage,
  isCustomizationPairOf,
  isOverridableMetadataType,
} from './customization-package';
import { CUSTOMIZATION_PACKAGE_SUFFIX } from './override-declaration.zod';
import { ManifestSchema, MANIFEST_ID_PATTERN } from './manifest.zod';
import { DEFAULT_METADATA_TYPE_REGISTRY, type MetadataType } from './metadata-plugin.zod';
import { deriveNamespaceFromPackageId } from './namespace-prefix';

describe('the pair\'s package id', () => {
  it('the suffix is `.custom` (maintainer: 「同意 后缀改成 .custom」)', () => {
    expect(CUSTOMIZATION_PACKAGE_SUFFIX).toBe('.custom');
  });

  it.each([
    ['hotcrm', 'hotcrm.custom'],
    ['com.acme.crm', 'com.acme.crm.custom'],
    ['com.example.showcase', 'com.example.showcase.custom'],
    ['com.example.help-desk', 'com.example.help-desk.custom'],
  ])('customizationPackageId(%s) → %s, a valid manifest id', (base, pair) => {
    expect(customizationPackageId(base)).toEqual({ ok: true, value: pair });
    expect(MANIFEST_ID_PATTERN.test(pair)).toBe(true);
  });

  it.each([
    ['', 'base_id_missing'],
    [undefined, 'base_id_missing'],
    [42, 'base_id_missing'],
    ['hotcrm.custom', 'base_is_customization_package'],
    ['com.example.showcase.custom', 'base_is_customization_package'],
    ['Com.Acme', 'base_id_invalid'],
    ['@acme/crm', 'base_id_invalid'],
    ['com..acme', 'base_id_invalid'],
  ])('customizationPackageId(%j) is refused: %s', (base, reason) => {
    expect(customizationPackageId(base)).toEqual({ ok: false, reason });
  });

  it.each([
    ['hotcrm.custom', 'hotcrm'],
    ['com.example.showcase.custom', 'com.example.showcase'],
    ['com.acme.crm', null],
    ['custom', null],
    ['.custom', null],
    ['a.custom.custom', null],
    ['Com.Acme.custom', null],
    [undefined, null],
  ])('customizationBasePackageId(%j) → %j', (id, base) => {
    expect(customizationBasePackageId(id)).toBe(base);
    expect(isCustomizationPackage(id)).toBe(base !== null);
  });

  it('base-of is the exact inverse of pair-of on every valid base', () => {
    for (const base of ['hotcrm', 'com.acme.crm', 'com.example.showcase', 'org.example.help-desk']) {
      const pair = customizationPackageId(base);
      expect(pair.ok).toBe(true);
      if (pair.ok) expect(customizationBasePackageId(pair.value)).toBe(base);
    }
  });

  it.each([
    ['com.acme.crm.custom', 'com.acme.crm', true],
    ['hotcrm.custom', 'hotcrm', true],
    // A dependent package is not the pair, whatever it depends on (ruling A).
    ['com.partner.crm-addon', 'com.acme.crm', false],
    // The pair of a DIFFERENT base.
    ['com.acme.crm.custom', 'com.acme.crmx', false],
    ['com.acme.crmx.custom', 'com.acme.crm', false],
    // The base itself is not its own pair.
    ['com.acme.crm', 'com.acme.crm', false],
    // A pair is never paired again.
    ['com.acme.crm.custom.custom', 'com.acme.crm.custom', false],
  ])('isCustomizationPairOf(%s, %s) → %s', (pair, base, verdict) => {
    expect(isCustomizationPairOf(pair, base)).toBe(verdict);
  });
});

describe('the pair\'s namespace — `<base_ns>_custom`, never derived', () => {
  it('the derived namespace of a pair id is the wrong one (the reason the rule exists)', () => {
    expect(deriveNamespaceFromPackageId('hotcrm.custom')).toBe('custom');
    expect(customizationNamespace('crm')).toEqual({ ok: true, value: 'crm_custom' });
  });

  it('13 is the grammar\'s own limit: 20 characters less the 7 of `_custom`', () => {
    const grammar = ManifestSchema.shape.namespace;
    const at = 'a'.repeat(MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH) + CUSTOMIZATION_NAMESPACE_SUFFIX;
    const past = 'a'.repeat(MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH + 1) + CUSTOMIZATION_NAMESPACE_SUFFIX;
    expect(MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH).toBe(13);
    expect(grammar.safeParse(at).success).toBe(true);
    expect(grammar.safeParse(past).success).toBe(false);
  });

  it.each([
    ['crm', 'crm_custom'],
    ['feature_flags', 'feature_flags_custom'], // 13 characters — the longest base in the repository today
    ['abcdefghijklm', 'abcdefghijklm_custom'],
  ])('customizationNamespace(%s) → %s', (base, pair) => {
    expect(customizationNamespace(base)).toEqual({ ok: true, value: pair });
    expect(ManifestSchema.shape.namespace.safeParse(pair).success).toBe(true);
  });

  it.each([
    ['abcdefghijklmn', 'base_namespace_too_long'], // 14 characters
    ['a_twenty_char_namesp', 'base_namespace_too_long'],
    ['', 'base_namespace_missing'],
    [undefined, 'base_namespace_missing'],
    ['Crm', 'base_namespace_invalid'],
    ['1crm', 'base_namespace_invalid'],
  ])('customizationNamespace(%j) is refused: %s — no truncation, no hashing', (base, reason) => {
    expect(customizationNamespace(base)).toEqual({ ok: false, reason });
  });
});

describe('the pair\'s dependency range — `^<major>` of the base version', () => {
  it.each([
    ['3.2.1', '^3'],
    ['1.0.0', '^1'],
    ['0.4.0', '^0'],
    ['10.0.0', '^10'],
    ['2.0.0-beta.1', '^2'],
    ['1.4.0+build.7', '^1'],
    ['1.0.0-rc.1+exp.sha.5114f85', '^1'],
  ])('customizationDependencyRange(%s) → %s', (version, range) => {
    expect(customizationDependencyRange(version)).toEqual({ ok: true, value: range });
  });

  it.each([['v1.0.0'], ['1.0'], ['latest'], [''], ['01.1.1'], [undefined], [3]])(
    'customizationDependencyRange(%j) is refused: base_version_not_semver',
    (version) => {
      expect(customizationDependencyRange(version)).toEqual({ ok: false, reason: 'base_version_not_semver' });
    },
  );
});

describe('the closed overridable-type list, pinned to the registry', () => {
  const registryTypes = DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type).sort();
  const classified = Object.keys(OVERRIDE_TYPE_CLASSIFICATION).sort();

  it('classifies every registry type — a type added to the registry without a row here fails', () => {
    expect(registryTypes.filter((t) => !classified.includes(t))).toEqual([]);
  });

  it('classifies nothing the registry does not hold', () => {
    expect(classified.filter((t) => !registryTypes.includes(t))).toEqual([]);
  });

  it('every runtime-creatable type has a classification (the registry\'s `allowRuntimeCreate` closure)', () => {
    const runtimeCreatable = DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => e.allowRuntimeCreate).map((e) => e.type);
    expect(runtimeCreatable.length).toBeGreaterThan(0);
    for (const type of runtimeCreatable) expect(getOverrideTypeClassification(type), type).toBeDefined();
  });

  it('every overridable type is runtime-creatable (D2: "Studio or the metadata API can author")', () => {
    const byType = new Map(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => [e.type, e]));
    for (const type of OVERRIDABLE_METADATA_TYPES) expect(byType.get(type)?.allowRuntimeCreate, type).toBe(true);
  });

  it('a `not_runtime_creatable` row is one the registry really closes', () => {
    const byType = new Map(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => [e.type, e]));
    for (const [type, row] of Object.entries(OVERRIDE_TYPE_CLASSIFICATION)) {
      if (row.basis === 'not_runtime_creatable') expect(byType.get(type)?.allowRuntimeCreate, type).toBe(false);
    }
  });

  it('D6: permission sets, positions and capabilities are excluded whatever the registry says', () => {
    for (const type of ['permission', 'position', 'capability'] as const) {
      expect(OVERRIDE_TYPE_CLASSIFICATION[type]).toEqual({ disposition: 'excluded', basis: 'adr_0146_d6_security_catalog' });
      expect(isOverridableMetadataType(type)).toBe(false);
    }
  });

  it('D10: `object` is extended, never replaced', () => {
    expect(OVERRIDE_TYPE_CLASSIFICATION.object.disposition).toBe('extend_only');
    expect(isOverridableMetadataType('object')).toBe(false);
  });

  it('D2: the code-only types stay outside', () => {
    for (const type of ['field', 'hook', 'job', 'api', 'agent'] as const) {
      expect(OVERRIDE_TYPE_CLASSIFICATION[type].basis).toBe('adr_0126_code_only');
      expect(isOverridableMetadataType(type)).toBe(false);
    }
  });

  it('D9: flow carries its four conditions and action its ledger switch plus conditions 1–3, as data', () => {
    expect(OVERRIDE_TYPE_CLASSIFICATION.flow.conditions).toEqual([
      'served_over_code_package', 'rebound_in_one_reload', 'ledger_identity_inherited', 'version_pinning',
    ]);
    expect(OVERRIDE_TYPE_CLASSIFICATION.action.conditions).toEqual([
      'action_ledger_switch', 'served_over_code_package', 'rebound_in_one_reload', 'ledger_identity_inherited',
    ]);
    const conditioned = Object.entries(OVERRIDE_TYPE_CLASSIFICATION)
      .filter(([, row]) => 'conditions' in row).map(([type]) => type).sort();
    expect(conditioned).toEqual(['action', 'flow']);
  });

  it('the types ADR-0146 does not decide are excluded (today\'s posture) and marked for the maintainer', () => {
    const undecided = (Object.keys(OVERRIDE_TYPE_CLASSIFICATION) as MetadataType[])
      .filter((t) => OVERRIDE_TYPE_CLASSIFICATION[t].basis === 'undecided').sort();
    expect(undecided).toEqual(['datasource', 'seed', 'skill', 'tool']);
    for (const type of undecided) expect(OVERRIDE_TYPE_CLASSIFICATION[type].disposition).toBe('excluded');
  });

  it('isOverridableMetadataType answers false for a name that is no metadata type', () => {
    expect(isOverridableMetadataType('view')).toBe(true);
    expect(isOverridableMetadataType('not_a_type')).toBe(false);
    expect(isOverridableMetadataType('toString')).toBe(false);
    expect(getOverrideTypeClassification(undefined)).toBeUndefined();
  });
});
