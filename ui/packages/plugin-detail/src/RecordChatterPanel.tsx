/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn, Button } from '@object-ui/components';
import { MessageSquare, PanelRightOpen, PanelRightClose, X } from 'lucide-react';
import type { RecordChatterComponentProps, FeedItem, RecordSubscription } from '@object-ui/types';
import { RecordActivityTimeline } from './RecordActivityTimeline';
import type { FeedFilterMode } from './RecordActivityTimeline';
import { useDetailTranslation } from './useDetailTranslation';
import { useRecordAriaProps } from './renderers/recordComponentAria';

export interface RecordChatterPanelProps {
  /** Chatter panel configuration from RecordChatterComponentProps */
  config?: RecordChatterComponentProps;
  /** Feed items to display in the embedded timeline */
  items: FeedItem[];
  /** Whether there are more items to load */
  hasMore?: boolean;
  /** Called when user wants to load more */
  onLoadMore?: () => void | Promise<void>;
  /** Loading state */
  loading?: boolean;
  /** Called when a comment is submitted */
  onAddComment?: (text: string) => void | Promise<void>;
  /** Called when a reply is submitted */
  onAddReply?: (parentId: string | number, text: string) => void | Promise<void>;
  /** Called when user toggles a reaction */
  onToggleReaction?: (itemId: string | number, emoji: string) => void | Promise<void>;
  /** Edits a comment the viewer wrote; forwarded to the timeline (objectui#12268). */
  onEditComment?: (itemId: string | number, text: string) => void | Promise<void>;
  /** Deletes a comment the viewer wrote; forwarded to the timeline (objectui#12268). */
  onDeleteComment?: (itemId: string | number) => void | Promise<void>;
  /** Subscription state */
  subscription?: RecordSubscription;
  /** Called when user toggles subscription */
  onToggleSubscription?: (subscribed: boolean) => void | Promise<void>;
  /** Filter mode */
  filterMode?: FeedFilterMode;
  /** Called when filter changes */
  onFilterChange?: (mode: FeedFilterMode) => void;
  /** When true, auto-collapse panel when there are no feed items */
  collapseWhenEmpty?: boolean;
  /** Optional list of users (or any mentionable entities) the comment
   *  input can suggest after the user types `@`. */
  mentionSuggestions?: Array<{ id: string; label: string; avatarUrl?: string }>;
  /** Optional uploader. When provided the composer renders an attachment
   *  panel; returned attachments are passed to `onAddComment`. */
  onUploadAttachments?: (files: FileList) => Promise<Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    url?: string;
    thumbnailUrl?: string;
  }>>;
  /** The feed's activity read was refused; forwarded to the timeline, which
   *  shows a no-permission state for it (objectui#11195). */
  activityDenied?: boolean;
  /** The same, for the feed's comment read. */
  commentsDenied?: boolean;
  className?: string;
}

/**
 * RecordChatterPanel — Side/inline/drawer panel for record discussions.
 *
 * Consumes RecordChatterComponentProps from the spec protocol.
 * Supports three positions: bottom (inline), right (sidebar), left (sidebar).
 * Can be collapsible/expandable.
 *
 * Embeds RecordActivityTimeline as the feed sub-component.
 */
export const RecordChatterPanel: React.FC<RecordChatterPanelProps> = ({
  config,
  items,
  hasMore,
  onLoadMore,
  loading,
  onAddComment,
  onAddReply,
  onToggleReaction,
  onEditComment,
  onDeleteComment,
  subscription,
  onToggleSubscription,
  filterMode,
  onFilterChange,
  collapseWhenEmpty = false,
  mentionSuggestions,
  onUploadAttachments,
  activityDenied,
  commentsDenied,
  className,
}) => {
  const position = config?.position ?? 'right';
  const width = config?.width ?? '360px';
  const collapsible = config?.collapsible ?? true;
  const defaultCollapsed = (collapseWhenEmpty && items.length === 0) || (config?.defaultCollapsed ?? false);

  const { t } = useDetailTranslation();
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  /**
   * The feed's own `aria` bag (objectui#11083). The spec declares `feed` as
   * the `record:activity` shape (`RecordActivityProps`), `aria` included, and
   * nothing read `feed.aria`, so a declared accessible name for the feed
   * reached no element. It is read the way `record:activity` reads its own
   * bag: through `useRecordAriaProps` (which maps it with the shared
   * `resolveInlineAriaProps`), onto a `div` around the timeline, as
   * `record-activity.tsx` puts its bag on the `div` around its timeline. The
   * block family's defaults come with it: no role while nothing is authored,
   * and `region` to carry an authored name.
   *
   * The `div` is always rendered, in both layouts, so the timeline (and a
   * half-typed comment in its composer) is never remounted when the bag
   * resolves differently. With nothing authored it carries no attribute.
   */
  const feedAria = useRecordAriaProps(config?.feed?.aria);

  const isSidebar = position === 'right' || position === 'left';
  const isInline = position === 'bottom';

  // Sidebar mode
  if (isSidebar) {
    if (collapsed && collapsible) {
      return (
        <div
          className={cn(
            'flex items-start pt-4',
            position === 'right' ? 'border-l' : 'border-r',
            className,
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 mx-1"
            onClick={() => setCollapsed(false)}
            aria-label={t('detail.openDiscussion')}
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'flex flex-col overflow-hidden',
          position === 'right' ? 'border-l' : 'border-r',
          className,
        )}
        style={{ width, minWidth: width }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <span className="text-sm font-medium">{t('detail.discussion')}</span>
          </div>
          {collapsible && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCollapsed(true)}
              aria-label={t('detail.closeDiscussion')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Embedded Timeline */}
        <div className="flex-1 overflow-y-auto">
          <div {...feedAria}>
            <RecordActivityTimeline
              items={items}
              config={config?.feed}
              hasMore={hasMore}
              onLoadMore={onLoadMore}
              loading={loading}
              onAddComment={onAddComment}
              onAddReply={onAddReply}
              onToggleReaction={onToggleReaction}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              subscription={subscription}
              onToggleSubscription={onToggleSubscription}
              filterMode={filterMode}
              onFilterChange={onFilterChange}
              collapseWhenEmpty={collapseWhenEmpty}
              mentionSuggestions={mentionSuggestions}
              onUploadAttachments={onUploadAttachments}
              titleLabel={t('detail.discussion')}
              emptyLabel={t('detail.noCommentsYet')}
              activityDenied={activityDenied}
              commentsDenied={commentsDenied}
              className="border-0 shadow-none"
            />
          </div>
        </div>
      </div>
    );
  }

  // Inline / bottom mode
  return (
    <div className={cn('', className)}>
      {collapsible && collapsed ? (
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setCollapsed(false)}
          aria-label={t('detail.showDiscussion', { count: items.length })}
        >
          <MessageSquare className="h-4 w-4" />
          <span>{t('detail.showDiscussion', { count: items.length })}</span>
        </Button>
      ) : (
        <div>
          {collapsible && (
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                {t('detail.discussion')}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCollapsed(true)}
                aria-label={t('detail.hideDiscussion')}
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div {...feedAria}>
            <RecordActivityTimeline
              items={items}
              config={config?.feed}
              hasMore={hasMore}
              onLoadMore={onLoadMore}
              loading={loading}
              onAddComment={onAddComment}
              onAddReply={onAddReply}
              onToggleReaction={onToggleReaction}
              onEditComment={onEditComment}
              onDeleteComment={onDeleteComment}
              subscription={subscription}
              onToggleSubscription={onToggleSubscription}
              filterMode={filterMode}
              onFilterChange={onFilterChange}
              collapseWhenEmpty={collapseWhenEmpty}
              mentionSuggestions={mentionSuggestions}
              onUploadAttachments={onUploadAttachments}
              titleLabel={t('detail.discussion')}
              emptyLabel={t('detail.noCommentsYet')}
              activityDenied={activityDenied}
              commentsDenied={commentsDenied}
            />
          </div>
        </div>
      )}
    </div>
  );
};
