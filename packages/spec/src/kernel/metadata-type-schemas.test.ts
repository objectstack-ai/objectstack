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
 *
 * ## Two iterations, one walker (#6931)
 *
 * The invariant above runs over `listMetadataTypeSchemaTypes()`, the REGISTERED
 * kind set. A second `describe` below runs the envelope half — and only that
 * half — over `listUnregisteredKindSchemaTypes()`, the non-KIND stack
 * collections `UNREGISTERED_KIND_SCHEMAS` binds. Both call the same
 * `objectShapes` walker and the same `rejectedEnvelopeKeys` probe defined here,
 * so the two iterations cannot drift into judging the property differently;
 * only the SET each walks differs, which is the whole point of the split.
 */

import { describe, expect, it } from 'vitest';

import {
  listMetadataTypeSchemaTypes,
  listUnregisteredKindSchemaTypes,
  getMetadataTypeSchema,
} from './metadata-type-schemas';
import { ObjectStackSchema } from '../stack.zod';

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
 * when its groups were closed, leaving 4; `mapping` and `page` when they closed,
 * leaving 2; `field` when it closed, leaving 1.
 *
 * `field` is worth a line of its own: it was the ONE type the original probe
 * actually checked (the other 24 took an early return), so it was the only
 * envelope gap anyone could see for as long as that probe was green — and it
 * outlasted every gap the probe was hiding.
 *
 * **This list is now EMPTY, and that is the end state — not a reason to delete
 * it.** Every registered type declares the envelope its loader stamps. Keeping
 * the empty set means the `DECLARES the protection envelope` case below runs
 * over ALL types with no exemptions, so the day a new registered type ships
 * without the spread it fails immediately rather than being quietly added here.
 * If you find yourself adding a name back, that is a bug being filed, not an
 * exemption being granted.
 */
const UNDECLARED_ENVELOPE = new Set<string>([]);

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
  element?: unknown;
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

/**
 * Non-KIND collections that resolve a schema but do not declare the envelope.
 *
 * The exact counterpart of `UNDECLARED_ENVELOPE` above, kept as a SEPARATE
 * constant on purpose: the two lists exempt from two different iterations, and
 * merging them would be the first step toward treating the two sets as one —
 * which is precisely the status this suite must not grant (see the fence on the
 * describe below).
 *
 * It is EMPTY, and — like its registered sibling — that is the end state, not a
 * reason to delete it. All three bound kinds declare the envelope as of PR
 * #6900; keeping the empty set means the case below runs over ALL of them with
 * no exemptions, so a FOURTH entry added to `UNREGISTERED_KIND_SCHEMAS` without
 * the spread fails immediately instead of being quietly added here. Adding a
 * name back is a bug being filed, not an exemption being granted.
 */
const UNDECLARED_ENVELOPE_UNREGISTERED = new Set<string>([]);

/**
 * The same ADR-0010 envelope invariant, over the collections the registered
 * walk cannot see (#6931).
 *
 * ## Why these need their own iteration
 *
 * `webhook` / `connector` / `sharing_rule` are bound in
 * `UNREGISTERED_KIND_SCHEMAS` and wired to `PUT /api/v1/meta/:type/:name` by
 * #6245 — real parse doors — while `listMetadataTypeSchemaTypes()` deliberately
 * excludes them, so the invariant above never ran over any of them. The gate's
 * empty debt list nevertheless read as total coverage. All three were therefore
 * judged ONE AT A TIME, BY HAND, for a property this file already automates:
 * `sharing_rule` is `.strict()`, so its undeclared envelope surfaced as a hard
 * 422 that #6245 hit; `connector` is a plain `z.object`, so it silently stripped
 * all seven keys and needed a separate card and a hand-written probe roughly a
 * day later (#6362 / PR #6900); `webhook` happened to be fine from #4001 batch
 * 11, but nothing verified that either — #6362 had to measure it by hand to find
 * out, which is what a gate is for.
 *
 * ## The fence — this enrolls them in a TEST ITERATION, nothing else
 *
 * Triage ruling on #6931: "the fix enrolls them in the **test's iteration only**
 * (assert envelope posture or an explicit debt entry); it must NOT grant them
 * KIND status — #2657's B/C decision stays open, exactly as the schemas file's
 * comment intends."
 *
 * So this block asserts the envelope property and NOTHING else. The obligations
 * of being a KIND stay where they were and keep walking the registered set
 * alone: the #4001 closure campaign and its count (the `describe` below),
 * `metadata-create-seeds`, `MetadataTypeSchema` membership,
 * `DEFAULT_METADATA_TYPE_REGISTRY` descriptors. In particular there is
 * deliberately NO unknown-key/posture case here — `sharing_rule` is strict and
 * `connector` is not, and choosing between them is #2657's decision to make, not
 * this suite's.
 */
describe('#6931 — the envelope invariant also covers UNREGISTERED_KIND_SCHEMAS', () => {
  const bound = listUnregisteredKindSchemaTypes();

  it('is a non-empty set — guards the derivation returning nothing', () => {
    // `it.each([])` registers no cases and reports green, so an export that
    // silently answered `[]` would restore the exact blind spot this closes.
    expect(bound.length).toBeGreaterThan(0);
  });

  it('stays OUT of the registered-kind set — the #6245 fence, pinned', () => {
    // The scope fence, made mechanical: enrollment here must never leak into
    // `listMetadataTypeSchemaTypes()`, which is what would attach the KIND
    // obligations #2657 has not decided to attach. Should #2657 later resolve to
    // promote one of these, that is a deliberate act — it moves the name into
    // BUILTIN_METADATA_TYPE_SCHEMAS with its create seed, registry entry and
    // campaign-count update, and this pin is what makes the move visible rather
    // than a veto on making it.
    const registered = listMetadataTypeSchemaTypes();
    for (const type of bound) {
      expect(registered, `'${type}' is now a registered kind`).not.toContain(type);
    }
  });

  it.each(bound)('%s resolves to a schema', (type) => {
    expect(getMetadataTypeSchema(type), `no schema bound for '${type}'`).toBeDefined();
  });

  /** The same no-silent-skip guard the registered walk carries, same walker. */
  it.each(bound)('%s resolves to at least one object shape the walker understands', (type) => {
    expect(
      objectShapes(getMetadataTypeSchema(type)).length,
      `the structural walker cannot resolve '${type}' to an object shape, so the `
      + 'envelope assertion below would silently skip it. Teach `objectShapes` the '
      + 'wrapper this schema uses.',
    ).toBeGreaterThan(0);
  });

  it.each(bound)('%s does not REJECT the protection envelope', (type) => {
    // `sharing_rule`'s class: strict + undeclared ⇒ a hard 422 on the write door.
    expect(
      rejectedEnvelopeKeys(type),
      `'${type}' is strict and does not declare the ADR-0010 envelope, so a body `
      + 'carrying the stamped keys fails to parse — a hard 422 on `PUT /meta/'
      + `${type}/:name\`. Add \`...MetadataProtectionFields\` to its schema.`,
    ).toEqual([]);
  });

  it.each(bound.filter((t) => !UNDECLARED_ENVELOPE_UNREGISTERED.has(t)))(
    '%s DECLARES the protection envelope',
    (type) => {
      // `connector`'s class: non-strict + undeclared ⇒ a SILENT strip, no 422,
      // nothing in any log. The quieter half, and the one that survived #6245.
      const shapes = objectShapes(getMetadataTypeSchema(type));
      expect(
        shapes.some((shape) => '_packageId' in shape),
        `'${type}' does not declare \`_packageId\`, so the envelope is dropped on every `
        + 'parse through `PUT /meta` — silently, if the schema is not strict. Add '
        + '`...MetadataProtectionFields` to its schema.',
      ).toBe(true);
    },
  );

  it.each([...UNDECLARED_ENVELOPE_UNREGISTERED])(
    '%s is still on the undeclared-envelope debt list (remove it once fixed)',
    (type) => {
      // The reverse pin, as above: fixing one fails this until the list shrinks,
      // so the debt list cannot outlive the debt.
      expect(bound).toContain(type);
      const shapes = objectShapes(getMetadataTypeSchema(type));
      expect(
        shapes.some((shape) => '_packageId' in shape),
        `'${type}' now declares the envelope — remove it from `
        + 'UNDECLARED_ENVELOPE_UNREGISTERED.',
      ).toBe(false);
    },
  );
});

/**
 * [#10194] The map's own closing invariant, pinned instead of trusted.
 *
 * `UNREGISTERED_KIND_SCHEMAS` closes with: "Each entry binds the SAME schema
 * its stack collection is validated against in `stack.zod.ts`, so no body can
 * be legal in a stack and illegal through `/meta` or the reverse." That
 * sentence was prose until #10194 found its converse failure mode — two stack
 * collections (`themes`, `analyticsCubes`) with strict schemas and NO map
 * entry, so the divergence the sentence forbids simply lived outside the map.
 *
 * Two halves, both load-bearing:
 *
 *   1. IDENTITY, not equivalence: the map entry must be the very same schema
 *      object the stack collection's `z.array(...)` element is. A re-built
 *      "equal" schema would drift the day either side gains a rule.
 *   2. The mapping table below must cover exactly the bound set, so a sixth
 *      entry added to the map without a row here fails loudly instead of
 *      escaping the invariant.
 *
 * What this deliberately does NOT assert: that every stack collection has a
 * map entry. `rag_pipeline` has no stack collection at all (#6242 row 2), and
 * whether more collections should bind is #2657's B/C decision — this pin
 * holds the invariant for the entries that exist, nothing more.
 */
const STACK_COLLECTION_OF: Record<string, string> = {
  webhook: 'webhooks',
  connector: 'connectors',
  sharing_rule: 'sharingRules',
  theme: 'themes',
  analytics_cube: 'analyticsCubes',
};

/** Unwrap `optional`/`default`/`lazy`… down to an array's element schema. */
function arrayElementOf(schema: unknown, depth = 0): unknown {
  if (!schema || depth > 12) return undefined;
  const s = schema as { _zod?: { def?: Def }; def?: Def };
  const def = s._zod?.def ?? s.def;
  switch (def?.type) {
    case 'array':
      return def.element;
    case 'lazy':
      try {
        return arrayElementOf(def.getter?.(), depth + 1);
      } catch {
        return undefined;
      }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      return arrayElementOf(def.innerType, depth + 1);
    default:
      return undefined;
  }
}

describe('#10194 — each bound entry IS its stack collection\'s schema', () => {
  it('the mapping table covers exactly the bound set', () => {
    expect(Object.keys(STACK_COLLECTION_OF).sort()).toEqual(listUnregisteredKindSchemaTypes());
  });

  it.each(Object.entries(STACK_COLLECTION_OF))(
    '`%s` binds the same schema `stack.zod.ts` validates `%s` with',
    (kind, collection) => {
      const stackShapes = objectShapes(ObjectStackSchema);
      expect(
        stackShapes.length,
        'the walker cannot resolve ObjectStackSchema to an object shape',
      ).toBeGreaterThan(0);

      const collectionSchema = stackShapes
        .map((shape) => shape[collection])
        .find((v) => v !== undefined);
      expect(
        collectionSchema,
        `stack.zod.ts no longer declares a \`${collection}\` collection — if it was `
        + 'renamed, update STACK_COLLECTION_OF; if it was removed, the map entry it '
        + 'validated needs a decision, not a silent unpin.',
      ).toBeDefined();

      const element = arrayElementOf(collectionSchema);
      expect(
        element,
        `\`${collection}\` no longer unwraps to z.array(<schema>) — teach arrayElementOf `
        + 'the new wrapper.',
      ).toBeDefined();

      // Identity, not structural equality — see the docblock.
      expect(element).toBe(getMetadataTypeSchema(kind));
    },
  );
});

/**
 * The #4001 headline number, derived instead of tallied.
 *
 * "N of 25 registered types closed" was carried by hand across batches and had
 * drifted by one before anyone measured it — in a campaign whose recurring
 * finding is that hand-maintained measurements of coverage go stale (the ledger
 * gate's non-recursive walk, the hollow envelope probe, the lint's root-gated
 * posture). A number nobody can check is the same class of instrument.
 *
 * `STILL_STRIP` carries the same reverse pin as `UNDECLARED_ENVELOPE`: closing a
 * type fails this suite until the list shrinks, so the list cannot outlive the
 * debt and start exempting types that no longer need exempting.
 *
 * ## `view` is the end state, not the last item of debt
 *
 * 24 of 25 are closed and the 25th will not be, for a reason worth stating so
 * nobody "finishes the job" by force. The registered `view` schema is a UNION
 * over the runtime shapes a `view` body really takes, and THREE of its four
 * members are deliberately `.strip()`:
 *
 *   • member 1, `ViewItemWireSchema` — the wire variant of `ViewItemSchema`;
 *   • members 3 and 4, the flattened personalization overlays.
 *
 * All three carry Studio's auxiliary round-trip keys (`isPinned`, `sortOrder`,
 * …) that `saveMetaItem` persists verbatim, so closing any of them would 422 a
 * shape the platform itself writes. A union is only as closed as its most open
 * member, so `view` reads `strip` and always will.
 *
 * ⚠️ [#5074] This paragraph used to name the flattened overlay as "the one
 * deliberately open member" and say nothing about member 1 — which was ALSO
 * open, and open by accident rather than by decision. That gap was #5074's
 * finding: member 1 was the shape `updateView` PUTs a pin through, so it had a
 * wire contract nobody had written down. It now has a name, a declared home for
 * the aux keys, and a strict authoring twin (`ViewItemSchema`). Do not shorten
 * this back to "the overlay".
 *
 * What DID close is everything an author writes: `ViewSchema` (the container),
 * `ViewItemSchema`, `ListViewSchema`, `FormViewSchema`, and the ~28 config
 * shapes under them. The open members are wire shapes, now wearing their own
 * names — which is exactly the distinction the ledger's classification rule
 * exists to draw, arriving here as the campaign's final answer rather than as an
 * exception to it.
 *
 * ## `api` arrived (2026-08-04, #5271) and has now LEFT this list (#5384)
 *
 * Kept as history, because the two entries looked identical and only one of
 * them was the end state — and telling them apart is what this list is for.
 *
 * `api` joined the registry after the campaign ended and landed here wearing
 * `view`'s clothes: `ApiEndpointSchema` is not only an authoring surface — it
 * is what STORED rows were parsed with, by `buildEndpointIndex`
 * (`packages/metadata/src/endpoint-matcher.ts`) and by
 * `MetadataManager.publishPackage`'s `gateApiItemsForPublish`. A stored row
 * carries the metadata layer's own bookkeeping (`packageId`, `state`, `version`,
 * `published*` — written by `register` / `publishPackage`, and read back by
 * `publishPackage`'s package filter), which is not endpoint vocabulary.
 *
 * That was MEASURED, not assumed. Closing the shape with `strictObject` turned
 * every stored row into `unrecognized_keys: ['packageId', 'state']`: the
 * load-time backstop then excluded the endpoint (its route answered 404) and the
 * publish gate reported a schema error in place of the ADR-0121 D6 verdict it
 * exists to give — 11 tests in `packages/metadata` went red, which is what
 * surfaced it. The conclusion drawn at the time was the one that held up: the
 * debt was real and it was NOT in this vocabulary.
 *
 * **#5309 (PR #6576) paid it at the right layer** — `peelStoredEnvelope`
 * (`packages/metadata/src/stored-envelope.ts`) takes the envelope off before the
 * body parse, at both parse sites — and under a strict probe on that tree
 * exactly ONE test remained red, a fixture planting an authored `namespace` key
 * that the closed shape now refuses by name. So `api` closed at **#5384** as an
 * ordinary #4001 conversion, and it is off this list. `ApiEndpointSchema` never
 * learned a bookkeeping key: teaching it two would have made the authoring
 * contract describe the storage layer, which is the trade this campaign refuses.
 *
 * So: `view` is the end state, and `api` was tracked debt with a named owner
 * that got paid. Both were here for the same underlying reason — one type name
 * serving both an authored document and a wire row — and the difference is that
 * `view`'s open members are wire shapes with nowhere else to live, while `api`'s
 * envelope had a layer that could own it. A future entry on this list should be
 * asked which of the two it is before it is accepted as permanent.
 */
const STILL_STRIP = new Set<string>(['view']);

/** The registered schema's own top-level posture: `.strict()` sets a `never` catchall. */
function topLevelPosture(schema: unknown, depth = 0): 'strict' | 'strip' | null {
  if (!schema || depth > 12) return null;
  const s = schema as { _zod?: { def?: Def }; def?: Def };
  const def = s._zod?.def ?? s.def;
  switch (def?.type) {
    case 'object': {
      const catchall = (def as { catchall?: { _zod?: { def?: Def } } }).catchall;
      return catchall?._zod?.def?.type === 'never' ? 'strict' : 'strip';
    }
    case 'lazy':
      try {
        return topLevelPosture(def.getter?.(), depth + 1);
      } catch {
        return null;
      }
    case 'pipe':
      return topLevelPosture(def.out, depth + 1) ?? topLevelPosture(def.in, depth + 1);
    case 'union': {
      // A union is closed only when EVERY variant is — one open variant is an
      // open door, and `validation` is exactly this shape.
      const seen = (def.options ?? []).map((o) => topLevelPosture(o, depth + 1));
      if (seen.length === 0) return null;
      if (seen.every((r) => r === 'strict')) return 'strict';
      return seen.some((r) => r !== null) ? 'strip' : null;
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      return topLevelPosture(def.innerType, depth + 1);
    default:
      return null;
  }
}

describe('#4001 — registered-type closure is derived, not tallied', () => {
  const types = listMetadataTypeSchemaTypes();

  it.each(types.filter((t) => !STILL_STRIP.has(t)))('%s REJECTS unknown keys', (type) => {
    const posture = topLevelPosture(getMetadataTypeSchema(type));
    // A type the walker cannot resolve is a hard failure, never a pass — the
    // walker going quiet is precisely when this would stop covering something.
    expect(posture, `could not resolve a top-level posture for '${type}'`).not.toBeNull();
    expect(
      posture,
      `'${type}' still strips unknown keys. Close it with \`strictObject\`, or add it to `
      + 'STILL_STRIP with a reason.',
    ).toBe('strict');
  });

  it.each([...STILL_STRIP])('%s is still on the strip list (remove it once closed)', (type) => {
    expect(types).toContain(type);
    expect(
      topLevelPosture(getMetadataTypeSchema(type)),
      `'${type}' is now strict — remove it from STILL_STRIP and update the count.`,
    ).toBe('strip');
  });

  it('reports the campaign number so a reader never has to count', () => {
    const closed = types.filter((t) => !STILL_STRIP.has(t));
    expect(closed.length + STILL_STRIP.size).toBe(types.length);
    // 25 → 24 on 2026-08-02: `validation` left the registry entirely (#4509,
    // ADR-0088 retirement), taking an already-closed schema with it. The
    // campaign's closure ratio is unchanged — one fewer registered type, not
    // one fewer closed one.
    //
    // 24 → 25 on 2026-08-04: `api` JOINED the registry (#5271, part of #5206),
    // the first new registered kind since the campaign ended. It declares the
    // protection envelope (so `UNDECLARED_ENVELOPE` stays empty) but goes onto
    // STILL_STRIP — measured, see that list's note: the same schema parses
    // stored rows carrying `packageId` / `state`, so closing it breaks the
    // load-time backstop and the publish gate. Closed count is therefore
    // unchanged at 23 while the registered total moves to 25.
    //
    // 25 → 26 on 2026-08-08: `capability` JOINED the registry (#5961), under
    // the same template `api` used. Unlike `api` it lands CLOSED —
    // `CapabilityDeclarationSchema` is only an AUTHORING surface, so
    // `strict()` cost nothing: nothing re-parses a stored `sys_capability` row
    // through it (`bootstrapDeclaredCapabilities` reads named fields off the
    // body via `capabilityRowFields`), which is exactly the property `api`
    // lacks. So the closed count moves with the total, 23 → 24, and
    // `STILL_STRIP` does not grow.
    //
    // 24 → 25 CLOSED on 2026-08-08: `api` closed (#5384). The registered total
    // does not move — only the posture does. The property `capability` had and
    // `api` lacked above turned out not to be a permanent difference: #5309
    // (PR #6576) gave the stored envelope a layer of its own
    // (`peelStoredEnvelope`), so nothing re-parses a stored `api` row through
    // this schema either, and the conversion became an ordinary #4001 one.
    // `STILL_STRIP` shrinks to `view` alone, which IS the end state — its open
    // members are wire shapes with nowhere else to live (see that list's note).
    expect(closed.length).toBe(25);
    expect(types.length).toBe(26);
  });
});
