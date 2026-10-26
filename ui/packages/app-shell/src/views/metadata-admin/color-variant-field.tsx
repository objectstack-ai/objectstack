// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared color-variant swatch picker.
 *
 * Metadata color fields (`colorVariant` on metrics / dashboard widgets, badge
 * tones, …) are a fixed SEMANTIC palette, not arbitrary hex. A row of colored
 * swatches is far more scannable than a text dropdown — the admin sees the
 * actual color, like Linear/Notion label pickers. Reused by the generic
 * SchemaForm `color-picker` widget and the curated inspectors so every color
 * field looks and behaves the same.
 */

import { cn } from '@object-ui/components';

export interface ColorVariant { value: string; label: string; css: string }

/** Canonical semantic palette (mirrors the renderer's colorVariant tokens). */
export const COLOR_VARIANTS: ColorVariant[] = [
  { value: 'default', label: 'Default', css: '#9ca3af' },
  { value: 'blue', label: 'Blue', css: '#3b82f6' },
  { value: 'teal', label: 'Teal', css: '#14b8a6' },
  { value: 'orange', label: 'Orange', css: '#f97316' },
  { value: 'purple', label: 'Purple', css: '#a855f7' },
  { value: 'success', label: 'Success', css: '#22c55e' },
  { value: 'warning', label: 'Warning', css: '#f59e0b' },
  { value: 'danger', label: 'Danger', css: '#ef4444' },
  // common aliases so non-canonical tokens still get a sensible swatch
  { value: 'green', label: 'Green', css: '#22c55e' },
  { value: 'red', label: 'Red', css: '#ef4444' },
  { value: 'amber', label: 'Amber', css: '#f59e0b' },
];

const CSS_BY_VALUE: Record<string, string> = Object.fromEntries(COLOR_VARIANTS.map((c) => [c.value, c.css]));

/** Resolve a token (or hex) to a CSS color; unknown tokens fall back to neutral. */
export function colorVariantCss(value: string | undefined): string {
  if (!value) return '#9ca3af';
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
  return CSS_BY_VALUE[value] ?? '#9ca3af';
}

/**
 * How this picker's `radiogroup` gets its accessible name (objectui#4010).
 *
 * The swatches are `role="radio"` buttons, each already named by its colour —
 * "Blue", "Success". The GROUP is a separate naming surface, and its name is
 * the one that says WHAT is being coloured; without it focus enters an
 * anonymous radiogroup and the field's visible label is unowned text.
 *
 * Naming is required at the type level, exactly one channel, mirroring
 * `InspectorComboField` (objectui#3997): an unnamed picker does not compile.
 *
 *  - `ariaLabelledBy` — a VISIBLE label names this field. It publishes its own
 *    `id` and the group answers by IDREF. This is the WAI-ARIA group pattern
 *    this repo already applies to `labelling: 'group'` field widgets
 *    (objectui#3961 → #3990), and it is the right channel here for the reason
 *    stated there: `role="radiogroup"` is a CONTAINER, not a labelable element,
 *    so a `<label for>` aimed at it is inert HTML that names nothing. The
 *    visible text becomes the accessible name verbatim — one fact, one author,
 *    no second string to drift.
 *  - `ariaLabel` — no visible label is in a position to publish an id (a
 *    generic host that rendered its `<label for>` before it knew this surface
 *    would be a group). Self-owned name; keep it EQUAL to the visible text
 *    where one exists, or WCAG 2.5.3 (Label in Name) fails.
 *
 * Deliberately no `id` variant: handing this container the id a `<label for>`
 * points at would make the IDREF resolve while still naming nothing — the
 * cosmetic half-fix objectui#4010 was filed to avoid, and the pairing
 * `form.tsx` refuses outright ("one label two association channels, one of
 * which is broken").
 */
export type ColorVariantPickerNaming =
  | { ariaLabelledBy: string; ariaLabel?: never }
  | { ariaLabel: string; ariaLabelledBy?: never };

export function ColorVariantPicker({ value, onChange, disabled, options, required, ariaLabelledBy, ariaLabel }: ColorVariantPickerNaming & {
  value: string | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Restrict/relabel the choices; defaults to the full canonical palette. */
  options?: Array<{ value: string; label?: string }>;
  /**
   * Whether the host shows a required `*` for this field (objectui#10367). The
   * host's `*` is `aria-hidden`, so this is the channel that announces the
   * requirement: `aria-required` on the `radiogroup`, which ARIA 1.2 supports
   * on that role. Omitted, never "false", when the field is optional.
   */
  required?: boolean;
}) {
  const opts: ColorVariant[] = options
    ? options.map((o) => ({ value: o.value, label: o.label ?? o.value, css: colorVariantCss(o.value) }))
    : COLOR_VARIANTS.slice(0, 8); // canonical 8 (skip aliases in the default row)
  const current = value ?? 'default';
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
      aria-required={required ? true : undefined}
    >
      {opts.map((o) => {
        const on = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full border transition-all',
              on
                ? 'border-transparent ring-2 ring-foreground/60 ring-offset-1 ring-offset-background'
                : 'border-border hover:scale-110',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: o.css }} />
          </button>
        );
      })}
    </div>
  );
}
