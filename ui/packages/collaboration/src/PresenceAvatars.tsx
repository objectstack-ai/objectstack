/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useMemo } from 'react';
import type { PresenceUser } from './usePresence.js';
import {
  useCollaborationTranslation,
  type CollaborationTranslate,
} from './useCollaborationTranslation.js';

export interface PresenceAvatarsProps {
  /** Present users */
  users: PresenceUser[];
  /** Max avatars to show before "+N" */
  maxVisible?: number;
  /** Avatar size */
  size?: 'sm' | 'md' | 'lg';
  /** Show status indicators */
  showStatus?: boolean;
  /** Additional className */
  className?: string;
}

const sizeMap = {
  sm: 24,
  md: 32,
  lg: 40,
} as const;

const statusColors: Record<PresenceUser['status'], string> = {
  active: '#22c55e',
  idle: '#f59e0b',
  away: '#94a3b8',
};

/**
 * Display-layer translation key per presence status (objectui#3440).
 *
 * The status enum is DATA: `'active' | 'idle' | 'away'` is what
 * {@link PresenceUser} carries, what the transport pushes and what
 * `statusColors` above keys off. Nothing about that changes — this map exists
 * only at the render exit, the one place the value stops being an identifier
 * and becomes copy inside a tooltip.
 *
 * Typed `Record< string, string >` rather than
 * `Record< PresenceUser['status'], string >` on purpose. Presence users arrive
 * from a host-supplied `PresenceSource` (a WebSocket/SSE transport the package
 * does not own — see `PresenceProvider`), so a status outside the union is
 * reachable at runtime however strict the type is. An unmapped value renders
 * as ITSELF, the raw string: no invented label, and no empty parenthesis where
 * a status used to be.
 */
const statusLabelKeys: Record<string, string> = {
  active: 'collaboration.statusActive',
  idle: 'collaboration.statusIdle',
  away: 'collaboration.statusAway',
};

/**
 * Resolve a status value to its display copy, falling back to the raw value.
 *
 * Takes `t` as a parameter (same shape as `CommentThread`'s `formatTimestamp`)
 * so this helper cannot drift from whichever half of the union — real i18next
 * `t` or the English defaults map — the component is running under.
 */
function statusLabel(status: string, t: CollaborationTranslate): string {
  const key = statusLabelKeys[status];
  return key ? t(key) : status;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Avatar stack component showing active users with overflow indicator.
 *
 * Displays user avatars (or initials) in an overlapping stack,
 * with optional status indicators and a "+N" overflow badge.
 *
 * Every user-visible string resolves through `useCollaborationTranslation`
 * (objectui#3440). The stack is images and initials only, so its `aria-label`
 * is the entire control as far as a screen reader is concerned — leaving it in
 * English left a `zh` console announcing its avatar group in English.
 */
export function PresenceAvatars({
  users,
  maxVisible = 5,
  size = 'md',
  showStatus = true,
  className,
}: PresenceAvatarsProps): React.ReactElement {
  const { t } = useCollaborationTranslation();
  const px = sizeMap[size];
  const overlapOffset = Math.round(px * 0.3);
  const fontSize = Math.round(px * 0.35);
  const statusDotSize = Math.max(8, Math.round(px * 0.28));

  const visible = useMemo(() => users.slice(0, maxVisible), [users, maxVisible]);
  const overflowCount = Math.max(0, users.length - maxVisible);

  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    flexDirection: 'row-reverse',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const avatarBaseStyle: React.CSSProperties = {
    width: `${px}px`,
    height: `${px}px`,
    borderRadius: '50%',
    border: '2px solid #fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: `${fontSize}px`,
    fontWeight: 600,
    color: '#fff',
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  const overflowStyle: React.CSSProperties = {
    ...avatarBaseStyle,
    backgroundColor: '#e2e8f0',
    color: '#475569',
    marginLeft: `-${overlapOffset}px`,
  };

  const statusDotStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '-1px',
    right: '-1px',
    width: `${statusDotSize}px`,
    height: `${statusDotSize}px`,
    borderRadius: '50%',
    border: '2px solid #fff',
    boxSizing: 'border-box',
  };

  // Render in reverse order so the first user appears on top (z-index via DOM order with row-reverse)
  const reversedVisible = useMemo(() => [...visible].reverse(), [visible]);

  return React.createElement('div', {
    style: containerStyle,
    className,
    role: 'group',
    // An i18next count family, not an English `s` glued on at render time:
    // the old `` `${n} user${n !== 1 ? 's' : ''} present` `` compiled the
    // plural RULE into the component. The count goes in as a NUMBER, because
    // i18next plural-selects only for a number (objectui#11445) — then each
    // pack's own CLDR categories apply (ru three forms, ar six, ja none).
    'aria-label': t('collaboration.presentUserCount', { count: users.length }),
  },
    // Overflow badge (rendered first because of row-reverse)
    overflowCount > 0 && React.createElement('div', {
      key: 'overflow',
      style: overflowStyle,
      title: t('collaboration.moreUserCount', { count: overflowCount }),
    }, `+${overflowCount}`),
    // Avatars
    reversedVisible.map((user, idx) =>
      React.createElement('div', {
        key: user.userId,
        style: {
          ...avatarBaseStyle,
          backgroundColor: user.color,
          marginLeft: idx > 0 || overflowCount > 0 ? `-${overlapOffset}px` : '0',
        },
        // The parentheses live in the translation, not in the component, so a
        // translator owns the whole shape — spacing included: the CJK packs
        // drop the space English puts before `(`, which a component-side
        // `` `${name} (${status})` `` could never let them do.
        title: t('collaboration.userStatusTitle', {
          name: user.userName,
          status: statusLabel(user.status, t),
        }),
      },
        user.avatar
          ? React.createElement('img', {
              src: user.avatar,
              alt: user.userName,
              style: { width: '100%', height: '100%', objectFit: 'cover' as const },
            })
          : getInitials(user.userName),
        showStatus && React.createElement('span', {
          style: {
            ...statusDotStyle,
            backgroundColor: statusColors[user.status],
          },
        }),
      ),
    ),
  );
}
