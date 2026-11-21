/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import type { CommentItemActions } from './CommentThread';

/** How long a press is held before it opens the comment's actions, in ms. */
export const COMMENT_LONG_PRESS_MS = 500;
/** How far a press may travel and still be a press, not a scroll, in px. */
export const COMMENT_PRESS_SLOP = 10;

/** A comment's own controls: a press on one of them is that control's, never the comment's tap. */
const OWN_CONTROL = 'button, a, input, textarea, select, [role="menuitem"], [contenteditable="true"]';

export interface CommentPressOptions {
  /** The comment was held (or its context menu asked for): open its actions. */
  onLongPress: (actions: CommentItemActions) => void;
  /** The comment was tapped outside its own controls (the phone's list: open the thread). */
  onTap?: (actions: CommentItemActions) => void;
}

export interface CommentPress {
  /** The handlers one comment's box takes (`CommentThread`'s `itemInteraction`). */
  bind: (actions: CommentItemActions) => React.HTMLAttributes<HTMLDivElement>;
}

/**
 * The phone's press on a comment (objectstack#36076 item 5): held for
 * {@link COMMENT_LONG_PRESS_MS} without travelling {@link COMMENT_PRESS_SLOP},
 * it opens the comment's actions, and the click that ends the hold does
 * nothing else. The context menu opens them too: Android's own long press,
 * the keyboard's menu key (Shift+F10) on a focused comment, a right click. A
 * tap outside the comment's own controls is `onTap`, and so is Enter on a
 * focused comment. One press at a time, so one record serves every comment.
 */
export function useCommentPress({ onLongPress, onTap }: CommentPressOptions): CommentPress {
  const press = React.useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; fired: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    fired: false,
  });
  const latest = React.useRef({ onLongPress, onTap });
  React.useLayoutEffect(() => {
    latest.current = { onLongPress, onTap };
  });
  const cancel = React.useCallback(() => {
    const p = press.current;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
  }, []);
  React.useEffect(() => cancel, [cancel]);

  const bind = React.useCallback(
    (actions: CommentItemActions): React.HTMLAttributes<HTMLDivElement> => {
      return {
        // Focusable, so the keyboard reaches the actions (its menu key) and the tap (Enter).
        tabIndex: 0,
        onPointerDown: (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          cancel();
          const p = press.current;
          p.fired = false;
          p.x = e.clientX;
          p.y = e.clientY;
          p.timer = setTimeout(() => {
            p.timer = null;
            p.fired = true;
            latest.current.onLongPress(actions);
          }, COMMENT_LONG_PRESS_MS);
        },
        onPointerMove: (e) => {
          const p = press.current;
          if (!p.timer) return;
          if (Math.abs(e.clientX - p.x) > COMMENT_PRESS_SLOP || Math.abs(e.clientY - p.y) > COMMENT_PRESS_SLOP) cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onContextMenu: (e) => {
          e.preventDefault();
          const p = press.current;
          const alreadyOpen = p.fired;
          cancel();
          p.fired = true;
          if (!alreadyOpen) latest.current.onLongPress(actions);
        },
        onClickCapture: (e) => {
          const p = press.current;
          if (!p.fired) return;
          // The click that ends a hold: the hold opened the actions, the click does nothing.
          p.fired = false;
          e.preventDefault();
          e.stopPropagation();
        },
        onClick: (e) => {
          const tap = latest.current.onTap;
          if (!tap) return;
          const target = e.target as Element | null;
          const control = target?.closest?.(OWN_CONTROL);
          if (control && e.currentTarget.contains(control)) return;
          tap(actions);
        },
        onKeyDown: (e) => {
          if (e.target !== e.currentTarget || !latest.current.onTap) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            latest.current.onTap(actions);
          }
        },
      };
    },
    [cancel],
  );
  return React.useMemo(() => ({ bind }), [bind]);
}
