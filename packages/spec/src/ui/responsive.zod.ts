// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE IS STRICT (#4001 批 13, ADR-0078) — engineering rationale; the
// author-facing text is the JSDoc on each schema, which is what the generated
// reference page renders.
//
// THIS FILE CARRIES TWO BREAKPOINT VOCABULARIES, AND THEY SIT SIXTEEN LINES
// APART ON THE SAME PAGE COMPONENT. `PageComponentSchema` declares both:
//
//     responsiveStyles: ResponsiveStylesSchema  // large | medium | small | xsmall
//     responsive:       ResponsiveConfigSchema  // columns/order keyed xs … 2xl
//
// The first is desktop-first max-width buckets (ADR-0065, mirroring Builder.io's
// SDK); the second is the Tailwind-style `BreakpointName` ramp declared at the
// top of this file. Both are correct, neither is a typo of the other, and edit
// distance cannot bridge `lg` → `large`. So the curation below is not decoration
// — crossing the two vocabularies is THE mistake this file invites, and until
// #4001 批 13 every crossing was silent.
//
// Measured on `main` before the change (`ResponsiveStylesSchema.parse`):
//
//     { lg: { fontSize: '40px' } }             → {}
//     { desktop: { fontSize: '40px' } }        → {}
//     { columns: { large: 4, lg: 3 } }         → { columns: { lg: 3 } }
//
// The third one is the worst of the three: half the author's map survived, so
// the node did lay out — at the wrong width, on the breakpoints they did not
// name. And none of it was caught upstream, because THE OUTER GATE DOES NOT
// RECURSE. `PageComponentSchema` has been `.strict()` since ADR-0089 D3a, and it
// still accepted this whole component:
//
//     PageComponentSchema.parse({
//       type: 'element:text', id: 't1',
//       responsiveStyles: { lg: { fontSize: '40px' } },
//       responsive: { colums: { lg: 4 }, hideOn: ['xs'] },
//     })
//     → { …, responsiveStyles: {}, responsive: {} }
//
// Every styling and layout instruction the author wrote, gone, reported valid.
// That is the campaign's thesis in one parse: a strict shell over strip-mode
// blocks is not a closed surface, it is a closed surface's silhouette.
//
// WHERE THIS BINDS, MEASURED — because a tightening must not claim reach it does
// not have. The door is `getMetadataTypeSchema('page')`, i.e. the registry read
// by `MetadataManager.validate`, `GET /api/v1/meta` and the Studio page form:
// against it, the crossed vocabulary and the legacy breakpoint-keyed shape are
// both rejected, and a clean page still parses. It does NOT bind in
// `objectstack build` / `validate` — that path never parses page metadata at
// all, which a control proves rather than a guess: a key `PageComponentSchema`
// has rejected since ADR-0089 D3a passes both commands and lands in the built
// artifact. That gap predates this change and is filed as #5000; it is recorded
// here so nobody reads the campaign's usual "three example apps validate" line
// as evidence for this surface.
//
// LIVENESS IS NOT WHAT THIS CHANGE CLAIMS. `responsiveStyles` is read —
// objectui's `compileScopedStyles` (`@object-ui/core`, `styling/scoped-styles.ts`)
// compiles exactly `large`/`medium`/`small`/`xsmall` into id-scoped CSS, and the
// showcase authors it on ~40 nodes. `ResponsiveConfigSchema`'s own liveness is a
// separate, open question tracked outside #4001 — closing a shape says which
// keys it declares, never that a renderer reads them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Breakpoint Name Enum
 * Standard Tailwind-style breakpoint names (xs–2xl).
 */
export const BreakpointName = z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);

export type BreakpointName = z.input<typeof BreakpointName>;

/**
 * Aliases for the two per-breakpoint MAPS (`columns` / `order`), which are keyed
 * by {@link BreakpointName}.
 *
 * Anchored to a named sibling rather than to edit distance: the four targets are
 * the key set of {@link ResponsiveStylesSchema}, the OTHER breakpoint vocabulary
 * on the same page component. `large` → `lg` is a vocabulary crossing, not a
 * misspelling, so only a written-down entry can answer it.
 *
 * `xxl` is the one entry that is not a crossing — it is the recorded near-miss
 * for `2xl`, pinned as rejected by this file's own test since before #4001
 * (`responsive.test.ts`, "should reject invalid breakpoint names").
 */
const BREAKPOINT_MAP_ALIASES = {
  large: 'lg',
  medium: 'md',
  small: 'sm',
  xsmall: 'xs',
  xxl: '2xl',
} as const;

const BREAKPOINT_MAP_HISTORY =
  'Until #4001 批 13 a breakpoint name this map does not declare was dropped silently — ' +
  'the surviving half of the map still laid the node out, at the wrong width, on the ' +
  'breakpoints the author never named.';

/**
 * Breakpoint Column Map Schema
 * Maps breakpoint names to grid column counts (1-12).
 * All entries are optional — only specified breakpoints are configured.
 */
export const BreakpointColumnMapSchema = lazySchema(() => strictObject(
  {
    surface: 'this per-breakpoint column map',
    history: BREAKPOINT_MAP_HISTORY,
    aliases: BREAKPOINT_MAP_ALIASES,
  },
  {
    xs: z.number().min(1).max(12).optional(),
    sm: z.number().min(1).max(12).optional(),
    md: z.number().min(1).max(12).optional(),
    lg: z.number().min(1).max(12).optional(),
    xl: z.number().min(1).max(12).optional(),
    '2xl': z.number().min(1).max(12).optional(),
  },
).describe('Grid columns per breakpoint (1-12)'));
export type BreakpointColumnMap = z.input<typeof BreakpointColumnMapSchema>;

/**
 * Breakpoint Order Map Schema
 * Maps breakpoint names to display order numbers.
 * All entries are optional — only specified breakpoints are configured.
 */
export const BreakpointOrderMapSchema = lazySchema(() => strictObject(
  {
    surface: 'this per-breakpoint order map',
    history: BREAKPOINT_MAP_HISTORY,
    aliases: BREAKPOINT_MAP_ALIASES,
  },
  {
    xs: z.number().optional(),
    sm: z.number().optional(),
    md: z.number().optional(),
    lg: z.number().optional(),
    xl: z.number().optional(),
    '2xl': z.number().optional(),
  },
).describe('Display order per breakpoint'));
export type BreakpointOrderMap = z.input<typeof BreakpointOrderMapSchema>;

/**
 * A bare breakpoint name written at the `responsive` LEVEL rather than inside
 * one of its maps — the legacy breakpoint-keyed shape.
 *
 * This is not hypothetical: the retired `view.responsive` was authored that way,
 * and the conversion registry still carries `responsive: { sm: {} }` as the
 * `before` fixture of `view-inert-keys-removed`. A rename cannot answer it —
 * three different keys are plausible targets — so each name gets its own
 * prescription. Per-key rather than one shared string, because `guidance` emits
 * one bullet VERBATIM per offending key and a shared string prints the same
 * paragraph N times (the 批 10 `join`/`joinGateway` lesson).
 */
const BREAKPOINT_AT_TOP_LEVEL = Object.fromEntries(
  (['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const).map((bp) => [
    bp,
    `\`${bp}\` is a BREAKPOINT NAME, not a key on this block — the breakpoint-keyed ` +
    `shape (\`responsive: { ${bp}: … }\`) belonged to \`view.responsive\`, retired in 17 ` +
    `(#3896). Name the knob first, the breakpoint second: \`columns: { ${bp}: 6 }\`, ` +
    `\`order: { ${bp}: 2 }\`, or \`hiddenOn: ['${bp}']\`.`,
  ]),
);

/**
 * A key from the SIBLING vocabulary — `responsiveStyles`' max-width buckets —
 * written on the layout block instead. The fix is the sibling key on the same
 * component, so this is a wrong-layer pointer rather than a rename.
 */
const STYLE_BUCKET_AT_LAYOUT_LEVEL = Object.fromEntries(
  (['large', 'medium', 'small', 'xsmall'] as const).map((bucket) => [
    bucket,
    `\`${bucket}\` is a \`responsiveStyles\` bucket, not a \`responsive\` key — this block ` +
    `configures LAYOUT (grid columns / visibility / order) on the \`xs\`…\`2xl\` axis. For ` +
    `per-breakpoint CSS write the sibling key on this component: ` +
    `\`responsiveStyles: { ${bucket}: { … } }\` (ADR-0065).`,
  ]),
);

/**
 * Responsive Configuration Schema
 *
 * Provides responsive layout configuration for UI components.
 * Maps breakpoint names to layout behavior (columns, visibility, order).
 *
 * @example
 * ```typescript
 * const config: ResponsiveConfig = {
 *   columns: { xs: 12, sm: 6, lg: 4 },
 *   hiddenOn: ['xs'],
 *   order: { xs: 2, lg: 1 },
 * };
 * ```
 */
export const ResponsiveConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'this responsive layout configuration',
    history:
      'Until #4001 批 13 these were dropped silently — and the component around them ' +
      'parsed clean, because `PageComponentSchema` is strict only at its own level.',
    aliases: {
      // objectui's `useResponsiveConfig` resolves this block and returns
      // `{ hidden, columns, order, breakpoint }` (`@object-ui/mobile`,
      // `useResponsiveConfig.ts`). `hidden` is that RESULT's spelling of the
      // authored `hiddenOn`, which is where the wrong word comes from.
      hidden: 'hiddenOn',
      // `hideOn` USED to need an entry here. It is not a different word — it is
      // the same word, and the distance fallback could not reach it only
      // because of #4990: the fallback lowercased the INPUT but not the
      // CANDIDATES, so `hiddenOn`'s capital O cost an extra edit and `hideOn`
      // scored 3 against a budget of 2, while the all-lowercase `hiddenon`
      // scored 1 and resolved fine. #4990 fixed that at the source by folding
      // case on both sides, so this per-case workaround is retired: `hideOn`
      // now reaches `hiddenOn` on distance alone. The measurement that
      // justified the entry is preserved as an assertion in `responsive.test.ts`
      // ("reaches `hiddenOn` from both wrong spellings") rather than as a
      // comment, so it fails if the general fix ever regresses.
    },
    guidance: {
      ...BREAKPOINT_AT_TOP_LEVEL,
      ...STYLE_BUCKET_AT_LAYOUT_LEVEL,
      responsiveStyles:
        '`responsiveStyles` is a SIBLING key on the component, not a key inside ' +
        '`responsive`. Move it out one level: `{ …component, responsive: { … }, ' +
        'responsiveStyles: { large: { … } } }` (ADR-0065).',
    },
  },
  {
    /** Minimum breakpoint for visibility */
    breakpoint: BreakpointName.optional()
      .describe('Minimum breakpoint for visibility'),

    /** Hide on specific breakpoints */
    hiddenOn: z.array(BreakpointName).optional()
      .describe('Hide on these breakpoints'),

    /** Grid columns per breakpoint (1-12 column grid) */
    columns: BreakpointColumnMapSchema.optional().describe('Grid columns per breakpoint'),

    /** Display order per breakpoint */
    order: BreakpointOrderMapSchema.optional().describe('Display order per breakpoint'),
  },
).describe('Responsive layout configuration'));

export type ResponsiveConfig = z.input<typeof ResponsiveConfigSchema>;

/**
 * Style Map Schema (ADR-0065)
 *
 * A CSS property → value map (camelCase keys, e.g. `flexDirection`). Values are
 * arbitrary CSS strings/numbers but authors should prefer design tokens
 * (`var(--space-6)`, `var(--surface)`) for consistency and AI-safety.
 *
 * **Deliberately OPEN, and it must stay open** (#4001 批 13 exemption). The key
 * space here is *every CSS property*, not a contract this repo owns: objectui's
 * `declarations()` camel→kebab-cases whatever it is handed and emits it verbatim
 * (`@object-ui/core`, `styling/scoped-styles.ts`), so closing it would mean
 * transcribing the CSS property list into the spec and rejecting each new one
 * until we noticed. That is the `open` class of the #4001 ledger, not an
 * unfinished row — pinned in `responsive.test.ts` so a later sweep stops here
 * instead of "finishing" the file. (`z.record` has no unknown-key posture at
 * all, so this exemption costs no `.strict()` decision; it is recorded because
 * the REASON is what a later reader needs.)
 */
export const StyleMapSchema = lazySchema(() =>
  z.record(z.string(), z.union([z.string(), z.number()]))
    .describe('CSS property → value map (camelCase keys; design tokens encouraged)'));

export type StyleMap = z.input<typeof StyleMapSchema>;

/**
 * Responsive Styles Schema (ADR-0065)
 *
 * Per-breakpoint CSS-property maps for the SDUI scoped-styling model. Compiled
 * to **id-scoped CSS at render** (objectui `SchemaRenderer`) — build-independent,
 * collision-free, responsive-correct. Desktop-first: `large` is the
 * unconditional base; `medium`/`small`/`xsmall` are `max-width` overrides.
 *
 * Distinct from {@link ResponsiveConfigSchema}, which configures *layout* (grid
 * columns / visibility / order) on the Tailwind `xs..2xl` axis. This styles a
 * node's own box; that arranges a node within a grid.
 */
export const ResponsiveStylesSchema = lazySchema(() => strictObject(
  {
    surface: 'this per-breakpoint style map',
    history:
      'Until #4001 批 13 a bucket this shape does not declare was dropped silently — ' +
      'and since the whole block is optional, a node whose every style was written ' +
      'under the wrong vocabulary rendered completely unstyled and parsed clean.',
    aliases: {
      // The Tailwind ramp is `BreakpointName`, declared at the top of this file
      // and used by the SIBLING `responsive` key on the same page component.
      // Mapped onto the max-width bucket that contains each one: objectui's
      // `STYLE_BREAKPOINTS` cuts at medium ≤991px, small ≤640px, xsmall ≤479px
      // (`@object-ui/core`, `styling/scoped-styles.ts`), and `large` is the
      // unconditional base, so everything above `md` lands there.
      xs: 'xsmall',
      sm: 'small',
      md: 'medium',
      lg: 'large',
      xl: 'large',
      '2xl': 'large',
    },
    guidance: {
      columns:
        '`columns` is a `responsive` key, not a `responsiveStyles` bucket — this block ' +
        'holds per-breakpoint CSS. For a grid column count write the sibling key on this ' +
        'component: `responsive: { columns: { lg: 4 } }`.',
      hiddenOn:
        '`hiddenOn` is a `responsive` key, not a `responsiveStyles` bucket. Write the ' +
        "sibling key on this component: `responsive: { hiddenOn: ['xs'] }` — or express it " +
        'as CSS here with `xsmall: { display: \'none\' }`.',
      order:
        '`order` is a `responsive` key, not a `responsiveStyles` bucket. Write the sibling ' +
        'key on this component: `responsive: { order: { lg: 1 } }` — or express it as CSS ' +
        "here with `large: { order: '1' }`.",
    },
  },
  {
    large: StyleMapSchema.optional().describe('Unconditional base (desktop-first)'),
    medium: StyleMapSchema.optional().describe('Applied at ≤ medium breakpoint'),
    small: StyleMapSchema.optional().describe('Applied at ≤ small breakpoint'),
    xsmall: StyleMapSchema.optional().describe('Applied at ≤ xsmall breakpoint'),
  },
).describe('Per-breakpoint scoped style maps (ADR-0065)'));

export type ResponsiveStyles = z.input<typeof ResponsiveStylesSchema>;

/*
 * REMOVED — `PerformanceConfigSchema` / `PerformanceConfig` (#3896 audit
 * close-out). It typed the `performance` keys on report (removed in the
 * report-liveness close-out), list view and dashboard (removed in this
 * sweep): every carrier was authorable and inert — no renderer or runtime
 * ever read a performance block. An exported schema with no consumer is read
 * as a capability by whoever finds it (#3950 precedent).
 */
