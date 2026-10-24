/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useMemo } from 'react';
import type { PresenceUser } from './usePresence.js';

export interface LiveCursorsProps {
  /** Other users' presence data */
  users: PresenceUser[];
  /** Container ref for relative positioning */
  containerRef?: React.RefObject<HTMLElement>;
  /** Whether to show user names next to cursors */
  showNames?: boolean;
  /** Whether to show user avatars */
  showAvatars?: boolean;
  /** Cursor size in pixels (default: 20) */
  cursorSize?: number;
  /** Fade out idle cursors */
  fadeIdle?: boolean;
  /** Additional className */
  className?: string;
}

const cursorStyles = {
  container: {
    position: 'absolute' as const,
    inset: 0,
    pointerEvents: 'none' as const,
    overflow: 'hidden',
    zIndex: 9999,
  },
  cursor: {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    transition: 'transform 120ms ease-out, opacity 300ms ease',
    willChange: 'transform, opacity',
  },
  label: {
    position: 'absolute' as const,
    left: '16px',
    top: '16px',
    fontSize: '11px',
    fontWeight: 500,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#fff',
    padding: '1px 6px',
    borderRadius: '3px',
    whiteSpace: 'nowrap' as const,
    lineHeight: '18px',
  },
  avatar: {
    position: 'absolute' as const,
    left: '18px',
    top: '-4px',
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    border: '2px solid #fff',
    objectFit: 'cover' as const,
  },
} as const;

function CursorSvg({ color, size }: { color: string; size: number }): React.ReactElement {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    style: { display: 'block' },
  },
    React.createElement('path', {
      d: 'M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z',
      fill: color,
      stroke: '#fff',
      strokeWidth: '1',
    }),
  );
}

/**
 * Live cursors component displaying other users' cursor positions.
 *
 * Renders absolutely-positioned cursor SVGs with smooth CSS transitions,
 * user name labels, and fade-out for idle users.
 */
export function LiveCursors({
  users,
  containerRef: _containerRef,
  showNames = true,
  showAvatars = false,
  cursorSize = 20,
  fadeIdle = true,
  className,
}: LiveCursorsProps): React.ReactElement {
  const visibleUsers = useMemo(
    () => users.filter(u => u.cursor),
    [users],
  );

  return React.createElement('div', {
    style: cursorStyles.container,
    className,
    'aria-hidden': 'true',
  },
    visibleUsers.map(user => {
      const { cursor } = user;
      if (!cursor) return null;

      const opacity = fadeIdle
        ? user.status === 'active' ? 1 : user.status === 'idle' ? 0.5 : 0.2
        : 1;

      return React.createElement('div', {
        key: user.userId,
        style: {
          ...cursorStyles.cursor,
          transform: `translate(${cursor.x}px, ${cursor.y}px)`,
          opacity,
        },
        'data-user-id': user.userId,
      },
        React.createElement(CursorSvg, { color: user.color, size: cursorSize }),
        showAvatars && user.avatar && React.createElement('img', {
          src: user.avatar,
          alt: user.userName,
          style: cursorStyles.avatar,
        }),
        showNames && React.createElement('span', {
          style: {
            ...cursorStyles.label,
            backgroundColor: user.color,
          },
        }, user.userName),
      );
    }),
  );
}
