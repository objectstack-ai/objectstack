/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ⭐ THE ORDER-DISCRIMINATING PIN for objectui#6837 half 2, on `plugin-detail`'s
 * two exported protocol readers. The full truth table is stated once, in
 * `app-shell`'s sibling of this file
 * (`utils/__tests__/referenceArms-6837.divergent.test.ts`); the short version
 * is that the legacy-ONLY refusal pins are ORDER-BLIND — they go red under
 * either way of re-widening the chain — while a def whose two keys DISAGREE
 * goes red only under a LEGACY-FIRST re-widening and stays green under a
 * canonical-first one. So the two sets are complementary, not redundant: the
 * refusals say an arm came back, these say which order it came back in.
 * ⛔ Neither set is the other's spare.
 *
 * ## Both readers here read AND write `reference` (objectui#11070 round 4)
 *
 * `enrichDetailField` and `deriveFieldGroupDetailSections` both take the target
 * off an OBJECT SCHEMA field def (the protocol, where `reference` is the only
 * declared spelling) and stamp it onto a `DetailViewField`-shaped bag. Until
 * objectui#11070 round 4 that bag's contract declared `reference_to`, so these
 * pins read `enriched.reference_to` while feeding `reference` — the READ had
 * narrowed and the WRITE had not. Round 4 moved `DetailViewField` to
 * `reference`, so the write narrowed too: the pins below read `reference` back,
 * and each single-key control also asserts that no `reference_to` is emitted.
 */
import { describe, it, expect } from 'vitest';
import { enrichDetailField } from '../fieldEnrichment';
import { deriveFieldGroupDetailSections } from '../synth/buildDefaultPageSchema';

describe('enrichDetailField consults `reference` and emits `reference` (objectui#6837 half 2, objectui#11070 round 4)', () => {
  const enrich = (objectDefField: Record<string, unknown>) =>
    enrichDetailField({ name: 'account_id' }, { type: 'lookup', ...objectDefField });

  it('a divergent def resolves through `reference` — restoring the legacy-first arm turns this red', () => {
    expect(enrich({ reference: 'canonical_target', reference_to: 'legacy_target' }).reference).toBe(
      'canonical_target',
    );
  });

  describe('single-key controls — without these, a helper that enriched nothing would pass the divergent case', () => {
    it('`reference` alone is stamped onto the view field as `reference`, and no `reference_to` is emitted', () => {
      const enriched = enrich({ reference: 'canonical_target' });
      expect(enriched.reference).toBe('canonical_target');
      expect(enriched.reference_to).toBeUndefined();
    });

    it('`reference_to` alone is not read', () => {
      const enriched = enrich({ reference_to: 'canonical_target' });
      expect(enriched.reference).toBeUndefined();
      expect(enriched.reference_to).toBeUndefined();
    });

    it('the field is still enriched either way, so the case above is not passing on an empty result', () => {
      expect(enrich({ reference_to: 'canonical_target' }).type).toBe('lookup');
    });
  });
});

describe('deriveFieldGroupDetailSections consults `reference` and emits `reference` (objectui#6837 half 2, objectui#11070 round 4)', () => {
  const sectionField = (accountField: Record<string, unknown>) => {
    // `deriveFieldGroupLayout` (the spec helper this adapter wraps) needs BOTH
    // halves of ADR-0085's grouping shape: declared groups, and per-field
    // `group` keys pointing into them. With either half missing it returns
    // null and this harness would measure nothing.
    const sections = deriveFieldGroupDetailSections({
      name: 'probe',
      fields: {
        name: { type: 'text', label: 'Name', group: 'main' },
        account_id: { type: 'lookup', label: 'Account', group: 'main', ...accountField },
      },
      fieldGroups: [{ key: 'main', label: 'Main' }],
    } as never);
    const all = (sections ?? []).flatMap((s) => (s.fields ?? []) as Array<Record<string, unknown>>);
    return all.find((f) => f.name === 'account_id');
  };

  it('a divergent def resolves through `reference` — restoring the legacy-first arm turns this red', () => {
    expect(sectionField({ reference: 'canonical_target', reference_to: 'legacy_target' })?.reference).toBe(
      'canonical_target',
    );
  });

  describe('single-key controls', () => {
    it('`reference` alone is stamped onto the section field as `reference`, and no `reference_to` is emitted', () => {
      const field = sectionField({ reference: 'canonical_target' });
      expect(field?.reference).toBe('canonical_target');
      expect(field?.reference_to).toBeUndefined();
    });

    it('`reference_to` alone is not read', () => {
      const field = sectionField({ reference_to: 'canonical_target' });
      expect(field?.reference).toBeUndefined();
      expect(field?.reference_to).toBeUndefined();
    });

    it('the section field is still derived either way, so the case above is not passing on a missing field', () => {
      expect(sectionField({ reference_to: 'canonical_target' })?.type).toBe('lookup');
    });
  });
});
