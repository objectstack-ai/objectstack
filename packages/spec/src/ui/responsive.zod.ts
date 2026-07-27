// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Breakpoint Name Enum
 * Standard Tailwind-style breakpoint names (xs–2xl).
 */
import { lazySchema } from '../shared/lazy-schema';
export const BreakpointName = z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl']);

export type BreakpointName = z.infer<typeof BreakpointName>;

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
/**
 * Breakpoint Column Map Schema
 * Maps breakpoint names to grid column counts (1-12).
 * All entries are optional — only specified breakpoints are configured.
 */
export const BreakpointColumnMapSchema = lazySchema(() => z.object({
  xs: z.number().min(1).max(12).optional(),
  sm: z.number().min(1).max(12).optional(),
  md: z.number().min(1).max(12).optional(),
  lg: z.number().min(1).max(12).optional(),
  xl: z.number().min(1).max(12).optional(),
  '2xl': z.number().min(1).max(12).optional(),
}).describe('Grid columns per breakpoint (1-12)'));

/**
 * Breakpoint Order Map Schema
 * Maps breakpoint names to display order numbers.
 * All entries are optional — only specified breakpoints are configured.
 */
export const BreakpointOrderMapSchema = lazySchema(() => z.object({
  xs: z.number().optional(),
  sm: z.number().optional(),
  md: z.number().optional(),
  lg: z.number().optional(),
  xl: z.number().optional(),
  '2xl': z.number().optional(),
}).describe('Display order per breakpoint'));

export const ResponsiveConfigSchema = lazySchema(() => z.object({
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
}).describe('Responsive layout configuration'));

export type ResponsiveConfig = z.infer<typeof ResponsiveConfigSchema>;

/**
 * Style Map Schema (ADR-0065)
 *
 * A CSS property → value map (camelCase keys, e.g. `flexDirection`). Values are
 * arbitrary CSS strings/numbers but authors should prefer design tokens
 * (`var(--space-6)`, `var(--surface)`) for consistency and AI-safety.
 */
export const StyleMapSchema = lazySchema(() =>
  z.record(z.string(), z.union([z.string(), z.number()]))
    .describe('CSS property → value map (camelCase keys; design tokens encouraged)'));

export type StyleMap = z.infer<typeof StyleMapSchema>;

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
export const ResponsiveStylesSchema = lazySchema(() => z.object({
  large: StyleMapSchema.optional().describe('Unconditional base (desktop-first)'),
  medium: StyleMapSchema.optional().describe('Applied at ≤ medium breakpoint'),
  small: StyleMapSchema.optional().describe('Applied at ≤ small breakpoint'),
  xsmall: StyleMapSchema.optional().describe('Applied at ≤ xsmall breakpoint'),
}).describe('Per-breakpoint scoped style maps (ADR-0065)'));

export type ResponsiveStyles = z.infer<typeof ResponsiveStylesSchema>;

/**
 * Performance Configuration Schema
 *
 * Defines performance optimization settings for UI components
 * such as lazy loading, virtual scrolling, and caching.
 *
 * @example
 * ```typescript
 * const perf: PerformanceConfig = {
 *   lazyLoad: true,
 *   virtualScroll: { enabled: true, itemHeight: 40, overscan: 5 },
 *   cacheStrategy: 'stale-while-revalidate',
 *   prefetch: true,
 * };
 * ```
 */
export const PerformanceConfigSchema = lazySchema(() => z.object({
  /** Enable lazy loading for this component */
  lazyLoad: z.boolean().optional()
    .describe('Enable lazy loading (defer rendering until visible)'),

  /** Virtual scrolling configuration for large datasets */
  virtualScroll: z.object({
    enabled: z.boolean().default(false).describe('Enable virtual scrolling'),
    itemHeight: z.number().optional().describe('Fixed item height in pixels (for estimation)'),
    overscan: z.number().optional().describe('Number of extra items to render outside viewport'),
  }).optional().describe('Virtual scrolling configuration'),

  /** Client-side caching strategy */
  cacheStrategy: z.enum([
    'none',
    'cache-first',
    'network-first',
    'stale-while-revalidate',
  ]).optional().describe('Client-side data caching strategy'),

  /** Enable data prefetching */
  prefetch: z.boolean().optional()
    .describe('Prefetch data before component is visible'),

  /** Maximum number of items to render before pagination */
  pageSize: z.number().optional()
    .describe('Number of items per page for pagination'),

  /** Debounce interval for user interactions (ms) */
  debounceMs: z.number().optional()
    .describe('Debounce interval for user interactions in milliseconds'),
}).describe('Performance optimization configuration'));

export type PerformanceConfig = z.infer<typeof PerformanceConfigSchema>;
