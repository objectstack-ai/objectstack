/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/collaboration
 *
 * Real-time collaboration for Object UI providing:
 * - useRealtimeSubscription hook for WebSocket data subscriptions
 * - usePresence hook for live cursor and presence tracking
 * - useConflictResolution hook for version history and conflict management
 * - CommentThread component for threaded comments with @mentions
 * - PresenceAvatars component for showing active user avatars
 *
 * @packageDocumentation
 */

export {
  useRealtimeSubscription,
  type RealtimeSubscriptionConfig,
  type ConnectionState,
  type RealtimeMessage,
  type RealtimeResult,
} from './useRealtimeSubscription.js';

export {
  usePresence,
  createPresenceUpdater,
  type PresenceUser,
  type PresenceConfig,
  type PresenceResult,
} from './usePresence.js';

export {
  useConflictResolution,
  type VersionEntry,
  type ConflictInfo,
  type ConflictResolutionResult,
} from './useConflictResolution.js';

export {
  CommentThread,
  type Comment,
  type CommentThreadProps,
} from './CommentThread.js';

// The owner rule `CommentThread` gates Edit and Delete on, exported so a host
// that maps its own comment rows reads the same rule rather than a copy of it
// (objectui#12268: the console's record feed).
export { isCommentAuthor } from './commentAuthorship.js';

// This package's i18n seam. Exported like `plugin-detail`'s
// `useDetailTranslation` / `DETAIL_DEFAULT_TRANSLATIONS` so a host can read the
// English defaults (e.g. to seed its own bundle) and so anything added to this
// package later translates through the same map instead of a second one.
export {
  useCollaborationTranslation,
  COLLAB_DEFAULT_TRANSLATIONS,
  type CollaborationTranslate,
} from './useCollaborationTranslation.js';

export {
  useMentionNotifications,
  type MentionNotificationsConfig,
  type MentionNotificationsResult,
} from './useMentionNotifications.js';

export {
  useCommentSearch,
  type CommentSearchConfig,
  type CommentSearchReturn,
} from './useCommentSearch.js';

export {
  PresenceAvatars,
  type PresenceAvatarsProps,
} from './PresenceAvatars.js';

export {
  PresenceProvider,
  useTenantPresence,
  useRecordPresence,
  type PresenceSource,
  type PresenceProviderProps,
  type RecordPresenceScope,
} from './PresenceProvider.js';

// Re-export types from @object-ui/types for convenience
export type {
  CollaborationPresence,
  CollaborationOperation,
  CollaborationConfig,
} from '@object-ui/types';
