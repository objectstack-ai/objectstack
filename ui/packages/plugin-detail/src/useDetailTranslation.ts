/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Create a safe translation hook with fallback to defaults.
 *
 * Thin alias over `@object-ui/i18n`'s `createSafeTranslation` — this used to
 * be a local re-implementation that wrapped the hook call in try/catch, which
 * violates rules-of-hooks (objectui#2879, same class as #2595/#2596).
 * `useObjectTranslation` is provider-safe and never throws, so the testKey
 * probe alone carries the "translations not configured" fallback.
 *
 * @param defaults - Fallback English translations keyed by i18n key
 * @param testKey - A key to test if i18n is properly configured
 */
export const createSafeTranslationHook = createSafeTranslation;

/**
 * Default English translations for detail view components.
 * Used as fallback when no I18nProvider is available.
 *
 * Every row whose key the `en` pack also defines must stay byte-identical to it
 * — otherwise this control is labelled one way on a provider-less host and
 * another in the console. Enforced since objectui#4401 by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`, which
 * compares this map, `LIST_DEFAULT_TRANSLATIONS` and
 * `DESIGNER_DEFAULT_TRANSLATIONS` key by key against the pack.
 */
export const DETAIL_DEFAULT_TRANSLATIONS: Record<string, string> = {
  // objectstack#5733 — RecordDetailDrawer's drag-resize handle. The only
  // `common.*` key in this map, deliberately: it is the SAME key objectstack#5506 gave
  // NavigationOverlay's identical handle (`common.resizeDrawer`, already in
  // all ten packs), and one control should not get two spellings just because
  // it is rendered from two packages. Adding a `detail.resizeDrawer` twin
  // would fork the translation and drift the two handles apart.
  'common.resizeDrawer': 'Resize drawer',
  'detail.back': 'Back',
  'detail.edit': 'Edit',
  'detail.editInline': 'Edit',
  'detail.save': 'Save',
  'detail.saveChanges': 'Save changes',
  // objectui#4396 — InlineEditSaveBar's in-flight label. Read bare
  // (`t('detail.saving')`, no inline `defaultValue`), so before this row a
  // provider-less host rendered the raw key `detail.saving` into the button.
  'detail.saving': 'Saving…',
  // objectui#4401 — was 'Edit fields inline' here while the packs all say
  // "Edit fields", so InlineEditSaveBar's toggle announced two different names
  // depending on whether an I18nProvider was mounted. The pack won: it is what
  // the console (essentially all traffic) renders, nine other packs already
  // translated its copy, and this map's contract is to mirror the pack.
  'detail.editFieldsInline': 'Edit fields',
  'detail.editInlineHint': 'Double-click to edit',
  'detail.cancel': 'Cancel',
  'detail.cancelEdit': 'Discard changes',
  'detail.openInNewTab': 'Open in new tab',
  'detail.share': 'Share',
  'detail.duplicate': 'Duplicate',
  'detail.export': 'Export',
  'detail.viewHistory': 'View history',
  'detail.delete': 'Delete',
  'detail.moreActions': 'More actions',
  // objectstack#5407 — the activity-feed reaction button's accessible name.
  // It is icon-only, so this label IS the button as far as a screen reader
  // (or a hover tooltip) is concerned; it used to be an English literal.
  'detail.addReaction': 'Add reaction',
  // objectstack#5430 — the rest of the reaction chrome. The picker popup is
  // `role="listbox"` with no visible label, and each reaction chip is an
  // emoji + a bare number, so these labels ARE those controls to a screen
  // reader. The count label is an i18next count family (objectui#11445):
  // `fallbackT` reads its `_one` / `_other` row for a numeric `count`.
  'detail.emojiPicker': 'Emoji picker',
  'detail.reactionCount': '{{emoji}} {{count}} reactions',
  'detail.reactionCount_one': '{{emoji}} {{count}} reaction',
  'detail.reactionCount_other': '{{emoji}} {{count}} reactions',
  'detail.addToFavorites': 'Add to favorites',
  'detail.removeFromFavorites': 'Remove from favorites',
  'detail.previousRecord': 'Previous record',
  'detail.nextRecord': 'Next record',
  'detail.recordOf': '{{current}} of {{total}}',
  'detail.recordNotFound': 'Record not found',
  'detail.recordNotFoundDescription': 'The record you are looking for does not exist or may have been deleted.',
  'detail.goBack': 'Go back',
  'detail.details': 'Details',
  'detail.relatedRecords': '{{count}} records',
  'detail.relatedRecordOne': '{{count}} record',
  'detail.noRelatedRecords': 'No related records found',
  'detail.loading': 'Loading…',
  'detail.copyToClipboard': 'Copy to clipboard',
  'detail.copied': 'Copied!',
  'detail.deleteConfirmation': 'Are you sure you want to delete this record?',
  'detail.editRecord': 'Edit record',
  'detail.viewAll': 'View All',
  'detail.new': 'New',
  'detail.noValue': 'No value',
  'detail.activity': 'Activity',
  'detail.copyRecordId': 'Copy record ID',
  'detail.showEmptyFields': 'Show {{count}} empty fields',
  'detail.showEmptyFields_one': 'Show {{count}} empty field',
  'detail.showEmptyFields_other': 'Show {{count}} empty fields',
  'detail.hideEmptyFields': 'Hide empty fields',
  'detail.editRow': 'Edit',
  'detail.deleteRow': 'Delete',
  // objectui#13333 — the related list's row delete names the row by its title.
  'detail.deleteRowConfirmation': 'Are you sure you want to delete "{{name}}"?',
  'detail.actions': 'Actions',
  'detail.previousPage': 'Previous',
  'detail.nextPage': 'Next',
  'detail.pageOf': 'Page {{current}} of {{total}}',
  'detail.sortBy': 'Sort by',
  'detail.filterPlaceholder': 'Filter…',
  'detail.highlightFields': 'Key Fields',
  // objectui#4645 — `HeaderHighlight`'s own container name. The strip is a
  // bare `<section>` with no visible label of its own, so this `aria-label`
  // IS the landmark to a screen reader; it was an English literal in every
  // locale. Same shape and same argument as `detail.pathLabel` (#5956).
  'detail.highlightsLabel': 'Record highlights',
  // Comments
  'detail.comments': 'Comments',
  'detail.searchComments': 'Search comments…',
  'detail.addCommentPlaceholder': 'Add a comment… (Ctrl+Enter to submit)',
  'detail.noMatchingComments': 'No matching comments',
  'detail.noCommentsYet': 'No comments yet',
  'detail.pinned': 'Pinned',
  'detail.pin': 'Pin',
  'detail.unpin': 'Unpin',
  'detail.justNow': 'just now',
  'detail.minutesAgo': '{{count}}m ago',
  'detail.hoursAgo': '{{count}}h ago',
  'detail.daysAgo': '{{count}}d ago',
  // Record meta footer (audit provenance). created/updated are the
  // actor-less variants used when created_by/updated_by is null (system or
  // seeded rows) — "Created by · 5m ago" dangled without an actor.
  'detail.createdBy': 'Created by',
  'detail.updatedBy': 'Updated by',
  'detail.created': 'Created',
  'detail.updated': 'Updated',
  // Attachments
  'detail.dropFilesToUpload': 'Drop files here or click to upload',
  'detail.attachmentCount': '{{count}} attachment',
  'detail.attachmentCount_one': '{{count}} attachment',
  'detail.attachmentCount_other': '{{count}} attachments',
  'detail.removeAttachment': 'Remove attachment',
  // Discussion
  'detail.discussion': 'Discussion',
  'detail.showDiscussion': 'Show Discussion ({{count}})',
  'detail.hideDiscussion': 'Hide discussion',
  // Rich text editor
  'detail.bold': 'Bold (Ctrl+B)',
  'detail.italic': 'Italic (Ctrl+I)',
  'detail.listFormat': 'List',
  'detail.inlineCode': 'Inline code',
  'detail.mentionSomeone': 'Mention someone',
  'detail.preview': 'Preview',
  'detail.submitComment': 'Submit (Ctrl+Enter)',
  'detail.sendComment': 'Send',
  'detail.writeComment': 'Write a comment…',
  // Subscription
  'detail.subscribedTooltip': 'Subscribed — click to unsubscribe',
  'detail.unsubscribedTooltip': 'Subscribe to notifications',
  // The reference rail's empty related-record list
  'detail.noRecords': 'No records',
  // objectui#3863 — the packs grew a BASE key for this family, and this map mirrors
  // it: `fallbackT` (createSafeTranslation) reads the `_one` / `_other` row for a
  // numeric `count` (objectui#11445) and the base row for a call made without one,
  // the order i18next reads the `en` pack in.
  'detail.showEmptyRelated': '+ {{count}} empty',
  'detail.showEmptyRelated_one': '+ {{count}} empty',
  'detail.showEmptyRelated_other': '+ {{count}} empty',
  // Activity timeline
  'detail.allActivity': 'All Activity',
  'detail.commentsOnly': 'Comments Only',
  'detail.fieldChangesFilter': 'Field Changes',
  'detail.tasksOnly': 'Tasks Only',
  'detail.leaveCommentPlaceholder': 'Leave a comment… (Ctrl+Enter to submit)',
  'detail.noActivity': 'No activity recorded',
  // objectui#11195 — the timeline's no-permission state for a REFUSED feed
  // read. Read bare (`t('detail.activityAccessDenied')`), so without these rows
  // a provider-less host would render the raw key where the refusal belongs.
  'detail.activityAccessDenied': "You don't have permission to view activity on this record.",
  'detail.commentsAccessDenied': "You don't have permission to view comments on this record.",
  // objectui#7149 — the rest of `ActivityTimeline`'s copy. Byte-identical to
  // the `en` pack rows (this map mirrors it; `defaults-maps-mirror-en-pack`
  // enforces that), so a provider-less host reads the same English the console
  // does instead of a raw key.
  'detail.allFilter': 'All',
  'detail.createsFilter': 'Creates',
  'detail.deletesFilter': 'Deletes',
  'detail.statusChangesFilter': 'Status Changes',
  'detail.activityEmptyValue': '(empty)',
  'detail.activityFieldChanged': 'Changed {{field}} from "{{old}}" to "{{new}}"',
  'detail.activityCreated': 'Created this record',
  'detail.activityDeleted': 'Deleted this record',
  'detail.activityStatusChanged': 'Changed status to "{{value}}"',
  'detail.activityUpdated': 'Updated record',
  'detail.loadMore': 'Load more',
  'detail.edited': '(edited)',
  // objectui#12268 — the author's controls on their own feed comment: the
  // icon-only Edit and Delete buttons' accessible names (Edit's is also the
  // in-place editor's).
  'detail.editComment': 'Edit comment',
  'detail.deleteComment': 'Delete comment',
  'detail.via': 'via {{source}}',
  'detail.viewSource': 'View source',
  // Replies
  'detail.replyCount': '{{count}} reply',
  'detail.replyCount_one': '{{count}} reply',
  'detail.replyCount_other': '{{count}} replies',
  'detail.replyPlaceholder': 'Reply…',
  // Aria labels
  'detail.filterActivity': 'Filter activity',
  'detail.openDiscussion': 'Open discussion panel',
  'detail.closeDiscussion': 'Close discussion panel',
  'detail.subscribeAriaLabel': 'Subscribe to notifications',
  'detail.unsubscribeAriaLabel': 'Unsubscribe from notifications',
  'detail.clearSearch': 'Clear search',
  // Concurrent update (OCC) dialog
  'detail.concurrentUpdateTitle': 'This record was modified by someone else',
  'detail.concurrentUpdateDescription': 'Another user saved a newer version of {{field}} while you were editing. To prevent silently overwriting their change, please choose how to resolve the conflict.',
  'detail.concurrentUpdateYourEdit': 'Your edit',
  'detail.concurrentUpdateCurrentValue': 'Current value',
  'detail.concurrentUpdateUpdatedBy': 'Updated by {{name}}',
  'detail.concurrentUpdateUpdatedAt': 'Updated at {{when}}',
  'detail.concurrentUpdateReload': 'Reload latest',
  'detail.concurrentUpdateOverwrite': 'Overwrite anyway',
  'detail.concurrentUpdateCancel': 'Cancel',
  // Approval band (objectui#2618; two-state since #2902)
  'detail.lockedByApproval': 'Locked for approval',
  'detail.lockedTooltip': 'This record has a pending approval request; editing is locked',
  // …and the pending-but-writable variant: the approval node declares
  // `lockRecord: false`, so the record stays editable while the request is open.
  'detail.approvalPendingEditable': 'In approval · editable',
  'detail.approvalPendingTooltip': 'This record has a pending approval request; this step still allows editing',
  // Quorum / 会签 progress on the pending node (objectstack#4478). The group
  // NAMES are data, not copy — they come from the flow author's config.
  'detail.approvalProgress': 'Approvals — {{got}} of {{need}}',
  'detail.approvalProgressGroups': 'Sign-off — {{got}} of {{need}} groups',
  'detail.approvalProgressLabel': 'Approval progress',
  'detail.cancelApproval': 'Recall approval',
  'detail.cancelApprovalInFlight': 'Recalling…',
  'detail.cancelApprovalTooltip': 'Recall the pending approval request to unlock this record',
  'detail.cancelApprovalTooltipUnlocked': 'Recall the pending approval request',
  'detail.cancelApprovalFailed': 'Failed to recall approval',
  'detail.cancelApprovalUnavailable': 'Recalling approvals is not supported on this data source',
  // `record:path`'s own container label — the accessible name of the stage LIST
  // (objectui#5956). Was a hardcoded `'Record path'` literal in the renderer, so
  // a zh/ja/ar session heard English for the list while every stage inside it
  // announced in the session locale. The author's `schema.aria.ariaLabel`
  // still wins ahead of this fallback (the refused `aria.label` no longer
  // does: objectui#9945).
  'detail.pathLabel': 'Record path',
  // `record:path` stage state, composed into each stage's accessible name
  // (objectui#5916). A `role="listitem"` takes its name from the AUTHOR only —
  // visually-hidden text inside one computes to an empty accessible name — so the
  // state cannot ride along as content and is composed into `aria-label` instead.
  // `{{stage}}` is the stage's own label, already localized via `translateOptions`.
  'detail.pathStageCompleted': '{{stage}}, completed',
  'detail.pathStageCurrent': '{{stage}}, current stage',
  'detail.pathStageUpcoming': '{{stage}}, upcoming',
  'detail.pathStageLostCurrent': '{{stage}}, closed lost, current stage',
  'detail.pathStageLostUpcoming': '{{stage}}, closed lost, not reached',
  // The GOAL terminus, unreached (objectui#5957). An unreached `won` stage is
  // painted a faint emerald where a plain upcoming stage is `bg-muted`, and that
  // was the last distinction this control carried in COLOUR ALONE. Only the
  // `upcoming` state gets a key: a REACHED `won` terminus paints identically to
  // any other current/completed stage, so naming it apart would hand a screen
  // reader a distinction the screen does not make.
  'detail.pathStageWonUpcoming': '{{stage}}, goal stage, not reached',
  // objectui#9050 — RelatedList's malformed-filter state. Byte-identical to
  // the `en` pack (`defaults-maps-mirror-en-pack`), and present HERE as well
  // because a provider-less host mounting `RelatedList` directly is exactly
  // the case with no per-component error boundary above it either.
  'view.malformedFilter': 'This view’s filter is malformed, so no records are shown: the {{subject}} condition cannot be applied.',
};

/**
 * Translation hook for detail view components.
 * Falls back to DETAIL_DEFAULT_TRANSLATIONS when no I18nProvider is available.
 */
export const useDetailTranslation = createSafeTranslationHook(
  DETAIL_DEFAULT_TRANSLATIONS,
  'detail.back',
);
