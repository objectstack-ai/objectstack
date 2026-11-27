// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0150 D3 rule lives in `@objectstack/metadata-core`; core re-exports
 * it (`./package-scoped-resolution.ts`). Two facts are pinned here:
 *
 *  - every value core re-exports IS metadata-core's object (`===`), so there is
 *    one rule and one refusal class: an `instanceof PackageScopedNameRefusedError`
 *    holds whichever package the caller imported it from;
 *  - core's value export set for the rule is exactly the set it had when the
 *    rule lived here, so the move changed no core caller.
 *
 * The rule's own arms are pinned beside it, in
 * `packages/metadata-core/src/package-scoped-resolution.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import * as metadataCore from '@objectstack/metadata-core';
import * as reExported from './package-scoped-resolution.js';
import * as coreIndex from './index.js';

/** Core's value exports for the rule before the move, by name. */
const RULE_VALUE_EXPORTS = [
  'BARE_NAME_ONE_HOLDER_TYPES',
  'ENGINE_FUNCTION_TYPE',
  'NAMESPACE_SCOPED_BARE_NAME_TYPES',
  'OVERRIDABLE_BASELINE_PACKAGES',
  'PACKAGE_SCOPED_TYPES',
  'PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE',
  'PackageScopedNameRefusedError',
  'RUNTIME_COMPATIBILITY_PACKAGE_ID',
  'describeBareNameHolder',
  'describePackageScopedHolder',
  'isBareNameOneHolderType',
  'isNamespaceScopedBareNameType',
  'isOverridableBaseline',
  'isPackageScopedResolvableType',
  'isPackageScopedType',
  'isPlatformRequestedBareName',
  'packageScopedActionOwnersSentence',
  'packageScopedHolderSource',
  'packageScopedRefusalMessage',
  'resolvePackageScopedHolders',
] as const;

describe('the ADR-0150 D3 rule, re-exported by core from metadata-core', () => {
  it('re-exports exactly the value names core exported before the move', () => {
    expect(Object.keys(reExported).sort()).toEqual([...RULE_VALUE_EXPORTS].sort());
  });

  it.each(RULE_VALUE_EXPORTS)('%s is the same object as metadata-core exports, through the module and the index', (name) => {
    const moved = (metadataCore as Record<string, unknown>)[name];
    expect(moved).toBeDefined();
    expect((reExported as Record<string, unknown>)[name]).toBe(moved);
    expect((coreIndex as Record<string, unknown>)[name]).toBe(moved);
  });

  it('a refusal thrown through one package is an instance of the class the other exports', () => {
    // Two package holders and a caller with no package: the rule refuses.
    const outcome = reExported.resolvePackageScopedHolders(
      { type: 'skill', name: 'brief', callerPackageId: null },
      reExported.packageScopedHolderSource([
        ['com.acme.a', true],
        ['com.acme.b', true],
      ]),
      () => new Set<string>(),
    );
    expect(outcome.status).toBe('refused');
    if (outcome.status !== 'refused') return;
    const thrown = new metadataCore.PackageScopedNameRefusedError(outcome);
    expect(thrown).toBeInstanceOf(reExported.PackageScopedNameRefusedError);
    expect(thrown.code).toBe('RESOURCE_CONFLICT');
    expect(thrown.status).toBe(409);
  });
});
