/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Layout Component Zod Validators
 * 
 * Zod validation schemas for layout and container components.
 * Following @objectstack/spec UI specification format.
 * 
 * @module zod/layout
 * @packageDocumentation
 */

import { z } from 'zod';
import { aliasKeyRefusal, handlerKeyRefusal, retirementTombstone } from './tombstone.zod.js';
import {
  PageSchema as SpecPageSchema,
  PageTypeSchema as SpecPageTypeSchema,
  PageVariableSchema as SpecPageVariableSchema,
  checkPageDefaultPlacement,
  checkPageMainRegionWidth,
  checkPageRecordBindingPlacement,
  checkPageRegionPlacement,
  checkPageRequiresKind,
  checkPageSlotPair,
  checkPageSourceCompleteness,
} from '@objectstack/spec/ui';
import { BaseSchema, SchemaNodeSchema, specFieldsExcept } from './base.zod.js';
import { stripImportedDefaults } from './imported-defaults.js';
// objectui#10872 batch 9 — the node-level `responsiveStyles` fragment the public
// blocks declare, spread into `FlexSchema` below. objectui#11276 — the bag and
// flat-prop helpers the authored `flex` arm (`FlexBlockSchema`) is built with.
// `./public-blocks.zod.ts` imports nothing from this module, so this adds no
// cycle.
import { NODE_ENVELOPE, flatPropRefusals, propsBag } from './public-blocks.zod.js';

/**
 * ⭐ THE IMPORT BOUNDARY (objectui#8317, decision batch #90, 2026-09-08).
 *
 * **This mirror authors no default, imported subschemas included.** Batch #69
 * (objectui#7735) ruled that a validator validates and does not write values
 * into an author's document; batch #90 ruled that this holds for EVERY key
 * `safeValidateSchema` answers, not only the sites this repository wrote. So a
 * schema arriving from `@objectstack/spec` crosses into a mirror shape only
 * through `stripImportedDefaults`, which removes each reachable `ZodDefault`
 * with `.removeDefault()` and keeps the key omissible. Keys, types, checks and
 * the accept set are untouched, and a subtree carrying no default comes back
 * reference-equal — so this is a no-op the day the spec adopts the same
 * principle.
 *
 * ⛔ Spelled at every crossing rather than once per file, deliberately: a local
 * `const Spec… = stripImportedDefaults(…)` would put the spec's provenance one
 * hop away from every declaration that reads it, and `check:spec-symbols`
 * (rule 1) reads exactly one hop — a mirror export under a spec-owned name has
 * to show the spec binding in its OWN initializer. The verbosity is the
 * provenance.
 *
 * ⚠️ A read that is NOT a crossing stays unwrapped and is declared as such: a
 * value VOCABULARY (`./views.zod.ts`'s `SpecListViewTypeEnum` and
 * `./objectql.zod.ts`'s `ViewKindEnum`, which unwrap the spec's own
 * `.default('grid')` to reach its enum) and a TYPE position — neither puts a
 * default into a parsed document. `../__tests__/imported-defaults-8317.test.ts`
 * re-derives that exception list from the source rather than trusting this
 * paragraph, and fails if an entry stops matching a real read.
 */


/**
 * Div Schema - Basic HTML container
 */
export const DivSchema = BaseSchema.extend({
  type: z.literal('div'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
});

/**
 * Box Schema - Neutral block container (objectui#3965)
 *
 * The class-transparent replacement for the deprecated `div` on the JSON
 * authoring surface: renders `children`, authored `className` passes through
 * verbatim, zero injected classes. Mirrors {@link ../layout.ts BoxSchema};
 * the pairing is registered in `__tests__/zod-mirror-parity.test.ts`.
 */
export const BoxSchema = BaseSchema.extend({
  type: z.literal('box'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this box node',
    '`box` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/layout/box.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Span Schema - Inline text container
 */
export const TextSpanSchema = BaseSchema.extend({
  type: z.literal('span'),
  value: z.string().optional().describe('Text content'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this span node',
    '`span` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/basic/span.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Text Schema - Text display component
 */
export const TextSchema = BaseSchema.extend({
  type: z.literal('text'),
  content: z.string().optional()
    .describe('Text content — the one content spelling `text` reads (declared by objectui#6150; its `value` fallback spelling was retired)'),
  // ADR-0049 RETIREMENT TOMBSTONE (`5ad86ddee` / objectui#7016, maintainer
  // ruling A1 of 2026-09-04). `value` was the second spelling of the one
  // content slot; the renderer now reads `content` alone, so a plain deletion
  // here would let an authored `value` ride `BaseSchema.passthrough()` into a
  // silent blank. The tombstone refuses it BY NAME instead — one string, both
  // channels (parse-time message and `.describe()`), see `./tombstone.zod.ts`.
  value: retirementTombstone(
    'RETIRED (ADR-0049) — `value` is no longer part of TextSchema; write `content`. It was a second '
    + 'spelling of the one content slot, read only as the fallback limb of `schema.content || schema.value`, '
    + 'and was retired under ADR-0049 enforce-or-remove with no deprecation window (maintainer ruling A1, '
    + '2026-09-04). The renderer reads `content` alone now, so an authored `value` would render nothing. '
    + 'Rename the key; the string is unchanged.',
  ),
  variant: z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'caption', 'overline'])
    .optional()
    .describe('Text variant/style'),
  align: z.enum(['left', 'center', 'right', 'justify']).optional().describe('Text alignment'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `text` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `align`, `className`, `content`, `variant`. '
    + '`ui:text` is the measured SOLE owner of the bare `text` key (`element:text` and `field:text` pass `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `text` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `align`, `className`, `content`, `variant`. '
    + '`ui:text` is the measured SOLE owner of the bare `text` key (`element:text` and `field:text` pass `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
});

/**
 * Image Schema - Image component
 */
export const ImageSchema = BaseSchema.extend({
  type: z.literal('image'),
  src: z.string().describe('Image source URL'),
  alt: z.string().optional().describe('Alt text for accessibility'),
  width: z.union([z.string(), z.number()]).optional().describe('Image width'),
  height: z.union([z.string(), z.number()]).optional().describe('Image height'),
  objectFit: z.enum(['contain', 'cover', 'fill', 'none', 'scale-down']).optional().describe('Object fit property'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `image` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `alt`, `src`. '
    + '`ui:image` is the measured SOLE owner of the bare `image` key (`element:image` and `field:image` pass `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `image` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `alt`, `src`. '
    + '`ui:image` is the measured SOLE owner of the bare `image` key (`element:image` and `field:image` pass `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
});

/**
 * Icon Schema - Icon component (Lucide icons)
 *
 * ## `icon`, not `name` — and why the rejection message carries a migration
 *
 * The glyph key on this node is `icon` (objectui#5631, maintainer rulings
 * 2026-08-22 option A and 2026-08-24 「5631 A′，按一次正经的契约迁移立项。」).
 * `name` reverts to the SDUI identity key it always was, inherited optional
 * from {@link BaseSchema}. The declaration in `../layout.ts` carries the full
 * reasoning; this mirror carries the enforcement.
 *
 * This mirror is the half that had to move for the ruling to be landable at
 * all. It previously declared `name: z.string()` REQUIRED, which measured as:
 *
 * ```text
 * REJECT  { type:'icon', icon:'check' }  -> invalid_type at [name]
 * ACCEPT  { type:'icon', name:'check' }
 * ```
 *
 * i.e. the published contract refused the ruled shape and required the broken
 * one — contract-first exactly backwards, and the reason the renderer could
 * not be migrated on its own.
 *
 * `icon` is REQUIRED here, exactly as `name` was: this is a key rename at
 * constant strictness, not a loosening. Keeping the same requiredness is also
 * what keeps the `__tests__/zod-mirror-parity.test.ts` ledger silent — an
 * optional mirror key against a required declaration is drift that guard
 * measures and would demand a `KnownDrift` entry for.
 *
 * ## The rejection message IS the conversion story's first half
 *
 * A stored node authored before this migration reaches here as
 * `{ type:'icon', name:'check' }` and is refused. Zod's default message for
 * that is `invalid_type at [icon]: expected string, received undefined`, which
 * is true and tells the author nothing about what happened to their metadata.
 * The custom `error` below replaces it, for the ABSENT case only, with the
 * rename and where to convert in bulk. Deliberate mechanics:
 *
 *  - it fires only when `icon` is `undefined`, so a genuine type error
 *    (`icon: 42`) still gets zod's own precise message — returning `undefined`
 *    from the callback falls back to the default;
 *  - it is a MESSAGE, not an accept. ⛔ There is no `icon ?? name` read here
 *    or in the renderer; the legacy shape is refused, loudly, by design. That
 *    tolerant shape was ruled out by name on 2026-08-22 and the ruling of
 *    2026-08-24 restates it;
 *  - it lives on the FIELD rather than in an object-level `.check()`, because
 *    zod 4 skips object-level checks once a field issue exists — an
 *    object-level diagnostic for a missing key would never run. Measured.
 */
export const IconSchema = BaseSchema.extend({
  type: z.literal('icon'),
  icon: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? "ui:icon names its glyph with `icon` (e.g. `icon: 'check'`). If this node still "
            + 'names it with `name`, that key moved: `name` is the SDUI identity key on every '
            + 'node and is no longer read as a glyph name (objectui#5631). Rename `name` to '
            + '`icon`, or convert stored metadata in bulk with `migrateIconNodeKeys` from '
            + '`@object-ui/types`.'
          : undefined,
    })
    .describe('Lucide glyph name, kebab-case (objectui#5631: was `name`)'),
  size: z.number().optional().describe('Icon size in pixels'),
  color: z.string().optional().describe('Icon color'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `icon` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `color`, `icon`, `name`, `size`. '
    + '`ui:icon` is the measured SOLE owner of the bare `icon` key (`action:icon` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `icon` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `className`, `color`, `icon`, `name`, `size`. '
    + '`ui:icon` is the measured SOLE owner of the bare `icon` key (`action:icon` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
});

/**
 * Separator Schema - Divider component
 */
export const SeparatorSchema = BaseSchema.extend({
  type: z.literal('separator'),
  orientation: z.enum(['horizontal', 'vertical']).optional().describe('Separator orientation'),
  decorative: z.boolean().optional().describe('Whether decorative'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `separator` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `orientation`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `separator` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `orientation`.',
  ),
});

/**
 * A numeric layout key closed to the set its renderer maps, with a refusal that
 * names it (objectui#11424; generalised by objectui#11474 to every spacing key,
 * and by objectui#11491 to `grid.columns`, a count, under the name this helper
 * now has — it was `rendererSpacingSteps`).
 *
 * `container.padding`, `stack.gap`, `flex.gap`, `grid.gap` and `grid.columns`
 * are not keys `@objectstack/spec` declares, so each read site is the truth
 * (the objectui#7759 ruling, the one objectui#10286 applied to
 * `container.maxWidth`). Each renderer maps a closed set of numbers to utility
 * classes. A spacing step outside its set reaches no rule in the compiled
 * stylesheet, so the node renders without that spacing at all — not even the
 * default, which `??` supplies only for an absent key. A column count outside
 * `grid`'s set drew no column class where it was authored. `z.number()`
 * accepted such numbers. ⛔ The renderers neither round, clamp nor substitute
 * an unmapped number, and must not start: the declaration closes to the set
 * instead.
 *
 * The literal union is the refusal's carrier: zod's `invalid_value` issue
 * lists the accepted values, and the message spells the same list out. A key
 * that also takes an object of the same set keyed by breakpoint
 * (`grid.columns`) passes `shape`, which builds that union from the ONE closed
 * literal and gives the union the same refusal, so the set is named whichever
 * arm the authored value missed.
 *
 * `components/src/__tests__/layout-spacing-sets-11474.test.tsx` enumerates
 * every registered layout renderer's numeric input, re-derives each set by
 * rendering the real node and reading which values draw a class the package's
 * compiled stylesheet defines, and holds this declaration and the
 * registration's closed `enum` to it, so the three cannot part silently.
 */
interface RendererMappedSetSpec<Steps extends readonly [number, ...number[]]> {
  /** The node type, as authored. */
  node: string;
  /** The numeric key on that node. */
  key: keyof typeof MAPPED_SET_WORDING;
  /** The values the renderer maps, in ascending order. */
  steps: Steps;
  /** The value the renderer applies when the key is absent. */
  fallback: Steps[number];
  /** The card that closed this key. */
  card: string;
  /** What an unmapped number did, measured, ending with the refusal's reason. */
  unmapped: string;
}

/** How each closed key's set is spoken of, in its refusal and its describe. */
const MAPPED_SET_WORDING = {
  gap: { noun: 'Gap step', unit: 'step', maps: 'a gap class', zero: true, forms: '' },
  padding: { noun: 'Padding step', unit: 'step', maps: 'a padding class', zero: true, forms: '' },
  columns: {
    noun: 'Column count',
    unit: 'count',
    maps: 'a column class, as the bare number and at every breakpoint of the object form',
    zero: false,
    forms: ', bare or per breakpoint',
  },
} as const;

function rendererMappedSet<const Steps extends readonly [number, ...number[]]>(
  spec: RendererMappedSetSpec<Steps>,
): z.ZodOptional<z.ZodLiteral<Steps[number]>>;
function rendererMappedSet<const Steps extends readonly [number, ...number[]], Shape extends z.ZodType>(
  spec: RendererMappedSetSpec<Steps>,
  shape: (closed: z.ZodLiteral<Steps[number]>, refusal: string) => Shape,
): z.ZodOptional<Shape>;
function rendererMappedSet(
  spec: RendererMappedSetSpec<readonly [number, ...number[]]>,
  shape?: (closed: z.ZodLiteral<number>, refusal: string) => z.ZodType,
): z.ZodOptional<z.ZodType> {
  const set = spec.steps.join(', ');
  const words = MAPPED_SET_WORDING[spec.key];
  const refusal =
    `\`${spec.key}\` on a \`${spec.node}\` is one of ${set} (${spec.card}): those are the ${words.unit}s the ` +
    `renderer maps to ${words.maps}${words.zero ? ', and `0` means none' : ''}. ${spec.unmapped} ` +
    `Pick the ${words.unit} you meant from that set.`;
  const closed = z.literal(spec.steps, { error: refusal });
  return (shape ? shape(closed, refusal) : closed)
    .optional()
    .describe(`${words.noun}, one of ${set}${words.zero ? '; 0 is none' : ''}${words.forms} (default ${spec.fallback})`);
}

/**
 * The `padding` steps the `container` renderer maps to a padding class
 * (objectui#11424): `container.tsx` tests `schema.padding ?? 4` against one
 * `padding === N` branch per step, and a number that equals none of them
 * matches no branch and draws NO padding class.
 */
const CONTAINER_PADDING_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16] as const;

/**
 * Container Schema - Generic container component
 */
export const ContainerSchema = BaseSchema.extend({
  type: z.literal('container'),
  // `false` ONLY, not `z.boolean()` (objectui#10286, the objectui#7759 ruling:
  // for a key the spec does not declare, the read site is the truth). The
  // `container` renderer maps `false` to `max-w-none` and each size word to its
  // `max-w-*` class; `true` matches none of those branches, so it parsed green
  // here and drew no max-width class at all — neither the default `max-w-xl`
  // nor the `max-w-none` that `false` states. The declaration never admitted it.
  maxWidth: z.union([
    z.enum(['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', 'full', 'screen']),
    z.literal(false),
  ]).optional().describe('Max width constraint'),
  centered: z.boolean().optional().describe('Center the container'),
  // A literal union of the renderer's mapped steps, not `z.number()`
  // (objectui#11424) — see {@link rendererMappedSet}.
  padding: rendererMappedSet({
    node: 'container',
    key: 'padding',
    steps: CONTAINER_PADDING_STEPS,
    fallback: 4,
    card: 'objectui#11424',
    unmapped:
      'Any other number drew NO padding class at all, not even the default `4`, so it is '
      + 'refused here rather than rendered flush.',
  }),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this container node',
    '`container` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/layout/container.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * The `gap` steps the `flex` renderer maps to a gap class (objectui#11474):
 * `flex.tsx` tests `schema.gap ?? 2` against one `gap === N` branch per step,
 * 0 to 8, and a number that equals none of them draws NO gap class. The
 * describe used to advertise "Tailwind scale 0-8", which was this set, but the
 * declaration under it was `z.number()`.
 */
const FLEX_GAP_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Flex Schema - Flexbox layout component
 *
 * The node as the `flex` renderer reads it, after `SchemaRenderer` hoists the
 * `properties` bag onto the node, and as code composes it. Paired with the
 * TypeScript `FlexSchema` (`../layout.ts`). ⚠️ Not the authored arm: since
 * objectui#11276 an authored `flex` node takes these props in its `properties`
 * bag, and `AnyComponentSchema` judges it through {@link FlexBlockSchema}
 * below, whose bag is this mirror's own members by reference.
 */
export const FlexSchema = BaseSchema.extend({
  type: z.literal('flex'),
  // objectui#10872 batch 9 — the node-level `responsiveStyles` the spec's
  // `PageComponentSchema` declares, from the ONE fragment the public blocks
  // spread (`NODE_ENVELOPE`). The objectstack showcase writes it on `flex`
  // nodes, and `SchemaRenderer` compiles it on every node. ⛔ Not on `stack`,
  // `grid` or `container`: no producer was measured writing it there. The TS
  // twin declares it too.
  ...NODE_ENVELOPE,
  direction: z.enum(['row', 'col', 'row-reverse', 'col-reverse'])
    .optional()
    .describe('Flex direction'),
  justify: z.enum(['start', 'end', 'center', 'between', 'around', 'evenly'])
    .optional()
    .describe('Justify content alignment'),
  align: z.enum(['start', 'end', 'center', 'baseline', 'stretch'])
    .optional()
    .describe('Align items'),
  // A literal union of the renderer's mapped steps, not `z.number()`
  // (objectui#11474). The authored bag holds this member BY REFERENCE
  // (`FlexPropsBag` below), so `properties.gap` refuses the same numbers.
  gap: rendererMappedSet({
    node: 'flex',
    key: 'gap',
    steps: FLEX_GAP_STEPS,
    fallback: 2,
    card: 'objectui#11474',
    unmapped:
      'Any other number drew NO gap class at all, not even the default `2`, so it is refused '
      + 'here rather than rendered with no gap.',
  }),
  wrap: z.boolean().optional().describe('Allow items to wrap'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this flex node',
    '`flex` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/layout/flex.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/* ── The authored `flex` node: its props in the `properties` bag ───────────── */

/**
 * The node-level keys of `FlexSchema` above: everything the node base declares
 * (`BaseSchema`, `type` and `body` among them) except `children`, plus the node
 * envelope (`NODE_ENVELOPE`). Read off the declarations, not transcribed, so a
 * key `BaseSchema` or the envelope gains stays at node level the day it lands.
 *
 * `children` is the one base key that is NOT node-level here: `flex` renders
 * its child list, and its mirror declares the list as a member of its own, so
 * the list is one of the props the bag holds. That is where the spec's page
 * walk (`walkAddressedPageComponents`) and `SchemaRenderer`'s hoist read it
 * (`properties.children`), as on the `page:` containers, whose rows declare it.
 */
const FLEX_NODE_LEVEL_KEYS = Object.fromEntries(
  [...Object.keys(BaseSchema.shape).filter((key) => key !== 'children'), ...Object.keys(NODE_ENVELOPE)]
    .map((key) => [key, true]),
) as { [K in Exclude<keyof typeof BaseSchema.shape, 'children'> | keyof typeof NODE_ENVELOPE]: true };

/**
 * The child list in the `flex` bag (objectui#11276): the mirror's accept set —
 * one node, or a list of them — judged ONCE.
 *
 * A list at `properties.children` is a position `@objectstack/spec`'s page
 * walk descends, and `AnyComponentSchema` already judges every component the
 * walk finds there, at its real path, on both faces (objectui#11223,
 * `./nested-component-walk.ts`). So the list's entries are left to that
 * judgment, as the `page:` containers' rows leave theirs (`z.array(z.unknown())`).
 * Measured before this was written: with the mirror's own `children` member in
 * the bag, a refused child was reported twice — an `invalid_union` at
 * `properties.children` from the member, and the child's own issue from the
 * walk — and every nesting level was judged twice over. A single node, which
 * the walk does not descend, is judged by `SchemaNodeSchema`, the slot the
 * mirror's member is built from.
 */
const FLEX_BAG_CHILDREN = z.union([z.array(z.unknown()), SchemaNodeSchema])
  .optional()
  .describe(
    'Child components: a list, each entry judged as a component by the page walk (`properties.children`), '
      + 'or one node.',
  );

/**
 * The `flex` props bag (objectui#11276): the flat mirror's own members, BY
 * REFERENCE — `direction`, `justify`, `align`, `gap` and `wrap`, each the SAME
 * schema object `FlexSchema` holds — and the child list, `children`, in the
 * spelling {@link FLEX_BAG_CHILDREN} gives it above.
 *
 * ⛔ `@objectstack/spec` has no `ComponentPropsMap['flex']` row, and none is
 * invented here. The spec's `PageComponentSchema` types every `properties` bag
 * as an open record and judges a bag only through a row, so for this type the
 * spec accepts any bag at all. The bag's members are therefore objectui's own,
 * the ones the TypeScript `FlexLayoutProps` (`../layout.ts`) declares. Nothing
 * else is restated, so the bag and the post-hoist mirror cannot drift apart.
 *
 * The bag keeps the mirror's posture, `.passthrough()` (`BaseSchema`'s), so a
 * key `flex` does not declare is judged in the bag exactly as it was judged on
 * the flat node: unjudged by the tolerant face, refused by name by the strict
 * authoring face, which closes every object it walks.
 */
const FlexPropsBag = FlexSchema.omit(FLEX_NODE_LEVEL_KEYS).extend({ children: FLEX_BAG_CHILDREN });

/**
 * The ONE refusal detail every `flex` prop written flat on the node gets
 * (objectui#11276). `aliasKeyRefusal` puts the key and its bag member in front
 * of it: "Did you mean `gap` → `properties.gap`?".
 */
const FLEX_FLAT_PROP =
  'A `flex` node takes its props in its `properties` bag: write `{ "type": "flex", "properties": '
  + '{ "direction": "col", "gap": 4, "children": [ … ] } }` (objectui#11276). `@objectstack/spec`\'s own page '
  + 'component refuses a prop written on the node as mis-layered (ADR-0089 D3a), so this face and `os validate` '
  + 'agree. The spec has no `ComponentPropsMap[\'flex\']` row, so the bag\'s members are `FlexSchema`\'s own. '
  + 'Moving it changes nothing at render time: `SchemaRenderer` hoists every `properties` key onto the node '
  + 'before `flex` reads it.';

/**
 * `flex` — the AUTHORED node: its props in the `properties` bag (objectui#11276,
 * the `flex` batch, under the maintainer's ruling A on objectui#11300).
 *
 * ## Why the arm moved to the bag
 *
 * `@objectstack/spec`'s strict `PageComponentSchema` refuses a prop written on
 * a page component itself as mis-layered (ADR-0089 D3a), for every component
 * type: `properties` is the only home of a component's own props. This union
 * used to arm the node with the flat `FlexSchema` above, so `objectui validate`
 * refused the spec-shaped document — the objectstack showcase's layout boxes,
 * `{ type: 'flex', responsiveStyles, properties: { children } }` — and accepted
 * the flat one `os validate` refuses. The maintainer ruled A on objectui#11300:
 * the bag is the contract on `flex` too, and objectui's own documents moved to
 * it in the same change. objectui#6751's fence ("`flex` declares its own keys")
 * is revoked for `flex` only; every other node-level arm is unchanged.
 *
 * It is the construct `ObjectChartBlockSchema` uses (`./objectql.zod.ts`) —
 * `BaseSchema` + the `type` literal + `NODE_ENVELOPE` + `properties` through
 * `propsBag` + one by-name refusal per bag member — because `flex`, like
 * `object-chart`, has no spec row: the bag is `FlexPropsBag` above, the flat
 * mirror's own members, and its description says so instead of naming a row.
 * The refusals come from the shared `flatPropRefusals`, read off the bag, with
 * a detail (`FLEX_FLAT_PROP`) that names no row.
 *
 * ## The flat spelling is refused by name
 *
 * Every member of the bag written FLAT on the node is refused on both faces,
 * with a message naming its bag member — the child list included, which is
 * `properties.children`. `body`, the child-list spelling objectui#6771
 * retired, is refused with a message naming `properties.children` too,
 * replacing the mirror's refusal, whose remedy (a node-level `children`) this
 * arm refuses. `BaseSchema`'s other keys stay on the node (`id`, `className`,
 * `style`, `visible`, …), as on every arm, and so does the node envelope's
 * `responsiveStyles`. A key `flex` does not declare is left as every arm leaves
 * an undeclared key: unjudged by the tolerant face, refused by the strict one.
 *
 * ## What did not move
 *
 * The TypeScript `FlexSchema` and its zod mirror above stay published: they are
 * the node as the `flex` renderer reads it after `SchemaRenderer` hoists the
 * bag, and as code composes it. A stored flat `flex` node keeps rendering,
 * because `SchemaRenderer` reads both spellings and the narrowing is on the
 * authoring faces only; a node compiled from the `kind: 'html'` JSX tier
 * (`@object-ui/sdui-parser`) never passes through this face.
 */
export const FlexBlockSchema = BaseSchema.extend({
  type: z.literal('flex'),
  ...NODE_ENVELOPE,
  ...flatPropRefusals('flex', FlexPropsBag, FLEX_FLAT_PROP),
  properties: propsBag(
    'flex',
    FlexPropsBag,
    'The `flex` props bag — the members `FlexSchema` declares beyond the node-level keys (`direction`, '
      + '`justify`, `align`, `gap`, `wrap` and the child list, `children`), by reference. `@objectstack/spec` has '
      + 'no `ComponentPropsMap[\'flex\']` row, so these are objectui\'s own members (objectui#11276).',
  ),
  body: aliasKeyRefusal(
    'body',
    'properties.children',
    'this `flex` node',
    '`body` is the child-list spelling objectui#6771 retired, and a `flex` node takes its child list in its '
      + '`properties` bag: write `{ "type": "flex", "properties": { "children": [ … ] } }` (objectui#11276). '
      + 'objectui#8284.',
  ),
});

/**
 * The `gap` steps the `stack` renderer maps to a gap class (objectui#11474):
 * `stack.tsx` tests `schema.gap ?? 2` against one `gap === N` branch per step.
 * It has no branch for `7`, which `flex` maps, and one for `10`, which `flex`
 * does not, so the two sets differ; a number that equals none of them draws
 * NO gap class.
 */
const STACK_GAP_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10] as const;

/**
 * Stack Schema - Vertical flex layout (shortcut)
 */
export const StackSchema = BaseSchema.extend({
  type: z.literal('stack'),
  direction: z.enum(['row', 'col', 'row-reverse', 'col-reverse']).optional(),
  justify: z.enum(['start', 'end', 'center', 'between', 'around', 'evenly']).optional(),
  align: z.enum(['start', 'end', 'center', 'baseline', 'stretch']).optional(),
  // A literal union of the renderer's mapped steps, not `z.number()`
  // (objectui#11474) — see {@link STACK_GAP_STEPS}.
  gap: rendererMappedSet({
    node: 'stack',
    key: 'gap',
    steps: STACK_GAP_STEPS,
    fallback: 2,
    card: 'objectui#11474',
    unmapped:
      'Any other number drew NO gap class at all, not even the default `2`, so it is refused '
      + 'here rather than rendered with no gap.',
  }),
  wrap: z.boolean().optional(),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this stack node',
    '`stack` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/layout/stack.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * The `gap` steps the `grid` renderer maps to a gap class (objectui#11474):
 * `grid.tsx` looks `schema.gap ?? 4` up in its `GAPS` map. For any other
 * number it builds an arbitrary-value class at runtime, `gap-[N*0.25rem]`
 * (`gap-[2.25rem]` for `9`). Tailwind compiles only the class names it finds
 * in scanned source text, and a class assembled from a template at runtime is
 * not one of them, so an unmapped number reached no gap rule. The pin named in
 * {@link rendererMappedSet} re-derives this against the package's own
 * compiled stylesheet on every run; the console's stylesheet was read the same
 * way once, on objectui#11474, and nothing re-derives that reading. The
 * describe's "Tailwind scale 0-8" was not this set either.
 */
const GRID_GAP_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12] as const;

/**
 * The column counts the `grid` renderer maps to a column class
 * (objectui#11491): `grid.tsx` spells `grid-cols-1` to `grid-cols-12` once per
 * breakpoint, in `GRID_COLS` and its five breakpoint twins, and nothing else.
 * Every one of those 72 classes is a rule in the package's compiled stylesheet;
 * the pin named in {@link rendererMappedSet} re-derives that on every run.
 *
 * A count outside the set drew no column class where it was authored, and was
 * still `z.number()` here. Measured through the real `SchemaRenderer`: a bare
 * `13` drew `grid-cols-1 sm:grid-cols-2` and lost its `md` count; `{ md: 13 }`
 * drew nothing at `md`; `{ xs: 13 }`, `0` and `-1` drew `grid-cols-2`, a count
 * nobody authored, through a fallback the renderer no longer has.
 */
const GRID_COLUMN_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * The objectui#11505 retirement guidance for the four flat per-breakpoint
 * column keys of the `grid` node. One concept, responsive columns, has one
 * spelling: the breakpoint object of `columns`. The refusal names the key, the
 * breakpoint it spelled a second time, and the object member to write instead.
 * The TypeScript face carries the same four keys as `?: never` tombstones.
 *
 * The migration it prescribes is the one that draws the same classes, measured
 * through the real `SchemaRenderer` on objectui#11505: a flat key switched off
 * the bare count's mobile-first ramp, so a bare `columns: C` beside it is the
 * object's `xs: C`; with no `columns` at all the grid drew its default two
 * columns below that breakpoint, and an object without `xs` draws one, so the
 * object needs `xs: 2` to keep them.
 */
const retiredGridColumnsKey = (key: string, breakpoint: 'sm' | 'md' | 'lg' | 'xl') =>
  retirementTombstone(
    `RETIRED (objectui#11505, ADR-0049) — \`${key}\` on \`grid\` was a second spelling of the `
    + `\`${breakpoint}\` member of \`columns\`: the registration offered it and the renderer read it over `
    + 'the breakpoint object, but no face of `GridSchema` declared it, so the strict face refused it at '
    + 'every value and the tolerant face passed any value through unexamined. The renderer no longer reads it. '
    + `Instead: write the count, 1 to 12, as the \`${breakpoint}\` member of the breakpoint object, `
    + `\`columns: { ${breakpoint}: N }\`, and delete the key. A bare \`columns: C\` beside it becomes the `
    + "object's `xs: C`; with no `columns` at all, add `xs: 2` to keep the two columns the grid drew below "
    + `\`${breakpoint}\`.`,
  );

/**
 * Grid Schema - CSS Grid layout component
 */
export const GridSchema = BaseSchema.extend({
  type: z.literal('grid'),
  /**
   * One of the counts the renderer maps (objectui#11491, see
   * {@link GRID_COLUMN_COUNTS}): the bare number, or an object of such counts
   * keyed by the BREAKPOINT VOCABULARY, not by `string` (objectui#8516). The
   * one closed literal is both arms' value, so a count is judged the same way
   * as the bare number and at every breakpoint.
   *
   * `z.partialRecord`, ⛔ never `z.record(z.enum([…]), …)`: measured on zod
   * 4.4.3, the plain `z.record` over an enum key REQUIRES every member, so
   * `{ md: 2 }` — which the declaration explicitly invites, and which
   * `grid-breakpoint-columns-7097.test.tsx` pins the renderer as reading —
   * stops parsing. That spelling trades this divergence for its opposite.
   *
   * The six names are the whole of `BreakpointName` (`../mobile.ts`). They are
   * spelled here rather than derived because `mobile.ts` has no zod mirror to
   * derive from; the equality is held by a type-level pin in
   * `__tests__/mirror-partial-record-narrowing-8516.test.ts`, so adding or
   * dropping a breakpoint on either face fails to compile.
   *
   * The union carries the refusal as well as each arm: a count that misses
   * both arms is reported as one `invalid_union` at `columns` whose message
   * names the set, and the arms' own issues, under `errors`, carry it as
   * `values`. A key outside the six is still reported on its own, as
   * `unrecognized_keys` at `columns` (objectui#8516).
   */
  columns: rendererMappedSet(
    {
      node: 'grid',
      key: 'columns',
      steps: GRID_COLUMN_COUNTS,
      fallback: 2,
      card: 'objectui#11491',
      unmapped:
        'Any other count drew no column class where it was authored: a bare `13` lost its `md` '
        + 'count, `{ md: 13 }` drew nothing at `md`, and `{ xs: 13 }`, `0` and `-1` drew two '
        + 'columns nobody authored; so it is refused here instead.',
    },
    (count, refusal) =>
      z.union([count, z.partialRecord(z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl']), count)], {
        error: (issue) => (issue.code === 'invalid_union' ? refusal : undefined),
      }),
  ),
  // ADR-0049 RETIREMENT TOMBSTONES (objectui#11505) — see
  // {@link retiredGridColumnsKey}. A plain deletion would let each key ride
  // `BaseSchema.passthrough()` on the tolerant face, unexamined, so each is
  // refused by name on both faces instead.
  smColumns: retiredGridColumnsKey('smColumns', 'sm'),
  mdColumns: retiredGridColumnsKey('mdColumns', 'md'),
  lgColumns: retiredGridColumnsKey('lgColumns', 'lg'),
  xlColumns: retiredGridColumnsKey('xlColumns', 'xl'),
  // A literal union of the renderer's mapped steps, not `z.number()`
  // (objectui#11474) — see {@link GRID_GAP_STEPS}.
  gap: rendererMappedSet({
    node: 'grid',
    key: 'gap',
    steps: GRID_GAP_STEPS,
    fallback: 4,
    card: 'objectui#11474',
    unmapped:
      'Any other number built a class at runtime that no compiled stylesheet defines, so the '
      + 'grid rendered with no gap at all, not even the default `4`; it is refused here instead.',
  }),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this grid node',
    '`grid` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/layout/grid.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Card Schema - Card component
 */
export const CardSchema = BaseSchema.extend({
  type: z.literal('card'),
  title: z.string().optional().describe('Card title'),
  description: z.string().optional().describe('Card description'),
  header: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Card header content'),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this card node',
    '`card` read `renderNodeSlot(schema.children || schema.body, …)`, one of the fallback readers whose '
    + '`body` arm objectui#6771 dropped in the same change as the `body`-only registrations converged. '
    + 'The TS face declares this member `never` and the corpus moved with it.',
  ),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Card content — the one child-list spelling (objectui#6771)'),
  footer: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Card footer content'),
  variant: z.enum(['default', 'outline', 'ghost']).optional().describe('Card variant style'),
  hoverable: z.boolean().optional().describe('Whether the card is hoverable'),
  clickable: z.boolean().optional().describe('Whether the card is clickable'),
  onClick: handlerKeyRefusal('onClick', 'runtime-slot', 'Click handler'),
});

/**
 * Tab Item Schema
 */
export const TabItemSchema = z.object({
  value: z.string().describe('Unique tab identifier'),
  label: z.string().describe('Tab label'),
  icon: z.string().optional().describe('Tab icon'),
  disabled: z.boolean().optional().describe('Whether tab is disabled'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Tab content'),
  // RETIRED (objectui#9590) — mirrors `TabItem.body: never` (`../layout.ts`).
  // This object STRIPS undeclared keys, so leaving `body` undeclared would keep
  // dropping it in silence beside a `content`; the refusal names `content` instead.
  body: aliasKeyRefusal(
    'body',
    'content',
    'this tab item',
    '`tabs` draws each panel from `content` (`packages/components/src/renderers/layout/tabs.tsx`). '
    + 'The item-level `body` fallback was retired by objectui#9590.',
  ),
});

/**
 * Tabs Schema - Tabs component
 */
export const TabsSchema = BaseSchema.extend({
  type: z.literal('tabs'),
  defaultValue: z.string().optional().describe('Default active tab value'),
  value: z.string().optional().describe('Controlled active tab value'),
  orientation: z.enum(['horizontal', 'vertical']).optional().describe('Tabs orientation'),
  items: z.array(TabItemSchema).describe('Tab items configuration'),
  onValueChange: handlerKeyRefusal('onValueChange', 'runtime-slot', 'Change handler'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `tabs` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `items`, `orientation`, `value`. '
    + '`ui:tabs` is the measured SOLE owner of the bare `tabs` key (`page:tabs` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `tabs` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker over one program per workspace package plus the apps and examples, on a '
    + 'BUILT tree, no renderer read consumes `body` or `children` for this node, and `SchemaRenderer` '
    + 'strips both out of the props bag it spreads. An authored value therefore rendered NOTHING — no '
    + 'render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `defaultValue`, `items`, `orientation`, `value`. '
    + '`ui:tabs` is the measured SOLE owner of the bare `tabs` key (`page:tabs` passes `skipFallback: true`); '
    + 're-derive with `pnpm check:registry-bare-names --table` (objectui#9264).',
  ),
});

/**
 * Scroll Area Schema
 */
export const ScrollAreaSchema = BaseSchema.extend({
  type: z.literal('scroll-area'),
  height: z.union([z.string(), z.number()]).optional().describe('Height of scroll container'),
  width: z.union([z.string(), z.number()]).optional().describe('Width of scroll container'),
  orientation: z.enum(['vertical', 'horizontal', 'both']).optional().describe('Scrollbar orientation'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional(),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this scroll-area node',
    '`scroll-area` reads `children`, never `body` (READ SITE, measured with the TypeScript type checker: `packages/components/src/renderers/complex/scroll-area.tsx`). '
    + '`body` is the child-list spelling objectui#6771 retired — one concept, one spelling — so it is '
    + 'refused here by name; write the content under `children`, the one child-list key. objectui#8284.',
  ),
});

/**
 * Resizable Panel Schema
 */
export const ResizablePanelSchema = z.object({
  id: z.string().describe('Unique panel identifier'),
  defaultSize: z.number().optional().describe('Default size (percentage 0-100)'),
  minSize: z.number().optional().describe('Minimum size (percentage 0-100)'),
  maxSize: z.number().optional().describe('Maximum size (percentage 0-100)'),
  content: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).describe('Panel content'),
});

/**
 * Resizable Schema - Resizable panels component
 */
export const ResizableSchema = BaseSchema.extend({
  type: z.literal('resizable'),
  direction: z.enum(['horizontal', 'vertical']).optional().describe('Direction of resizable panels'),
  minHeight: z.union([z.string(), z.number()]).optional().describe('Minimum height'),
  withHandle: z.boolean().optional().describe('Show resize handle'),
  panels: z.array(ResizablePanelSchema).describe('Resizable panels'),
  body: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `resizable` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `direction`, `minHeight`, `panels`, `withHandle`.',
  ),
  children: retirementTombstone(
    'REFUSED (objectui#9256, ADR-0049) — `resizable` reads NEITHER content channel: measured with the '
    + 'TypeScript type checker across all 24 registering packages, no renderer read consumes `body` or '
    + '`children` for this node, and `SchemaRenderer` strips both out of the props bag it spreads. An '
    + 'authored value therefore rendered NOTHING — no render-time error or warning and no element; only the parser tier\'s `not-a-container` warning (objectui#9910) noticed it. '
    + 'What it renders instead: `direction`, `minHeight`, `panels`, `withHandle`.',
  ),
});

/**
 * Aspect Ratio Schema
 */
export const AspectRatioSchema = BaseSchema.extend({
  type: z.literal('aspect-ratio'),
  ratio: z.number().optional().describe('Aspect ratio (width / height)'),
  image: z.string().optional().describe('Image URL to display'),
  alt: z.string().optional().describe('Image alt text'),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this aspect-ratio node',
    '`aspect-ratio` read `renderChildren(schema.children || schema.body)` whenever no `image` was set; '
    + 'objectui#6771 dropped the `body` arm with the rest of the dialect.',
  ),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional().describe('Child components rendered when no image is set'),
});

/**
 * Page Region Width Schema
 */
export const PageRegionWidthSchema = z.enum(['small', 'medium', 'large', 'full']);

/**
 * Page Region Schema — zod twin of `layout.ts`'s `PageNodeRegion`, renamed off
 * the spec's `PageRegionSchema` name (objectstack#4115) for the reason given
 * there: this validates a region of the objectui page NODE (renderer
 * components, plus a semantic `type` and `className`), the spec's validates a
 * region of the authored page (`PageComponent`s). See {@link PageNodeSchema},
 * whose `regions` note has pointed at this entry since objectui#3074.
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts`.
 */
export const PageNodeRegionSchema = z.object({
  name: z.string().describe('Region name (e.g. "sidebar", "main", "header")'),
  type: z.enum(['header', 'sidebar', 'main', 'footer', 'aside']).optional().describe('Semantic region type'),
  width: z.union([PageRegionWidthSchema, z.string()]).optional().describe('Region width'),
  components: z.array(SchemaNodeSchema).describe('Components in this region'),
  className: z.string().optional().describe('CSS class overrides'),
});

/**
 * Page Variable Schema — `@objectstack/spec/ui` schema re-exported **by
 * reference** (objectstack#4115), for exactly the reason the sibling
 * {@link PageTypeSchema} below documents.
 *
 * The mirror this replaces had drifted twice over: it omitted `source` — the
 * whole ADR-0049 write-binding, so a spec-authored master/detail page
 * (`{ name: 'selectedProjectId', source: 'project_picker' }`) parsed into a
 * variable nothing could ever write — and its `type` enum was missing
 * `record_id`, so a spec-valid record-picker variable was rejected outright.
 */
export const PageVariableSchema = stripImportedDefaults(SpecPageVariableSchema);

/**
 * Page Type Schema — `@objectstack/spec/ui` schema re-exported **by reference**
 * (issue #2231; formerly a hand-written mirror).
 *
 * The mirror was missing `list`, so a spec-valid `list` page failed validation
 * here — and it shadowed the spec's export under the same symbol name, so an
 * importer could not tell the two apart. Note the sibling TS `PageType` in
 * `layout.ts` had drifted the OPPOSITE way (it carried five visualization names
 * the spec explicitly repudiates); both now come from the spec.
 */
export const PageTypeSchema = stripImportedDefaults(SpecPageTypeSchema);

/**
 * Spec-owned Page fields, flowing in **by reference** (objectstack#4115).
 *
 * `BaseSchema` is `.passthrough()` while the spec's `PageSchema` is strict, so
 * before this derivation every spec-only key rode through objectui completely
 * unvalidated — `interfaceConfig`, `kind`, `slots`, `source`, `requires` and
 * `aria` were neither checked nor even declared. `source` was the sharpest
 * hole: `kind: 'html' | 'react'` pages carry their body in `source`, so a
 * source-authored page could not be expressed here at all.
 *
 * Omitted, each for a stated reason:
 *  - `name`/`label`/`description` — component-envelope keys owned by BaseSchema;
 *  - `type` — the names genuinely collide: spec's `type` IS the page kind
 *    (`record|app|utility|list|home`), objectui's is the component
 *    discriminator (`'page'`) and the kind lives on `pageType` below.
 *    Reconciling the two is a rename decision tracked separately;
 *
 *    ⚠️ **The collision is NOT resolved at runtime, and a reader of this bullet
 *    alone will get it wrong** (objectui#9642). `PageView` (`@object-ui/app-shell`)
 *    hands a stored page to `SchemaRenderer` with the KIND written VERBATIM into
 *    `type` and a copy on `pageType` — so the node that actually reaches
 *    `ComponentRegistry` carries `type: 'app'` / `'home'` / `'record'` /
 *    `'utility'`, which `PageNodeSchema`'s `z.literal('page')` below would
 *    REFUSE. ⇒ `@object-ui/components` registers those kinds as node types on
 *    `PageRenderer` precisely so the passthrough resolves; that registration set
 *    is the renderer half of the spec's `PageTypeSchema`, ⛔ not a component
 *    family and ⛔ not names registered without a schema. Two cards read it the
 *    second way (objectui#9263, re-ruled letter E "⛔ not a defect", and
 *    objectui#9576). Since objectui#11440 the validator answers that node too:
 *    {@link PageKindNodeSchema} below claims `record` / `home` / `utility`.
 *
 *    ⭐ `app` is one token carrying two vocabularies: `AppComponentSchema`'s
 *    `'app'` is the APP-LEVEL DOCUMENT, read structurally by the runner /
 *    layout path and never resolved through `ComponentRegistry`; the spec page
 *    kind `app` is a stored PAGE document served by `PageRenderer` through that
 *    passthrough. ⛔ Neither is a collision to be resolved by removing the other.
 *
 *    The live split — which kind is served by `PageRenderer`, which is
 *    short-circuited by `PageView`'s `interfaceConfig.source` branch — is
 *    re-derived by `page-kind-node-type-channel-9642` in `@object-ui/components`,
 *    ⛔ not by this bullet;
 *  - `regions` — objectui's `PageNodeRegionSchema` adds `type`/`className` and
 *    widens `width`; migration deferred (it is its own ledger entry).
 *
 * `.partial()` guarantees no *future* spec field can become required and
 * silently invalidate stored objectui pages.
 */
export const PAGE_SPEC_EXCLUDED = [
  'name',
  'label',
  'description',
  'type',
  'regions',
] as const;

// One list, two readers (objectui#9736): this call and the `PageNodeSchema`
// TypeScript twin in `../layout.ts`, which extends `Omit< Page, … >` over the same
// array — so the published validator and the published type project one spec
// surface and cannot drift apart again.
const SpecPageFields = specFieldsExcept(stripImportedDefaults(SpecPageSchema).shape, PAGE_SPEC_EXCLUDED);

/**
 * The `actions` REFUSAL on the `page` node (`12b599219`, maintainer ruling
 * 2026-09-09, decision batch #107 item 2 — option A).
 *
 * ## What was measured
 *
 * `PageNodeSchema` never declared `actions`, and `PageRenderer` never read it:
 * `git grep -ni action packages/components/src/renderers/layout/page.tsx`
 * returns only the `PageVariableActionBridge` import and its render, with
 * `schema.title` / `schema.pageType` (3 hits in the same file) as the lit
 * control. Rendered through the real `SchemaRenderer`, a `page` node carrying
 * `actions: [{type:'button',label:'Add Product'}, …]` drew **0** buttons and
 * the label appeared nowhere in the DOM; the SAME two buttons moved into
 * `body` drew **2**.
 *
 * `BaseSchema` is `.passthrough()`, so the array was not refused — it was KEPT,
 * and until objectui#7933 it was spread onto the wrapper element as
 * `actions="[object Object],[object Object]"`. That half is closed (`toDomProps`,
 * `page.tsx:521`), which leaves the silent half: an author writes a key, the
 * validator says yes, and nothing draws.
 *
 * ## Why a REFUSAL rather than a reader
 *
 * This was the THIRD surface carrying an `actions` array no reader consumes
 * (objectui#7469 — the app node; objectui#7693 — the alert-dialog fixtures),
 * and the authorable action FORM was already ruled on 2026-08-25 for
 * objectui#6497 / #6182 (option A: the declarative action object). Growing a
 * reader here would have minted a FOURTH `actions` shape, so the ruling pulls
 * the node back to its declared contract instead.
 *
 * ⛔ NOT `.strict()` on the node, and that is the census talking rather than
 * taste. Measured over this tree before the refusal was written: 91 authored
 * `page`-tagged objects, 8 sites the census could not read (7 elided doc fences
 * plus one literal carrying a spread), and the undeclared keys that survive
 * passthrough on a real `page` NODE are exactly `actions` (3 sites, all of them
 * the `content/docs/guide/layout.md` passages this card rewrites) and
 * `breadcrumbs` (its own question — the 2026-09-09 ruling does not cover it; RULED
 * and refused separately by objectui#8871, see {@link PAGE_BREADCRUMBS_REFUSAL}
 * below, which also corrects the "1 site" reading recorded here to THREE — two
 * were missed for two DIFFERENT reasons: one passage's literal does carry
 * `type: 'page'` but sits inside a markdown `typescript` fence, a fence
 * LANGUAGE the census's `json`-fence reader never visits; the other is a
 * `json`-fenced fragment that never writes `type` at all).
 * Every other undeclared key the grep found sits on a DIFFERENT declaration
 * that merely spells `type: 'page'` — nav items (`pageName`, `href`, `badge`,
 * `labelKey`, `requiredPermissions`), `registerMetadataResource` rows
 * (`domain`, `listColumns`, `anchors`, `create*`) and spec `page` LIST VIEWS
 * (`pageName` + empty `columns`) — none of which this schema parses. And
 * `page-app-dashboard-spec-parity.test.ts` PINS the node staying open
 * ("the component envelope still passes unknown renderer props through"), so a
 * strict node would have taken a living pin with it. One key, by name.
 *
 * Same helper and the same reasoning as `MenuItemSchema.type`
 * (`./overlay.zod.ts`, objectui#6523): a spelling the type never declared,
 * turned into a named refusal that carries the remedy.
 */
const PAGE_ACTIONS_REFUSAL =
  '`actions` is not a key of the `page` node and never was (ADR-0049): no renderer ' +
  'reads it, so an authored array drew nothing and rode `.passthrough()` onto the wrapper ' +
  'element. Author the buttons as NODES in `children` (a `button` node, or an `action:button` ' +
  'node with a declared `actionType`); on a record page declare them on a `page:header` ' +
  'block instead, whose own `actions` are ACTION IDS resolved from the object metadata ' +
  '(objectui#7182), not nodes.';

/**
 * The `breadcrumbs` REFUSAL on the `page` node (objectui#8871) — the key
 * `12b599219` measured on this same node and deliberately left parsing, so
 * that retiring it would be a DECISION rather than an accident. This is that
 * decision, taken under ADR-0049 enforce-or-remove.
 *
 * ## Why ADR-0049 governs this, and not a fresh ruling
 *
 * The 2026-09-09 maintainer ruling covers `actions` and, by its own comments,
 * nothing else — so it is NOT borrowed here. What reaches this key instead is
 * the standing enforce-or-remove discipline, which this repository applies to
 * this exact face: {@link retirementTombstone} is documented as the "ADR-0049
 * RETIREMENT TOMBSTONE" helper and is internal to these zod modules; 63
 * changesets under `.changeset/` cite the ADR; and `PageNodeSchema` itself
 * already carries one of its refusal arms one member up. "Declared-or-authored
 * but unread" is the population the gate names, and this key is in it.
 *
 * ## What was measured (objectui#8871, on this branch's BASE `93127bd6f`)
 *
 * ZERO readers — and the FRAME is load-bearing: every number below is a
 * reading on the BASE unless it says HEAD. On the base,
 * `git grep -E "\.breadcrumbs"` over the whole tree returns nothing (exit 1);
 * the same shape one letter shorter, `"\.breadcrumb\b"`, returns 12 files
 * tree-wide (10 under `packages/`) — the lit control that says the probe
 * runs. At HEAD those two read 16 and 13, and `\.breadcrumbs` itself turns
 * exit 0 over 4 files / 6 lines, because THIS branch's own four files — the
 * changeset, `page-breadcrumbs-refusal-8871.test.ts`, `layout.ts` and this one
 * — QUOTE the probe string; subtract the eight exclusions the tree-scoped pin
 * spells out and HEAD is back at exit 1. `layout.ts`'s twin docblock states the
 * same frame, and the two must not be allowed to drift apart on it again.
 * ⛔ A BARE-WORD probe is useless here and the reason this note
 * spells the shape out: `breadcrumbs` is heavily overloaded in this tree, and
 * a bare grep hits Sentry's own unrelated breadcrumbs concept
 * (`app-shell/src/observability/sentry.ts`) plus two comments listing UI
 * surfaces (`core/src/utils/record-title.ts`, `layout/src/NavigationRenderer.tsx`)
 * — three prose sites, no reader, no declaration. A bare probe reads "5
 * readers" and every one of them is false.
 *
 * THREE author sites, all of them teaching passages in one file — and the
 * count corrects the `actions` refusal's "1 site", which came from a census that
 * reads every git-tracked JSON file, every `json` fence in `.md`/`.mdx`, and
 * every TS/TSX object literal via the TypeScript AST (PR #8870). It
 * undercounted for TWO DIFFERENT reasons: the Schema API block declared the
 * member outright and its literal does carry `type: 'page'`, but that literal
 * sits inside a markdown `typescript` fence — a fence LANGUAGE the census's
 * `json`-fence reader never visits, so it was never read at all. Best
 * Practices §2 authored it on a fragment inside a `json` fence the census
 * DOES read, but that fragment never writes `type`, so a `page`-TAGGED filter
 * correctly excluded it. The "Detail Page with Actions" fence is the one site
 * both instruments would see — a `json` fence, tagged `type: 'page'` — and is
 * the "1 site" the earlier census counted. No example app, catalog fixture,
 * template or customer document writes the key; this refusal therefore
 * strands no authored document in the tree.
 *
 * ## Why a REFUSAL and not a bare deletion
 *
 * There is nothing to delete: the key was never in the shape. `BaseSchema` is
 * `.passthrough()`, so an undeclared key is not refused, it is KEPT — deleting
 * a declaration that does not exist would leave the silent accept exactly as it
 * is. Declaring the refusal is what makes it audible, and it is what converts a
 * write from OUTSIDE this repository — the half no in-tree census can read —
 * into a named refusal carrying its own remedy.
 *
 * ## Why a REFUSAL and not a reader
 *
 * The remedy is a NODE, and it already ships. `breadcrumb` is a REGISTERED,
 * live component (`ComponentRegistry.register('breadcrumb', …)` in
 * `packages/components/src/renderers/data-display/breadcrumb.tsx`) whose
 * `BreadcrumbSchema.items` takes the very `{ label, href }` shape these
 * passages authored, and which honours `separator`, `maxItems` and per-item
 * `icon` besides. Growing a second road to the same trail would mint a rival
 * spelling for a vocabulary that already renders — the `wrap` test
 * (objectui#5453) run in the opposite direction: there the key was retired
 * because it had NO second road to a consumer; here it is retired because the
 * road that exists is the one that draws.
 *
 * ⛔ NOT `.strict()` on the node, for the reason {@link PAGE_ACTIONS_REFUSAL}
 * records above: the census found only these two keys on a real `page` node,
 * and `page-app-dashboard-spec-parity.test.ts` pins the node staying open to
 * unknown renderer props. One key, by name — again.
 */
const PAGE_BREADCRUMBS_REFUSAL =
  '`breadcrumbs` is not a key of the `page` node and never was (objectui#8871, ADR-0049 ' +
  'enforce-or-remove): no renderer reads it, so an authored trail drew nothing and rode ' +
  '`.passthrough()` through the validator as a silent accept. Author the trail as a NODE ' +
  'in `children` instead — { "type": "breadcrumb", "items": [{ "label": "Home", "href": "/" }] } ' +
  '— which is a registered renderer and takes the same item shape, plus `separator` and ' +
  '`maxItems`. ⛔ Not the `page:header` block\'s `breadcrumb` either: that one is SINGULAR ' +
  'and a BOOLEAN display toggle, not a list of links.';

/**
 * The `maxWidth` and `padding` REFUSALS on the `page` node (objectui#11318,
 * ADR-0049 enforce-or-remove) — the third and fourth keys of the kind
 * {@link PAGE_ACTIONS_REFUSAL} and {@link PAGE_BREADCRUMBS_REFUSAL} retired:
 * taught by `content/docs/guide/layout.md`, declared by nothing on this node,
 * read by nothing on the render path.
 *
 * ## What was measured (objectui#11318, on this branch's BASE `0858267e4`)
 *
 * Both keys are members of {@link ContainerSchema}, never of this node. On the
 * tolerant face (`safeValidateSchema`) the guide's four page fences carrying them
 * parsed GREEN with the key kept; on the strict authoring face they were
 * refused as a bare `unrecognized_keys` (`Unrecognized key: "maxWidth"`), which
 * names the key and not the door. Rendered through the real `SchemaRenderer`, a
 * page carrying `maxWidth: 'lg'` drew the same `max-w-7xl` inner class as the
 * same page without it, and a page carrying `padding: false` kept the wrapper's
 * `p-3 md:p-4 lg:p-6` unchanged; neither key reached the DOM as an attribute
 * (`toDomProps` drops both). `PageRenderer` takes its max-width class from
 * `pageType` through `getPageMaxWidth`, and its wrapper padding is fixed.
 *
 * The four author sites were all teaching passages in that guide. A census of
 * every git-tracked JSON file and `json` fence, plus every TS/TSX object literal
 * through the TypeScript AST, found no other `type: 'page'` object carrying
 * either key, so this refusal strands no authored document in the tree.
 * `../__tests__/page-width-padding-refusal-11318.test.ts` re-derives the guide
 * half; the census itself is a reading on that base, not a live count.
 *
 * ## Why a REFUSAL and not a reader
 *
 * Both capabilities already ship, one door each: the page's own cap is
 * `pageType`, and a narrower column or custom spacing is a `container` node in
 * `children`, whose `maxWidth` and `padding` are declared and rendered. A page
 * reader would mint a rival spelling of the container's two members on a
 * second node. The triage direction (objectui#11318) rules the same way: no new
 * keys on the `page` node.
 *
 * ⛔ NOT `.strict()` on the node, for the reason {@link PAGE_ACTIONS_REFUSAL}
 * records: `page-app-dashboard-spec-parity.test.ts` pins the node staying open
 * to unknown renderer props. One key, by name, twice.
 */
const PAGE_MAX_WIDTH_REFUSAL =
  '`maxWidth` is not a key of the `page` node and never was (objectui#11318, ADR-0049 ' +
  'enforce-or-remove): no renderer reads it, so an authored value drew nothing and rode ' +
  '`.passthrough()` through the validator as a silent accept. The page takes its max width ' +
  'from `pageType` (`utility` is the narrowest, `home` the widest). For a narrower column, ' +
  'wrap the content in a `container` node in ' +
  '`children` and set THAT node\'s `maxWidth` — { "type": "container", "maxWidth": "2xl", ' +
  '"children": [ … ] } — where it is a declared, rendered member.';

const PAGE_PADDING_REFUSAL =
  '`padding` is not a key of the `page` node and never was (objectui#11318, ADR-0049 ' +
  'enforce-or-remove): no renderer reads it — the page always insets its content — so an ' +
  'authored value, `false` included, drew nothing and rode `.passthrough()` through the ' +
  'validator as a silent accept. Put the spacing on a `container` node in `children` instead, ' +
  'whose `padding` is a declared, rendered NUMBER on the container\'s spacing scale (`0` for ' +
  'none) — { "type": "container", "padding": 8, "children": [ … ] }.';

/**
 * Page Schema — top-level page layout, derived from `@objectstack/spec/ui`
 * `PageSchema` (see {@link SpecPageFields}). The drift guard is
 * `__tests__/page-app-dashboard-spec-parity.test.ts`.
 */
export const PageNodeSchema = BaseSchema.extend(SpecPageFields.shape).extend({
  type: z.literal('page'),
  actions: retirementTombstone(PAGE_ACTIONS_REFUSAL),
  breadcrumbs: retirementTombstone(PAGE_BREADCRUMBS_REFUSAL),
  maxWidth: retirementTombstone(PAGE_MAX_WIDTH_REFUSAL),
  padding: retirementTombstone(PAGE_PADDING_REFUSAL),
  title: z.string().optional().describe('Page title'),
  icon: z.string().optional().describe('Page icon (Lucide icon name)'),
  description: z.string().optional().describe('Page description'),
  pageType: PageTypeSchema.optional().describe('Page type (record, home, app, utility)'),
  // objectui#12464: the page kind `jsx` retired in @objectstack/spec 18
  // (objectstack-ai/objectstack#23638), naming `html`. Picked out of the spec's
  // own enum by reference (`.extract`), the way `PAGE_KIND_NODE_TYPE` is below:
  // the resolved spec carries the retirement, so this extracts exactly the
  // spec's members, and a kind the spec drops fails to compile here. Mirrors
  // the TS face's `PageNodeSchema.kind`.
  kind: stripImportedDefaults(SpecPageSchema)
    .shape.kind.unwrap()
    .extract(['full', 'slotted', 'html', 'react'])
    .optional()
    .describe('Page override mode (full | slotted | html | react)'),
  object: z.string().optional().describe('Bound object name (for record pages)'),
  // objectstack#23610: the spec's own member, by reference, mirroring the TS
  // face's `PageNodeSchema.template` (`SpecPage['template']`). A `z.string()`
  // here accepts every name, so once the spec closes the set of layout names it
  // measures WIDER than the TS face and accepts the `full-width` the spec
  // retires. Against a spec whose member is still a string, it is unchanged.
  template: stripImportedDefaults(SpecPageSchema).shape.template.describe('Layout template name'),
  variables: z.array(PageVariableSchema).optional().describe('Local page state variables'),
  regions: z.array(PageNodeRegionSchema).optional().describe('Page layout regions'),
  body: aliasKeyRefusal(
    'body',
    'children',
    'this page node',
    '`PageRenderer`\'s `FlatContent` read `schema.body || schema.children` and the registration published '
    + '`body` as the flat content list on all five page kinds; objectui#6771 retired the spelling and '
    + 'moved both to `children`.',
  ),
  // objectui#8310: ONE node or a list, mirroring the TS face and the runtime.
  // `FlatContent` in `page.tsx` normalizes a bare node into a one-element list,
  // and the root README's flagship example authors exactly that. The ruling was
  // made about the `body` spelling; objectui#6771 retired it, so the union lives
  // on the key the same reader now takes (`CardSchema` and `AspectRatioSchema`
  // spell the same union on `children`, as does `BaseSchema`).
  children: z
    .union([SchemaNodeSchema, z.array(SchemaNodeSchema)])
    .optional()
    .describe('Main content — one node or a list of nodes'),
  isDefault: z.boolean().optional().describe('Whether this is the default page'),
  // objectui#9409: `assignedProfiles` is RETIRED, and deliberately not declared
  // here. @objectstack/spec 17.5.0 turned its `PageSchema.assignedProfiles` into
  // a `retiredKey()` tombstone (ADR-0090 D2 deleted the Profile concept the key
  // was named after; ADR-0049 enforce-or-remove), and it reaches this node BY
  // REFERENCE through {@link SpecPageFields}, the way App `version` and
  // Dashboard `refreshInterval` do. So an authored value is refused at
  // `assignedProfiles` with the spec's own message, which names the
  // permission-set route. The `string[]` override this line used to carry
  // shadowed that tombstone and accepted the key under a description that
  // called it access control, which nothing ever enforced.
})
  // ⭐ THE SPEC'S OBJECT-LEVEL CHECKS, re-attached (objectui#7715, ruling B1).
  // {@link SpecPageFields} rebuilds a fresh object from the spec's `.shape`, so
  // it drops the two checks the spec's `PageSchema` carries on the OBJECT:
  //  - an `html` / `react` page with no non-empty `source` renders
  //    nothing and is refused at `source` (`checkPageSourceCompleteness`,
  //    objectstack#16489);
  //  - `requires` is refused at `requires` on a page whose `kind` the platform
  //    does not compile at save — anything but `html`, an absent `kind`
  //    included (`checkPageRequiresKind`, objectstack#21459, the spec's 17.7.0);
  //  - a page that authors both `slots.details` and `slots.tabs` is refused at
  //    `slots.details`, because the `tabs` slot replaces the strip the details
  //    body lives in (`checkPageSlotPair`, objectstack#22568, the spec's 18;
  //    attached by objectui#12030);
  //  - on a `kind: 'full'` page, a region whose `name` the page's `template`
  //    does not place, or a second region for a slot already filled, is
  //    refused at `regions.N.name` (`checkPageRegionPlacement`, the spec's
  //    18.0.0-next.2; attached by objectui#12626). It reads `kind`, `template`
  //    (both by reference) and each region's `name`, which this node's own
  //    {@link PageNodeRegionSchema} carries with the same meaning: `page.tsx`
  //    in `@object-ui/components` places a region by its lowercased `name`, as
  //    the check does, so the refusal names exactly the region the renderer
  //    does not place: on a page that names a slotted template it is drawn
  //    nowhere and the page shows a refusal (objectui#12476); on a page that
  //    names no template it is still stacked under `main`.
  //  - a region named `main` (case-insensitively) with `width` `'small'`,
  //    `'medium'` or `'large'` is refused at `regions.N.width`, because no
  //    layout reads `main.width` except `'full'`, which lifts the page's
  //    max-width cap (`checkPageMainRegionWidth`, objectstack#24326; attached
  //    by objectui#12971). It reads each region's `name` and `width`, which
  //    this node's own {@link PageNodeRegionSchema} carries with the same
  //    meaning: `page.tsx` places `main` by its lowercased `name` and reads its
  //    `width` only for `'full'`.
  // The checks listed above are attached as-is: the first three read `kind`,
  // `source`, `requires` and `slots`, which this node carries by reference —
  // none is in {@link PAGE_SPEC_EXCLUDED} nor overridden above.
  // The page-parse judge of a view-data component's retired `api` binding is no
  // longer among them: objectstack#23784 removed it from the spec, which now
  // leaves that verdict to the component-props lint rule at the save door
  // (`validateComponentProps`, `@objectstack/lint`). So a slotted block naming
  // `api` passes here, as it passes the spec's own `PageSchema`; a region
  // block is still refused by its arm in the component union (measured in
  // `__tests__/page-component-view-data-12666.test.ts`). `checkPagePrintComposition`
  // reads `type` and `regions` as the PAGE's own, which this node does NOT carry
  // by reference, so it is not attached; the census below records why.
  // `checkPageDefaultPlacement` (18.0.0-next.2) judges `isDefault` by the page's
  // `type`, and on this node `type` is the component discriminator (`'page'`),
  // so attached here it would refuse every `isDefault`; it is attached on
  // {@link PageKindNodeSchema} below, whose `type` IS the page kind.
  // `checkPageRecordBindingPlacement` (objectstack#24275) refuses the page
  // `record` binding on any page whose `type` is not `app`. It reads `type` the
  // same way, so attached here it would refuse every `record`, a `pageType:
  // 'app'` page's included; it is attached on the kind node only (objectui#12971).
  // `__tests__/spec-object-refinements-7715.test.ts` re-derives the count, so a
  // check the spec adds to `PageSchema` later reddens there.
  .superRefine(checkPageSourceCompleteness)
  .superRefine(checkPageRequiresKind)
  .superRefine(checkPageSlotPair)
  .superRefine(checkPageRegionPlacement)
  .superRefine(checkPageMainRegionWidth);

/**
 * The spec page KINDS a node may carry in `type` (objectui#11440): `record`,
 * `home` and `utility`, picked out of `@objectstack/spec`'s own
 * `PageTypeSchema` by reference (`.extract`), so a kind the spec drops fails to
 * compile here.
 *
 * Exactly the kinds `@object-ui/components` registers on `PageRenderer` and no
 * other arm claims. The spec declares two more, and neither is armed here:
 *  - `app` — the token `AppComponentSchema` already claims for the APP-LEVEL
 *    document (the `app` note on {@link SpecPageFields} above). A spec page of
 *    kind `app` is judged by that arm.
 *  - `list` — not registered under that key (an interface-mode kind, which
 *    `PageView` renders before the registry), and the `list` data-display
 *    component owns the literal.
 */
const PAGE_KIND_NODE_TYPE = PageTypeSchema.extract(['record', 'home', 'utility']);

/**
 * The `page` node's own members, minus its `type` literal, read off
 * {@link PageNodeSchema} by reference — the shape the page kinds below share.
 */
const { type: _pageNodeTypeLiteral, ...PAGE_NODE_MEMBERS } = PageNodeSchema.shape;

/**
 * Page Kind Node Schema — a stored spec page document whose `type` is its page
 * KIND (`record` / `home` / `utility`), the spelling `@objectstack/spec`'s
 * `PageSchema` declares (objectui#11440, under the seat ruling `5945530142` on
 * objectui#10859: "the spec's own page kinds").
 *
 * ## The defect this closes
 *
 * `PageView` (`@object-ui/app-shell`) hands a stored page to `SchemaRenderer`
 * with the kind written verbatim into `type`, and `@object-ui/components`
 * registers the three kinds on `PageRenderer` for exactly that reason
 * (objectui#9642). No arm claimed the literals, so `safeValidateSchema`, and
 * `objectui validate` with it, refused the spec's own page document —
 * `{ type: 'home', name, label, regions }` — with one `invalid_union` at
 * `type`, while `{ type: 'page', pageType: 'home' }` passed.
 *
 * ## Why this shape
 *
 * The five page registrations share ONE renderer and ONE `pageMeta` (its
 * `inputs`), so a kind node is the `page` node under a different literal: every
 * member is {@link PageNodeSchema}'s own, by reference, and that node already
 * takes the spec's `PageSchema` fields by reference through
 * {@link SpecPageFields}. Its four refusals (`actions`, `breadcrumbs`,
 * `maxWidth`, `padding`), the `body` refusal and the spec's attachable
 * object-level checks (`source`, `requires` by `kind`, the `details` /
 * `tabs` slot pair, region placement by `template`, and the `main` region's
 * `width`) come with it. The spec's `isDefault` placement check and its
 * `record` binding placement check are attached here only: each reads the page
 * kind from `type`, which this node carries and the `page` node does not. `regions` stays the node's own
 * {@link PageNodeRegionSchema}, so each region component is judged by this
 * union at every depth, as on `page`.
 *
 * ⛔ Which spelling of a page is canonical — `type: 'page'` + `pageType`, or
 * the spec's `type: KIND` — is not decided here. Both validate, as both render.
 */
export const PageKindNodeSchema: PageKindNodeSchemaType = BaseSchema.extend({
  ...PAGE_NODE_MEMBERS,
  type: PAGE_KIND_NODE_TYPE.describe('The spec page kind — `record`, `home` or `utility` (`@objectstack/spec` `PageTypeSchema`)'),
}).superRefine(checkPageSourceCompleteness).superRefine(checkPageRequiresKind).superRefine(checkPageSlotPair)
  .superRefine(checkPageRegionPlacement)
  .superRefine(checkPageMainRegionWidth)
  // On this node `type` is the spec page kind, the field the spec's
  // `checkPageDefaultPlacement` judges `isDefault` by (objectui#12626), and
  // `checkPageRecordBindingPlacement` judges `record` by (objectui#12971): none
  // of the three kinds is `app`, so a `record` binding is refused here, as the
  // spec refuses it.
  .superRefine(checkPageDefaultPlacement)
  .superRefine(checkPageRecordBindingPlacement);

/**
 * The TYPE of {@link PageKindNodeSchema}, written out BY REFERENCE to the
 * `page` node's shape. Without it, declaration emit re-serializes the whole
 * page shape a second time inside `AnyComponentSchema`, and `tsc` refuses that
 * union with TS7056 ("The inferred type of this node exceeds the maximum length
 * the compiler will serialize"), measured on objectui#11440. A named type is
 * emitted by name.
 */
export type PageKindNodeSchemaType = z.ZodObject<
  Omit<(typeof PageNodeSchema)['shape'], 'type'> & {
    type: z.ZodEnum<{ record: 'record'; home: 'home'; utility: 'utility' }>;
  },
  z.core.$loose
>;

/**
 * Semantic Element Schema — the seven HTML sectioning tags
 * `packages/components/src/renderers/layout/semantic.tsx` registers
 * (objectui#8499).
 *
 * ## The defect this closes
 *
 * These seven are REGISTERED, LIVE renderers with nine catalog fixtures of
 * their own under `examples/schema-catalog/src/schemas/components-layout-semantic/`,
 * and `AnyComponentSchema` had no arm for any of them. So a document that
 * renders correctly in the browser was REFUSED by `objectui validate` — the
 * expensive direction, because the author's likely reaction is to stop trusting
 * the validator rather than to fix the document (objectui#8499 triage).
 *
 * The two faces disagreed BY CONSTRUCTION: `check:doc-types` judges a `type`
 * literal against the RENDERER registry (656 keys at the time of writing), not
 * against this union (107 arms), and nothing compared them at a node slot.
 * `../__tests__/node-slot-registered-arms-8499.test.ts` compares the literal set
 * below against `semantic.tsx`'s own `tags` array, so a tag added there without
 * an arm here goes red instead of diverging silently.
 *
 * ## Why one arm and not seven
 *
 * The factory in `semantic.tsx` builds ONE component over all seven tags: it
 * renders `renderChildren(schema.children)` inside the tag and declares exactly
 * one authoring input, `className`. It read `schema.children || schema.body`
 * until objectui#6771 retired the second spelling. Seven arms would restate
 * the same shape seven times with no key to tell them apart.
 *
 * ## What is NOT declared here, and why
 *
 * Nothing beyond `type` and the child slot. Every other key the factory touches
 * — `data-obj-id`, `data-obj-type`, `style` — is a DESIGNER prop injected by the
 * renderer host, never authored metadata, and `className` is already a
 * {@link BaseSchema} member. Following the `BarChartSchema` discipline (`./data-display.zod.ts`):
 * only keys the renderer demonstrably reads, nothing on the strength of what a
 * sectioning tag "should" accept.
 */
export const SemanticElementSchema = BaseSchema.extend({
  type: z.enum(['aside', 'main', 'header', 'nav', 'footer', 'section', 'article'])
    .describe('HTML sectioning tag — the seven `renderers/layout/semantic.tsx` registers'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional()
    .describe('Child components — read by the factory as `schema.children`; the `body` arm was retired by objectui#6771'),
});

/**
 * Html Element Schema — the safe flow/inline HTML passthrough set
 * `packages/components/src/renderers/basic/html-elements.tsx` registers
 * (objectui#8499).
 *
 * ## Why these must resolve
 *
 * That module's own docblock states the purpose: a `kind:'html'` page is PARSED
 * (never executed) into the SDUI tree, so "the everyday HTML tags an author
 * reaches for — headings, paragraphs, lists, links, images, emphasis — must each
 * resolve to a renderer (otherwise the parser flags them `unknown-component`)".
 * They resolved in the RENDERER registry and in no arm of `AnyComponentSchema`,
 * which is objectui#8499: `content/docs/utilities/runner.mdx` teaches the reader
 * to save a document carrying `h1`, and the document it teaches renders and is
 * refused.
 *
 * ⚠️ One arm over the whole set, deliberately, and it is a real cost: `h1`
 * becomes legal at EVERY node slot, including slots where it is absurd (a
 * `header-bar`'s `logo`, a `dialog`'s `trigger`). That is not new laxity
 * — every one of the 107 pre-existing arms is already legal at every one of the
 * 249 declared node slots, because there is exactly ONE node-slot vocabulary in
 * this face ({@link SchemaNodeSchema}) and a discriminated union selects its arm
 * from the authored literal alone, with no way for a slot to narrow it. A
 * per-slot vocabulary is a different programme, not a variant of this arm.
 *
 * ## The per-tag keys, and why they are typed wider than the registration
 *
 * `PER_TAG_INPUTS` in that module declares `img`'s `width`/`height` as
 * `number`. The renderer FORWARDS them verbatim onto the DOM element, which
 * accepts `"100"` as readily as `100`, so a number-only declaration here would
 * refuse a document the renderer draws — this card's own defect, rebuilt one
 * key down. The declaration follows the read site, not the authoring hint.
 *
 * ⚠️ The keys are declared on the whole set rather than per tag, so
 * `{ type: 'p', href: '…' }` parses. {@link BaseSchema} passes unknown keys
 * through, so it parsed before this arm existed too — declaring them narrows
 * nothing and gains the author a typed surface.
 */
export const HtmlElementSchema = BaseSchema.extend({
  type: z.enum([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'sub', 'sup', 'del', 'ins', 'abbr',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'figure', 'figcaption', 'img', 'hr', 'br', 'time', 'address', 'cite', 'q',
  ]).describe('Safe HTML tag — the set `renderers/basic/html-elements.tsx` registers'),
  children: z.union([SchemaNodeSchema, z.array(SchemaNodeSchema)]).optional()
    .describe('Child components — read as `schema.children`, ignored for the void tags `img` / `hr` / `br`; the `body` arm was retired by objectui#6771'),
  href: z.string().optional()
    .describe('`a` link target; scheme-sanitised (`javascript:` / `data:` / `vbscript:` are dropped)'),
  target: z.string().optional().describe('`a` browsing context — an internal link navigates through the SPA router unless this names another target'),
  rel: z.string().optional().describe('`a` link relationship'),
  title: z.string().optional().describe('Advisory title — declared for `a`, `img` and `abbr`'),
  src: z.string().optional().describe('`img` source URL'),
  alt: z.string().optional().describe('`img` alternative text'),
  width: z.union([z.string(), z.number()]).optional().describe('`img` width — forwarded verbatim to the DOM attribute'),
  height: z.union([z.string(), z.number()]).optional().describe('`img` height — forwarded verbatim to the DOM attribute'),
  dateTime: z.string().optional().describe('`time` machine-readable datetime'),
  cite: z.string().optional().describe('`q` / `blockquote` source URL'),
});

/**
 * Layout Schema Union - All layout component schemas
 */
const LayoutSchemaInferred = z.discriminatedUnion('type', [
  DivSchema,
  BoxSchema,
  TextSpanSchema,
  TextSchema,
  ImageSchema,
  IconSchema,
  SeparatorSchema,
  ContainerSchema,
  // objectui#11276 — the AUTHORED `flex` node, its props in the `properties`
  // bag. `FlexSchema` (the flat mirror) stays exported as the node the renderer
  // reads after the hoist, and leaves this union.
  FlexBlockSchema,
  StackSchema,
  GridSchema,
  CardSchema,
  TabsSchema,
  ScrollAreaSchema,
  ResizableSchema,
  AspectRatioSchema,
  PageNodeSchema,
  SemanticElementSchema,
  HtmlElementSchema,
]);

/**
 * The TYPE of {@link LayoutSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface LayoutZodType extends LayoutSchemaInferredType {
  options: LayoutSchemaInferredType['options'];
}
type LayoutSchemaInferredType = typeof LayoutSchemaInferred;

/** The union above, typed by its named {@link LayoutZodType}. */
export const LayoutSchema: LayoutZodType = LayoutSchemaInferred;
