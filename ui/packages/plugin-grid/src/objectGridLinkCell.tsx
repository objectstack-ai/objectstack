/**
 * The record-link cell of `ObjectGrid` (`./ObjectGrid.tsx`): its class lists,
 * the row's primary key, `LinkCell` and the `referenceVia` pointer face,
 * moved out of that file verbatim (objectstack#25994, slice 1).
 */

import React from 'react';
import { useRelatedRecordActions, RelatedRecordActionsProvider } from '@object-ui/react';
import { resolveRecordPointer } from '@object-ui/fields';
import { RecordPointerCell, type RecordPointerSource } from './RecordPointerCell';

/**
 * The class list both faces of {@link LinkCell} wear — the anchor is a visual
 * no-op against the span it upgrades, so a list does not change appearance
 * depending on whether its host publishes record URLs.
 */

const LINK_CELL_CLASS =
  'text-primary font-medium underline-offset-4 hover:underline cursor-pointer truncate block max-w-full';

/**
 * The same list with the one-line clamp swapped for wrapping — what a cell in a
 * column carrying an authored `wrap: true` wears (objectui#6650).
 *
 * ⭐ DERIVED from {@link LINK_CELL_CLASS} rather than written out, so the two
 * cannot drift: every future edit to the link cell's appearance lands in both
 * faces of both variants, and the no-wrap variant stays byte-identical to what
 * `ObjectGrid.linkCellAnchor.test.tsx` pins as full markup.
 *
 * ⚠️ Why this exists at all — the outer read in `data-table.tsx` is NOT enough
 * on its own. `data-table` puts the wrap/truncate decision on the cell BODY it
 * owns, but a link column's content is this component, and its own `truncate`
 * clamps the text back to one line INSIDE a body that is willing to wrap. So
 * `wrap: true` on the record-link column — column one of almost every grid —
 * would have rendered as silently nothing: the very failure mode this card
 * exists to end, reproduced one element deeper. Measured, not reasoned: the
 * end-to-end pin in `ObjectGrid.columnWrapForward.test.tsx` failed on exactly
 * this, reading back `…cursor-pointer truncate block max-w-full` from a column
 * authored `wrap: true`.
 */
const LINK_CELL_CLASS_WRAP = LINK_CELL_CLASS.replace('truncate', 'whitespace-normal break-words');

/**
 * A row's primary key — the value the host's record-URL builder addresses.
 * Mirrors what `useNavigationOverlay.handleClick` reads off the same row, so
 * the anchor's href and the click path can never point at different records.
 */
export function rowRecordId(row: unknown): string | number | undefined {
  const rec = row as Record<string, unknown> | null | undefined;
  const id = rec?.id ?? rec?._id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

// Clickable text cell that can safely contain other interactive content
// (e.g., EmailCellRenderer's copy button). Using <button> here would
// produce an invalid <button> > <button> nesting (hydration error +
// breaks the inner copy click). role="link" + tabIndex + keyboard
// handlers preserves accessibility while allowing arbitrary children.
//
// objectui#4490 — that span was the whole cell, so the list's link column had
// none of a link's native affordances: no middle-click / ⌘-click open-in-new-
// tab, no "copy link address", no hover status-bar URL, and `role="link"` with
// no `href` is a weaker contract for assistive tech than a real anchor. PR
// #4489 had just given detail-page and related-list lookup VALUES real anchors,
// which left the list — the surface users open records from — as the weakest of
// the three.
//
// So when the host publishes a record URL this renders a real `<a href>`, with
// the split #4489 established:
//   - plain left click → `preventDefault()` + the existing `onActivate`, so SPA
//     navigation (drawer / modal / page, whatever the view configured) is
//     completely unchanged;
//   - modifier / non-primary click → NOT prevented, so the browser does what it
//     does with any link.
//
// **The URL is not built here.** This package has no router and no business
// knowing what a record route looks like; the host publishes its own builder
// through `RelatedRecordActionsContext.recordHref` — the same seam #4489 used,
// and for the console list surface the same builder its "open in new window"
// action already navigates with. No host, or a host that cannot route to this
// object, renders EXACTLY the span below: same markup, same behavior, nothing
// to un-learn (the Studio designer, embedded renderers, standalone grids).
export const LinkCell: React.FC<{
  testId: string;
  onActivate: () => void;
  /** Object whose record this row is — passed to the host's URL builder. */
  objectName?: string;
  /** This row's primary key. Absent (a row with no id) ⇒ no anchor. */
  recordId?: string | number | null;
  /**
   * The column's authored `wrap` (objectui#6650). `true` ⇒ this cell drops its
   * one-line clamp so long link text flows onto further lines, matching what
   * `data-table` does to the body around it. Absent / `false` ⇒ unchanged.
   */
  wrap?: boolean;
  children: React.ReactNode;
}> = ({ testId, onActivate, objectName, recordId, wrap, children }) => {
  const host = useRelatedRecordActions();
  const cellClass = wrap ? LINK_CELL_CLASS_WRAP : LINK_CELL_CLASS;
  const href =
    objectName && recordId != null && recordId !== '' && host?.recordHref
      ? host.recordHref(objectName, recordId)
      : null;

  if (href && host) {
    // objectui#11817 — no anchor inside this anchor. A reference value in the
    // cell (`LookupCellRenderer`'s `ReferencedRecordLink`) draws its own `a`
    // whenever the host answers `recordHref` for the referenced object, so the
    // children are rendered under the same host with no record destination:
    // "the host cannot route to that object", which the context documents as
    // render the plain value. The self-linking faces (`mailto:`, URL, `tel:`)
    // never ask the host; the cell is handed their text face instead
    // (`linkCellRenderer` in `./cellRendererResolution`).
    const unlinkedHost = { ...host, recordHref: undefined, openRecord: undefined };
    return (
      <a
        href={href}
        data-testid={testId}
        className={cellClass}
        onClick={(e) => {
          // The row underneath carries its own click handler (open the record,
          // and on a modifier click open it in a new tab). Following this link
          // must never ALSO fire that — on a modifier click that would open two
          // tabs, one from the anchor and one from the row.
          e.stopPropagation();
          // Modifier and non-primary clicks belong to the browser (new tab, new
          // window) — that is the entire point of rendering a real href.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onActivate();
        }}
        onKeyDown={(e) => {
          // Enter is the anchor's OWN activation: the browser fires a click for
          // it, which the handler above turns into the SPA path. Handling it
          // here too would activate twice. Space is the one the span had that a
          // link does not do natively, so it is carried over explicitly.
          if (e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onActivate();
          }
        }}
      >
        <RelatedRecordActionsProvider value={unlinkedHost}>{children}</RelatedRecordActionsProvider>
      </a>
    );
  }

  return (
    <span
      role="link"
      tabIndex={0}
      data-testid={testId}
      className={cellClass}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onActivate();
        }
      }}
    >
      {children}
    </span>
  );
};

/**
 * objectui#12608 — the face a `referenceVia` pointer column draws its rows
 * with, or `null` when the field declares no pointer pair.
 *
 * The pair is resolved per row by `resolveRecordPointer` (`@object-ui/fields`),
 * the one rule the record details grid asks too; `referenceVia` is read off the
 * OBJECT field, where the spec declares it, and the type is the column's
 * declared one, so a view that re-types the column keeps its own face. A row
 * the rule answers `null` for (a half-addressed pair) is drawn by the column's
 * ordinary face: the returned function answers `null` and the caller falls
 * through to it. Inside a link cell the face is drawn under `LinkCell`'s
 * unlinked host, so it draws the name without a second anchor.
 */
export function recordPointerFace(
  fieldName: string,
  declaredType: string | null,
  fieldDef: { referenceVia?: unknown } | null | undefined,
  dataSource: RecordPointerSource | null | undefined,
): ((row: any) => React.ReactElement | null) | null {
  const referenceVia = fieldDef?.referenceVia;
  if (typeof referenceVia !== 'string' || referenceVia === '') return null;
  return (row: any) => {
    const pointer = resolveRecordPointer({ name: fieldName, type: declaredType, referenceVia }, row);
    return pointer ? <RecordPointerCell pointer={pointer} dataSource={dataSource} /> : null;
  };
}
