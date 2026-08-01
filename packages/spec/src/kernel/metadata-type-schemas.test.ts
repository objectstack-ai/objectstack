// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Invariants that must hold for EVERY registered metadata type.
 *
 * ## The protection-envelope invariant
 *
 * `MetadataPlugin`'s artifact loader calls `applyProtection` on every registered
 * type, and `getMetaItemLayered` → `saveMetaItem` round-trips a body carrying
 * the stamped `_packageId` / `_provenance`. A type whose schema does not declare
 * {@link MetadataProtectionFields} therefore mishandles it in one of two ways,
 * and the severities are different enough to assert separately:
 *
 * - **Rejects it** (the schema is `.strict()`): a hard 422 on the overlay path.
 *   Live breakage. Asserted unconditionally below — no debt list.
 * - **Strips it** (the schema is strip-mode): the envelope is silently dropped
 *   on every parse, so protection metadata is lost on round-trip. Quieter, and
 *   it becomes the first case the day that schema is closed.
 *
 * ## Why this file exists at all
 *
 * The same defect was found four separate times, by four different routes,
 * before anyone wrote a check for it:
 *
 *   1. `permission` (#4001 Tier-A) — surfaced as a hard 422 on the ADR-0094
 *      overlay path, caught by the dogfood gate.
 *   2. `position` (#4001 step 2) — found by reading, as the "known sibling gap".
 *   3. `seed` + `doc` (#4001 registered-types batch) — found while converting.
 *   4. `hook` + `datasource` — found by THIS test, on its first run. Both had
 *      gone `.strict()` in the #4001 data step without declaring the envelope,
 *      so both were in the hard-422 class on `main` at the time.
 *
 * Finding one defect four times by hand is the signal that the check is
 * missing, not that the search worked. Case 4 is the argument in miniature: two
 * live bugs that three prior hand-searches had walked past.
 */

import { describe, expect, it } from 'vitest';

import { listMetadataTypeSchemaTypes, getMetadataTypeSchema } from './metadata-type-schemas';

/** The ADR-0010 stamp the loader puts on every registered item. */
const STAMP = { _packageId: 'pkg_probe', _provenance: 'package' as const };

/**
 * A body that satisfies the required fields of the registered types generously
 * enough to reach the unknown-key check. Types it does not fully satisfy fail
 * on other grounds, which the assertions below distinguish and ignore — this
 * test is only about how the `_`-prefixed envelope is treated.
 */
const PROBE: Record<string, unknown> = {
  name: 'probe_item',
  label: 'Probe',
  object: 'probe_object',
  records: [],
  content: '# probe',
  type: 'text',
  ...STAMP,
};

/** `_`-prefixed keys the schema reported as unrecognized, if any. */
function rejectedEnvelopeKeys(type: string): string[] {
  const result = getMetadataTypeSchema(type)!.safeParse(PROBE);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .flatMap((i) => (i as unknown as { keys?: string[] }).keys ?? [])
    .filter((k) => k.startsWith('_'));
}

/**
 * Types that parse the envelope but drop it. Every entry is a bug awaiting a
 * `...MetadataProtectionFields` spread, not a permanent exemption — and each
 * becomes a hard 422 the day its schema is closed. Empty this list; never grow
 * it. A new registered type belongs in neither list.
 */
const STRIPS_ENVELOPE = new Set<string>([
  // Registered so a single field can be addressed as a metadata item, but
  // authored inside `object.fields`, where the object's own envelope covers the
  // package. Closing this one means auditing that nesting, so it is tracked
  // rather than bundled into the batch that found it.
  'field',
]);

describe('registered metadata types', () => {
  const types = listMetadataTypeSchemaTypes();

  it('is a non-empty set — guards the derivation returning nothing', () => {
    expect(types.length).toBeGreaterThan(15);
  });

  it.each(types)('%s does not REJECT the protection envelope its loader stamps', (type) => {
    expect(
      rejectedEnvelopeKeys(type),
      `'${type}' is strict and does not declare the ADR-0010 envelope, so `
      + '`applyProtection` output fails to parse — a hard 422 on the overlay path. '
      + 'Add `...MetadataProtectionFields` to its schema.',
    ).toEqual([]);
  });

  it.each(types.filter((t) => !STRIPS_ENVELOPE.has(t)))(
    '%s does not STRIP the protection envelope',
    (type) => {
      const result = getMetadataTypeSchema(type)!.safeParse(PROBE);
      // A probe that fails for unrelated reasons (a required field this generic
      // body does not supply) tells us nothing about stripping — and the reject
      // case is already covered unconditionally above.
      if (!result.success) return;
      expect(
        (result.data as Record<string, unknown>)._packageId,
        `'${type}' silently drops \`_packageId\` — protection metadata is lost on `
        + 'every round-trip. Add `...MetadataProtectionFields` to its schema.',
      ).toBe(STAMP._packageId);
    },
  );

  it('every registered type resolves to a schema', () => {
    for (const type of types) {
      expect(getMetadataTypeSchema(type), `no schema registered for '${type}'`).toBeDefined();
    }
  });
});
