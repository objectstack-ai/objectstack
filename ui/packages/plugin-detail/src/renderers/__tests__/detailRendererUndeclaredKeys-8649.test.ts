/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8649 — the twelve undeclared reads across four record renderers do
 * NOT share one cause and do NOT share one exit. This file is the instrument
 * for every claim the ruling rests on, so each is re-derived on every run
 * instead of being written down once (AGENTS.md #9).
 *
 * ## The two causes, measured with the checker (objectui#8410: never a grep)
 *
 *   - `record-details.tsx`, `record-highlights.tsx` and `record-related-list.tsx`
 *     annotate `schema` correctly and then destructure it as `schema = {} as any`.
 *     A destructuring default's type joins the annotation at the binding, so
 *     `any` ERASED the annotation for every read site in the file — declared
 *     keys (`hideFields`, `add`, `columns`, `sort`, …) and undeclared ones
 *     (`enforceFieldSecurity`, …) alike read `any`, indistinguishably. That is a
 *     local type defect with no published-surface consequence, and repairing it
 *     is the prerequisite to classifying anything: before it, the checker cannot
 *     tell an author's key from a host's at any of those sites.
 *   - `record-reference-rail.tsx` has the OTHER cause. Its `schema` type is not
 *     erased; `properties` is simply not a declared member of it and compiles
 *     through the `[k: string]: any` index signature.
 *
 * ## The exits, one per key — determined by the contract, not by preference
 *
 * `@object-ui/types` is a MIRROR of `@objectstack/spec`, not an authority, so
 * declaring a key the platform does not declare would make this repo accept what
 * the platform refuses. The question per key is therefore: does the contract
 * declare it, and on WHICH schema? Both halves matter — a token that exists
 * somewhere under the UI contract is not a declaration on the schema a given
 * node maps to. {@link declaringBlocksOf} answers exactly that, over the
 * installed published artifact, every run.
 *
 *   - `hideFields` (`record-details`) — DECLARED, on `RecordDetailsProps` and
 *     already on this repo's mirror since objectui#9040. The card listed it only
 *     because the erasure hid it. ⇒ nothing to rule; the erasure repair alone
 *     makes the checker see it.
 *   - `relationshipValueField` (`record-related-list`) — DECLARED on
 *     `RecordRelatedListProps` and published by this block's registry `inputs`
 *     (`recordRelatedListInputs.spec-parity.test.ts`), while the mirror
 *     interface omitted it. That is objectui#9040's Direction 1 one interface
 *     over: a spec-valid, renderer-honoured, registry-published document refused
 *     by `tsc` with `TS2353`. ⇒ ALIGN THE MIRROR.
 *   - `properties` (`record-reference-rail`) — DECLARED by the contract at NODE
 *     level on `PageComponentSchema` ("Component props passed to the widget"),
 *     which is the same standing `dataSource` and `className` have in
 *     `recordRelatedListInputs.spec-parity.test.ts`. ⇒ ALIGN THE MIRROR, for the
 *     one member this renderer reads off the envelope.
 *   - The field-security triple — `enforceFieldSecurity`, `redactFields`,
 *     `requiredPermissions` (three renderers each). Through `@objectstack/spec`
 *     17.4.0 the first two were declared by NO block the UI contract maps, and
 *     `requiredPermissions` only on the sibling block `record:quick_actions` —
 *     the reading a word-frequency screen got backwards. The first landing of
 *     this card ROUTED all three to the producer (objectstack#18159), ⛔ neither
 *     declared nor retired: the renderers honoured them on the raw-node path,
 *     and changing runtime masking or permission behaviour is the maintainer
 *     floor this card must not cross.
 *   - ⭐ The routed card LANDED (objectstack PR #19913, ruling A) and shipped in
 *     `@objectstack/spec` 17.5.0: all three keys are declared on exactly these
 *     three blocks. The census rows below fired at the 17.5.0 bump
 *     (objectui#11073), which declared nothing; this card's SECOND landing took
 *     the exit that expiry left — ALIGN THE MIRROR: the three keys are declared
 *     on the three props interfaces, the reads are un-cast, and the three
 *     blocks' registry `inputs` publish them. The emitted JavaScript of the three
 *     renderers is byte-identical, so no gating or masking behaviour moved.
 *
 * ## What each leg can and cannot prove
 *
 *   - The `Equal` legs are compiled by `tsc -p tsconfig.test.json` and by nothing
 *     else — vitest strips types. They are the ONLY half that discriminates the
 *     two mirror alignments from their defect, because that defect was a
 *     TypeScript-only refusal.
 *   - The census legs read the INSTALLED `@objectstack/spec` artifact, over the
 *     contract's own block-tag map plus the node envelope — the surface an
 *     author actually writes into. They are
 *     the PREMISE of the routing decision, never its evidence: they were green
 *     before this card and are green after. They earn their place by going RED
 *     the day the platform declares one of the routed keys — which is the signal
 *     that the routed card landed and this repo owes the mirror an update.
 *   - The source-text legs read the three renderers through the shared comment
 *     mask, so a re-introduced `{} as any` is caught by a run that never
 *     type-checks. Each carries a control that varies only the claim.
 *   - {@link ALIGNED_TRIPLE} names the renderer files each triple key is read
 *     in. Every entry is asserted STILL READ, and read UN-CAST: a cast between
 *     `schema` and the key would spend the declaration at its own read site —
 *     the D1 shape this card's first contract review found — while every
 *     membership-shaped leg above stayed green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// ⛔ NOT `import * as` from '@objectstack/spec/ui'. A namespace import pulls in
// the restricted form-VIEW vocabulary (`FormField` / `FormFieldSchema`,
// objectui#3090) whose type erases to `any`, and the repo's `no-restricted-imports`
// rule refuses it by name. Named imports are also the better instrument here:
// they make the census population a DECLARED set rather than "whatever the module
// happens to export".
import {
  ComponentPropsMap,
  PageComponentSchema,
  RecordRelatedListProps,
  type ComponentPropsInput,
  type ReferenceRailEntry,
} from '@objectstack/spec/ui';
import type {
  RecordDetailsComponentProps,
  RecordHighlightsComponentProps,
  RecordRelatedListComponentProps,
} from '@object-ui/types';
import type { RecordReferenceRailRendererProps } from '../record-reference-rail';
import type { RecordDetailsRendererProps } from '../record-details';
import type { RecordHighlightsRendererProps } from '../record-highlights';
import type { RecordRelatedListRendererProps } from '../record-related-list';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/** Rooted at THIS file, never at `process.cwd()` — the two differ per invocation. */
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERERS = join(HERE, '..');

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

/**
 * What an author writes for the spec's `record:related_list` props bag, reached
 * through the contract's own block-tag map rather than through a named schema
 * export — so the pin is bound to the tag this renderer registers. `zod` is not
 * a dependency of this package and must not become one for a type alias; the
 * contract already publishes this derivation.
 *
 * The map entry and the named export being the SAME schema is the premise of
 * that indirection, and it is asserted at runtime below rather than assumed.
 */
type SpecRelatedListProps = ComponentPropsInput<'record:related_list'>;

/** Invariant type equality. `A extends B` is NOT this: `never` and `any` pass that. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** The only assertion form used here — its constraint is what refuses `false`. */
type Expect<T extends true> = T;

/* Direction proofs: a broken instrument makes THIS file red. */

// @ts-expect-error objectui#8649 — `Expect` must refuse `false`. Widen its constraint and this directive goes unused (TS2578).
type _ExpectRefusesFalse = Expect<false>;

// @ts-expect-error objectui#8649 — `never` must NOT read as equal to `true`. An `extends`-shaped comparison would let it through.
type _EqualRefusesNever = Expect<Equal<never, true>>;

// @ts-expect-error objectui#8649 — `any` must NOT read as equal to `true`. This is the exact shape the erasure produced.
type _EqualRefusesAny = Expect<Equal<any, true>>;

/* Exit "align the mirror", key 1: `relationshipValueField`. */

/** RED before objectui#8649 (`TS2339` — the member did not exist here). */
export type _RelationshipValueFieldMirrorsSpec = Expect<
  Equal<
    RecordRelatedListComponentProps['relationshipValueField'],
    SpecRelatedListProps['relationshipValueField']
  >
>;

/**
 * Spelled out as well as derived. `Equal` against the spec alone would also be
 * satisfied if BOTH faces drifted to the same wrong type.
 */
export type _RelationshipValueFieldIsOptionalString = Expect<
  Equal<RecordRelatedListComponentProps['relationshipValueField'], string | undefined>
>;

/**
 * The card's repro as a literal: spec-valid, renderer-honoured, registry-published,
 * and refused by `tsc` with `TS2353` before this card.
 */
const relationshipValueFieldAccepted: RecordRelatedListComponentProps = {
  objectName: 'task',
  relationshipField: 'account',
  relationshipValueField: 'name',
};

/* Exit "align the mirror", key 2: the reference rail's node-level `properties`. */

type RailSchema = NonNullable<RecordReferenceRailRendererProps['schema']>;

/**
 * RED before objectui#8649: `properties` was admitted only by the schema type's
 * `[k: string]: any` index signature, so it read `any` — which `Equal` refuses
 * (see `_EqualRefusesAny` above, the same shape).
 */
export type _RailPropertiesIsDeclared = Expect<
  Equal<RailSchema['properties'], ({ entries?: ReferenceRailEntry[] } & Record<string, any>) | undefined>
>;

/**
 * And the member the renderer actually reads off the envelope carries the
 * contract's own entry type, not `any`.
 */
export type _RailPropertiesEntriesIsSpecEntry = Expect<
  Equal<NonNullable<RailSchema['properties']>['entries'], ReferenceRailEntry[] | undefined>
>;

/*
 * Exit "align the mirror", keys 3-5: the field-security triple on all three
 * blocks (objectui#8649's second landing, on `@objectstack/spec` 17.5.0).
 *
 * Each mirror member is compared against the contract's own input type for
 * the same block, reached through the same block-tag map as the
 * `relationshipValueField` pin above. RED before the second landing: `TS2339`,
 * the members did not exist on the three interfaces.
 */

type SpecDetailsProps = ComponentPropsInput<'record:details'>;
type SpecHighlightsProps = ComponentPropsInput<'record:highlights'>;

export type _DetailsTripleMirrorsSpec = Expect<
  Equal<
    [
      RecordDetailsComponentProps['enforceFieldSecurity'],
      RecordDetailsComponentProps['redactFields'],
      RecordDetailsComponentProps['requiredPermissions'],
    ],
    [
      SpecDetailsProps['enforceFieldSecurity'],
      SpecDetailsProps['redactFields'],
      SpecDetailsProps['requiredPermissions'],
    ]
  >
>;

export type _HighlightsTripleMirrorsSpec = Expect<
  Equal<
    [
      RecordHighlightsComponentProps['enforceFieldSecurity'],
      RecordHighlightsComponentProps['redactFields'],
      RecordHighlightsComponentProps['requiredPermissions'],
    ],
    [
      SpecHighlightsProps['enforceFieldSecurity'],
      SpecHighlightsProps['redactFields'],
      SpecHighlightsProps['requiredPermissions'],
    ]
  >
>;

export type _RelatedListTripleMirrorsSpec = Expect<
  Equal<
    [
      RecordRelatedListComponentProps['enforceFieldSecurity'],
      RecordRelatedListComponentProps['redactFields'],
      RecordRelatedListComponentProps['requiredPermissions'],
    ],
    [
      SpecRelatedListProps['enforceFieldSecurity'],
      SpecRelatedListProps['redactFields'],
      SpecRelatedListProps['requiredPermissions'],
    ]
  >
>;

/**
 * Spelled out as well as derived, for the reason given at
 * `_RelationshipValueFieldIsOptionalString`: `Equal` against the spec alone is
 * satisfied if BOTH faces drift to the same wrong type.
 */
type TripleShape = [boolean | undefined, string[] | undefined, string[] | undefined];

export type _TripleIsTheContractShapeOnEveryBlock = Expect<
  Equal<
    [
      [
        RecordDetailsComponentProps['enforceFieldSecurity'],
        RecordDetailsComponentProps['redactFields'],
        RecordDetailsComponentProps['requiredPermissions'],
      ],
      [
        RecordHighlightsComponentProps['enforceFieldSecurity'],
        RecordHighlightsComponentProps['redactFields'],
        RecordHighlightsComponentProps['requiredPermissions'],
      ],
      [
        RecordRelatedListComponentProps['enforceFieldSecurity'],
        RecordRelatedListComponentProps['redactFields'],
        RecordRelatedListComponentProps['requiredPermissions'],
      ],
    ],
    [TripleShape, TripleShape, TripleShape]
  >
>;

/**
 * The renderers' own `schema` bindings carry the members — the type every read
 * in the three files goes through. ⚠️ A MEMBERSHIP question: a cast at the read
 * site leaves these green, which is why the source-text legs below exist.
 *
 * One pin per block, deliberately. The three written as ONE nested tuple
 * compare unequal under this `Equal` even though each block compares equal on
 * its own (measured while writing them: the nested form reddened, each split
 * form was green) — a limit of the identity trick on types derived through an
 * intersection, not a difference in the members.
 */
export type _DetailsBindingCarriesTheTriple = Expect<
  Equal<
    [
      NonNullable<RecordDetailsRendererProps['schema']>['enforceFieldSecurity'],
      NonNullable<RecordDetailsRendererProps['schema']>['redactFields'],
      NonNullable<RecordDetailsRendererProps['schema']>['requiredPermissions'],
    ],
    TripleShape
  >
>;

export type _HighlightsBindingCarriesTheTriple = Expect<
  Equal<
    [
      NonNullable<RecordHighlightsRendererProps['schema']>['enforceFieldSecurity'],
      NonNullable<RecordHighlightsRendererProps['schema']>['redactFields'],
      NonNullable<RecordHighlightsRendererProps['schema']>['requiredPermissions'],
    ],
    TripleShape
  >
>;

export type _RelatedListBindingCarriesTheTriple = Expect<
  Equal<
    [
      NonNullable<RecordRelatedListRendererProps['schema']>['enforceFieldSecurity'],
      NonNullable<RecordRelatedListRendererProps['schema']>['redactFields'],
      NonNullable<RecordRelatedListRendererProps['schema']>['requiredPermissions'],
    ],
    TripleShape
  >
>;

/** The card's repro as literals: spec-valid documents, accepted by all three faces. */
const tripleAccepted = {
  details: {
    enforceFieldSecurity: true,
    redactFields: ['salary'],
    requiredPermissions: ['crm.manage'],
  } satisfies RecordDetailsComponentProps,
  highlights: {
    fields: ['name'],
    enforceFieldSecurity: true,
    redactFields: ['salary'],
    requiredPermissions: ['crm.manage'],
  } satisfies RecordHighlightsComponentProps,
  relatedList: {
    objectName: 'task',
    relationshipField: 'account',
    enforceFieldSecurity: true,
    redactFields: ['salary'],
    requiredPermissions: ['crm.manage'],
  } satisfies RecordRelatedListComponentProps,
};

/* ── Runtime legs ─────────────────────────────────────────────────────────── */

/**
 * Every key name declared on `schema`, unwrapping the wrappers a published zod
 * artifact uses (`.pipe()` — which `PageComponentSchema` is — plus
 * `.optional()` / `.default()`), or `null` when `schema` is not an object
 * schema at all.
 */
function objectShapeKeys(schema: unknown): string[] | null {
  let node = schema as
    | { shape?: unknown; _def?: { shape?: unknown; in?: unknown; innerType?: unknown; type?: unknown } }
    | undefined;
  for (let hop = 0; hop < 8; hop += 1) {
    // ⚠️ zod 4 schemas are CALLABLE, so a `typeof !== 'object'` guard here is not
    // a type check — it is a silent census cut. Measured: it dropped 96 of the
    // 115 object schemas the contract exports, and every "declared nowhere"
    // reading taken through it would have been vacuous. The population leg in
    // the first block is what caught it, and is why it is written as a floor.
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return null;
    let shape: unknown;
    try {
      shape = node.shape ?? node._def?.shape;
    } catch {
      return null;
    }
    const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
    if (resolved && typeof resolved === 'object') return Object.keys(resolved);
    node = (node._def?.in ?? node._def?.innerType ?? node._def?.type) as typeof node;
  }
  return null;
}

/**
 * The census this card's routing rests on: which BLOCKS of the installed UI
 * contract declare `key` on their props. Derived from the artifact on every run
 * — never a list written down here.
 *
 * The population is `ComponentPropsMap`, the contract's own block-tag map, which
 * is the authoring surface an author writes into. That is narrower and more
 * meaningful than every export of the module: a token can appear on
 * `ActionSchema` or a nav item and still be no part of any block's props, which
 * is exactly the trap `requiredPermissions` sets for a word-frequency screen.
 */
function declaringBlocksOf(key: string): string[] {
  const found: string[] = [];
  for (const [tag, schema] of Object.entries(ComponentPropsMap as Record<string, unknown>)) {
    const keys = objectShapeKeys(schema);
    if (keys?.includes(key)) found.push(tag);
  }
  return found.sort();
}

/** The block tags whose props schema the census could not walk. */
const unwalkableBlocks = (): string[] =>
  Object.entries(ComponentPropsMap as Record<string, unknown>)
    .filter(([, schema]) => objectShapeKeys(schema) === null)
    .map(([tag]) => tag)
    .sort();

/** How many block props schemas the census actually walked. */
const censusPopulation = (): number =>
  Object.keys(ComponentPropsMap as Record<string, unknown>).length - unwalkableBlocks().length;

/** Keys the contract accepts on the page-component NODE, on every block. */
const nodeLevelKeys = (): string[] => objectShapeKeys(PageComponentSchema) ?? [];

/** The three blocks this card's erasure-repaired renderers implement. */
const CARD_BLOCKS = ['record:details', 'record:highlights', 'record:related_list'] as const;

/**
 * The field-security triple, and the renderer files each key is read in. It
 * was the ROUTED-to-producer ledger until the contract declared the keys; it is
 * now the set whose reads must stay live AND un-cast (see the legs below).
 */
const ALIGNED_TRIPLE = {
  enforceFieldSecurity: ['record-details.tsx', 'record-highlights.tsx', 'record-related-list.tsx'],
  redactFields: ['record-details.tsx', 'record-highlights.tsx', 'record-related-list.tsx'],
  requiredPermissions: ['record-details.tsx', 'record-highlights.tsx', 'record-related-list.tsx'],
} as const;

/** The block each renderer file registers, for the contract readings below. */
const BLOCK_OF_FILE = {
  'record-details.tsx': 'record:details',
  'record-highlights.tsx': 'record:highlights',
  'record-related-list.tsx': 'record:related_list',
} as const;

/**
 * A cast standing between `schema` and `key`, e.g. `(schema as any).key`.
 * Applied to the real sources AND to a control below.
 */
const castBefore = (key: string): RegExp =>
  new RegExp(`\\(\\s*schema\\s+as\\s+\\w+\\s*\\)\\s*\\.\\s*${key}\\b`);

/** The un-cast read, e.g. `schema.key` — the liveness half. */
const unCastRead = (key: string): RegExp => new RegExp(`(?<![\\w)])schema\\s*\\.\\s*${key}\\b`);

/** The three files whose `schema` annotation the erasure used to destroy. */
const ERASURE_REPAIRED = [
  'record-details.tsx',
  'record-highlights.tsx',
  'record-related-list.tsx',
] as const;

const maskedSource = (file: string): string => mask(readFileSync(join(RENDERERS, file), 'utf8'));

/** The erasing spelling, as a matcher — applied to real sources AND to a control. */
const ERASING_DEFAULT = /schema\s*=\s*\{\}\s*as\s+any/;

/**
 * A cast standing between `schema` and `.properties` — the shape that made this
 * card's `properties` declaration inert at its own read site (objectui#8649
 * contract review D1). Applied to the real source AND to a control below.
 */
const CAST_BEFORE_PROPERTIES = /\(\s*schema\s+as\s+\w+\s*\)\s*\.\s*properties/;

describe('objectui#8649 — the census the routing rests on (PREMISE, re-derived every run)', () => {
  it('walks a non-empty population, names what it cannot walk, and discriminates', () => {
    // Calibration in both directions: an empty walk would make every "declared
    // nowhere" reading below vacuous, and an everything-set would make them
    // unfalsifiable.
    expect(censusPopulation()).toBeGreaterThan(30);
    // ⚠️ A block whose props schema this walk cannot open is a HOLE in every
    // absence reading below, so it is surfaced rather than silently skipped. The
    // three blocks this card rules on must never be in it.
    for (const block of CARD_BLOCKS) expect(unwalkableBlocks()).not.toContain(block);
    expect(declaringBlocksOf('zzqx_no_such_key')).toEqual([]);
    expect(declaringBlocksOf('aria').length).toBeGreaterThan(0);
    expect(declaringBlocksOf('fields').length).toBeGreaterThan(0);
  });

  // ⭐ FIRED at the `@objectstack/spec` 17.5.0 bump (objectui#11073), as these two
  // rows were written to. Through 17.4.0 they read: `enforceFieldSecurity` and
  // `redactFields` declared by NO block, and `requiredPermissions` declared, but
  // never on these three. 17.5.0 declares all three ON exactly these three
  // blocks — the routed producer-side card LANDED. Flipped to the new reading;
  // what it signals — this repo owes the mirror an update (declare on the
  // three interfaces, then drop the casts) — is objectui#8649's own burn-down,
  // ⛔ not the bump's, the same split objectui#10940's tripwire took.
  it('`enforceFieldSecurity` and `redactFields` are declared on exactly the three card blocks since 17.5.0, and not on the node', () => {
    expect(declaringBlocksOf('enforceFieldSecurity')).toEqual([...CARD_BLOCKS]);
    expect(declaringBlocksOf('redactFields')).toEqual([...CARD_BLOCKS]);
    expect(nodeLevelKeys()).not.toContain('enforceFieldSecurity');
    expect(nodeLevelKeys()).not.toContain('redactFields');
  });

  it('`requiredPermissions` is declared on the three card blocks too since 17.5.0 — beside `record:quick_actions`', () => {
    // Why a word-frequency screen got this key wrong through 17.4.0 is kept as
    // the sibling precedent: `record:quick_actions` carried it first.
    const declaring = declaringBlocksOf('requiredPermissions');
    expect(declaring).toContain('record:quick_actions');
    for (const block of CARD_BLOCKS) expect(declaring).toContain(block);
    expect(nodeLevelKeys()).not.toContain('requiredPermissions');
  });

  it('the block-tag map entry IS the named props schema (premise of the type pins)', () => {
    // The `ComponentPropsInput<'record:related_list'>` alias above is only a
    // reading of `RecordRelatedListProps` while this holds.
    expect(ComponentPropsMap['record:related_list']).toBe(RecordRelatedListProps);
  });

  it('the two mirror alignments are alignments — the contract declares both keys', () => {
    expect(declaringBlocksOf('relationshipValueField')).toContain('record:related_list');
    expect(declaringBlocksOf('hideFields')).toContain('record:details');
    // `properties` is a NODE-level key: declared on the page-component envelope
    // every block shares, and on no block's own props bag. Both halves asserted,
    // because the rail's declaration is only an alignment if BOTH are true.
    expect(nodeLevelKeys()).toContain('properties');
    expect(declaringBlocksOf('properties')).toEqual([]);
    // Calibration of the node reading itself, in both directions.
    expect(nodeLevelKeys()).toContain('dataSource');
    expect(nodeLevelKeys()).not.toContain('relationshipField');
  });
});

describe('objectui#8649 — the erasure is repaired and stays repaired', () => {
  it('the matcher can fire, so a zero reading below is a reading', () => {
    // The control varies ONLY the claim: same matcher, same shape of source, the
    // erasing spelling restored.
    expect(ERASING_DEFAULT.test('const C = ({ schema = {} as any, className }) => null;')).toBe(true);
  });

  for (const file of ERASURE_REPAIRED) {
    it(`${file} destructures \`schema\` without erasing its annotation`, () => {
      const source = maskedSource(file);
      // Proof the file was read and masked, so the absence below is about the
      // spelling and not about an empty string.
      expect(source).toMatch(/RecordDetailsRendererProps|RecordHighlightsRendererProps|RecordRelatedListRendererProps/);
      expect(source).not.toMatch(ERASING_DEFAULT);
      // And the repaired spelling is the annotation-tracking one, so a future
      // change to the annotation cannot silently re-erase it.
      expect(source).toMatch(/schema\s*=\s*\{\}\s*as\s+NonNullable<\s*Record\w+RendererProps\['schema'\]\s*>/);
    });
  }
});

describe('objectui#8649 — the field-security triple is read UN-CAST, and still read', () => {
  it('the two matchers discriminate, so the readings below are readings', () => {
    // Each control varies ONLY the claim.
    expect(castBefore('redactFields').test('Array.isArray((schema as any).redactFields)')).toBe(true);
    expect(castBefore('redactFields').test('Array.isArray(schema.redactFields)')).toBe(false);
    expect(unCastRead('redactFields').test('Array.isArray(schema.redactFields)')).toBe(true);
    expect(unCastRead('redactFields').test('Array.isArray((schema as any).redactFields)')).toBe(false);
    // Comments are masked before the legs run, so prose that spells the cast
    // out — this file's and the renderers' — can neither satisfy nor defeat them.
    expect(mask('// (schema as any).redactFields\nconst x = 1;')).not.toMatch(castBefore('redactFields'));
  });

  for (const [key, files] of Object.entries(ALIGNED_TRIPLE)) {
    for (const file of files) {
      it(`${file} reads \`${key}\` off \`schema\` un-cast, and still reads it at all`, () => {
        const source = maskedSource(file);
        // Liveness: a negative guard alone is satisfied by deleting the read.
        expect(source).toMatch(unCastRead(key));
        // ⭐ The load-bearing NEGATIVE: no cast may stand between the two again.
        expect(source).not.toMatch(castBefore(key));
      });
    }
  }

  it('every file in the ledger registers a block the contract declares the whole triple on', () => {
    // So the un-cast reads above are reads of DECLARED keys, block by block —
    // the premise of removing each cast, re-derived rather than assumed.
    for (const [key, files] of Object.entries(ALIGNED_TRIPLE)) {
      for (const file of files) {
        expect(declaringBlocksOf(key), `${key} on ${file}`).toContain(
          BLOCK_OF_FILE[file as keyof typeof BLOCK_OF_FILE],
        );
      }
    }
  });

  /**
   * ⭐ The assertion this block used to carry was
   * `toMatch(/properties\??\.entries/)`, and it was WORTHLESS for the thing it
   * was there to guard: it matches `(schema as any).properties.entries` exactly
   * as happily as the un-cast form. The declaration this card added was inert at
   * this very site for that reason, and this pin reported green throughout —
   * measured by the objectui#8649 contract review, not by this file.
   *
   * A cast at the read site defeats a declaration that a MEMBERSHIP instrument
   * (`getPropertyOfType` on the binding, which unwraps the cast) still reports
   * as present. So the liveness leg is now three assertions, and the
   * load-bearing one is the NEGATIVE: the enveloped read must not be re-cast.
   */
  it('the rail reads the node-level `properties` envelope UN-CAST, so the declaration reaches it', () => {
    const source = maskedSource('record-reference-rail.tsx');
    // Liveness: the read is still here at all.
    expect(source).toMatch(/Array\.isArray\(schema\.properties\?\.entries\)/);
    expect(source).toMatch(/\?\s*schema\.properties\.entries/);
    // The guard: no cast may stand between `schema` and `.properties`. Comments
    // are masked before this runs, so the spelling quoted in this file's own
    // prose cannot satisfy or defeat it.
    expect(source).not.toMatch(CAST_BEFORE_PROPERTIES);
  });

  it('the un-cast guard can fire, so the negative leg above is a reading', () => {
    // The control varies ONLY the claim: the same read, re-cast.
    expect(CAST_BEFORE_PROPERTIES.test('Array.isArray((schema as any).properties?.entries)')).toBe(true);
    expect(CAST_BEFORE_PROPERTIES.test('Array.isArray(schema.properties?.entries)')).toBe(false);
  });

  it('the liveness matcher can fire negative, so the legs above are readings', () => {
    expect(mask('const x = 1;')).not.toMatch(unCastRead('enforceFieldSecurity'));
  });
});

describe('objectui#8649 — the aligned mirror keys reach the renderers', () => {
  it('`relationshipValueField` is accepted by the mirror at the type level', () => {
    // The compile-time legs are the discriminating half; this keeps the literal
    // reachable from a vitest run so the fixture cannot rot unnoticed.
    expect(relationshipValueFieldAccepted.relationshipValueField).toBe('name');
  });

  it('the triple fixtures are reachable from a vitest run (the type legs are the discriminating half)', () => {
    expect(tripleAccepted.details.redactFields).toEqual(['salary']);
    expect(tripleAccepted.highlights.requiredPermissions).toEqual(['crm.manage']);
    expect(tripleAccepted.relatedList.enforceFieldSecurity).toBe(true);
  });

  it('the contract accepts the triple fixtures on each block, values intact, and refuses a wrong-typed value', () => {
    const cases = [
      ['record:details', tripleAccepted.details],
      ['record:highlights', tripleAccepted.highlights],
      ['record:related_list', { ...tripleAccepted.relatedList, columns: ['name'] }],
    ] as const;
    for (const [tag, doc] of cases) {
      const schema = ComponentPropsMap[tag] as unknown as {
        safeParse: (v: unknown) => { success: boolean; data?: Record<string, unknown>; error?: { issues: Array<{ path: PropertyKey[] }> } };
      };
      const parsed = schema.safeParse(doc);
      expect(parsed.success, tag).toBe(true);
      expect(parsed.data?.enforceFieldSecurity, tag).toBe(true);
      expect(parsed.data?.redactFields, tag).toEqual(['salary']);
      expect(parsed.data?.requiredPermissions, tag).toEqual(['crm.manage']);
      // A VALUE-level refusal, with the path it names: the mirror's
      // `string[]` is the contract's, not a looser face over it.
      const wrong = schema.safeParse({ ...doc, requiredPermissions: 'crm.manage' });
      expect(wrong.success, `${tag} accepted a bare-string requiredPermissions`).toBe(false);
      expect(wrong.error?.issues.map((i) => i.path.join('.')), tag).toContain('requiredPermissions');
    }
  });

  it('the contract accepts the same document, so mirror and contract agree', () => {
    const parsed = RecordRelatedListProps.safeParse({
      objectName: 'task',
      relationshipField: 'account',
      columns: ['name'],
      relationshipValueField: 'name',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.relationshipValueField).toBe('name');
  });
});
