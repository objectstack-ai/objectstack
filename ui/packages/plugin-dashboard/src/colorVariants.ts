// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dashboard renderer's `colorVariant` tokens — ONE table, shared by every
 * surface that paints a KPI accent.
 *
 * The vocabulary is `@objectstack/spec`'s `WidgetColorVariantSchema` enum
 * (`packages/spec/src/ui/dashboard.zod.ts`), mirrored by the designer's swatch
 * picker (`app-shell/.../color-variant-field.tsx` — "Canonical semantic
 * palette"). Those three lists must state the same eight tokens; a renderer
 * that invented a ninth variant, or dropped one, would turn a
 * declared-but-unenforced key into the harder bug: two disagreeing
 * declarations. The picker carries three EXTRA display-only aliases
 * (`green`/`red`/`amber`) so a swatch can still be drawn for an off-spec
 * stored value — deliberately NOT honoured here (see `metricAccentTextClass`).
 *
 * Class strings stay static literals so Tailwind's content scanner sees them
 * (`apps/console/src/index.css` sources this package's `src/**`).
 */

export type MetricColorVariant =
  | 'default' | 'blue' | 'teal' | 'orange' | 'purple'
  | 'success' | 'warning' | 'danger';

/**
 * Icon-chip classes per variant — a soft background + bold foreground that
 * tints the icon container while the rest of the card stays in the neutral
 * Shadcn palette. Used by the card-chrome KPI layout (`MetricWidget`).
 */
export const VARIANT_ICON_CLASSES: Record<MetricColorVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  blue:    'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  teal:    'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  orange:  'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  purple:  'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger:  'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

/** Text-colour per variant — tints the big number on the chrome-less
 *  (`bare` / dataset-bound) KPI layouts, which have no icon chip to carry the
 *  accent. */
export const VARIANT_TEXT_CLASSES: Record<MetricColorVariant, string> = {
  default: 'text-foreground',
  blue:    'text-blue-600 dark:text-blue-400',
  teal:    'text-teal-600 dark:text-teal-400',
  orange:  'text-orange-600 dark:text-orange-400',
  purple:  'text-purple-600 dark:text-purple-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger:  'text-rose-600 dark:text-rose-400',
};

/**
 * Resolve a widget's declared `colorVariant` to the accent text class for a
 * KPI that already renders in the ambient foreground colour, or `undefined`
 * when there is no accent to add.
 *
 * `undefined` is returned for three distinct inputs, and the caller wants the
 * same thing in all three — emit no extra class at all:
 *
 *  - **not declared** — the widget said nothing, so its markup must not change
 *    (objectui#3359 pins this byte-for-byte);
 *  - **`'default'`** — the enum's own name for "no accent". Painting the
 *    explicit `text-foreground` here would be a no-op on a surface that
 *    already inherits it, and would make `colorVariant: 'default'` differ from
 *    omitting the key purely in class-attribute bytes;
 *  - **off-spec token** (`'chartreuse'`, or the picker's display-only
 *    `'green'`/`'red'`/`'amber'` aliases) — deliberately no accent and no
 *    aliasing. The spec enum rejects these where the metadata is authored and
 *    published; teaching the renderer to accept a second spelling would
 *    fossilize a dialect the contract does not have (AGENTS.md #0.1). A
 *    cosmetic key is also the wrong place to fail a widget's whole render,
 *    hence "no accent" rather than an error.
 *
 * `MetricWidget`'s own layouts keep indexing `VARIANT_TEXT_CLASSES` /
 * `VARIANT_ICON_CLASSES` directly — they take a defaulted prop, so `'default'`
 * genuinely resolves to a class there.
 */
export function metricAccentTextClass(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === 'default') return undefined;
  return VARIANT_TEXT_CLASSES[value as MetricColorVariant];
}
