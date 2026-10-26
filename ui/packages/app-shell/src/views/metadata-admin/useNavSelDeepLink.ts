// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The designer's nav-item deep link, `?sel=nav:<id>` (#2272), as ONE hook for
 * both designers that carry it: Studio's Interfaces pillar and the metadata
 * editor's `app` page. The parse/format/lookup helpers it wires together live
 * beside it in `nav-selection.ts`; this module is the React half, kept out of
 * that one so its URL-parsing consumers stay free of React and the router.
 *
 * Two halves, the same shape as `useSurfaceDeepLink`:
 *
 *  1. APPLY: once the nav document has loaded and the designer's write state
 *     has settled, select the item whose spec `id` the param names — once per
 *     param and scope, so the mirror's own writes do not re-trigger it. An id
 *     the document does not have changes nothing.
 *  2. MIRROR: write the current nav selection back to `sel` (replace), and
 *     delete it when the selection is not a nav item.
 *
 * objectui#11153 — the mirror is keyed on the selection, so its first pass runs
 * at MOUNT, with no selection yet. Both designers used to delete `sel` right
 * there, before the document had loaded, so the apply half found nothing left
 * to apply and the link never opened anything. The mirror now leaves the param
 * alone while it is unapplied and the document (or the write state) has not
 * settled; the apply's own selection is what writes it back.
 *
 * Applying reads the write state. Opening the item in editing is the normal
 * outcome, but editing on a read-only designer takes edits its autosave will
 * never send (the objectui#11124 / objectui#11136 class), so there the link
 * selects the item WITHOUT entering editing. An UNKNOWN write state is neither:
 * the apply waits for it rather than read it as writable.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DESIGNER_SEL_PARAM,
  parseNavSelParam,
  formatNavSelParam,
  findNavPositionById,
  navIdAtPosition,
} from './nav-selection.js';

/** The linked item, located in the loaded nav document. */
export interface NavSelDeepLinkHit {
  /** The designer's positional selection id (`navigation[2]`, …). */
  selectionId: string;
  label?: string;
}

export interface NavSelDeepLinkOptions {
  /** False turns both halves off, e.g. an editor page for a non-app type. */
  enabled: boolean;
  /**
   * Scopes "applied once": the same param applies again under a new scope (the
   * editor page names the item here, so a link re-applies on another item).
   */
  scope?: string;
  /** The nav document the link's id resolves against, and the mirror reads. */
  draft: Record<string, unknown>;
  /** True once `draft` is the loaded document, not the mount-time placeholder. */
  loaded: boolean;
  /** The designer's write state; `undefined` while it has not settled. */
  readOnly: boolean | undefined;
  /** The designer's current selection; mirrored to the URL when it is a nav item. */
  selection: { kind: string; id: string } | null;
  /** Select the linked item. `enterEditing` is false on a read-only designer. */
  onApply: (hit: NavSelDeepLinkHit, options: { enterEditing: boolean }) => void;
}

export function useNavSelDeepLink({
  enabled,
  scope = '',
  draft,
  loaded,
  readOnly,
  selection,
  onApply,
}: NavSelDeepLinkOptions): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const navSelParam = enabled ? parseNavSelParam(searchParams.get(DESIGNER_SEL_PARAM)) : null;
  const linkKey = navSelParam ? `${scope}:${navSelParam}` : null;
  const settled = loaded && readOnly !== undefined;
  const appliedRef = React.useRef<string | null>(null);
  // Read through a ref, so a non-memoized callback does not re-run the apply.
  const onApplyRef = React.useRef(onApply);
  React.useEffect(() => {
    onApplyRef.current = onApply;
  });

  React.useEffect(() => {
    if (!navSelParam || !linkKey || !settled) return;
    if (appliedRef.current === linkKey) return;
    const hit = findNavPositionById(draft, navSelParam);
    if (!hit) return;
    appliedRef.current = linkKey;
    onApplyRef.current(hit, { enterEditing: readOnly === false });
  }, [navSelParam, linkKey, settled, readOnly, draft]);

  React.useEffect(() => {
    if (!enabled) return;
    // The link has not had its chance yet: leave it for the apply above.
    if (linkKey && !settled && appliedRef.current !== linkKey) return;
    const navId = selection?.kind === 'nav' ? navIdAtPosition(draft, selection.id) : null;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (navId) next.set(DESIGNER_SEL_PARAM, formatNavSelParam(navId));
        else next.delete(DESIGNER_SEL_PARAM);
        return next;
      },
      { replace: true },
    );
    // Keyed on the selection alone, as both designers' own copies of this
    // mirror were: the document is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selection]);
}
