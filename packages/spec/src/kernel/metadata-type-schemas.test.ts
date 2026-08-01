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
 * and the severities differ enough to assert separately:
 *
 * - **Rejects it** (the schema is `.strict()`): a hard 422 on the overlay path.
 *   Live breakage. Asserted unconditionally — no exemption list.
 * - **Does not declare it** (strip mode): the envelope is silently dropped on
 *   every parse, so protection metadata is lost on round-trip. Quieter, and it
 *   becomes the first case the day that schema is closed.
 *
 * ## Why this file exists
 *
 * The same defect was found four separate times, by four different routes,
 * before anyone wrote a check for it: `permission` (#4001 Tier-A, as a hard 422
 * caught by the dogfood gate), `position` (step 2, by reading), `seed` + `doc`
 * (the registered-types batch, while converting), and then `hook` +
 * `datasource` — which THIS test found on its first run, both already strict on
 * `main` and therefore both in the 422 class.
 *
 * ## Why the declaration check is structural, not a parse probe
 *
 * The first version of this file probed with one generic body and asked whether
 * `_packageId` survived. It reported green. It was hollow: a type whose required
 * fields the generic body did not satisfy failed for unrelated reasons, and the
 * assertion returned early — **so 24 of 25 types were silently skipped and only
 * `field` was ever really checked.** A check that skips is indistinguishable
 * from a check that passes, which is the exact defect this whole campaign is
 * about, reproduced in the instrument built to detect it.
 *
 * So the declaration side now walks the schema structurally — unwrapping
 * `lazy` / `pipe` / `optional` / `default` and expanding unions — and asks
 * whether any resolved object shape declares the key. That answer does not
 * depend on constructing a valid instance, so it cannot skip. And a type whose
 * shape cannot be resolved at all is a hard FAILURE rather than a pass: the
 * walker not understanding a schema is exactly when this test would otherwise
 * go quiet.
 */

import { describe, expect, it } from 'vitest';

import { listMetadataTypeSchemaTypes, getMetadataTypeSchema } from './metadata-type-schemas';

/** The ADR-0010 stamp the loader puts on every registered item. */
const STAMP = { _packageId: 'pkg_probe', _provenance: 'package' as const };

/** A body generous enough to reach the unknown-key check on most types. */
const PROBE: Record<string, unknown> = {
  name: 'probe_item',
  label: 'Probe',
  object: 'probe_object',
  records: [],
  content: '# probe',
  type: 'text',
  ...STAMP,
};

/**
 * Registered types that parse the envelope but do not declare it, so it is
 * dropped on every round-trip. Every entry is a bug awaiting a
 * `...MetadataProtectionFields` spread — not a permanent exemption — and each
 * becomes a hard 422 the day its schema is closed. Empty this list; never grow
 * it. A NEW registered type belongs in neither list.
 *
 * The structural walk found 8 of these; the probe it replaced had been hiding 7.
 * `job` and `book` were closed in the same pass, leaving 6; `validation` came off
 * when its six union variants were converted, leaving 5; `translation` came off
 * when its groups were closed, leaving 4.
 */
const UNDECLARED_ENVELOPE = new Set<string>([
  'action', 'field', 'mapping', 'page',
]);

/**
 * Every object shape reachable from `schema`, unwrapping the wrappers the
 * registered types actually use and expanding unions. Returns `[]` only when
 * the walker does not understand the schema — which the caller treats as a
 * failure, never as a pass.
 */
function objectShapes(schema: unknown, depth = 0): Record<string, unknown>[] {
  if (!schema || depth > 12) return [];
  const s = schema as { shape?: Record<string, unknown>; _zod?: { def?: Def }; def?: Def };
  const def = s._zod?.def ?? s.def;
  switch (def?.type) {
    case 'object':
      return [s.shape ?? def.shape ?? {}];
    case 'lazy':
      try {
        return objectShapes(def.getter?.(), depth + 1);
      } catch {
        return [];
      }
    case 'pipe':
      return [...objectShapes(def.in, depth + 1), ...objectShapes(def.out, depth + 1)];
    case 'union':
      return (def.options ?? []).flatMap((o) => objectShapes(o, depth + 1));
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      return objectShapes(def.innerType, depth + 1);
    default:
      return [];
  }
}

interface Def {
  type?: string;
  shape?: Record<string, unknown>;
  getter?: () => unknown;
  in?: unknown;
  out?: unknown;
  options?: unknown[];
  innerType?: unknown;
}

/** `_`-prefixed keys the schema reported as unrecognized, if any. */
function rejectedEnvelopeKeys(type: string): string[] {
  const result = getMetadataTypeSchema(type)!.safeParse(PROBE);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .flatMap((i) => (i as unknown as { keys?: string[] }).keys ?? [])
    .filter((k) => k.startsWith('_'));
}

describe('registered metadata types', () => {
  const types = listMetadataTypeSchemaTypes();

  it('is a non-empty set — guards the derivation returning nothing', () => {
    expect(types.length).toBeGreaterThan(15);
  });

  it('every registered type resolves to a schema', () => {
    for (const type of types) {
      expect(getMetadataTypeSchema(type), `no schema registered for '${type}'`).toBeDefined();
    }
  });

  /**
   * The no-silent-skip guard. If the walker stops understanding a schema shape,
   * the declaration assertions below would quietly stop covering that type —
   * so that condition fails here first, loudly, with the type named.
   */
  it.each(types)('%s resolves to at least one object shape the walker understands', (type) => {
    expect(
      objectShapes(getMetadataTypeSchema(type)).length,
      `the structural walker cannot resolve '${type}' to an object shape, so the `
      + 'envelope assertions below would silently skip it. Teach `objectShapes` the '
      + 'wrapper this schema uses.',
    ).toBeGreaterThan(0);
  });

  it.each(types)('%s does not REJECT the protection envelope its loader stamps', (type) => {
    expect(
      rejectedEnvelopeKeys(type),
      `'${type}' is strict and does not declare the ADR-0010 envelope, so `
      + '`applyProtection` output fails to parse — a hard 422 on the overlay path. '
      + 'Add `...MetadataProtectionFields` to its schema.',
    ).toEqual([]);
  });

  it.each(types.filter((t) => !UNDECLARED_ENVELOPE.has(t)))(
    '%s DECLARES the protection envelope',
    (type) => {
      const shapes = objectShapes(getMetadataTypeSchema(type));
      expect(
        shapes.some((shape) => '_packageId' in shape),
        `'${type}' does not declare \`_packageId\`, so the envelope its loader stamps is `
        + 'dropped on every parse. Add `...MetadataProtectionFields` to its schema.',
      ).toBe(true);
    },
  );

  it.each([...UNDECLARED_ENVELOPE])(
    '%s is still on the undeclared-envelope debt list (remove it once fixed)',
    (type) => {
      // A reverse pin: when someone fixes one of these, this fails and forces the
      // list to shrink. Without it the debt list would outlive the debt and start
      // exempting types that no longer need exempting.
      expect(types).toContain(type);
      const shapes = objectShapes(getMetadataTypeSchema(type));
      expect(
        shapes.some((shape) => '_packageId' in shape),
        `'${type}' now declares the envelope — remove it from UNDECLARED_ENVELOPE.`,
      ).toBe(false);
    },
  );
});
