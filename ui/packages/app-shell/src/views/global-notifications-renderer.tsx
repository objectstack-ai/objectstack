/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `global:notifications` — the notification bell, addressable from a page
 * schema (`f99932a42`).
 *
 * ## Why this exists
 *
 * `global:notifications` is a first-class member of `@objectstack/spec`'s
 * `PageComponentType`, and the maintainer ruling of 2026-08-26 (objectstack#12183)
 * kept it declared because its data source shipped. Nothing rendered it, so a
 * page that authored it drew `PlaceholderRenderer`'s literal "Component
 * Placeholder" scaffold — the author-time gate accepted the metadata and the
 * screen showed a dashed box.
 *
 * ## What backs it — nothing new
 *
 * ADR-0012 / ADR-0030: *the bell reads `sys_inbox_message`*. That read already
 * exists (`sharedUserFeeds`), the popover already exists (`InboxPopover`), and
 * the wiring between them is `useInboxBell` — the same hook `AppHeader` mounts
 * for the chrome bell. Registering this block adds a mount point, not a data
 * layer: header bell and authored bell cut from ONE feed with ONE optimistic
 * read overlay, so they have no representable state in which they disagree
 * (the property #4225 and #4316 bought and this block must not spend).
 *
 * ## Declared propless, deliberately
 *
 * `ComponentPropsMap['global:notifications']` is an EMPTY shape ("declares no
 * props at all" is the recorded intent), so this registration publishes NO
 * `inputs`. Declaring even `className` here would advertise an authoring key
 * the contract rejects by name — the forward direction of
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts` is a vice on
 * exactly that move. The node-level `className` the SchemaRenderer threads
 * through is a NODE key (`PageComponentSchema`), not a prop, and needs no
 * declaration.
 *
 * Registered in app-shell rather than `@object-ui/components` for the same
 * reason `record:approvals` is: the feed hooks depend on `@object-ui/auth` and
 * on this package's providers, which `@object-ui/components` deliberately does
 * not pull in. The side-effect registration is imported from the app-shell
 * barrel (`src/index.ts`).
 *
 * This does NOT put the block back in the Studio page palette: `PALETTE_EXCLUSIONS`
 * still records it as a shell singleton, and that is a palette decision about
 * authoring ergonomics, independent of whether a declared type renders.
 */

import * as React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { InboxPopover } from '../layout/InboxPopover.js';
import { useInboxBell } from '../hooks/useInboxBell.js';
import { useSharedActivityFeed } from '../hooks/sharedUserFeeds.js';

/** Keep the designer's own data attributes on the wrapper, drop the rest. */
const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style } = props || {};
  return { 'data-obj-id': id, 'data-obj-type': type, style };
};

export interface GlobalNotificationsRendererProps {
  schema?: Record<string, any>;
  className?: string;
  [k: string]: any;
}

export const GlobalNotificationsRenderer: React.FC<GlobalNotificationsRendererProps> = ({
  className,
  schema: _schema,
  ...props
}) => {
  const {
    notifications,
    unreadCount,
    pendingApprovalsCount,
    markAllRead,
    markRead,
    markManyRead,
  } = useInboxBell();
  // Rows, status and the caller's read grant together (objectui#12081), the
  // same reading the header bell hands the same popover.
  const activity = useSharedActivityFeed();

  return (
    <div className={className} data-block="global:notifications" {...splitDesigner(props)}>
      <InboxPopover
        notifications={notifications}
        unreadCount={unreadCount}
        pendingApprovalsCount={pendingApprovalsCount}
        activity={activity}
        onMarkAllRead={markAllRead}
        onMarkRead={markRead}
        onMarkManyRead={markManyRead}
      />
    </div>
  );
};

// `register('notifications', …, { namespace: 'global' })` — the BARE name plus a
// namespace, never a pre-prefixed one (the registry prepends it itself, and a
// pre-prefixed name lands under `global:global:notifications`).
// `skipFallback: true` keeps it off the top-level `notifications` key, which is
// far too generic a tag to claim. No `inputs`: the spec shape is empty.
ComponentRegistry.register('notifications', GlobalNotificationsRenderer, {
  namespace: 'global',
  skipFallback: true,
  category: 'navigation',
  label: 'Notifications',
  icon: 'Bell',
});

export default GlobalNotificationsRenderer;
