/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The DISPLAY half of the three rich-content field types — `markdown`, `html`
 * and `richtext` — and the single table that says which pipeline each one
 * reads through.
 *
 * ## Why this is its own module (`4bb940b6e`)
 *
 * These two renderers used to live in `../index.tsx`, which meant the only way
 * to reach them was through the barrel — and the barrel is what registers
 * `RichTextField`, so the widget could not import them back without a cycle.
 * The readonly branch of `RichTextField` therefore rendered `{value}` as a
 * React TEXT CHILD and showed a user the markup SOURCE of their own field: a
 * `markdown` field's asterisks and hashes, a `richtext` field's tags. Every
 * OTHER read surface — grid, kanban card, gallery, related list, dashboard
 * record panel, record detail read mode — dispatches through `getCellRenderer`
 * and rendered the same stored bytes FORMATTED, so one field disagreed with
 * itself depending on which surface the user was looking at.
 *
 * Extracting them here is what lets both sides consume the SAME components:
 * `getCellRenderer`'s table spreads {@link RICH_TEXT_CELL_RENDERERS}, and the
 * widget's readonly branch indexes it. There is one dispatch table for these
 * three types, not two that can drift — which matters because drift is exactly
 * how objectui#5452 happened (`richtext` pointing at the markdown pipeline).
 */

import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { coerceToSafeValue } from '../coerceToSafeValue.js';
import { renderSanitizedHtml } from './sanitizedHtml.js';
import type { CellRendererProps } from '../index.js';

const LazyMarkdownContent = React.lazy(() => import('./MarkdownContent.js'));

/**
 * The text a rich-content cell formats, or `undefined` when the record holds
 * nothing to format (objectui#8580).
 *
 * `@objectstack/spec` types all three rich-content fields as a plain string
 * (`STRING_VALUE_TYPES`; the write seam is `z.string()`), the same value
 * class as `text` / `textarea` / `code`. Both renderers below used to test the
 * RAW value (`value == null || value === ''`) and then `String()` it, which is
 * how the two off-contract shapes the census measured came out:
 *
 *   - `[]` passed the guard and `String([])` is `''`: the markdown pipeline
 *     drew a childless `prose` DIV (its Suspense fallback a childless SPAN),
 *     the HTML pipeline a childless `prose` DIV. Nothing drawn and no
 *     accessible name, where every other text-like type already answered
 *     with the shared `EmptyValue` — the objectui#8481 class, one family over.
 *   - `{}` passed and `String({})` is `[object Object]`: a coercion artefact
 *     no sibling prints (`text` prints `[Object]`).
 *
 * Two shapes, two rulings, one mechanism: test the COERCED text, exactly as
 * `TextCellRenderer` does. `[]` coerces to `''` and holds no string, so the
 * cell has no value and says so. `{}` is NOT swept into the affordance — the
 * record is storing something, so "No value" would be false — and is not
 * `String()`'d either: it takes the string class's existing answer for an
 * object (`coerceToSafeValue`: the display name when the object carries one,
 * `[Object]` otherwise), and that text is then formatted like any other. A
 * populated string is returned verbatim by `coerceToSafeValue`, so the
 * populated branch of each renderer below — and the HTML sanitiser it runs
 * through — sees the same bytes it always did.
 */
function richTextSource(value: unknown): string | undefined {
  const safe = coerceToSafeValue(value);
  if (safe == null || safe === '') return undefined;
  return String(safe);
}

/**
 * Renders `markdown` values as formatted GFM markdown (lazy-loaded, sanitized)
 * instead of the raw markup string.
 *
 * Markdown ONLY. `MarkdownContent` runs react-markdown with no `rehype-raw`, so
 * raw HTML in the string is not parsed and never reaches the DOM — that is this
 * renderer's trust boundary, not an oversight, and it must stay that way
 * (objectui#5452). `richtext` used to be routed here too and rendered as a
 * COMPLETELY EMPTY cell, because a richtext value is entirely HTML and this
 * pipeline drops all of it; see {@link HtmlCellRenderer}, which is where that
 * type belongs. Loosening this pipeline to pass raw HTML through would have
 * "fixed" one type by moving every `markdown` cell's trust boundary.
 *
 * What the cell holds is decided by {@link richTextSource} (objectui#8580):
 * `[]` is the No-value affordance, never a childless container, and an
 * object is the text the string class prints for it, never `[object Object]`.
 */
export function MarkdownCellRenderer({ value }: CellRendererProps): React.ReactElement {
  const text = richTextSource(value);
  if (text === undefined) return <EmptyValue />;
  return (
    <React.Suspense fallback={<span className="text-sm text-muted-foreground">{text.slice(0, 80)}</span>}>
      <LazyMarkdownContent value={text} />
    </React.Suspense>
  );
}

/**
 * Renders an `html` value as sanitized, formatted HTML instead of raw markup.
 *
 * Also the renderer for `richtext` (objectui#5452). Both types store an HTML
 * string: the spec's `Field.richtext` is documented as "Formatted content with
 * HTML/WYSIWYG", the showcase seed's own specimen is
 * `<p>Rich <strong>text</strong></p>`, and this repo's designer bridge already
 * maps `richtext` onto its `html` type. The value is parsed, sanitized
 * against an allow-list and rendered as React elements by
 * {@link renderSanitizedHtml} (`./sanitizedHtml.tsx`, the package's one
 * sanitizer, shared with the markdown pipeline). The allow-list keeps what a
 * rich-text document is made of — headings, paragraphs, emphasis, lists,
 * links, quotes, tables, images — so routing `richtext` here restores the
 * content rather than trading a blank cell for a mangled one.
 *
 * What the cell holds is decided by {@link richTextSource} (objectui#8580):
 * `[]` is the No-value affordance, never a childless `prose` container, and
 * an object is the text the string class prints for it. A stored string comes
 * back from `richTextSource` verbatim, so the bytes that reach the sanitiser
 * are the stored bytes — its output pinned byte-for-byte in
 * `__tests__/cellRenderers.childlessContainer-8580.test.tsx`.
 *
 * The parse is memoised on the text for cost only (a grid renders many
 * cells); nothing depends on the identity of the memoised value.
 */
export function HtmlCellRenderer({ value }: CellRendererProps): React.ReactElement {
  const text = richTextSource(value);
  const content = React.useMemo(
    () => (text === undefined ? undefined : renderSanitizedHtml(text)),
    [text],
  );
  if (text === undefined) return <EmptyValue />;
  return <div className="prose prose-sm max-w-none dark:prose-invert break-words">{content}</div>;
}

/**
 * Field type → display pipeline, for the three types `RichTextField` serves.
 *
 * THE table, singular. `getCellRenderer`'s standard map spreads it (so the
 * grid, kanban, gallery, related list, dashboard panel and detail read mode
 * resolve through these entries) and `RichTextField`'s readonly branch indexes
 * it (so a readonly form field renders through the very same component). A
 * change here moves every read surface at once; there is no second copy left
 * to forget.
 *
 * `richtext` reads through the HTML renderer — NOT the markdown one, which
 * drops raw HTML and therefore rendered every populated richtext value as a
 * blank cell (objectui#5452).
 */
export const RICH_TEXT_CELL_RENDERERS = {
  markdown: MarkdownCellRenderer,
  html: HtmlCellRenderer,
  richtext: HtmlCellRenderer,
} as const satisfies Record<string, React.FC<CellRendererProps>>;

/** The rich-content field types, i.e. the keys of {@link RICH_TEXT_CELL_RENDERERS}. */
export type RichTextFieldType = keyof typeof RICH_TEXT_CELL_RENDERERS;

/**
 * The same three types as a RUNTIME list, DERIVED from THE table rather than
 * spelled a second time — the type-level {@link RichTextFieldType} cannot be
 * enumerated at runtime, and a hand-written array beside it would be exactly
 * the shape this export exists to retire.
 *
 * ## Why this export exists
 *
 * objectui#4831 asked, in its own body, whether the hand-written type lists
 * that keep omitting the third of this widget's three registry keys should
 * become "every type that resolves to the long-text widget". It was answered
 * by adding one literal, and the omission recurred (objectui#4250,
 * objectui#8438). This is that question answered in the other direction: a
 * consumer that spreads this list cannot omit a key, because it never names
 * one. Adding a fourth key to {@link RICH_TEXT_CELL_RENDERERS} extends every
 * such consumer in the same commit that adds the key.
 *
 * ⚠️ It is NOT a general "long text" list and must not be used as one:
 * `textarea` renders a `<Textarea>` too and is deliberately absent, because it
 * is a different widget with its own registry key and its own metadata face.
 * The invariant this list states is narrower and exact — *these are the keys
 * `RichTextField` serves*.
 */
export const RICH_TEXT_FIELD_TYPES: readonly RichTextFieldType[] = Object.keys(
  RICH_TEXT_CELL_RENDERERS,
) as RichTextFieldType[];

/**
 * The display pipeline a field type reads through, or `undefined` when the
 * type is not one of the three rich-content types.
 *
 * The lookup is a function rather than a raw index so the "not a rich-content
 * type" answer is in the RETURN TYPE. Indexing {@link RICH_TEXT_CELL_RENDERERS}
 * directly hands back a non-optional component for any key the caller casts,
 * so the miss becomes a runtime `undefined` the compiler has been told cannot
 * happen — and a caller that checks for it reads as dead code.
 */
export function richTextCellRenderer(
  fieldType: string,
): React.FC<CellRendererProps> | undefined {
  return (RICH_TEXT_CELL_RENDERERS as Record<string, React.FC<CellRendererProps>>)[fieldType];
}
