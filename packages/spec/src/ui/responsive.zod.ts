// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

// ─────────────────────────────────────────────────────────────────────────────
// THIS FILE USED TO CARRY TWO BREAKPOINT VOCABULARIES; ONE SURVIVES (#11027).
//
// Until protocol 18 this file declared both channels `PageComponentSchema`
// offered sixteen lines apart:
//
//     responsiveStyles: ResponsiveStylesSchema  // large | medium | small | xsmall
//     responsive:       ResponsiveConfigSchema  // columns/order keyed xs … 2xl
//
// The first is desktop-first max-width buckets (ADR-0065, mirroring Builder.io's
// SDK) and is LIVE: objectui's `compileScopedStyles` (`@object-ui/core`,
// `styling/scoped-styles.ts`) compiles exactly `large`/`medium`/`small`/`xsmall`
// into id-scoped CSS, and the showcase authors it on ~40 nodes.
//
// The second — the Tailwind-style `xs…2xl` layout config — was retired whole
// (#11027, ADR-0049 D2). Measured across objectstack + objectui with the
// tsc-probe methodology (positive and negative controls): objectui's two
// implementations of the contract (`useResponsiveConfig` in `@object-ui/mobile`,
// `ResponsiveProtocol` in `@object-ui/core`) had ZERO callers, nothing read
// `.responsive` off a page component, and objectui's own node interface never
// declared the key — so `page.components[].responsive`, the destination the
// `dashboard.widgets[].responsive` tombstone (#4876) prescribed as "live",
// applied exactly as much breakpoint behaviour as the key it retired: none.
// `ResponsiveConfigSchema`, `BreakpointColumnMapSchema`,
// `BreakpointOrderMapSchema` and the `BreakpointName` enum had no other
// authorable carrier and left with the key (the PerformanceConfigSchema
// precedent below — an exported schema with no consumer is read as a
// capability, #3950). The removal record is the `retiredKey()` tombstone on
// `page.zod.ts`, the protocol-18 `page-component-responsive-removed`
// conversion, and `RETIRED_DEFS_BY_MAJOR[18]`.
//
// The #4001 批 13 strictness engineering (silent strip-mode blocks under a
// strict shell, `lg` → `large` vocabulary crossings) is preserved on the
// surviving shape below; the batch's measurements live in
// `docs/audits/2026-07-unknown-key-strictness-ledger.md` (`responsive.zod.ts`
// row) and the #4001 semantic entry.
// ─────────────────────────────────────────────────────────────────────────────

/*
 * REMOVED — `BreakpointName`, `BreakpointColumnMapSchema` /
 * `BreakpointColumnMap`, `BreakpointOrderMapSchema` / `BreakpointOrderMap`,
 * `ResponsiveConfigSchema` / `ResponsiveConfig` (#11027, ADR-0049 D2). They
 * typed the `responsive` layout block whose only remaining authorable carrier
 * was `page.components[].responsive` (its widget sibling was retired in
 * #4876, `view.responsive` in #3896): every carrier was authorable and inert
 * — no renderer or runtime ever applied a per-breakpoint column count,
 * display order, or visibility from it. An exported schema with no consumer
 * is read as a capability by whoever finds it (#3950 precedent; exactly how
 * `PerformanceConfigSchema` left in the #3896 close-out). The Tailwind-style
 * `xs…2xl` layout vocabulary returns if and when a renderer implements it —
 * in one change, with the engine (the #4834 rule).
 */

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
 * Since #11027 this is the ONLY per-breakpoint channel on a page component: the
 * sibling `responsive` layout block (grid columns / visibility / order on a
 * Tailwind `xs..2xl` axis) was authorable and inert, and was retired under
 * ADR-0049 D2. Express layout per breakpoint as CSS here instead — see the
 * `guidance` entries below for the per-knob translations.
 */
export const ResponsiveStylesSchema = lazySchema(() => strictObject(
  {
    surface: 'this per-breakpoint style map',
    history:
      'Until #4001 批 13 a bucket this shape does not declare was dropped silently — ' +
      'and since the whole block is optional, a node whose every style was written ' +
      'under the wrong vocabulary rendered completely unstyled and parsed clean.',
    aliases: {
      // The Tailwind ramp (`xs`…`2xl`) is the vocabulary the retired sibling
      // `responsive` block was keyed by (#11027), and the one authors carry in
      // from Tailwind itself. Mapped onto the max-width bucket that contains
      // each name: objectui's `STYLE_BREAKPOINTS` cuts at medium ≤991px,
      // small ≤640px, xsmall ≤479px (`@object-ui/core`,
      // `styling/scoped-styles.ts`), and `large` is the unconditional base, so
      // everything above `md` lands there.
      xs: 'xsmall',
      sm: 'small',
      md: 'medium',
      lg: 'large',
      xl: 'large',
      '2xl': 'large',
    },
    guidance: {
      // The three knobs of the RETIRED `responsive` layout block (#11027,
      // ADR-0049 D2 — no renderer ever applied them). An author who lands one
      // here is usually migrating off that block, so each entry carries the
      // CSS translation that IS applied.
      columns:
        '`columns` was a key of the retired `responsive` layout block (#11027 — no renderer ' +
        'ever applied it). This block holds per-breakpoint CSS. Express a column span as CSS ' +
        "on the bucket where it should apply, e.g. `medium: { gridColumn: 'span 6' }`.",
      hiddenOn:
        '`hiddenOn` was a key of the retired `responsive` layout block (#11027 — no renderer ' +
        'ever applied it). This block holds per-breakpoint CSS. Hide a component per ' +
        "breakpoint with CSS, e.g. `xsmall: { display: 'none' }`.",
      order:
        '`order` was a key of the retired `responsive` layout block (#11027 — no renderer ' +
        'ever applied it). This block holds per-breakpoint CSS. Set display order per ' +
        "breakpoint with CSS, e.g. `small: { order: '1' }`.",
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
