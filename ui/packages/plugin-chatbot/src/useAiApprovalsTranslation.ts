/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSafeTranslation } from '@object-ui/i18n';

/**
 * Locale wiring for `AiPendingActionsInbox` — objectui#7173.
 *
 * A module of its own, the shape `plugin-detail`'s `useDetailTranslation.ts`
 * already uses: the defaults map has to be importable by the test that compares
 * it against the `en` pack, and exporting a non-component from the component
 * file trips `react-refresh/only-export-components`.
 *
 * @module
 */

/**
 * English fallbacks for every key the inbox reads.
 *
 * `createSafeTranslation` serves these when no `I18nProvider` is mounted — a
 * standalone Studio panel, a host that embeds the inbox without the provider,
 * this package's own tests — so a provider-less render shows English rather
 * than raw keys. Every row here is byte-identical to its `en` pack value: the
 * pack is what the console renders and this map is its stand-in, so the two
 * must not disagree.
 *
 * The four relative-time rows are BORROWED from `detail.*` rather than minted
 * under this namespace. They already existed, translated, in all ten packs, and
 * cross-package borrowing is this repo's settled convention — `ObjectGrid`,
 * `ObjectKanban`, `ObjectTree`, `ListView`, `ObjectView`, `NavigationOverlay`
 * and `RecordAttachmentsPanel` all resolve `detail.*` from outside
 * `plugin-detail`. One phrase on one kind of control should not get a second
 * translation that can drift from the first.
 *
 * ⛔ The five relative-time helpers in this repo are NOT unified (objectui#7173's
 * triage ruling): they differ in real behaviour — `Math.round` in this inbox vs
 * `Math.floor` in `plugin-detail`, 45s/30d vs 60s/7d, different tails — and
 * normalising them is a behaviour change that needs its own card. Only the
 * OUTPUT is translated; `AiPendingActionsInbox.formatRelative` keeps its own
 * arithmetic, pinned by `__tests__/AiPendingActionsInbox.i18n.test.tsx`.
 *
 * Exported from this MODULE, not from the package barrel (`src/index.tsx`
 * names its exports one by one), so it stays off the published API surface
 * while `__tests__/AiPendingActionsInbox.i18n.test.tsx` can compare it row by
 * row against the `en` pack — the invariant
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` holds the
 * detail / list / designer maps to. A row that disagrees with the pack renders
 * two different labels for one control and nothing else would see it.
 */
export const AI_APPROVALS_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'aiApprovals.title': 'AI Approvals',
  'aiApprovals.description':
    'Actions an AI agent proposed that need a human review before execution.',
  'aiApprovals.tabPending': 'Pending',
  'aiApprovals.tabDecided': 'Decided',
  'aiApprovals.tabAll': 'All',
  'aiApprovals.statusPending': 'Pending',
  'aiApprovals.statusApproved': 'Approved',
  'aiApprovals.statusExecuted': 'Executed',
  'aiApprovals.statusFailed': 'Failed',
  'aiApprovals.statusRejected': 'Rejected',
  'aiApprovals.colTool': 'Tool',
  'aiApprovals.colAction': 'Action',
  'aiApprovals.colObject': 'Object',
  'aiApprovals.colStatus': 'Status',
  'aiApprovals.colProposed': 'Proposed',
  'aiApprovals.colDecision': 'Decision',
  'aiApprovals.emptyTitle': 'No actions waiting',
  'aiApprovals.emptyDescription':
    'When the AI proposes a sensitive action it will appear here for review.',
  'aiApprovals.view': 'View',
  'aiApprovals.approve': 'Approve',
  'aiApprovals.reject': 'Reject',
  'aiApprovals.working': 'Working…',
  'aiApprovals.approveAndExecute': 'Approve & Execute',
  'aiApprovals.outcomeApprove': 'Approve for {{id}}: {{message}}',
  'aiApprovals.outcomeReject': 'Reject for {{id}}: {{message}}',
  'aiApprovals.outcomeExecuteFailed': 'Action failed during execution',
  'aiApprovals.drawerFallbackTitle': 'Pending action',
  'aiApprovals.drawerSubtitle': 'Tool {{tool}} on {{object}}',
  'aiApprovals.fieldProposedBy': 'Proposed by',
  'aiApprovals.fieldDecidedBy': 'Decided by',
  'aiApprovals.fieldConversation': 'Conversation',
  'aiApprovals.fieldToolInput': 'Tool input',
  'aiApprovals.fieldResult': 'Result',
  'aiApprovals.fieldError': 'Error',
  'aiApprovals.fieldRejectionReason': 'Rejection reason',
  'aiApprovals.rejectTitle': 'Reject this action?',
  'aiApprovals.rejectBody':
    'The reason is shown back to the AI so it can adjust its next response.',
  'aiApprovals.rejectPlaceholder':
    "Optional reason (e.g. 'Wrong record id — please confirm with the user first.')",
  // Borrowed, not minted — see the note above.
  'detail.justNow': 'just now',
  'detail.minutesAgo': '{{count}}m ago',
  'detail.hoursAgo': '{{count}}h ago',
  'detail.daysAgo': '{{count}}d ago',
  // Generic verbs this surface shares with the rest of the product.
  'common.refresh': 'Refresh',
  'common.cancel': 'Cancel',
  'common.loading': 'Loading…',
  'common.ok': 'OK',
};

/**
 * Safe wrapper for `useObjectTranslation` that falls back to the map above when
 * no `I18nProvider` is mounted. Delegates to `@object-ui/i18n`'s
 * `createSafeTranslation` — the factory form, not the per-call
 * `useSafeTranslate(key, fallback)`: the inbox interpolates `{{count}}`,
 * `{{id}}`, `{{message}}`, `{{tool}}` and `{{object}}`, and `useSafeTranslate`
 * has no options argument, so those holes would reach the DOM raw. No inline
 * `defaultValue` anywhere either (objectui#3517).
 */
export const useAiApprovalsTranslation = createSafeTranslation(
  AI_APPROVALS_DEFAULT_TRANSLATIONS,
  'aiApprovals.title',
);

/**
 * The `t` the inbox's module-level helpers take.
 *
 * `formatRelative` and `statusLabel` are plain functions, not hooks, so the
 * component reads the hook once and passes `t` down — the same shape
 * `ActivityTimeline` uses for its own formatter.
 */
export type InboxTranslate = (key: string, options?: Record<string, unknown>) => string;
