// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The directory-lookup table is derived from the spec, not restated** (objectui#3017).
 *
 * `KIND_TO_RECORD_LOOKUP` used to hard-code `object` / `valueField` for the four
 * directory-backed kinds under a comment saying it mirrored the spec's
 * `APPROVER_VALUE_BINDINGS`. It now composes objectui's presentation on top of
 * the published `APPROVER_VALUE_SOURCES`, so those two fields cannot drift by
 * construction.
 *
 * What is still worth asserting is that the composition stays WIRED. Two ways it
 * could quietly stop being: the derivation could yield an empty table (every
 * kind skipped because the spec changed shape), or a kind could lose its
 * `data` source and vanish from the picker. Both would degrade a resolvable
 * reference back to a free-text box — exactly the framework #3508 failure that
 * publishing the binding existed to end, and exactly the kind of regression a
 * comment cannot catch.
 */

import { describe, it, expect } from 'vitest';
import { APPROVER_VALUE_SOURCES } from '@objectstack/spec/automation';

import { KIND_TO_RECORD_LOOKUP } from './FlowReferenceField';
import { APPROVER_REGISTRY_TYPES } from '../../../utils/approverValueSources.js';

/**
 * The directory-backed kinds this package renders a record lookup for.
 * `position` left this list on the move to `@objectstack/spec` 18
 * (objectui#12030): the spec binds it to the metadata registry
 * (objectstack#22710), so its picker is the registry arm the
 * `FlowReferenceField.*-7611` tests pin, as `approverValueSources.ts` said it
 * would be.
 */
const EXPECTED_KINDS = ['user', 'team', 'department'] as const;

describe('KIND_TO_RECORD_LOOKUP is derived from APPROVER_VALUE_SOURCES (objectui#3017)', () => {
  it('is not vacuous — the derivation still produces every expected kind', () => {
    // If the spec renamed these keys or changed their `source`, the flatMap
    // would skip them and the table would silently shrink.
    expect(Object.keys(KIND_TO_RECORD_LOOKUP).sort()).toEqual([...EXPECTED_KINDS].sort());
  });

  it.each(EXPECTED_KINDS)('%s: object + valueField come from the spec, not a local literal', (kind) => {
    const source = APPROVER_VALUE_SOURCES[kind as keyof typeof APPROVER_VALUE_SOURCES];
    expect(source, `spec no longer declares an approver binding for '${kind}'`).toBeDefined();
    expect(
      source.source,
      `spec changed '${kind}' away from a record lookup — the picker needs rethinking, not just re-deriving`,
    ).toBe('data');

    const binding = KIND_TO_RECORD_LOOKUP[kind];
    expect(binding).toBeDefined();
    expect(binding!.object).toBe((source as { object: string }).object);
    expect(binding!.valueField).toBe((source as { valueField: string }).valueField);
  });

  it('keeps presentation local — the spec publishes no display hints', () => {
    // The split is the point: the spec owns WHERE candidates come from and WHAT
    // is committed; this package owns what the row looks like. A spec that
    // started publishing display hints would make this assertion fail and force
    // the boundary to be re-drawn deliberately.
    for (const kind of EXPECTED_KINDS) {
      const source = APPROVER_VALUE_SOURCES[kind as keyof typeof APPROVER_VALUE_SOURCES] as Record<string, unknown>;
      expect(Object.keys(source).sort()).toEqual(['object', 'source', 'valueField']);
      expect(KIND_TO_RECORD_LOOKUP[kind]!.displayField).toBeTruthy();
    }
  });

  it('the people picker stays on `user` only', () => {
    // `picker: 'search'` opts into avatar rows; it is presentation, so it must
    // survive the derivation rather than be lost when the binding is composed.
    expect(KIND_TO_RECORD_LOOKUP.user?.picker).toBe('search');
    expect(KIND_TO_RECORD_LOOKUP.user?.subtitle).toEqual(['email']);
    for (const kind of ['team', 'department'] as const) {
      expect(KIND_TO_RECORD_LOOKUP[kind]?.picker).toBeUndefined();
    }
  });

  it('`position` is the registry member, so it has no record lookup (objectui#12030)', () => {
    expect(APPROVER_VALUE_SOURCES.position).toEqual({ source: 'registry', type: 'position' });
    expect(KIND_TO_RECORD_LOOKUP).not.toHaveProperty('position');
    expect(APPROVER_REGISTRY_TYPES).toEqual({ position: 'position' });
  });
});
