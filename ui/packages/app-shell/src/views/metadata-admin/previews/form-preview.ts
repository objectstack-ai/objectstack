// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * form-preview — shared classifier for rendering form blocks/views on a design
 * or preview surface (ViewPreview, the page-designer canvas).
 *
 * Overlay form types (`drawer` / `modal`) render their body through a portal as
 * a modal Sheet/Dialog. On a preview canvas that overlay escapes the layout and
 * locks the whole editor — Radix sets body `pointer-events:none` and traps focus
 * while open — which reads as a frozen UI. Preview surfaces neutralise overlay
 * types to an inline form before handing the schema to SchemaRenderer.
 *
 * This is the schema-level layer; `DrawerForm`/`ModalForm` also self-guard via
 * `PreviewModeProvider` (rendering inline under preview), so a form rendered live
 * can never lock the page even if a surface forgets to coerce. Keep the single
 * source of truth here so the two preview surfaces never drift apart.
 */

/** Form types that render inline (no portalled overlay). */
export const INLINE_FORM_TYPES = new Set(['simple', 'tabbed', 'wizard', 'split']);

/** Form types that render as a portalled, page-locking overlay. */
export const OVERLAY_FORM_TYPES = new Set(['drawer', 'modal']);

/** True when `t` is a form type that would mount a page-locking overlay. */
export function isOverlayFormType(t: unknown): boolean {
  return typeof t === 'string' && OVERLAY_FORM_TYPES.has(t);
}

/** Map any form type to an inline one: overlay types collapse to `simple`,
 *  inline types pass through, unknown/missing falls back to `simple`. */
export function toInlineFormType(t: unknown): string {
  return typeof t === 'string' && INLINE_FORM_TYPES.has(t) ? t : 'simple';
}
