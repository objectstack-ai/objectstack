/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0037 Live Canvas — preview mode plumbing.
 *
 * One URL flag (`?preview=draft`) flips the whole renderer tree into
 * "as-if-published" mode: metadata reads overlay pending ADR-0033 drafts on
 * the active registry, so an unpublished app/view/dashboard renders exactly
 * what Publish would make real. The canvas (and the Preview button in chat)
 * navigate with this flag; everything below just reads the context.
 *
 * Read-only by design: preview changes the SOURCE of metadata reads, never
 * writes, and Publish remains the single commit gate.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const PreviewModeContext = createContext<boolean>(false);

/** Query flag that switches the console into draft-preview mode. */
export const PREVIEW_QUERY_FLAG = 'preview';
export const PREVIEW_QUERY_VALUE = 'draft';

/** True when `search` (a `location.search` string) carries `preview=draft`. */
export function isPreviewSearch(search: string): boolean {
  return new URLSearchParams(search).get(PREVIEW_QUERY_FLAG) === PREVIEW_QUERY_VALUE;
}

// Set by markPreviewExit() for exactly one navigation: the user explicitly
// left preview (DraftPreviewBar's Exit / post-publish), so the keeper below
// must NOT re-stick the flag onto the next location.
let previewExitRequested = false;

/**
 * Declare that the NEXT navigation is an intentional exit from draft preview.
 * Call right before navigating away (e.g. the preview bar's Exit button);
 * without it, the sticky keeper re-applies `?preview=draft` to in-app
 * navigation so a click inside the previewed app can't silently drop the
 * draft world mid-session.
 */
export function markPreviewExit(): void {
  previewExitRequested = true;
}

/**
 * Provides the preview-mode flag to the tree. Reads the router location
 * LIVE, so entering/leaving `?preview=draft` flips consumers without a
 * remount. `force` overrides the URL — the Live Canvas mounts its embedded
 * renderer subtree with `force` so the canvas is always a draft window
 * regardless of the host page's own URL.
 *
 * STICKY by design: preview is URL-keyed, but in-app navigation (the app's
 * landing redirect, sidebar links, row clicks) builds URLs without the
 * query string. Once the tree is in preview, this provider re-applies the
 * flag (history REPLACE, no extra entry) to any same-session navigation
 * that lost it — so the only way out of the draft world is the explicit
 * Exit affordance ({@link markPreviewExit}), never an accidental click.
 */
export function PreviewModeProvider({ force, children }: { force?: boolean; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const fromUrl = useMemo(() => isPreviewSearch(location.search), [location.search]);
  // Sticky state: stays true across the flag-less navigation window so the
  // CONTEXT VALUE never flickers false mid-session. A flicker is not benign —
  // it swaps the whole metadata source to published for one render, which
  // (a) wastes a full refetch and (b) feeds cross-world diffs to effects
  // like NavigationSyncEffect that must never see the two worlds as one
  // timeline (that misread once WROTE nav changes from inside a preview).
  const [sticky, setSticky] = useState(fromUrl);
  useEffect(() => {
    if (fromUrl) {
      setSticky(true);
      previewExitRequested = false;
      return;
    }
    if (!sticky) return;
    if (previewExitRequested) {
      previewExitRequested = false;
      setSticky(false);
      return;
    }
    // In-app navigation lost the flag without an explicit exit — restore it
    // in place (history REPLACE, no extra entry) so a refresh/share of the
    // URL stays in the draft world too.
    const params = new URLSearchParams(location.search);
    params.set(PREVIEW_QUERY_FLAG, PREVIEW_QUERY_VALUE);
    navigate(`${location.pathname}?${params.toString()}${location.hash}`, { replace: true });
  }, [fromUrl, sticky, location.pathname, location.search, location.hash, navigate]);
  return (
    <PreviewModeContext.Provider value={force ?? (fromUrl || sticky)}>
      {children}
    </PreviewModeContext.Provider>
  );
}

/**
 * Whether the current tree renders the draft-overlaid world. Defaults to
 * false outside a provider, so surfaces that never mount preview (login,
 * bare pages) keep reading published metadata only.
 */
export function usePreviewDrafts(): boolean {
  return useContext(PreviewModeContext);
}
