// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Activity-timeline UI config enums.
 *
 * The `service-feed` backend was retired (ADR-0052 §5 / #1955); `sys_comment` /
 * `sys_activity` are the canonical record-collaboration/timeline backend. Only these
 * two enums remain here — they are pure UI configuration for the record activity
 * component (`RecordActivityProps` in `../ui/component.zod.ts`), with no backend
 * dependency. (A later `feed` → `activity` rename is tracked separately.)
 */

/**
 * Feed Item Type
 * Unified activity types for the record timeline.
 * Covers comments, field changes, tasks, events, and system activities.
 */
export const FeedItemType = z.enum([
  'comment',
  'field_change',
  'task',
  'event',
  'email',
  'call',
  'note',
  'file',
  'record_create',
  'record_delete',
  'approval',
  'sharing',
  'system',
]);
export type FeedItemType = z.input<typeof FeedItemType>;

/**
 * Feed Filter Mode
 * Controls which feed item types to display in the timeline.
 */
export const FeedFilterMode = z.enum([
  'all',
  'comments_only',
  'changes_only',
  'tasks_only',
]);
export type FeedFilterMode = z.input<typeof FeedFilterMode>;
