/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@object-ui/components';
import { CommentsPanel } from '@object-ui/plugin-detail';

/** The comment panel's width on the desktop (objectstack#36075, item 4). */
export const COMMENTS_PANEL_WIDTH = 380;

/**
 * From this window width the record page gives the panel its 380 px; a
 * narrower window draws the panel over the page instead.
 */
export const COMMENTS_PANEL_BESIDE_MIN_WINDOW = 1280;

/**
 * From this drawer width the panel sits beside the record inside the drawer,
 * leaving the record at least as wide as the panel; a narrower drawer (the
 * default `md`, 720) gives the panel the whole drawer body.
 */
export const COMMENTS_PANEL_DRAWER_SPLIT_MIN_WIDTH = 2 * COMMENTS_PANEL_WIDTH;

/**
 * Where the open panel is drawn: `beside` the record, which gives it the
 * width; `over` the page's right edge (a window under 1280); or as a `cover`
 * of the whole drawer body (a drawer under 760).
 */
export type CommentsPanelPlacement = 'beside' | 'over' | 'cover';

export function commentsPanelPlacement({
  embedded,
  windowWidth,
  hostWidth,
}: {
  /** The record is drawn in a drawer or pane, not on its own page. */
  embedded: boolean;
  windowWidth: number;
  /** The width of the record view itself (the drawer's body when embedded). */
  hostWidth: number;
}): CommentsPanelPlacement {
  if (embedded) return hostWidth >= COMMENTS_PANEL_DRAWER_SPLIT_MIN_WIDTH ? 'beside' : 'cover';
  return windowWidth >= COMMENTS_PANEL_BESIDE_MIN_WINDOW ? 'beside' : 'over';
}

/**
 * Whether the reader keeps the comment panel open (objectstack#36075, item 2):
 * a preference, kept in this browser, one for the record page and one for
 * the drawer, so the drawer (where the panel may cover the record) does not
 * open on the comments because the page was left with them open.
 */
export function useCommentsPanelOpen(surface: 'page' | 'drawer'): [boolean, (open: boolean) => void] {
  const key = `os:record-comments-panel:${surface}`;
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(key) === 'open';
    } catch {
      return false;
    }
  });
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        if (next) window.localStorage.setItem(key, 'open');
        else window.localStorage.removeItem(key);
      } catch {
        // Storage refused (a private window): the panel still opens and closes.
      }
    },
    [key],
  );
  return [open, setOpen];
}

/** The window's width now and on every resize. */
export function useWindowWidth(): number {
  const read = () => (typeof window === 'undefined' ? 0 : window.innerWidth);
  const [width, setWidth] = useState<number>(read);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setWidth(read());
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/** An element's rendered width, re-read whenever it resizes; 0 before it mounts. */
export function useElementWidth(element: Element | null): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return undefined;
    const read = () => setWidth(element.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

const PLACEMENT_CLASS: Record<CommentsPanelPlacement, string> = {
  beside: 'relative w-[380px] shrink-0 border-l border-border',
  over: 'absolute inset-y-0 right-0 z-30 w-[380px] max-w-full border-l border-border shadow-xl',
  cover: 'absolute inset-0 z-30',
};

/** The record's comment panel, in its place beside or over the record. */
export function RecordCommentsAside({
  placement,
  onClose,
}: {
  placement: CommentsPanelPlacement;
  onClose: () => void;
}) {
  return (
    <div className={cn('min-h-0', PLACEMENT_CLASS[placement])} data-comments-placement={placement}>
      <CommentsPanel onClose={onClose} />
    </div>
  );
}
