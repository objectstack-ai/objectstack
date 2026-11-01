// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#28473] A package namespace too long to have a paired customization
// namespace (ADR-0146 D3) warns at author time. The verdict is
// `customizationNamespace`'s own (`@objectstack/spec/kernel`), so the boundary
// cases below are the helper's boundary: 13 characters is silent, 14 warns.

import { describe, expect, it } from 'vitest';

import {
  CUSTOMIZATION_NAMESPACE_SUFFIX,
  MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
  customizationNamespace,
} from '@objectstack/spec/kernel';

import { AUTHORING_COMMANDS, AUTHORING_RULES, runAuthoringRules } from './authoring-rules.js';
import * as indexBarrel from './index.js';
import { RULE_EXPLANATIONS } from './rule-explanations.js';
import {
  NAMESPACE_NO_CUSTOMIZATION_PAIR,
  validateCustomizationNamespace,
} from './validate-customization-namespace.js';

/** 13 characters: the longest base namespace that has a pair namespace. */
const AT_LIMIT = 'warehouse_ops';
/** 14 characters: one past it. */
const PAST_LIMIT = 'warehouse_mgmt';

const single = (namespace: unknown, id: unknown = 'com.acme.warehouse') => ({
  manifest: { id, version: '1.0.0', type: 'app', namespace },
});

describe('validateCustomizationNamespace', () => {
  it('the boundary fixtures sit on the helper\'s own boundary', () => {
    expect(AT_LIMIT).toHaveLength(MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH);
    expect(PAST_LIMIT).toHaveLength(MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH + 1);
    expect(customizationNamespace(AT_LIMIT)).toEqual({ ok: true, value: `${AT_LIMIT}${CUSTOMIZATION_NAMESPACE_SUFFIX}` });
    expect(customizationNamespace(PAST_LIMIT)).toEqual({ ok: false, reason: 'base_namespace_too_long' });
  });

  it('is silent on a namespace of 13 characters', () => {
    expect(validateCustomizationNamespace(single(AT_LIMIT))).toEqual([]);
  });

  it('warns on a namespace of 14 characters, at manifest.namespace', () => {
    const findings = validateCustomizationNamespace(single(PAST_LIMIT));
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.severity).toBe('warning');
    expect(finding.rule).toBe(NAMESPACE_NO_CUSTOMIZATION_PAIR);
    expect(finding.path).toBe('manifest.namespace');
    expect(finding.where).toBe('package "com.acme.warehouse"');
  });

  it('the message names the pair namespace the package cannot have, and the hint the limit', () => {
    const [finding] = validateCustomizationNamespace(single(PAST_LIMIT));
    expect(finding.message).toContain(`"${PAST_LIMIT}${CUSTOMIZATION_NAMESPACE_SUFFIX}"`);
    expect(finding.message).toContain(`"${PAST_LIMIT}"`);
    expect(finding.hint).toContain(`${MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH} characters or fewer`);
  });

  it('is silent when the package is itself a pair: a pair is never paired again', () => {
    const pairNamespace = `${AT_LIMIT}${CUSTOMIZATION_NAMESPACE_SUFFIX}`;
    expect(validateCustomizationNamespace(single(pairNamespace, 'com.acme.warehouse.custom'))).toEqual([]);
    // Control: the same namespace on a base package does warn.
    expect(validateCustomizationNamespace(single(pairNamespace))).toHaveLength(1);
  });

  it('judges only the helper\'s too-long refusal: no namespace, or one the grammar refuses otherwise, is silent', () => {
    expect(validateCustomizationNamespace(single(undefined))).toEqual([]);
    expect(validateCustomizationNamespace(single(''))).toEqual([]);
    // `Warehouse` fails the manifest grammar (uppercase): `os validate`'s refusal, not this rule's.
    expect(customizationNamespace('Warehouse')).toEqual({ ok: false, reason: 'base_namespace_invalid' });
    expect(validateCustomizationNamespace(single('Warehouse'))).toEqual([]);
  });

  it('still judges the namespace when the manifest carries no id', () => {
    const findings = validateCustomizationNamespace(single(PAST_LIMIT, undefined));
    expect(findings.map((f) => [f.where, f.path])).toEqual([['package manifest', 'manifest.namespace']]);
  });

  it('is silent on a stack with no manifest', () => {
    expect(validateCustomizationNamespace({ objects: [] })).toEqual([]);
  });

  describe('an ADR-0130 artifact: the packages one install delivers', () => {
    const artifact = {
      // The artifact's own wrapper manifest is not a package and is not judged.
      manifest: { id: 'com.acme.bundle', version: '1.0.0', type: 'app', namespace: 'acme_bundle_wrapper' },
      packages: [
        { manifest: { id: 'com.acme.core', version: '1.0.0', type: 'app', namespace: AT_LIMIT } },
        { manifest: { id: 'com.acme.orders', version: '1.0.0', type: 'app', namespace: PAST_LIMIT } },
      ],
    };

    it('judges each packages[] body, at its own path, and never the wrapper manifest', () => {
      const findings = validateCustomizationNamespace(artifact);
      expect(findings.map((f) => [f.where, f.path])).toEqual([
        ['package "com.acme.orders"', 'packages[1].manifest.namespace'],
      ]);
    });

    // The CLI's per-package pass (`runPerPackageAuthoringRules`) hands each body
    // back as `{ ...body, manifest: body, packages }` and drops any finding the
    // union run already reported (same rule, where, message and path). This
    // rule reads `packages[]` whenever it is present, so the per-package view
    // yields exactly the union's findings and adds no second copy of one.
    it('the per-package view of each body yields the union run\'s findings, byte for byte', () => {
      const union = validateCustomizationNamespace(artifact);
      for (const entry of artifact.packages) {
        const asStack = { ...entry.manifest, manifest: entry.manifest, packages: artifact.packages };
        expect(validateCustomizationNamespace(asStack)).toEqual(union);
      }
    });
  });
});

describe('validateCustomizationNamespace in the authoring registry', () => {
  it('is registered as an advisory rule on all three commands, CLI surface only', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateCustomizationNamespace');
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe('advisory');
    expect([...entry!.commands].sort()).toEqual([...AUTHORING_COMMANDS].sort());
    expect(entry!.surfaces).toEqual(['cli']);
  });

  it('reaches every authoring command\'s findings as a warning', () => {
    const stack = single(PAST_LIMIT);
    for (const command of AUTHORING_COMMANDS) {
      const findings = runAuthoringRules(command, { normalized: stack, parsed: stack })
        .filter((f) => f.rule === NAMESPACE_NO_CUSTOMIZATION_PAIR);
      expect(findings.map((f) => [f.severity, f.path]), command).toEqual([['warning', 'manifest.namespace']]);
    }
  });

  it('exports its rule id from the root barrel and has an os explain entry', () => {
    expect(indexBarrel.NAMESPACE_NO_CUSTOMIZATION_PAIR).toBe(NAMESPACE_NO_CUSTOMIZATION_PAIR);
    expect(RULE_EXPLANATIONS[NAMESPACE_NO_CUSTOMIZATION_PAIR]?.rule).toBe(NAMESPACE_NO_CUSTOMIZATION_PAIR);
  });
});
