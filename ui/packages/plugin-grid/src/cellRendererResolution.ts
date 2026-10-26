/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE GRID'S SINGLE ANSWER TO "WHICH CELL RENDERER?" (objectui#8920).
 *
 * ## The defect this module exists to close
 *
 * `@object-ui/fields` publishes a TWO-STEP resolve:
 * `getCellRenderer(resolveCellRendererType(field))`. The second step exists
 * because a field's DECLARED type is not always the renderer's key — a textual
 * base type carrying a `format` hint (`phone`, `email`, `url`, `currency`,
 * `percent`) maps to the richer renderer. Skip it and the cell gets
 * `TextCellRenderer`, which destructures only `value` and therefore never reads
 * `field.format`: the hint is dropped, nothing throws, nothing warns, and the
 * column silently renders as plain truncated text instead of a `tel:` /
 * `mailto:` / formatted value.
 *
 * `ObjectGrid` used to spell that resolve SIX times with THREE conventions —
 * one two-step, four raw declared types, one fixed registry key. Patching the
 * four to match the one leaves the divergence in place and lets a seventh site
 * pick either convention, so the resolution itself lives here instead: every
 * `getCellRenderer` call the grid makes is made from this module, and
 * `ObjectGrid.tsx` no longer imports `getCellRenderer` at all. That invariant
 * is pinned by `__tests__/cellRendererResolutionBoundary-8920.test.ts`.
 *
 * ## Two resolutions, two names — the trap that hid the defect
 *
 * The word "resolve" named two different things in this file's caller, and the
 * collision is most of why four sites read as correct:
 *
 *   - "resolve which TYPE the field has" — `objectDef type > heuristic
 *     inference`. That answer is `declaredType`, and it is what the inline
 *     editor and the emitted `type:` key read.
 *   - "resolve which RENDERER the type maps to" — the published two-step.
 *     That answer is `rendererType`, and it is what `getCellRenderer`,
 *     `fieldMeta.type`, the header icon and the numeric alignment read.
 *
 * A local called `resolvedType` that held only the first one reads exactly like
 * a value the second step had already been applied to. Both are named here so
 * no call site has to hold the distinction in its head.
 */

import type React from 'react';
import {
  getCellRenderer,
  resolveCellRendererType,
  type CellRendererProps,
} from '@object-ui/fields';

/**
 * A field-shaped input. Deliberately narrower than `FieldMetadata`: the two
 * members below are the whole of what "declared type + format hint → renderer"
 * reads, and naming them stops the `any` that every caller's `objectSchema`
 * read carries (`useState<any>`) from collapsing the emit literals downstream
 * (objectui#6004).
 */
export interface GridCellFieldLike {
  /** The field's DECLARED type, already through any heuristic inference. */
  type?: string | null;
  /** The field's `format` hint, as the object definition declares it. */
  format?: string | null;
  /**
   * The field's `widget` hint, as the object definition declares it. A widget
   * with a read cell of its own (`object-ref`, `recipient-picker`) promotes a
   * textual type to that cell, the same second step `format` takes
   * (objectui#12613); the inline editor keeps reading `declaredType`.
   */
  widget?: string | null;
}

/** Everything the grid needs to know about one column's renderer. */
export interface GridCellRendering {
  /**
   * The DECLARED type, unpromoted — `null` when the column has none. This is
   * what the inline editor reads, so a `text` + `format: 'phone'` column keeps
   * editing as text.
   */
  declaredType: string | null;
  /**
   * The RENDERER key — the declared type promoted by its `format` hint.
   * `null` exactly when `declaredType` is `null`.
   */
  rendererType: string | null;
  /**
   * The cell renderer for `rendererType`.
   *
   * TOTAL, mirroring `getCellRenderer` itself, which ends in
   * `standardMap[key] || TextCellRenderer` and therefore never returns a falsy
   * renderer. A caller that wants "no declared type ⇒ no type-aware cell"
   * asks `rendererType`, not this — the two questions are different and the
   * grid's paths answer them differently on purpose.
   */
  Renderer: React.FC<CellRendererProps>;
}

/**
 * Resolve one column's renderer from its declared type and its `format` and
 * `widget` hints.
 *
 * ⚠️ A field with NO declared type does not promote, even when it carries a
 * `format`. `resolveCellRendererType` would promote it — `''` is a member of
 * its textual base set — but every grid path already treats "no type at all"
 * as "no type-aware renderer", and reversing that is a behaviour change wider
 * than the one objectui#8920 rules on. The bound is deliberate, not an
 * oversight; the unresolvable key still lands on the text renderer below,
 * byte-identical to the `getCellRenderer(field.type)` this replaced when
 * `field.type` was absent.
 */
export function resolveGridCellRendering(
  field: GridCellFieldLike | null | undefined,
): GridCellRendering {
  const declaredType: string | null = field?.type || null;
  const rendererType: string | null =
    declaredType === null
      ? null
      : resolveCellRendererType({
          type: declaredType,
          format: field?.format ?? undefined,
          widget: field?.widget ?? undefined,
        });
  return {
    declaredType,
    rendererType,
    Renderer: getCellRenderer(rendererType ?? ''),
  };
}

/**
 * ⭐ THE ONE SITE WITH A DIFFERENT CONTRACT, NAMED SO IT IS NOT A FIFTH SILENT
 * CONVENTION.
 *
 * The compound-cell prefix badge asks for a FIXED registry key, not for a
 * field's renderer: `prefix.type === 'badge'` is the author saying "draw this
 * neighbouring column's value as a badge", and the key it needs is a constant
 * of this component, not anything the prefixed field declares. There is no
 * declared type to promote and no `format` to read, so
 * `resolveGridCellRendering` cannot own it without misrepresenting the call as
 * a field resolution.
 *
 * It routes through this module anyway, and that is the point: the grid has
 * exactly two ways to reach a cell renderer, both of them here, both of them
 * documented — rather than one documented way plus a bare `getCellRenderer`
 * call that reads like a fifth convention nobody chose.
 */
export function gridCellRendererForFixedKey(
  rendererType: string,
): React.FC<CellRendererProps> {
  return getCellRenderer(rendererType);
}

/** The registry key the compound-cell prefix badge draws with. */
export const BADGE_PREFIX_RENDERER_KEY = 'select';

/**
 * Renderer keys whose cell draws its value as its OWN anchor, without asking
 * the host: `mailto:`, a `target="_blank"` URL and `tel:` (email and phone
 * with a copy button beside it), and the file family's download link
 * (`file`, `video`, `audio`).
 *
 * The reference family (`lookup`, `master_detail`, `tree`) is not listed: its
 * anchor is drawn only when the host's `recordHref` answers, and `LinkCell`
 * withholds that answer from its own children instead (see `LinkCell` in
 * `ObjectGrid.tsx`). Whether a registered type belongs here is measured, not
 * recalled: the census in `ObjectGrid.linkCellNoNestedAnchor-11817.test.tsx`
 * draws every type `listCellRendererTypes()` reports in a link column.
 */
const SELF_LINKING_RENDERER_TYPES: ReadonlySet<string> = new Set([
  'email',
  'url',
  'phone',
  'file',
  'video',
  'audio',
]);

/** The registry key a link cell draws a self-linking value with. */
export const LINK_CELL_TEXT_RENDERER_KEY = 'text';

/**
 * objectui#11817 — the renderer a LINK cell (the primary column, or a column
 * authored `link: true`) draws its value with.
 *
 * A link cell is the row's anchor to its record. A renderer that draws its
 * own anchor inside it nested an `a` inside an `a` — React's "In HTML, an
 * anchor cannot be a descendant of an anchor" warning, measured on the
 * Invitations list, whose first column is `email` — and put a second click
 * target on the very text the user clicks to open the record. Inside a link
 * cell those values are drawn as their text (`coerceToSafeValue`'s answer: the
 * address, the URL, the number, a file's name; an unexpanded file id prints
 * the id); outside one (any other column) they keep their anchor.
 *
 * Not a third way to reach a renderer: it narrows the one
 * {@link resolveGridCellRendering} answered, and the text face it substitutes
 * is reached through {@link gridCellRendererForFixedKey}. A `null` renderer
 * (no declared type) and a withheld column's mask pass through unchanged.
 */
export function linkCellRenderer(
  rendererType: string | null,
  Renderer: React.FC<CellRendererProps> | null,
): React.FC<CellRendererProps> | null {
  if (Renderer && rendererType !== null && SELF_LINKING_RENDERER_TYPES.has(rendererType)) {
    return gridCellRendererForFixedKey(LINK_CELL_TEXT_RENDERER_KEY);
  }
  return Renderer;
}
