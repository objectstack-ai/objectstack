/**
 * RecordDetailView Component
 *
 * Renders a detail view for a single record, resolved by URL params.
 * Renders via the SchemaRenderer Page pipeline: an authored
 * PageSchema(type='record') when one is assigned, else a canonical
 * default page synthesized from the object definition
 * (`buildDefaultPageSchema`).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { activityRowToFeedItem, InlineEditSaveBar, RecordMetaFooter, buildDefaultPageSchema, extractMentions, isRefusedFeedRead, resolveTitleField, useRecordEditable } from '@object-ui/plugin-detail';
import { Empty, EmptyTitle, EmptyDescription, Button, PageHeaderActions } from '@object-ui/components';
import { useAuth, createAuthenticatedFetch } from '@object-ui/auth';
import { usePermissions } from '@object-ui/permissions';
import { useDisplayLocale } from '@object-ui/i18n';
import { ActionProvider, useObjectTranslation, useObjectLabel, useActionTextLocalizer, usePageAssignment, isRecordPageOf, useMetadata, RecordContextProvider, SchemaRenderer, DiscussionContextProvider, HighlightFieldsProvider, InlineEditProvider, resolveApprovalLock, useGlobalUndo, useDataInvalidation, notifyDataChanged, subscribeDataChanges, dataChangeMatches, useRowPredicate, classifyLoadError } from '@object-ui/react';
import { buildExpandFields, captureUpdateUndoData, recordDelete, resolveAffordance, resolveRecordIdParamSeed, userActionPredicates, withoutDeniedFields, type AffordanceGrantPrincipal, type SchemaLike } from '@object-ui/core';
import { toast } from 'sonner';
import { useRecordPresence, PresenceAvatars, isCommentAuthor } from '@object-ui/collaboration';
import { Database, ChevronLeft, Lock, AlertTriangle, RotateCw, Printer, FileText } from 'lucide-react';
import { MetadataPanel, useMetadataInspector } from './MetadataInspector.js';
import { SkeletonDetail } from '../skeletons/index.js';
import { ManagedByBadge, useManagedByNote } from '../components/ManagedByBadge.js';
import { isSetupAppSegment } from '../console/setupApp.js';
import { deriveRelatedLists } from '../utils/deriveRelatedLists.js';
import { stripDiscussionNodes, hasExplicitAttachments, hasExplicitApprovals } from '../utils/pageSchemaIntrospect.js';
import { ActionConfirmDialog, type ConfirmDialogState } from './ActionConfirmDialog.js';
import { ActionParamDialog, type ParamDialogState } from './ActionParamDialog.js';
import { ActionResultDialog, type ResultDialogState } from './ActionResultDialog.js';
import { FlowRunner, type ScreenFlowState, type ScreenSpec } from './FlowRunner.js';
import { FlowRefusalNotice, type FlowRefusalState } from './FlowRefusalNotice.js';
import { RelatedRecordActionsBridge } from './RelatedRecordActionsBridge.js';
import { withPageTabsUrlSync } from '../utils/pageTabsUrlSync.js';
import { RECORD_DETAIL_TAB_PARAM, RECORD_TRAIL_PARAM, decodeRecordTrail, buildRecordTrailHref } from '../urlParams.js';
import { resolveActionParams } from '@object-ui/fields';
import { createConsoleServerActionHandler } from '../utils/consoleServerAction.js';
import { modalTargetRefusalMessage } from '../utils/modalTargetDiagnostics.js';
import { actionContextOrg } from '../utils/actionContextOrg.js';
import { resolveHostAppSegment } from '../utils/appRoute.js';
import { hostInConsolePath } from '../utils/hostInConsolePath.js';
import { launchConsoleFlow } from '../utils/flowLaunch.js';
import { useNavigationContext, useRecordBreadcrumbTitle } from '../context/NavigationContext.js';
// Audit provenance renders as the one-line <RecordMetaFooter>; the other
// framework-injected bookkeeping columns are hidden from the body outright.
// Both sets are derived, not restated — see record-detail-system-fields.ts.
import { deriveRecordDetailSections } from './recordDetailSections.js';
import type { DataSource, FeedItem, Reaction } from '@object-ui/types';
import type { ActionDef, ActionParamDef, ConfirmationHandler, ParamCollectionHandler } from '@object-ui/core';
import type { ConsoleActionDispatch } from '../consoleActionDispatch.js';
import { useRecordApprovals, recordLockedByApproval, isSubmitterOf } from '../hooks/useRecordApprovals.js';
import { RecordAttachmentsPanel } from './RecordAttachmentsPanel.js';
import { RecordApprovalsPanel } from './RecordApprovalsPanel.js';
import { DeclaredActionsBar } from './DeclaredActionsBar.js';
import {
  SYS_APPROVAL_REQUEST_OBJECT,
  RECORD_APPROVAL_ACTION_LOCATION,
  RECORD_APPROVAL_EXCLUDED_ACTIONS,
} from './recordApprovalActions.js';
// Side-effect registration of `record:approvals` — synthesized record pages
// reference the node whenever the record has approval requests (#3461), so
// the type must resolve wherever this view renders, not only under hosts
// that import the app-shell barrel.
import './record-approvals-renderer.js';
import { getRecordDisplayName } from '../utils/index.js';
import { parseAuditValue, collectAuditChanges, collectLookupIds, formatAuditValue } from '../utils/auditHistoryDisplay.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useActionModal } from '../hooks/useActionModal.js';
import { useRecentItems } from '../hooks/useRecentItems.js';
import { useObjectPresence } from '../hooks/useObjectPresence.js';

interface RecordDetailViewProps {
  dataSource: any;
  objects: any[];
  onEdit: (record: any) => void;
  /**
   * When provided, this object name overrides the value derived from the
   * current URL (`useParams()`). Used when rendering the detail inside a
   * navigation drawer or split-pane — the parent route owns the URL while
   * the embedded detail is keyed by an in-memory record selection.
   */
  objectNameOverride?: string;
  /**
   * When provided, this record id overrides the value derived from the
   * current URL. See {@link objectNameOverride}.
   */
  recordIdOverride?: string;
  /**
   * `true` when this view is embedded (drawer / split-pane). Suppresses
   * side effects that would conflict with the host route — namely the
   * breadcrumb title publish (the parent route already owns the
   * breadcrumb).
   */
  embedded?: boolean;
}

const FALLBACK_USER = { id: 'current-user', name: 'Demo User' };

/**
 * The `user` seeded into this view's own `<ActionProvider>` — identity plus, once
 * resolved, the caller's system capabilities.
 *
 * [ADR-0066 D4 / framework#3923] `systemPermissions` is not decoration here: this
 * provider SHADOWS the shell-level one (`useConsoleActionRuntime`) for every
 * action on the record surface, and `ActionEngine.getActionsForLocation` reads the
 * capability gate off `runner.getContext().user.systemPermissions`. The engine
 * fails OPEN on `undefined` (unknown ≠ denied), so shipping identity alone
 * silently un-gated every `record_header` / `record_more` action that declared
 * `requiredPermissions` — the button rendered, and only the server's 403 stopped
 * it (and only for platform action routes at that).
 *
 * The `permissionsLoaded` gate keeps "no answer yet" apart from "an answer,
 * whatever it is": while `!permissionsLoaded` (no PermissionProvider mounted,
 * or still resolving), `systemPermissions` is omitted entirely so the engine's
 * own fail-open applies. Forwarding `[]` in that window would flip the gate
 * fail-CLOSED and hide gated actions in a standalone embed.
 *
 * [objectui#4656] Once loaded, `systemPermissions` is forwarded AS-IS,
 * `undefined` included — it is NOT collapsed to `[]`. `MePermissionsProvider`
 * now preserves the distinction the engine already keys off: `undefined`
 * means the backend never reported `systemPermissions` at all (a deployment
 * predating ADR-0066), which is exactly the "unknown" case the engine's own
 * `Array.isArray(held)` check fails OPEN on — not "holds nothing". Defaulting
 * it to `[]` here would silently re-introduce the same collapse at this one
 * call site and gate every `record_header` / `record_more` action closed on
 * such a deployment. A REPORTED empty array still forwards as `[]` and gates
 * strictly, unchanged.
 */
export function resolveActionUser(
  user: { id: string; name: string; image?: string } | null | undefined,
  permissionsLoaded: boolean,
  systemPermissions: string[] | undefined,
): { id: string; name: string; avatar?: string; systemPermissions?: string[] } {
  const identity = user
    ? { id: user.id, name: user.name, avatar: user.image }
    : FALLBACK_USER;
  return permissionsLoaded
    ? { ...identity, systemPermissions }
    : identity;
}

// The secondary-field rule moved with the section derivation into
// `recordDetailSections.ts` (objectui#12442); re-exported for the
// cross-surface pin in `richtextSurfaceParity.test.tsx`.
export { isSecondaryField } from './recordDetailSections.js';

/**
 * The discussion feed of a record that has none. A module-level constant, not
 * a fresh `[]` per render: `feedItems` is handed straight to
 * `DiscussionContextProvider` as a prop, so a new array identity every render
 * would defeat every memo downstream of it. Read-only by convention — every
 * write path below produces a NEW array.
 *
 * ⚠️ That identity carries MORE weight since objectui#8983, not less. Both
 * chatter surfaces now read their rows off that one provider and run them
 * through `applyFeedConfig` inside a `useMemo` keyed on the array identity
 * (`record-chatter.tsx`), so a fresh `[]` per render would re-run the feed
 * pipeline on every render of a record with no comments.
 */
const EMPTY_FEED: FeedItem[] = [];

/**
 * objectui#13010 — the blocks that draw what this view's feed reads fetch. All
 * three read the DiscussionContext this view provides: its merged
 * `sys_comment` + `sys_activity` rows, and the `sys_user` mention list their
 * comment composer suggests. A page with none of them on screen draws nothing
 * those three reads return.
 */
const FEED_CONSUMER_TYPES: ReadonlySet<string> = new Set([
  'record:discussion',
  'record:chatter',
  'record:activity',
]);
/**
 * objectui#13010 part 5 — the block that draws this view's `sys_audit_log`
 * read: the synthesized page's History tab hands it the rows as `entries`.
 */
const HISTORY_CONSUMER_TYPES: ReadonlySet<string> = new Set(['record:history']);
/** Where a page tree nests nodes: the keys `pageSchemaIntrospect` walks. */
const PAGE_NODE_KEYS = ['children', 'items', 'body', 'components', 'regions'] as const;
const PAGE_NODE_PROPERTY_KEYS = ['children', 'items'] as const;
/**
 * The keys `withPageTabsUrlSync` descends through. A `page:tabs` node reached
 * through these alone is the one whose active tab is the `?tab=` value; any
 * other strip keeps its selection in its own state, which this view cannot see.
 */
const TABS_URL_SYNC_KEYS: ReadonlySet<string> = new Set(['regions', 'components', 'children']);

/**
 * Whether a node of one of `types` is on screen when `page` opens with
 * `activeTab` as its `?tab=` value — that is, whether it is mounted.
 *
 * The one thing that keeps a node off screen here is a `page:tabs` item that
 * is not the active one: the strip mounts only the active item's content. The
 * active item is chosen the way `PageTabsRenderer` chooses it — the `?tab=`
 * value when it names an item, else the first item — and only for a strip
 * whose active tab this view can know. Every case it cannot read answers
 * `true`, which is the eager read this view always made: a strip the URL does
 * not drive, a strip with a conditional item (`visibleWhen` can remove the
 * first one), a strip that carries its own `defaultTab` in either spelling
 * (whether or not `?tab=` is set), and a strip whose items sit under both
 * spellings.
 */
function pageShowsNodeOnOpen(page: unknown, types: ReadonlySet<string>, activeTab: string | undefined): boolean {
  const seen = { synced: new WeakSet<object>(), local: new WeakSet<object>() };
  type PageNode = Record<string, unknown>;
  const asNode = (value: unknown): PageNode | undefined =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as PageNode) : undefined;
  const walk = (value: unknown, synced: boolean): boolean => {
    if (!value || typeof value !== 'object') return false;
    const visited = synced ? seen.synced : seen.local;
    if (visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) return value.some((entry) => walk(entry, synced));
    const node = value as PageNode;
    if (typeof node.type === 'string' && types.has(node.type)) return true;

    const props = asNode(node.properties);
    let skipItems = false;
    if (node.type === 'page:tabs' && synced) {
      const top = Array.isArray(node.items) ? (node.items as unknown[]) : undefined;
      const nested = Array.isArray(props?.items) ? (props.items as unknown[]) : undefined;
      const raw = top && nested ? undefined : top ?? nested;
      const items = raw?.map(asNode);
      const readable =
        items !== undefined
        && items.length > 0
        && items.every((it) => it !== undefined && (it.visibleWhen === undefined || it.visibleWhen === null))
        // An authored `defaultTab`, in either spelling, makes the strip unreadable
        // whatever `?tab=` says: `SchemaRenderer`'s hoist copies `properties.*`
        // over the node AFTER `withPageTabsUrlSync` writes `?tab=` onto it, so
        // `properties.defaultTab` beats `?tab=` in the renderer.
        && node.defaultTab === undefined && props?.defaultTab === undefined;
      if (items && readable) {
        const values = items.map((it, idx) => (typeof it?.value === 'string' && it.value !== '' ? it.value : `tab-${idx}`));
        const activeIdx = activeTab !== undefined && values.includes(activeTab) ? values.indexOf(activeTab) : 0;
        // The item's content is past `withPageTabsUrlSync`'s reach, so a strip
        // nested in it is one this view cannot read.
        if (walk(items[activeIdx], false)) return true;
        skipItems = true;
      }
    }
    for (const key of PAGE_NODE_KEYS) {
      if (key === 'items' && skipItems) continue;
      if (walk(node[key], synced && TABS_URL_SYNC_KEYS.has(key))) return true;
    }
    if (props) {
      for (const key of PAGE_NODE_PROPERTY_KEYS) {
        if (key === 'items' && skipItems) continue;
        if (walk(props[key], false)) return true;
      }
    }
    return false;
  };
  return walk(page, true);
}

/**
 * Which of a record's two feed reads the server REFUSED (objectui#11195):
 * 401 / 403, or a permission envelope, judged by plugin-detail's
 * `isRefusedFeedRead`. A read that answered, even with zero rows, and a read
 * that failed for any other reason are both `false` here. Only a refusal is a
 * different answer from "nothing to show".
 */
interface FeedRefusal {
  activity: boolean;
  comments: boolean;
}

/**
 * Union two feed slices by row id, oldest first.
 *
 * Both reads that fill the feed (`sys_comment`, `sys_activity`) land through
 * here, and so does the re-read that follows a navigation back to a record we
 * already have rows for. Union-by-id (rather than replace) is what lets an
 * OPTIMISTIC row — a comment the user just posted, written with the same id it
 * was `create`d under — survive the refetch: if the row has persisted the
 * server copy wins on the same key (no duplicate), and if it has not, the local
 * row is still there.
 */
function mergeFeedRows(prev: readonly FeedItem[], incoming: readonly FeedItem[]): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const item of [...prev, ...incoming]) byId.set(String(item.id), item);
  return Array.from(byId.values()).sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return ta - tb;
  });
}

/**
 * The user ids a feed row's reaction holds in `sys_comment.reactions`. Every
 * reaction on a row carries them: the read keeps each emoji's stored list as
 * `userIds`, and a toggle keeps it. A reaction without them is refused, never
 * written as a list made up from its count, because such a list replaces the
 * stored id of every other user who gave that emoji (objectui#11019).
 */
function storedUserIds(reaction: Reaction): string[] {
  if (!Array.isArray(reaction.userIds)) {
    throw new Error(`The ${reaction.emoji} reaction carries no stored user ids, so it cannot be written.`);
  }
  return reaction.userIds;
}

/**
 * A feed row's reactions with `userId`'s `emoji` reaction toggled: their id is
 * added to that emoji's stored ids when they have not given it, and taken out
 * when they have. Every other id, on that emoji and on every other emoji, is
 * kept as stored, and an emoji left with no ids is dropped, the way the read
 * shows an emoji the stored map does not carry. Pure (it returns a new array
 * and never touches `reactions`) because it runs in the click handler and its
 * result goes both on screen and into the write.
 */
function toggleOwnReaction(
  reactions: readonly Reaction[] | undefined,
  emoji: string,
  userId: string,
): Reaction[] {
  const next = [...(reactions ?? [])];
  const idx = next.findIndex(r => r.emoji === emoji);
  if (idx < 0) {
    next.push({ emoji, count: 1, reacted: true, userIds: [userId] });
    return next;
  }
  const ids = storedUserIds(next[idx]);
  const userIds = ids.includes(userId) ? ids.filter(id => id !== userId) : [...ids, userId];
  if (userIds.length === 0) {
    next.splice(idx, 1);
  } else {
    next[idx] = { ...next[idx], count: userIds.length, reacted: userIds.includes(userId), userIds };
  }
  return next;
}

/**
 * The stored `sys_comment.reactions` shape, `{ emoji: userIds[] }`, of a feed
 * row's reactions: each emoji's stored ids, as the read kept them and the
 * toggle changed them. Two people reacting at the same moment still means the
 * later write wins; this only stops a write from rebuilding the lists.
 */
function storedReactions(reactions: readonly Reaction[]): Record<string, string[]> {
  const stored: Record<string, string[]> = {};
  for (const r of reactions) stored[r.emoji] = storedUserIds(r);
  return stored;
}

/**
 * One reaction click on a feed row: the reaction set it put on screen, which
 * is the set its write stores, and how that write went.
 */
interface ReactionStep {
  reactions: FeedItem['reactions'];
  outcome: 'stored' | 'pending' | 'failed';
}

/** A feed row's reaction clicks whose writes have not all answered yet. */
interface ReactionLedger {
  /** Oldest first. `steps[0]` is always `stored`: the set the server holds for certain. */
  steps: ReactionStep[];
  /** The set this ledger last put on the row. */
  shown: FeedItem['reactions'];
}

/**
 * The object that stores a comment's reactions, one row per (comment, emoji,
 * user), each row the reactor's own record (objectstack-ai/objectstack#22566,
 * ruling A amended on objectstack-ai/objectstack#22505; objectui#12078).
 *
 * A member adds a reaction by creating their row (`comment_id`, `emoji`; the
 * server stamps `user_id` from the session) and takes it back by deleting that
 * row. Nobody's write touches anyone else's reaction, so two members reacting
 * at the same moment both stay stored, which a whole-set write to
 * `sys_comment.reactions` could not do: the later write replaced the earlier.
 *
 * A deployment whose framework predates the object has no such object, and
 * there the chatter keeps the `sys_comment.reactions` column path (see
 * `reactionStore` in the view). That column is retired by
 * objectstack-ai/objectstack#22573, after this.
 */
const COMMENT_REACTION_OBJECT = 'sys_comment_reaction';

/** The object the record feed's comments and replies are rows of. */
const COMMENT_OBJECT = 'sys_comment';

/**
 * Which writes the record feed may offer: its comment and reply composers, the
 * author's Edit and Delete on their own comment (objectui#12268), and its
 * reaction control on either store (objectui#12082).
 *
 * Each is a row of the affordance-to-grant map (`resolveAffordance` in
 * `@object-ui/core`), asked of the object it writes, with that object's schema
 * as the registry serves it: the object's managed-object policy, the server's
 * effective API operation set for it, AND the caller's grant on it. The grant
 * is not a platform default the panel could assume: the `everyone` baseline
 * names neither object, and an application grants them in its own sets, so a
 * member whose sets do not was offered a composer whose post the server
 * refused. With no permission provider mounted every grant reads open, as
 * before.
 *
 * A composer or control whose row is closed is withheld: the panel draws each
 * from its handler's presence (`RecordActivityTimeline`'s
 * `showCommentInput`, the reply input and the reaction picker).
 */
function resolveFeedWriteGates(
  objects: readonly unknown[] | undefined,
  perms: AffordanceGrantPrincipal | null | undefined,
): {
  comment: boolean;
  commentEdit: boolean;
  commentDelete: boolean;
  reactionAdd: boolean;
  reactionRemove: boolean;
  reactionColumn: boolean;
} {
  const source = (objectName: string) => ({
    objectSchema: ((objects ?? []).find((o) => (o as { name?: unknown } | null)?.name === objectName) ??
      null) as SchemaLike | null,
    objectName,
    perms,
  });
  return {
    comment: resolveAffordance('feedComment', source(COMMENT_OBJECT)).allowed,
    // objectui#12268: the author's Edit and Delete on their own comment, each
    // under its own grant on `sys_comment`.
    commentEdit: resolveAffordance('feedCommentEdit', source(COMMENT_OBJECT)).allowed,
    commentDelete: resolveAffordance('feedCommentDelete', source(COMMENT_OBJECT)).allowed,
    reactionAdd: resolveAffordance('feedReactionAdd', source(COMMENT_REACTION_OBJECT)).allowed,
    reactionRemove: resolveAffordance('feedReactionRemove', source(COMMENT_REACTION_OBJECT)).allowed,
    reactionColumn: resolveAffordance('feedReactionColumn', source(COMMENT_OBJECT)).allowed,
  };
}

/**
 * How many comment ids one `sys_comment_reaction` read carries in its
 * `comment_id` `$in`. A record's comment read has no page size (it reads the
 * whole thread), so a busy thread is read in pages of this many ids, the pages
 * in parallel. The bound is the URL: the data door's `find` is a GET carrying
 * the filter in its query string, about 45 bytes per UUID-shaped id, so a page
 * of 100 ids is a URL of about 4.6 KB, well under the request-line limits of
 * Node's HTTP server (16 KB for all headers) and of common proxies (8 KB).
 */
const REACTION_READ_COMMENT_IDS = 100;

/**
 * The reaction rows of `commentIds`: one `sys_comment_reaction` read per page
 * of {@link REACTION_READ_COMMENT_IDS} ids, never one read per comment. Rows
 * come oldest first, so each comment's emoji keep the order they were first
 * given in.
 */
async function readCommentReactionRows(
  dataSource: Pick<DataSource<Record<string, unknown>>, 'find'>,
  commentIds: readonly string[],
): Promise<Array<Record<string, unknown>>> {
  const pages: string[][] = [];
  for (let i = 0; i < commentIds.length; i += REACTION_READ_COMMENT_IDS) {
    pages.push(commentIds.slice(i, i + REACTION_READ_COMMENT_IDS));
  }
  const answers = await Promise.all(
    pages.map((ids) =>
      dataSource.find(COMMENT_REACTION_OBJECT, {
        $filter: { comment_id: { $in: ids } },
        $orderby: { created_at: 'asc' },
      }),
    ),
  );
  return answers.flatMap((res) => (Array.isArray(res?.data) ? res.data : []));
}

/**
 * Reaction rows grouped per comment into the `{ emoji: userIds[] }` shape the
 * `sys_comment.reactions` column stores, so both stores reach the screen
 * through one aggregator. `own` keeps the row id of each of `userId`'s own
 * reactions, per comment and emoji: the id a second click deletes.
 */
function groupReactionRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  userId: string,
): { stored: Map<string, Record<string, string[]>>; own: Map<string, Map<string, string>> } {
  const stored = new Map<string, Record<string, string[]>>();
  const own = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const commentId = String(row.comment_id);
    const emoji = String(row.emoji);
    const reactor = String(row.user_id);
    const byEmoji = stored.get(commentId) ?? {};
    (byEmoji[emoji] ??= []).push(reactor);
    stored.set(commentId, byEmoji);
    if (reactor === userId) {
      const mine = own.get(commentId) ?? new Map<string, string>();
      mine.set(emoji, String(row.id));
      own.set(commentId, mine);
    }
  }
  return { stored, own };
}

/** Whether `userId`'s id is among the stored ids of a row's `emoji` reaction. */
function holdsOwnReaction(reactions: readonly Reaction[] | undefined, emoji: string, userId: string): boolean {
  return (reactions ?? []).some((r) => r.emoji === emoji && storedUserIds(r).includes(userId));
}

/**
 * One (comment, emoji)'s reaction-record writes by the signed-in user, run one
 * after another: a click that takes a reaction back needs the id of the row an
 * earlier click is still creating.
 */
interface ReactionRecordQueue {
  tail: Promise<void>;
  /** Writes queued and not yet answered. */
  pending: number;
  /** Whether the newest click on this key showed the signed-in user's reaction. */
  shown: boolean;
}

/**
 * Which system record-header affordances the record page may offer for this
 * object — the primary `sys_edit` CTA (which also gates the record-body
 * inline-edit session) and the `sys_delete` overflow item.
 *
 * Each bit is the `recordEdit` / `recordDelete` row of the affordance-to-grant
 * map (`resolveAffordance` in `@object-ui/core`, objectui#12082): the object's
 * resolved CRUD affordance (lifecycle bucket + `userActions`) INTERSECTED with
 * the server-resolved effective API operation set (`/me/permissions`
 * `apiOperations`, objectstack#3546) AND the caller's object grant — `update`
 * for Edit, `delete` for Delete. Never a union: a server grant can never
 * re-open an affordance the object's bucket closed, and a permissive bucket
 * default never survives the server denying the operation or the caller
 * lacking the grant. Before the map this gate read no grant at all, so a
 * read-only caller was offered Edit until the record-level probe answered.
 * With no `PermissionProvider` the grant and the operation set both read open,
 * leaving the bucket + `userActions` decision as it always was.
 *
 * Exported so the gate can be unit-tested directly: the record page itself is
 * wired into routing, auth, presence and data fetching too deeply to render in
 * a unit test, and this matrix is the part that must not regress. Same pattern
 * as `defaultListColumnsFromObject` in `ObjectView`.
 */
export function resolveRecordHeaderActionGates(
  objectDef: unknown,
  perms: AffordanceGrantPrincipal | null | undefined,
): { edit: boolean; delete: boolean } {
  const source = {
    objectSchema: objectDef as SchemaLike | null | undefined,
    objectName: (objectDef as { name?: string } | null | undefined)?.name,
    perms,
  };
  return {
    edit: resolveAffordance('recordEdit', source).allowed,
    delete: resolveAffordance('recordDelete', source).allowed,
  };
}

/** Gated copies of served rows, keyed on the served row object itself. */
const READABLE_ROWS = new WeakMap<object, { kept: string; row: unknown }>();

/**
 * `withoutDeniedFields` from `@object-ui/core` (objectui#10594) — the record
 * without the fields the loaded permission policy denies on `objectName`, for
 * building the record's TITLE (objectui#10434) and for the row the record
 * page's blocks read, `page:header`'s H1 among them (objectui#10499) — but the
 * SAME gated object for the same served row and the same kept keys
 * (objectui#10499). The record page hands this row to every block through
 * `RecordContext`, so a new object on every render would reach every consumer
 * as a changed record. The cache lives on the served row, a payload object,
 * not on a memoised identity (AGENTS.md #10).
 */
function readableRow<T>(
  record: T,
  perms: Pick<ReturnType<typeof usePermissions>, 'isLoaded' | 'checkField'>,
  objectName: string | undefined,
): T {
  const row = withoutDeniedFields(record, perms, objectName);
  if (row === record || !record || typeof record !== 'object') return row;
  const kept = JSON.stringify(Object.keys(row as object));
  const cached = READABLE_ROWS.get(record as object);
  if (cached && cached.kept === kept) return cached.row as T;
  READABLE_ROWS.set(record as object, { kept, row });
  return row;
}

export function RecordDetailView({ dataSource, objects, onEdit, objectNameOverride, recordIdOverride, embedded }: RecordDetailViewProps) {

  const params = useParams<{
    appName?: string;
    objectName?: string;
    recordId?: string;
    pageName?: string;
  }>();
  const appName = params.appName;
  const objectName = objectNameOverride ?? params.objectName;
  const recordId = recordIdOverride ?? params.recordId;
  const { showDebug } = useMetadataInspector();
  const { user, activeOrganization } = useAuth();
  const navigate = useNavigate();
  // objectui#2257 — the active detail tab is URL-addressable (`?tab=`), so it
  // survives the page subtree remounting (refreshKey-style save refreshes;
  // dev-StrictMode URL churn). Written with `replace` — switching tabs must
  // not stack history entries (Back would page through tabs and fight the
  // overlay contract where Back closes `?form=…`).
  const [tabSearchParams, setTabSearchParams] = useSearchParams();
  const activeTabParam = tabSearchParams.get(RECORD_DETAIL_TAB_PARAM) ?? undefined;
  const location = useLocation();
  const handleTabChange = useCallback((value: string) => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get(RECORD_DETAIL_TAB_PARAM) === value) return;
    sp.set(RECORD_DETAIL_TAB_PARAM, value);
    // `setSearchParams` is a navigation: without an explicit `state` it drops
    // the entry's history state, losing the list-origin `state.from` that
    // renders the "← All <object>" back link — switching tabs must keep it.
    setTabSearchParams(sp, { replace: true, state: location.state });
  }, [setTabSearchParams, location.state]);
  // Inline "← back to parent" link shown above the record body. Prefers an
  // explicit history-state `from` (legacy, in-session only), then falls back
  // to the last ancestor in the `?from=` URL trail — which, unlike history
  // state, survives refresh and shared links. This is the immediate-parent
  // affordance, and since the top bar draws no record crumb (objectui#12461)
  // the only one: each parent's own link carries the trail above it.
  const originFromState = (location.state as any)?.from as { pathname?: string; label?: string } | undefined;
  const originFrom = useMemo<{ pathname?: string; label?: string } | undefined>(() => {
    if (originFromState?.pathname && originFromState?.label) return originFromState;
    const trail = decodeRecordTrail(new URLSearchParams(location.search).get(RECORD_TRAIL_PARAM));
    const parent = trail[trail.length - 1];
    if (!parent) return undefined;
    const baseAppUrl = appName ? `/apps/${appName}` : '';
    const shortId = parent.i.length > 12 ? `${parent.i.slice(0, 8)}…` : parent.i;
    return {
      pathname: buildRecordTrailHref(baseAppUrl, parent, trail.slice(0, -1)),
      label: parent.t || `#${shortId}`,
    };
  }, [originFromState, location.search, appName]);
  // `i18n` with `language`: what a flow launch translates the flow's own
  // toasts in (objectui#12075).
  const { t, language, i18n } = useObjectTranslation();
  // The DISPLAY locale the audit-history dates format with (objectui#10442).
  // `language` above stays for what it is: the key into per-locale LABEL maps.
  const displayLocale = useDisplayLocale();
  const { objectLabel, objectPluralLabel, viewLabel: _vLabel, sectionLabel, actionParamText, actionParamOptionLabel, actionDescription, actionResultDialog, fieldLabel, fieldOptionLabel } = useObjectLabel();
  // label + confirmText + successMessage through ONE call (objectui#4265) —
  // the three keys of an `_actions.<name>` bundle entry can no longer be
  // localized apart from one another on this surface.
  const localizeActionTexts = useActionTextLocalizer();
  const { isFavorite, toggleFavorite, refreshLabel: refreshFavoriteLabel } = useFavorites();
  const { addRecentItem } = useRecentItems();
  const [isLoading, setIsLoading] = useState(true);
  // The discussion feed, stored PER RECORD (objectui#3268). See the
  // `feedRecordKey` block below for why this is a map and not a `FeedItem[]`.
  const [feedItemsByRecord, setFeedItemsByRecord] = useState<Record<string, FeedItem[]>>({});
  // Which feed reads were refused, stored under the same per-record key as the
  // rows (objectui#11195), so a refusal on record A never reaches record B's
  // panel.
  const [feedRefusalByRecord, setFeedRefusalByRecord] = useState<Record<string, FeedRefusal>>({});
  const [mentionSuggestions, setMentionSuggestions] = useState<
    Array<{ id: string; label: string; avatarUrl?: string }>
  >([]);
  // Screen-flow runtime: a paused `screen`-node flow launched from a record action.
  const [screenFlow, setScreenFlow] = useState<ScreenFlowState | null>(null);
  // A record-action flow launch that ended `refused` without pausing (objectui#9973).
  const [flowRefusal, setFlowRefusal] = useState<FlowRefusalState>({ open: false });
  const [historyEntries, setHistoryEntries] = useState<any[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recordTitle, setRecordTitle] = useState<string | undefined>();
  const objectDef = objects.find((o: any) => o.name === objectName);
  // objectui#13385 (maintainer ruling, option B) — a record page inside the
  // Setup app draws no floating `ManagedByBadge`; the header's object-label
  // chip carries the badge's note instead. Read off the route's `:appName`, so
  // a `sys_*` object opened in any other app keeps the badge, and every page
  // outside Setup is unchanged. The note keeps the badge's own gate
  // (`useCanAuthorMetadata`, objectui#12194), so it is `null` for a caller who
  // could not see the badge either.
  const inSetupApp = isSetupAppSegment(appName);
  const managedByNote = useManagedByNote((objectDef as any)?.managedBy);

  // Publish record title to the navigation context so the top-bar breadcrumb
  // can display "Acme Platform Upgrade" instead of "#9U1_MmmxjiGR…". Skip
  // when embedded (drawer/split): the parent list route owns the breadcrumb.
  useRecordBreadcrumbTitle(embedded ? undefined : recordTitle);

  // Use the URL recordId as-is — it contains the actual record id.
  // Navigation code passes `record.id || record._id` directly into the URL
  // without adding any prefix, so no stripping is needed.
  const pureRecordId = recordId;
  // #2269 — "refresh data, don't rebuild UI": after an action/save succeeds
  // we INVALIDATE this record on the bus instead of bumping a key that
  // remounted the whole DetailView (destroying tab/scroll/inline-edit state).
  // `recordInvalidationNonce` is the read side: it bumps when THIS record (or
  // its object) is invalidated by anyone — the form overlay, an action, an
  // undo, or any dataSource write via the MutationEvent bridge.
  const recordInvalidationNonce = useDataInvalidation(objectName || undefined, pureRecordId || undefined);
  // objectui#12244 — the record load's SECOND trigger: a write to one of this
  // record's related CHILD objects. Bumped by the subscription beside
  // `childRelations` below, which explains why it exists.
  const [childInvalidationNonce, setChildInvalidationNonce] = useState(0);
  const notifyRecordChanged = useCallback(() => {
    if (objectName) notifyDataChanged({ objectName, recordId: pureRecordId || undefined });
  }, [objectName, pureRecordId]);
  // Manual refresh (objectui#3460) — the producer for `RecordContext.refresh`,
  // which `page:header` turns into the ⟳ button at the end of the header row.
  //
  // Scope is deliberately `'*'`, not this record: the reason a user reaches for
  // refresh is a write made by SOMEONE ELSE (another operator started the work
  // order, a child row got reported) — a write this client never saw, so it
  // cannot know which objects it touched. `'*'` treats everything mounted as
  // stale, so the main record, every related child list and the tab-count
  // badges all refetch in place over the #2269 bus: no remount, so tab /
  // scroll / in-progress inline-edit state all survive.
  const handleManualRefresh = useCallback(() => {
    notifyDataChanged({ objectName: '*' });
  }, []);
  // First phase covers the standalone record ROUTE only. Embedded hosts — the
  // list drawer and the split-pane preview (ObjectView / ObjectDataPage /
  // InterfaceListPage all mount this same view with `embedded`) — wrap it in
  // overlay chrome that already owns its own controls, and the #3460 ruling
  // keeps ⟳ off those surfaces for now. `undefined` is the opt-out
  // `page:header` reads, so nothing renders there.
  const headerRefresh = embedded ? undefined : handleManualRefresh;

  // Record-scoped presence ("who else is viewing this record"). The default
  // PresenceProvider source is a no-op, so this resolves to `[]` until a
  // realtime transport (WebSocket-backed source) is wired in by the host
  // app — see `@object-ui/collaboration`'s `<PresenceProvider>`. The
  // PresenceAvatars row is hidden when the array is empty, so the
  // affordance is invisible until the transport lights up.
  const recordPresence = useRecordPresence(objectName, pureRecordId);

  const favoriteRecord = useMemo(() => {
    if (!objectName || !pureRecordId) return null;
    return {
      id: `record:${objectName}:${pureRecordId}`,
      label: recordTitle || pureRecordId || '',
      href: `/apps/${appName}/${objectName}/record/${pureRecordId}`,
      type: 'record' as const,
    };
  }, [appName, objectName, pureRecordId, recordTitle]);
  const isRecordFavorite = favoriteRecord ? isFavorite(favoriteRecord.id) : false;
  const handleToggleRecordFavorite = useCallback(() => {
    if (favoriteRecord) toggleFavorite(favoriteRecord);
  }, [favoriteRecord, toggleFavorite]);

  // ─── Page Assignment (Salesforce Lightning-style record Pages) ──────
  // If a PageSchema(type='record') is authored for this object, render
  // it via SchemaRenderer (which dispatches to the registered 'record'
  // PageRenderer in @object-ui/components). Otherwise the no-assignedPage
  // branch synthesizes a canonical Page via `buildDefaultPageSchema(objectDef)`
  // so the default detail page rides the same SchemaRenderer pipeline as
  // custom pages. (ADR-0085 PR4 removed the legacy DetailView monolith and
  // its `renderViaSchema` kill-switch — schema-driven is the only path.)
  //
  // objectui#12715 — the NAMED record page route
  // (`:objectName/record/:recordId/page/:pageName`, `RECORD_NAMED_PAGE_ROUTE`
  // in `console/AppContent.tsx`) names the page in the URL. It is honoured only
  // when that page is a record page of THIS object (`isRecordPageOf`, the same
  // reading the object-based lookup filters with); any other name is refused
  // with a visible not-found state. There is no fallback: while the pages load
  // nothing is drawn, and a refused name never draws the default page or a
  // synthesized one, so a print of this URL can never put a different document
  // on paper. An embedded detail (drawer / split pane) is keyed by its
  // overrides, not by the host route, so it never reads the segment. On the
  // record route itself `requestedPageName` is undefined and the lookup is the
  // object's default record page, exactly as before.
  const requestedPageName = embedded ? undefined : params.pageName;
  const {
    page: resolvedPage,
    slots: resolvedSlots,
    loading: pageAssignmentLoading,
  } = usePageAssignment(objectName, requestedPageName ? { pageName: requestedPageName } : undefined);
  const metadataPages = useMetadata().pages;
  const namedPageState: 'none' | 'pending' | 'accepted' | 'refused' = useMemo(() => {
    if (!requestedPageName) return 'none';
    if (pageAssignmentLoading) return 'pending';
    const pages: unknown[] = Array.isArray(metadataPages) ? metadataPages : [];
    const named = pages.find((p) => (p as { name?: unknown } | null)?.name === requestedPageName);
    return isRecordPageOf(named, objectName) ? 'accepted' : 'refused';
  }, [requestedPageName, pageAssignmentLoading, metadataPages, objectName]);
  const namedPageBlocked = namedPageState === 'pending' || namedPageState === 'refused';
  const assignedPage = namedPageBlocked ? null : resolvedPage;
  const assignedSlots = namedPageBlocked ? null : resolvedSlots;
  const synthesizedPage = useMemo(() => {
    // Synthesizer drives two cases:
    //   1) no assignedPage at all → pure default detail page
    //   2) assignedSlots (slotted page) → synth with slot overrides
    // In either case the page-record load effect below only needs
    // "is there a page?"; the fully-detailed schema is rebuilt at
    // render time once the synth parts (sections, related, …) are known.
    if (assignedPage) return null;
    if (!objectDef) return null;
    // A named page that is still loading or was refused is never replaced by
    // the synthesized default (objectui#12715).
    if (namedPageBlocked) return null;
    return buildDefaultPageSchema(objectDef as any, assignedSlots ? { slots: assignedSlots } : undefined);
  }, [assignedPage, assignedSlots, objectDef, namedPageBlocked]);
  const effectivePage = assignedPage || synthesizedPage;
  const [pageRecord, setPageRecord] = useState<any>(null);
  // 'idle' | 'loading' | 'loaded' | 'missing' | 'forbidden' | 'failed' —
  // distinguishes "haven't tried yet" from each way the read can end. The
  // short-circuits below render a clean empty state for the last three
  // instead of a half-broken page chrome (rail + discussion), one per answer
  // (objectui#11902):
  //
  //   - `missing`   — the read resolved with no record. The adapter answers a
  //     404 that way (`ObjectStackAdapter.findOne` resolves `null`), so this is
  //     the not-found state, and the only one that says "not found".
  //   - `forbidden` — the read was REFUSED: `classifyLoadError`'s `forbidden`
  //     kind (a 403 / `PERMISSION_DENIED`), the shared classifier the list
  //     view's error panel, the activity feed and the attachments panel read.
  //   - `failed`    — every other rejection (a 5xx, a transport error, …). It
  //     says the load failed and offers Retry, which re-runs the same read.
  //
  // Every rejection used to land on `missing`, so a refused read told the
  // viewer the record "may have been deleted" — and they reported a lost record
  // instead of asking for access — and a transient failure looked final.
  const [pageRecordStatus, setPageRecordStatus] = useState<
    'idle' | 'loading' | 'loaded' | 'missing' | 'forbidden' | 'failed'
  >('idle');
  // The record-load effect's own `loadRecord`, for the `failed` state's Retry
  // (objectui#11902). Held so Retry re-runs THE read the page already makes —
  // same request, same cancellation guard — rather than a second read path.
  // Cleared with the effect, so a Retry can never run a superseded load.
  const reloadPageRecordRef = useRef<(() => void) | null>(null);

  // Permissions context.
  //
  // ⚠️ [objectui#7230] THE POSITION IS LOAD-BEARING, not cosmetic. This used to
  // be a `usePermissions()` call ~670 lines below, next to the header's
  // Edit/Delete gates. The record-load effect just below FLS-gates its
  // `$expand`, and that gated list is computed DURING render (objectui#11699)
  // — so reading `perms` there while the binding was still declared below
  // would hit the temporal dead zone and throw
  // `Cannot access 'perms' before initialization`: a crash, not a stale value.
  // The hook moved up; the site below destructures THIS value instead of
  // calling the hook a second time, so the hook order is unchanged in shape.
  // Same structural note PR #7229 recorded for `ListView`'s memo.
  const perms = usePermissions();

  // What the page-record read below SENDS, held as primitives (objectui#11699).
  //
  // The record-load effect used to depend on three object identities —
  // `effectivePage`, `objectDef` and `perms` — while all it reads from them
  // is a yes/no ("is there a page?") and one list (the relations to expand).
  // Measured on full reloads of a showcase record page, the record's `$expand`
  // read went out twice in sequence, and the second run had changed nothing
  // but `objectDef`'s identity: a JSON-equal definition, with the very same
  // `fields` object, handed down again as a new object by a host re-render.
  // `effectivePage` was the same trap one step removed: the synthesized page
  // is a `useMemo` over `objectDef`, and an assigned page landing replaces it
  // without changing anything the read sends.
  //
  // So the effect keys on the DATA it reads (AGENTS.md #10), never on the
  // objects it reads it from: a new object carrying the same relations, an
  // assigned page taking over from a synthesized one, a discarded memo, or a
  // permission answer that leaves the list as it was does not read the record
  // again; a list that CHANGES does.
  const hasPage = !!effectivePage;
  // Expand lookup/master_detail fields so the page receives display
  // names (e.g. account.name) rather than raw foreign-key IDs. The
  // page subtitle interpolation and record:* renderers depend on this.
  //
  // [objectui#7230] FIELD-LEVEL SECURITY ON `$expand`, the gate
  // objectui#7215 / PR #7229 put on the two projection sites in its scope.
  // `$select` on a denied lookup asks the server for a bare foreign key;
  // `$expand` asks it to RESOLVE the relation and hand back the related
  // record — the larger of the two requests.
  //
  // ⚠️ NO COLUMN LIST IS PASSED HERE, which makes this the sharpest of the
  // family: `buildExpandFields` reads an absent column list as "no column
  // restriction" and falls back to EVERY declared relation on the object,
  // denied ones included. Every record page in the console therefore asked
  // for the object's full relation set by default, not by configuration.
  //
  // Graded as objectui#7215 graded it, by measurement rather than assumption:
  // against ObjectStack this is defence-in-depth, because `plugin-security`'s
  // `FieldMasker.maskRecord` does `delete result[field]` on every unreadable
  // key and objectql's expand path writes the resolved record back under THAT
  // SAME KEY, so one statement removes the expanded object and the bare id
  // alike; the expansion sub-read itself takes the referenced object's full
  // CRUD + RLS + FLS treatment (objectstack#7626). It is load-bearing for a
  // backend that does not strip.
  //
  // ⭐ THE GATE IS ON THE HELPER'S OUTPUT. There is no input to gate on this
  // site, and the output holds only DECLARED reference-bearing fields, so the
  // "`checkField` answers false for an undeclared key" trap is structurally
  // unreachable and a derived / host-joined key is never judged. An
  // unanswered policy filters nothing. The gated list is the effect's
  // dependency (as a string), so an answer that NARROWS it re-reads the record
  // without the denied relation the moment it arrives, and an answer that
  // leaves it as it was reads nothing again (objectui#11699). Pinned in
  // `RecordDetailView.expandFls-7230.test.tsx` and
  // `RecordDetailView.recordOpenRequests-11699.test.tsx`.
  const expandable = buildExpandFields(objectDef?.fields);
  const pageRecordExpand = JSON.stringify(
    !objectName || !perms?.isLoaded
      ? expandable
      : expandable.filter((f) => perms.checkField(objectName, f, 'read')),
  );

  useEffect(() => {
    let cancelled = false;
    if (!hasPage || !pureRecordId || !objectName || !dataSource?.findOne) {
      setPageRecord(null);
      setPageRecordStatus('idle');
      return;
    }
    const expandFields: string[] = JSON.parse(pageRecordExpand);
    const params = expandFields.length > 0 ? { $expand: expandFields } : undefined;
    const loadRecord = () => {
      setPageRecordStatus('loading');
      const findOnePromise = params
        ? dataSource.findOne(objectName, pureRecordId, params)
        : dataSource.findOne(objectName, pureRecordId);
      findOnePromise
        .then((rec: any) => {
          if (cancelled) return;
          if (rec && typeof rec === 'object') {
            setPageRecord(rec);
            setPageRecordStatus('loaded');
          } else {
            setPageRecord(null);
            setPageRecordStatus('missing');
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPageRecord(null);
          // objectui#11902 — a rejection is never "not found": the adapter
          // answers a 404 by resolving `null` (the branch above). A refusal is
          // told apart by the shared classifier; anything else is a failed load.
          setPageRecordStatus(classifyLoadError(err) === 'forbidden' ? 'forbidden' : 'failed');
        });
    };
    reloadPageRecordRef.current = loadRecord;
    loadRecord();

    // Re-sync when any descendant signals the record changed (e.g.
    // DetailView recalling a pending approval). Without this listener,
    // the cached `pageRecord` would stay stale and propagate `pending`
    // back into nested DetailViews via context.
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      if (detail.objectName !== objectName || String(detail.recordId) !== String(pureRecordId)) return;
      loadRecord();
    };
    window.addEventListener('objectui:record-changed', onChanged as EventListener);
    return () => {
      cancelled = true;
      if (reloadPageRecordRef.current === loadRecord) reloadPageRecordRef.current = null;
      window.removeEventListener('objectui:record-changed', onChanged as EventListener);
    };
    // #2269: recordInvalidationNonce re-runs this fetch in place whenever the
    // record (or its object) is invalidated on the bus; childInvalidationNonce
    // does the same for a write to one of its related children (objectui#12244).
    //
    // objectui#11699: every dependency here is either a primitive or the
    // adapter the read goes through. ⛔ Do not list `objectDef`,
    // `effectivePage` or `perms` here — derive what the read sends from them
    // above instead (AGENTS.md #10).
  }, [hasPage, objectName, pureRecordId, dataSource, pageRecordExpand, recordInvalidationNonce, childInvalidationNonce]);

  // The loaded record AS THE VIEWER MAY READ IT (objectui#10434,
  // objectui#10499): `withoutDeniedFields` removes the fields the loaded
  // policy denies on this object, `id` kept, which leaves the row
  // ObjectStack's `FieldMasker` already serves. Two readers take it:
  //
  //   - the record title below (breadcrumb, favourite, "Recently Accessed");
  //   - `RecordContext.data`, the row every block of the record page reads.
  //     `page:header` builds the page H1 from it, and `@object-ui/components`
  //     has no permission source of its own, so this hand-off is where its
  //     title ladder gets gated (objectui#10499). On a backend that strips
  //     denied fields the row is unchanged; on one that does not, every block
  //     now reads a denied field exactly as an absent one, as it would on the
  //     stripping backend.
  //
  // Before the policy loads (and with no provider mounted) nothing is removed,
  // the objectui#10411 rule. When nothing is withheld the served object itself
  // comes back. When something is, the gated copy is cached outside React on
  // the served row (`readableRow`), NOT on a `useMemo` (AGENTS.md #10), so a
  // re-render never republishes an equal row as a new object to the page.
  const readablePageRecord = readableRow(pageRecord, perms, objectName);

  // Derive a human-readable record title from the loaded record so
  // favourites (record:*) and the breadcrumb show e.g. "Acme Corporation"
  // instead of the raw record id. It reads `readablePageRecord` above, so a
  // denied name pointer or `titleFormat` token reads as an absent one and the
  // resolver falls through to its next rung (objectui#10434). When the policy
  // arrives the readable row changes, which re-derives the title.
  useEffect(() => {
    if (!readablePageRecord || typeof readablePageRecord !== 'object' || !objectDef) return;
    const resolved = getRecordDisplayName(objectDef, readablePageRecord);
    if (resolved && resolved !== 'Untitled' && resolved !== recordTitle) {
      setRecordTitle(resolved);
    }
  }, [readablePageRecord, objectDef, recordTitle]);

  // Once we have a human-readable title, (a) record this visit into the
  // "Recently Accessed" rail on the home page and (b) self-heal any
  // previously-favorited entry whose label was saved as the raw record id
  // (because the title hadn't loaded yet at the time of the toggle).
  useEffect(() => {
    if (!objectName || !pureRecordId || !appName) return;
    if (!recordTitle) return;
    const favId = `record:${objectName}:${pureRecordId}`;
    const href = `/apps/${appName}/${objectName}/record/${pureRecordId}`;
    addRecentItem({ id: favId, label: recordTitle, href, type: 'record' });
    refreshFavoriteLabel(favId, recordTitle);
  }, [appName, objectName, pureRecordId, recordTitle, addRecentItem, refreshFavoriteLabel]);

  // ─── Action Provider Handlers ───────────────────────────────────────

  // Confirm dialog state (promise-based)
  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({ open: false, message: '' });

  // Param collection dialog state (promise-based)
  const [paramState, setParamState] = useState<ParamDialogState>({ open: false, params: [] });

  // Result-dialog state — one-shot reveal of action response data
  // (2FA secrets, OAuth client_secret, recovery codes).
  const [resultDialogState, setResultDialogState] = useState<ResultDialogState>({ open: false });
  const resultDialogHandler = useCallback(
    (spec: any, data: unknown, action?: any) => new Promise<void>((resolve) => {
      // Localize title/description/acknowledge + field labels via the
      // `_actions.<action>.resultDialog` convention (metadata literals as
      // fallback); the action's own object wins over the page object.
      const objForI18n = (typeof action?.objectName === 'string' && action.objectName)
        ? action.objectName
        : objectName || objectDef?.name;
      const localized = actionResultDialog(objForI18n, action?.name, spec) ?? spec;
      setResultDialogState({ open: true, spec: localized, data, resolve });
    }),
    [objectName, objectDef, actionResultDialog],
  );

  // Typed as the PUBLISHED `ConfirmationHandler`, not a re-spelled copy of its
  // shape (objectui#5835). This view runs its own confirm runtime rather than
  // consuming `useConsoleActionRuntime`, and the inline
  // `(message: string, options?: { title?; confirmText?; cancelText? })` this
  // replaced was a near-duplicate that the compiler had no way to keep in step
  // with the real type — the same drift family as objectui#5610 / objectui#3320.
  //
  // `options` is inert ON THIS PATH and that is not a reason to narrow it. The
  // handler has two callers here and both pass ONE argument: the runner, which
  // gets it as `onConfirm` (the structured `confirm` arm that forwarded a bag
  // was retired, objectui#4314), and the header's `sys_delete` action below,
  // which passes no bag either, exactly like the list view's delete
  // (objectui#11001). The parameter is LIVE elsewhere:
  // `handleDeleteView` in `ObjectView.tsx` calls a `ConfirmationHandler`
  // directly with all three fields localized. One published type, two call
  // paths, one of which never fills the bag — settled KEEP, 2026-08-22 ruling
  // on objectui#5205.
  //
  // The field set this hands `ActionConfirmDialog` must stay identical to the
  // one `useConsoleActionRuntime` hands the same dialog; that parity is pinned
  // by `RecordDetailView.confirmRuntimeParity-5835.test.tsx`, which reads what
  // ARRIVES at the dialog from both runtimes rather than comparing the two
  // declarations to each other.
  const confirmHandler = useCallback<ConfirmationHandler>((message, options) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ open: true, message, options, resolve });
    });
  }, []);

  // The SECOND param-collection handler the console mounts, narrowed to the
  // same seam contract as `useConsoleActionRuntime`'s (objectui#5611). It does
  // not read `overrideNotice` itself — it takes the envelope so the two
  // handlers on this seam cannot drift apart from each other, and so a reader
  // added here later has the key declared rather than reaching for a cast.
  const paramCollectionHandler = useCallback((params: ActionParamDef[], action?: ConsoleActionDispatch, interpolate?: (text: string) => string, run?: Parameters<ParamCollectionHandler>[3]) => {
    return new Promise<Record<string, any> | null>((resolve) => {
      // Related-list row actions retarget a CHILD object (e.g. sys_member rows
      // on an org record page) and stash the clicked row under
      // `params._rowRecord` — resolve field-backed params against the
      // action's own object and pre-fill `defaultFromRow` from the row, with
      // the page object only as fallback (mirrors useConsoleActionRuntime).
      const actionObject = typeof action?.objectName === 'string' && action.objectName
        ? action.objectName
        : undefined;
      const row = action?.params && !Array.isArray(action.params)
        ? (action.params as Record<string, any>)._rowRecord
        : undefined;
      const resolved = resolveActionParams(params as any, {
        objectName: actionObject || objectName || objectDef?.name || '',
        objects: objects || [],
        fieldLabel,
        fieldOptionLabel,
        row,
        // Resolves an inline per-locale `label` map (rc.6's widened
        // `I18nLabel`) for the active language — objectui#4163.
        locale: language,
      });
      // Localize param label/placeholder/helpText (see ObjectView for the
      // convention); falls back to the metadata literal.
      const objForI18n = actionObject || objectName || objectDef?.name;
      const localized = (resolved as any[]).map((p: any) => ({
        ...p,
        label: actionParamText(objForI18n, action?.name, p.name, 'label', p.label) ?? p.label,
        placeholder: actionParamText(objForI18n, action?.name, p.name, 'placeholder', p.placeholder) ?? p.placeholder,
        helpText: actionParamText(objForI18n, action?.name, p.name, 'helpText', p.helpText) ?? p.helpText,
        options: Array.isArray(p.options)
          ? p.options.map((o: any) => ({ ...o, label: actionParamOptionLabel(objForI18n, action?.name, p.name, o.value, o.label) }))
          : p.options,
      }));
      const declaredDescription = actionDescription(objForI18n, action?.name, action?.description);
      setParamState({
        open: true,
        params: localized,
        // Title the dialog as the action rather than the generic "Action
        // parameters" — from `label` alone, the one spelling an action carries
        // for this. The `|| action?.title` fallback that used to sit here read
        // a key declared on no action surface at all — not `@objectstack/spec`'s
        // `ActionSchema` (44 keys walked at spec 17.0.0), not `ActionDef` or its
        // pinned `ACTION_DEF_KEYS` / `SPEC_ACTION_KEYS`, not `@object-ui/types`'
        // renderer view (`ui-action.ts`) or `crud.ts` — and forwarded by none of
        // the four action renderers, so it could not fire from authored
        // metadata. This was the SECOND copy of the limb objectui#4282 removed
        // from `useConsoleActionRuntime`: this view builds its own runtime
        // rather than routing through that hook, so the two param-collection
        // handlers drift as a pair (objectui#5610). Reads exactly one key, like
        // `description` below.
        title: action?.label,
        // `${...}` holes in the description and each `helpText` are filled in
        // the runner's template scope, as `confirmText` is (objectui#12967).
        description: interpolate && declaredDescription ? interpolate(declaredDescription) : declaredDescription,
        interpolate,
        resolve,
        // The runner's `run`, as `useConsoleActionRuntime` forwards it: a
        // refused run keeps what the user typed (objectui#13161).
        run,
      });
    });
  }, [objectName, objectDef, objects, fieldLabel, fieldOptionLabel, actionParamText, actionParamOptionLabel]);

  // Global undo/redo (Ctrl+Z), backed by the dataSource — the success toast's
  // "Undo" button (for `undoable` actions) restores the record's prior values.
  // The confirmation it raises reads the session's language, as the button's
  // own label does (objectui#11056).
  const undoCtl = useGlobalUndo({
    dataSource,
    onUndo: (op: any) => {
      if (op?.objectName) notifyDataChanged({ objectName: op.objectName, recordId: op.recordId });
      else notifyRecordChanged();
      toast.success(t('actions.undone'));
    },
  });

  const toastHandler = useCallback((message: string, options?: { type?: string; duration?: number; undo?: { label?: string } }) => {
    if (options?.type === 'error') { toast.error(message); return; }
    if (options?.undo) {
      toast.success(message, {
        duration: options.duration,
        action: { label: options.undo.label || 'Undo', onClick: () => { void undoCtl.undo(); } },
      });
      return;
    }
    toast.success(message, { duration: options?.duration });
  }, [undoCtl]);

  // The app an in-place hop from this page is hosted under (objectui#13396).
  // This view's `ActionProvider` shadows the console runtime's for every
  // action on the record page, so its navigator sorts a path the same way
  // that runtime's does (`hostInConsolePath`, objectui#13379): an app-relative
  // `onSuccess.navigate` such as `/crm_opportunity/${result.id}` opens in an
  // app instead of matching no route and landing on Home. The app is the
  // record page's own — the `:appName` of its route. Mounted outside an app
  // route, it falls back to the console runtime's answer
  // (`resolveHostAppSegment` over the shell's published app).
  //
  // The route's own `appName` also goes in as the third argument, so a
  // `type: 'form'` action on this page opens its form inside this app's shell
  // (`/apps/<app>/forms/<name>`) instead of on the app-less `/forms/<name>`
  // (objectui#13433). Only the route's app: outside an app route it is
  // undefined and the form keeps the app-less route.
  const { currentAppName } = useNavigationContext();
  const metadataApps = useMetadata().apps;
  const hostAppSegment = appName ?? resolveHostAppSegment(metadataApps, currentAppName);

  const navigateHandler = useCallback((url: string, options?: { external?: boolean; newTab?: boolean }) => {
    if (options?.external || options?.newTab) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      navigate(hostInConsolePath(url, hostAppSegment, appName));
    }
  }, [navigate, hostAppSegment, appName]);

  // Authenticated fetch for direct backend calls (absolute `type:'api'`
  // targets below + the flow trigger). Declared before apiHandler.
  const authFetch = useMemo(() => createAuthenticatedFetch(), []);

  // API action handler — absolute HTTP targets go to the backend verbatim
  // (the canonical `type:'api'` semantics); logical targets map to
  // dataSource operations.
  const apiHandler = useCallback(async (action: ActionDef) => {
    try {
      const target = action.target || action.name;
      const rowRecord = action.params && !Array.isArray(action.params)
        ? ((action.params as Record<string, any>)._rowRecord as Record<string, any> | undefined)
        : undefined;
      const params: Record<string, any> = { ...(action.params || {}) };
      delete params._rowRecord;

      // Absolute HTTP target — mirror of useConsoleActionRuntime.apiHandler's
      // canonical branch (fetch + recordIdParam/bodyExtra/bodyShape +
      // active-org injection for better-auth endpoints). The legacy
      // dataSource.update mapping below MUST NOT see these: routing a
      // better-auth row action (remove_member / update_member_role) through
      // it either silently no-opped (no collected params) or bypassed
      // better-auth with a raw table write on a managed identity table.
      const targetStr = typeof target === 'string' ? target : '';
      if (targetStr.startsWith('/') || /^https?:\/\//i.test(targetStr)) {
        const baseUrl = import.meta.env.VITE_SERVER_URL || '';
        // Interpolate `{field}` tokens in the target URL. Source: the stashed
        // row when the dispatch carries one (related-list rows; page:header
        // since objectui#3391), else THIS page's record — but only when the
        // action doesn't retarget another object (a child action interpolated
        // from the parent's fields would hit the wrong record; same guard as
        // the recordIdParam fallback below). Without the page-record fallback,
        // a `record_header` action reaching here through any dispatch path
        // that doesn't stash `_rowRecord` sent the literal `{id}` on the wire.
        const interpolationRecord = rowRecord
          ?? (!action.objectName || action.objectName === objectName
            ? (pageRecord as Record<string, any> | undefined) ?? undefined
            : undefined);
        let resolvedTarget = targetStr;
        if (interpolationRecord && /\{[a-z_][a-z0-9_]*\}/i.test(resolvedTarget)) {
          resolvedTarget = resolvedTarget.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (_, k) => {
            const v = interpolationRecord[k];
            return v == null ? '' : encodeURIComponent(String(v));
          });
        }
        const url = resolvedTarget.startsWith('http') ? resolvedTarget : `${baseUrl}${resolvedTarget}`;

        const wrap = action.bodyShape && typeof action.bodyShape === 'object' && (action.bodyShape as any).wrap
          ? (action.bodyShape as any).wrap
          : undefined;
        const body: Record<string, any> = wrap ? { [wrap]: params } : { ...params };

        if (action.recordIdParam) {
          const rowField = action.recordIdField || 'id';
          // This site has two sources resolveRecordIdParamSeed doesn't know
          // about — a literal `recordId` override (not a declared ActionDef
          // field; nothing in this repo's metadata sets it today, hence the
          // cast) and the same page-record fallback `interpolationRecord`
          // above uses for `record_header` actions dispatched with no
          // `rowRecord`. Preserve that priority (row -> override ->
          // page record) and let the helper decide — and word — the
          // refusal only once every source has been tried, instead of the
          // silent drop this call site used to fall back to
          // (objectstack#8018, objectui#4669).
          //
          // objectui#5176 — the page-record fallback is not enough on its own,
          // because the header does not wait for the page record. `isLoading`
          // (the only state the <SkeletonDetail> early return reads) is flipped
          // false in a route-keyed microtask, while `pageRecord` lands one
          // `findOne` round-trip later; for that whole window the real header
          // renders with every `record_header` action live. Clicking inside it
          // seeded from `null`, which `resolveRecordIdParamSeed` deliberately
          // abstains on (no value AND no error — "no row context" is not that
          // guard's business), so the request went out naming no record and the
          // backend answered `missing_record_id`. That is the reported "click
          // does nothing, click again and it works".
          //
          // `pureRecordId` is the id this page is ADDRESSED by — read off the
          // URL, present on the first render, and already the fallback the
          // other three dispatch paths in this file use. Seeding a minimal row
          // from it makes this path agree with them. It stays a LAST resort
          // (row and override still outrank it) and keeps the same
          // retarget guard `interpolationRecord` uses, so a child-object action
          // is never handed the parent page's id. An action keyed on some other
          // field via `recordIdField` gets a row without that key, which is the
          // helper's named refusal — deliberately, since the URL carries the
          // record's id and nothing else: refusing beats under-specifying.
          const recordIdOverride = (action as { recordId?: unknown }).recordId;
          const rowHasValue = !!rowRecord && rowRecord[rowField] != null;
          if (!rowHasValue && recordIdOverride != null) {
            body[action.recordIdParam] = recordIdOverride;
          } else {
            const targetsThisRecord = !action.objectName || action.objectName === objectName;
            const thisRecordSeed: Record<string, any> | undefined = targetsThisRecord
              ? ((pageRecord as Record<string, any> | undefined)
                  ?? (pureRecordId != null ? { id: pureRecordId } : undefined))
              : undefined;
            const seedRecord: Record<string, any> | undefined = rowHasValue
              ? rowRecord
              : (thisRecordSeed ?? rowRecord);
            const seed = resolveRecordIdParamSeed(action, seedRecord);
            if (seed.error) return { success: false, error: seed.error };
            if (seed.value !== undefined) body[action.recordIdParam] = seed.value;
          }
        }

        // better-auth org endpoints resolve the session's active org; pass it
        // explicitly so row actions stay correct mid-org-switch.
        if (/\/api\/v1\/auth\//.test(resolvedTarget) && !body.organizationId && activeOrganization?.id) {
          body.organizationId = activeOrganization.id;
        }
        if (action.bodyExtra && typeof action.bodyExtra === 'object') {
          Object.assign(body, action.bodyExtra);
        }

        const method = (action.method || 'POST').toUpperCase();
        const init: any = {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        };
        if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(body);
        const res = await authFetch(url, init);
        if (!res.ok) {
          let errBody: any = null;
          try { errBody = await res.json(); } catch { /* response body not JSON */ }
          const detail = errBody?.error?.message || errBody?.error || errBody?.message || `HTTP ${res.status}`;
          return { success: false, error: typeof detail === 'string' ? detail : `HTTP ${res.status}` };
        }
        const data = await res.json().catch(() => ({}));
        if (action.refreshAfter === true) notifyRecordChanged();
        return { success: true, data, reload: action.refreshAfter === true };
      }

      // Merge `bodyExtra` constant fields into the update payload. Per the
      // ActionSchema contract these are "applied last; overrides user params",
      // and the PageView/list executeAPI path already honors them. Without this
      // merge, a pure-confirm action (confirmText, no `params` array — the
      // trigger carried entirely in `bodyExtra`) collects empty `params`, so the
      // generic `default` branch below skips the update and the action silently
      // no-ops on the record-detail page while working from a list row.
      if (action.bodyExtra && typeof action.bodyExtra === 'object') {
        Object.assign(params, action.bodyExtra);
      }

      let undo: any;
      switch (target) {
        case 'opportunity_change_stage':
          await dataSource.update(objectName!, pureRecordId!, { stage: params.new_stage });
          break;
        case 'opportunity_mark_won':
          await dataSource.update(objectName!, pureRecordId!, { stage: 'closed_won' });
          break;
        case 'opportunity_mark_lost':
          await dataSource.update(objectName!, pureRecordId!, { stage: 'closed_lost', loss_reason: params.loss_reason });
          break;
        default: {
          // Generic: update record with collected params. Related-list row
          // actions retarget a CHILD record via explicit `objectName`/`recordId`;
          // otherwise the update falls back to this page's record.
          const targetObject = action.objectName ?? objectName;
          const targetId = (action as any).recordId ?? pureRecordId;
          const isThisRecord =
            targetObject === objectName && String(targetId) === String(pureRecordId);
          if (Object.keys(params).length > 0 && targetObject && targetId != null) {
            // Undoable single-record update: capture the changed fields' prior
            // values from the loaded record so the success toast can offer Undo.
            // Only this page's record has its prior values loaded, so child-row
            // updates skip undo capture.
            //
            // ⛔ A field the record does not CARRY is never captured as `null`
            // (objectui#11082, the objectui#10404 rule). The snapshot is
            // `@object-ui/core`'s `captureUpdateUndoData`, the one capture rule
            // the runner and the console runtime also call. The page record is
            // read with no column list, but the server deletes every field the
            // reader may not read, so an action that writes such a field finds
            // it absent here; `?? null` then made Undo write `null` over its
            // stored value. A `null` the record carries is a real empty value
            // and is captured as one. When any written field is not carried
            // there is no Undo at all: the success toast then has no Undo button.
            //
            // ⛔ A relation is captured as its stored id (objectui#11122). The
            // page record is read with `$expand` on every relation the reader
            // may read, so it carries the related record where the server
            // stores the id; copied verbatim, Undo wrote that record into the
            // reference. The rule reads which fields are relations from this
            // object's field definitions, the same ones that built `$expand`.
            let undoMissing: string[] | undefined;
            if (action.undoable && isThisRecord && pageRecord) {
              const record = pageRecord as Record<string, unknown>;
              const written = Object.keys(params);
              const objectFields = objectDef?.fields;
              const undoData = captureUpdateUndoData(written, record, objectFields);
              if (undoData) {
                undo = {
                  id: `undo-${targetObject}-${targetId}-${Date.now()}`,
                  type: 'update',
                  objectName: targetObject,
                  recordId: String(targetId),
                  timestamp: Date.now(),
                  // objectui#11080 — the object, never an English verb: the Undo /
                  // Redo toast supplies the verb from a pack key (see the runner's twin).
                  description: action.label || targetObject,
                  undoData,
                  redoData: { ...params },
                };
              } else {
                undoMissing = written.filter((k) => captureUpdateUndoData([k], record, objectFields) === undefined);
              }
            }
            await dataSource.update(targetObject, String(targetId), params);
            if (undoMissing) {
              console.warn(
                '[RecordDetailView] `undoable` action succeeded but offers no Undo: the record it ran on '
                + 'does not carry every field it wrote, so their prior values are unknown and an Undo would '
                + 'overwrite stored data. The record page carries a written field when the principal may read it.',
                { action: action.name, missing: undoMissing },
              );
            }
          }
          break;
        }
      }

      const shouldRefresh = action.refreshAfter === true;
      if (shouldRefresh) {
        notifyRecordChanged();
      } else if (undo) {
        // Even when refreshAfter isn't set, reflect the change so the user sees
        // it (and the subsequent Undo) on the open record.
        notifyRecordChanged();
      }
      return { success: true, reload: shouldRefresh, undo };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }, [dataSource, objectName, objectDef, pureRecordId, pageRecord, authFetch, activeOrganization]);

  // Client-side modal transport: `type:'modal'` actions open here (Dialog /
  // Sheet / Drawer by `placement`) and render arbitrary SchemaNode content.
  const { modalHandler, modalElement, resolveModalTarget } = useActionModal(dataSource);

  /**
   * Flow action handler — triggered when an Action with `type: 'flow'` is
   * invoked from a record-level location (record_header, record_more, …) or
   * from a related list on this page. It starts the flow through one of two
   * doors (objectui#12037, triage ruling B; the rule and its reasons live in
   * `utils/flowLaunch`):
   *
   * - a click whose object and `name` resolve to a DECLARED `type: 'flow'`
   *   action with the same target, in this page's `objects`, goes through the
   *   action door, `POST /api/v1/actions/:object/:action`, so every
   *   server-side gate that action declares applies to the click (ADR-0066
   *   D4). A related-list row action addresses the CHILD object and the
   *   child action's declared name, with the child row as `recordId`;
   * - every other flow click stays on `POST /api/v1/automation/:flow/trigger`.
   *   An undeclared flow start has no action gate to apply, and ruling A's
   *   elevation refusal already holds on the trigger route. An object-less
   *   declared action is absent from `objects`, so it keeps that route too,
   *   as every flow click did before.
   */
  const flowHandler = useCallback(async (action: ActionDef) => {
    const flowName = action.target || action.name;
    if (!flowName) {
      return { success: false, error: 'No flow target provided for flow action' };
    }
    try {
      const baseUrl = import.meta.env.VITE_SERVER_URL || '';
      // `_rowRecord` is the client-side row stash (page:header dispatches
      // carry it since objectui#3391) — never part of the trigger contract;
      // strip it exactly like useConsoleActionRuntime's flowHandler does.
      const flowParams = {
        ...(action.params && !Array.isArray(action.params)
          ? (action.params as Record<string, any>)
          : {}),
      };
      delete flowParams._rowRecord;
      // Related-list row actions retarget the flow at a CHILD record via an
      // explicit `recordId` / `objectName`. This page's record stands in only
      // for an action on THIS page's object (header/more actions): a child
      // action with no row — a related list's toolbar — is object-level, and
      // handing it the PARENT's id addressed a child record that does not
      // exist (the action door refuses that subject load with a 404).
      const targetObject = action.objectName ?? objectName;
      const recordId = (action as any).recordId
        ?? (targetObject === objectName ? pureRecordId : undefined);
      // Single source for the door choice, the request, the flow-response
      // rule AND what a launch does with it — shared with
      // useConsoleActionRuntime's copy of this handler (and the interpretation
      // with FlowRunner's resume). This copy once checked only the transport
      // envelope and treated everything else as terminal success, so a run
      // that failed on its first node fired a green toast (#2958) and passed
      // the nested `{code, message}` error through raw (React #31); later, a
      // run that ended `refused` without pausing toasted the action's
      // `successMessage` and refreshed while the refusal was never shown
      // (objectui#9973). See utils/flowLaunch.
      const launch = await launchConsoleFlow<ScreenSpec>({
        fetch: authFetch,
        baseUrl,
        action,
        objectName: targetObject,
        recordId,
        triggerParams: flowParams,
        objects,
        translation: { i18n, language },
      });
      const judged = launch.judged;
      // Paused at a `screen` node: FlowRunner renders the form + resumes, and
      // refreshes on completion. The pause keeps the action's own toast
      // silent, so its `successMessage` rides along to the run's completion
      // (objectui#12234 — see FlowRunner's header).
      if (judged.followUp?.kind === 'screen') {
        setScreenFlow({
          flowName: launch.flowName,
          flowLabel: judged.followUp.flowLabel,
          runId: judged.followUp.runId,
          screen: judged.followUp.screen,
          actionSuccessMessage: action.successMessage,
        });
      }
      // Ended `refused`: the Close-only notice carries the engine's sentence,
      // titled with the action the user clicked.
      if (judged.followUp?.kind === 'refusal') {
        setFlowRefusal({ open: true, title: action.label, message: judged.followUp.message });
      }
      if (judged.refresh) notifyRecordChanged();
      return judged.result;
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }, [authFetch, pureRecordId, objectName, objects, i18n, language]);

  // Server-side action handler — POST /api/v1/actions/{object}/{action},
  // built from @object-ui/core's `createServerActionHandler` via the shared
  // console wrapper (#2904), exactly like `useConsoleActionRuntime`: core owns
  // the dispatch (name-only identity per ADR-0110 D1 — this copy used to post
  // `target || name`, the drift framework#3935 fixed only in the shared
  // runtime — plus the re-entrancy guard and the /actions envelope rule), the
  // wrapper owns the popup pre-open / `newTabUrl` fast path / `redirectUrl`
  // convention.
  //
  // The record page resolves records against ITSELF, not a grid selection:
  // related-list row actions retarget a CHILD record via an explicit
  // `action.recordId`; header/more actions carry none and use this page's id.
  // The env ref keeps the handler instance stable across renders (authFetch is
  // memoized once) while the thunks read the live record/object.
  const serverActionEnvRef = useRef({ objectName, pureRecordId, notifyRecordChanged, t, navigate });
  serverActionEnvRef.current = { objectName, pureRecordId, notifyRecordChanged, t, navigate };
  const serverActionHandler = useMemo(
    () => createConsoleServerActionHandler({
      fetch: authFetch,
      baseUrl: () => import.meta.env.VITE_SERVER_URL || '',
      resolveObject: () => serverActionEnvRef.current.objectName,
      resolveRecordId: (action) => ({
        recordId: (action as { recordId?: unknown }).recordId ?? serverActionEnvRef.current.pureRecordId ?? undefined,
      }),
      onRefresh: () => serverActionEnvRef.current.notifyRecordChanged(),
      // SPA route hop for a handler-returned `openIn: 'self'` — react-router's
      // own `navigate`, matching the shared console runtime.
      navigate: (url: string) => serverActionEnvRef.current.navigate(url),
      // Read through the env ref so the spinner-tab / popup-blocked copy
      // follows a language switch without invalidating the handler instance
      // (objectui#3321).
      t: (key, englishDefault) => String(serverActionEnvRef.current.t(key, englishDefault)),
    }),
    [authFetch],
  );

  /**
   * `type: 'modal'` dispatch — same rule as the shared console runtime (see
   * `useConsoleActionRuntime.modalActionHandler`): CLIENT-SIDE ONLY. The
   * action's `target` names the PAGE to open — only a page, since the object
   * fallback retired (maintainer ruling on objectstack#6739, PR #4764);
   * rendering it is the whole of what a modal action does.
   *
   * [objectstack#3959 / objectui#3320] This used to fall through to
   * `serverActionHandler` when the target resolved to neither a page nor an
   * object, "so a modal action bound to `engine.registerAction(...)` completes
   * here exactly as it does on a list page". It never ran: the framework's
   * `headlessActionTypeError` rejects `type: 'modal'` over REST with a 400,
   * because a modal has no server dispatch — the fallthrough only converted an
   * authoring mistake (a target naming no page) into a confusing round-trip.
   * objectstack#3959 removed it from the shared runtime; this copy kept the
   * pre-objectstack-ai/objectstack#3959 shape until objectui#3320. An unresolvable target is now
   * reported as what it is. To collect input and then run server-side, declare
   * `type: 'script'` with `params`: the runner collects the same dialog and
   * the handler runs with those values.
   *
   * The refusal WORDING is built by `utils/modalTargetDiagnostics`, shared with
   * `useConsoleActionRuntime.modalActionHandler` and
   * `useActionModal.modalHandler` — see that module for why three hand-written
   * copies of one contract did not survive contact with PR #4764
   * (objectui#4767). Change the contract there, not here.
   */
  const modalActionHandler = useCallback(async (action: ActionDef) => {
    const schema = (action as any).modal ?? action.target ?? (action as any).params?.schema;
    const descriptor = schema != null ? await resolveModalTarget(schema) : null;
    if (descriptor) return modalHandler(descriptor);
    return {
      success: false,
      error: modalTargetRefusalMessage({
        actionName: action.name,
        target: schema,
        serverHandlerHint: true,
      }),
    };
  }, [resolveModalTarget, modalHandler]);

  // ─── Approvals ─────────────────────────────────────────────────────
  // Since ADR-0019 an approval is a flow node: the flow opens the request,
  // there is no manual submit/recall from the record header. This read backs
  // three things: the status badge / edit lock, the approvals panel (#3461),
  // and — since objectui#3055 — the pending `sys_approval_request` row that the
  // object's own SERVER-DECLARED decision actions run against.
  //
  // Not on an approval request's OWN page (objectui#12045): approvals are
  // never opened ON a request, so the read could only answer empty, and the
  // request's decisions are its own declared actions, drawn by
  // `record:approval_decision` over the page record itself. With no object
  // name the hook sends nothing and stays inert.
  const approvals = useRecordApprovals(
    objectName === SYS_APPROVAL_REQUEST_OBJECT ? undefined : objectName,
    pureRecordId,
  );
  // Hold latest approvals snapshot in a ref so the action handler
  // (memoized once inside ActionRunner) always sees fresh state instead of
  // the stale closure captured at the first render.
  const approvalsRef = useRef(approvals);
  approvalsRef.current = approvals;

  // Approval-lock preflight (objectui#2572 item 2): re-read the approval
  // state whenever this record is invalidated on the bus — a saved edit can
  // TRIGGER an approval flow (e.g. a budget change), and without this
  // re-fetch the page kept the pre-save snapshot: the user could re-enter
  // inline edit, fill a whole draft, and only learn about the lock when Save
  // came back RECORD_LOCKED. Reads only when the nonce MOVED (the hook reads
  // on mount itself); the ref keeps the effect off the approvals identity.
  //
  // objectui#12701 — keyed on the last nonce seen, not on "skip the first
  // run": StrictMode replays a mount's effects, and the replay was a second
  // run with nothing invalidated, so the old first-run flag sent a third
  // approvals read on every record open in the console.
  const lastApprovalsNonce = useRef(recordInvalidationNonce);
  useEffect(() => {
    if (lastApprovalsNonce.current === recordInvalidationNonce) return;
    lastApprovalsNonce.current = recordInvalidationNonce;
    void approvalsRef.current.refresh();
  }, [recordInvalidationNonce]);

  // Approval state is TWO signals, not one (objectui#2902).
  //
  // `approvalPending` — an approval is in flight on this record. Drives the
  // status band and the recall affordance, which are meaningful whether or not
  // the record is editable.
  //
  // `approvalLocked` — that approval also forbids edits. The approval node's
  // `lockRecord` policy decides this, and the server enforces exactly that
  // policy in its record-lock `beforeUpdate` hook. Conflating the two (which
  // this used to do) made every `lockRecord: false` node claim the record was
  // locked while the server happily accepted writes — and, worse than the
  // wrong label, `canEdit` below then suppressed the inline-edit affordances
  // entirely, so the "approver may fill in the missing detail" case the flag
  // exists for was unreachable from the console.
  //
  // The record's own `approval_status` field stays a fallback for backends
  // that mirror status onto the record but expose no approvals API. It carries
  // no node granularity, so it can only mean "locked" — the conservative read,
  // and the same one `recordLockedByApproval` applies to a pre-framework#3814 backend.
  //
  // It stands in ONLY while no approvals read has answered (objectui#12220).
  // A read that answered with no pending request means no approval is running:
  // a composition without the approvals service answers `200 { data: [] }` and
  // enforces no lock, so a stale `pending` in the column used to lock the
  // record with nothing to recall. `resolveApprovalLock` is the one rule this
  // page and the DetailView band share; `approvalReadAnswered` below hands the
  // band the same `answered` this call reads.
  const { pending: approvalPending, locked: approvalLocked } = resolveApprovalLock({
    readAnswered: approvals.answered,
    openApproval: approvals.pendingRequest
      ? { locked: recordLockedByApproval(approvals.pendingRequest) }
      : null,
    recordStatus: (pageRecord as any)?.approval_status,
  });
  // How far the pending node's tally has got (objectstack#4478). Multi-approver
  // nodes — `quorum`, `unanimous`, `per_group` — do not finalize on one
  // decision, so an approver standing on the record needs the count to know
  // whether their click closes the step. Server-computed; `first_response`
  // nodes carry none and the band then shows nothing extra.
  const approvalProgress = approvals.pendingRequest?.decision_progress;
  // Who may RECALL the pending approval (`830ed5803`). Recall is the
  // submitter's lever and the server refuses everyone else, so a non-submitter
  // reading a pending record was being offered a button whose click could only
  // fail. Same source order the approvals panel's Remind gate uses — one
  // `isSubmitterOf` for both, so the two levers cannot disagree about who
  // submitted.
  //
  // `undefined` when there is no pending request to consult: the band is then
  // running off the record's `approval_status` mirror alone (a backend with no
  // approvals API), the host has resolved no identity, and the DetailView keeps
  // its pre-`830ed5803` behaviour rather than hiding on absent information.
  //
  // This gates the AFFORDANCE only. `canEdit` / `approvalLocked` below are
  // untouched by it, and the recall endpoint authorizes the recall itself.
  const approvalIsSubmitter = isSubmitterOf(approvals.pendingRequest, user?.id);

  // A decision landed through the declared-action bar (objectui#3055). The
  // action itself already POSTed and the runtime already toasted; what the HOST
  // owes is a re-read of both halves it renders — the approval state (status,
  // pending row, `viewer` block, tally) and the record itself, whose
  // engine-written mirrors (`approval_status`, stage fields) change with the
  // decision. `refreshAfter: true` on every declared decision action is what
  // calls this.
  const handleApprovalActionDone = useCallback(() => {
    void approvalsRef.current.refresh();
    notifyRecordChanged();
  }, [notifyRecordChanged]);

  // Discover reverse references: other objects with lookup/master_detail fields
  // pointing to the current object (e.g., order_item.order → order).
  //
  // Audit FKs (`created_by` / `updated_by` / `owner_id`) are skipped — they
  // exist on virtually every object, and on a `sys_user` page they would
  // produce one related entry per (object × audit-FK) pair (dozens of
  // duplicate "用户偏好 / 邮件模板 / 角色 …" cards in the right rail and
  // tabs). The semantic owner field for a child record is its primary
  // `*_id` lookup; audit attribution belongs in audit views, not in the
  // related-records summary.
  // Detail-page related lists — the read-side mirror of the form's inline
  // master-detail. Derived purely from the relationship graph: every child
  // object whose lookup/master_detail FK references this object becomes a
  // related list (owned `master_detail` children first), unless its FK opts
  // out via `relatedList: false`. `relatedListTitle` / `relatedListColumns`
  // on the FK override the derived title / columns. Audit FKs are skipped and
  // children deduped — see `deriveRelatedLists`.
  // Object-level READ gate (objectui#2359): the relationship graph alone
  // decides WHICH lists exist, but the current user's permissions decide
  // which they may SEE. Children the user cannot read are dropped here, so
  // neither the section nor its tab is ever rendered (previously they showed
  // an empty grid + a "New" button that 403'd on save). While permissions
  // are still loading (`isLoaded === false`, e.g. no PermissionProvider in a
  // standalone embed) the gate stays open — fail-open is safe because the
  // server enforces data access regardless; this is purely a UI/DX filter.
  const { can: canOnObject, isLoaded: permissionsLoaded, systemPermissions } = perms;
  // [objectstack#3546] The server-resolved effective API operation set for this
  // object (`/me/permissions` `apiOperations`) and the caller's object grant
  // reach the header's Edit/Delete and the record-body inline-edit gate through
  // `resolveRecordHeaderActionGates(objectDef, perms)`: the affordance-to-grant
  // map asks both itself (objectui#12082), so this view no longer threads
  // either one by hand.
  const childRelations = useMemo(
    () => deriveRelatedLists(objectDef, objects, {
      canRead: permissionsLoaded ? (name) => canOnObject(name, 'read') : undefined,
      // A related list is a list of the child's records, so the multi-FK
      // title it composes names it with the plural, as the single-FK title
      // below does (objectui#11733).
      listLabel: (child) => objectPluralLabel({ name: child.name, label: child.label || child.name, pluralLabel: child.pluralLabel }),
    }),
    [objectDef, objects, canOnObject, permissionsLoaded, objectPluralLabel],
  );

  // [objectui#12244] A write to a CHILD re-reads this record, in place.
  //
  // Every block of this page — the header's highlight strip with its rollups
  // among them — draws from the ONE row the record-load effect above reads, and
  // that read re-ran only for a change to THIS record or object. A child write
  // reaches the bus (objectui#2269) under the CHILD's name: through the
  // console's MutationEvent bridge for a dataSource write (a related-list row
  // delete, the form overlay's save), or through `notifyRelatedChanged` for a
  // row action. Neither matched, so a quote's total stayed stale beside a line
  // list that refreshed, until a reload. A rollup is the server's to compute
  // (a summary field, or a hook rolling the children up); the page's part is
  // only to read the parent again.
  //
  // Reader side, the precedent `record:reference_rail` set for its own rows
  // (objectui#12110 item 4): the WRITER declares what it wrote, the reader
  // knows what it depends on. That covers every child-write path at one seam,
  // and costs one parent read per change, however many lists are mounted.
  //
  // The children are the page's derived related lists, keyed by CONTENT
  // (AGENTS.md #10 — `childRelations` is a memo). A change both subscriptions
  // match — a `'*'`, or this record when the object references itself — bumps
  // both nonces from one dispatch; React batches the two updates into one
  // render, so the row is still read once.
  const relatedChildObjectsKey = JSON.stringify(
    Array.from(new Set(childRelations.map((r) => r.childObject))).sort(),
  );
  useEffect(() => {
    const childObjects = JSON.parse(relatedChildObjectsKey) as string[];
    if (childObjects.length === 0) return;
    return subscribeDataChanges((change) => {
      if (childObjects.some((child) => dataChangeMatches(change, child))) {
        setChildInvalidationNonce((n) => n + 1);
      }
    });
  }, [relatedChildObjectsKey]);

  // [objectstack#3821] RECORD-level write gate. Everything above is object
  // scoped — it cannot express "this one record is read-only", which is
  // exactly what a read-only sharing grant is. So the header offered Edit on
  // a record the user may only read: the form opened, the user retyped a
  // field, and the server rejected the save with a 403. Ask the explain
  // engine for the row-level verdict (fail-open; the server stays the
  // authority per the framework's ADR-0124 D1 — server enforces, client is
  // courtesy) and fold it into the same affordance gates.
  //
  // [objectui#13045] An operation the object turns off with a STATIC
  // `userActions` boolean is not asked about: the affordance resolver already
  // hides that affordance (the `false` reaches `resolveRecordHeaderActionGates`
  // from this same `objectDef.userActions` entry), so its verdict would gate
  // nothing on screen and only cost a `security/explain` round trip before the
  // first paint. Only the literal `false` skips. A per-record predicate form,
  // `true`, or an absent entry still asks, and the affordance still follows
  // the verdict.
  const editOffByObject = objectDef?.userActions?.edit === false;
  const deleteOffByObject = objectDef?.userActions?.delete === false;
  const recordWriteAllowed = useRecordEditable(
    objectDef?.name,
    pureRecordId,
    'update',
    !!objectDef?.name && !!pureRecordId && !editOffByObject,
  );
  const recordDeleteAllowed = useRecordEditable(
    objectDef?.name,
    pureRecordId,
    'delete',
    !!objectDef?.name && !!pureRecordId && !deleteOffByObject,
  );

  // ── Per-record `userActions` predicates — the header's FOURTH gate ────────
  //
  // objectui#4213. `userActions.edit` / `.delete` reached this header in their
  // BOOLEAN form and only in that form: the switch flows through
  // `resolveRecordHeaderActionGates` → the affordance-to-grant map, so
  // `userActions: { delete: false }` hid Delete on the list row AND here. The
  // per-record OBJECT form — `{ visibleWhen: … }`, objectui#2614 — was
  // consumed by the list row alone (`plugin-grid`'s
  // `isBuiltinRowActionVisible`), because the conjunction below is the
  // affordance/permission channel and nothing on this path ever parsed a
  // predicate. An author narrowing "who may edit this object" to "which
  // records may be edited" therefore lost the record page while keeping the
  // list — a key whose scope SHRANK when a predicate was added to it.
  //
  // This is the console end of the same convergence PR #4515 (objectui#4419)
  // made for `plugin-detail`'s `DetailView` header. Three surfaces, one
  // evaluator, one answer: row kebab, `DetailView` header, console record page.
  //
  // These are HOOKS, so they live here — beside the record-level verdicts they
  // join — and not inside `synthSystemActions` below, which is a plain IIFE
  // sitting AFTER the `isLoading` / `!objectDef` / `missing` early returns.
  // Their results are threaded into that IIFE as ordinary values, the same
  // shape PR #4515 used.
  //
  // `userActionPredicates` from `@object-ui/core` is THE parser for this form,
  // shared with the row surfaces. A bare boolean yields NO predicates, which is
  // what keeps the boolean form the affordance resolver's channel alone rather
  // than growing a second definition of it here.
  const editPredicates = useMemo(
    () => userActionPredicates(objectDef?.userActions?.edit),
    [objectDef],
  );
  const deletePredicates = useMemo(
    () => userActionPredicates(objectDef?.userActions?.delete),
    [objectDef],
  );
  /**
   * The object's field definitions, handed to every predicate on this record
   * for the same reason the row kebab passes them: a relation field must bind
   * as the stored FOREIGN KEY rather than whatever `$expand` substituted for it
   * on this surface (the detail fetch expands every relation it can), or
   * `record.owner == os.user.id` answers a different question here than it does
   * on the list.
   */
  const predicateFields = objectDef?.fields;
  /**
   * `visibleWhen` — fails CLOSED, and counts as DECLARED by `!= null` rather
   * than by truthiness, so `visibleWhen: false` hides the affordance instead of
   * reading as "ungated" (the objectui#3492 invariant that
   * `isBuiltinRowActionVisible` restates for the row surfaces). `?? true`
   * expresses the ungated default as a boolean, which `useRowPredicate`
   * short-circuits without touching the engine — so an object with no
   * `userActions` takes no evaluation at all and this gate is a literal `true`.
   *
   * `useRowPredicate` IS the row surfaces' evaluator: `plugin-grid`'s
   * `evalRowActionVisibility` documents itself as mirroring
   * `useRowPredicate(pred, row, { fallback: false, warnOnError: true, label,
   * fields })` exactly, boolean short-circuit included, and is hook-free only
   * because a row loop evaluates a variable number of actions inside one
   * `useMemo`. This header evaluates a fixed arity of one record, so the hook
   * form is that same evaluator without the constraint that shaped the wrapper.
   */
  const editVisible = useRowPredicate(editPredicates?.visibleWhen ?? true, pageRecord, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:edit:visibleWhen',
    fields: predicateFields,
  });
  const deleteVisible = useRowPredicate(deletePredicates?.visibleWhen ?? true, pageRecord, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:delete:visibleWhen',
    fields: predicateFields,
  });
  /**
   * `disabledWhen` — fails SOFT (an unevaluable predicate must not grey a
   * button forever), and the `!= null` gate lives OUTSIDE the evaluation, so
   * `disabledWhen: ''` reads as "no condition" rather than as "disable".
   * Verbatim the posture of `DataTableBuiltinRowActionItem` and of PR #4515.
   */
  const editDisabledPred = useRowPredicate(editPredicates?.disabledWhen, pageRecord, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:edit:disabledWhen',
    fields: predicateFields,
  });
  const deleteDisabledPred = useRowPredicate(deletePredicates?.disabledWhen, pageRecord, {
    fallback: false,
    warnOnError: true,
    label: 'builtin:delete:disabledWhen',
    fields: predicateFields,
  });
  const editDisabledByPredicate = editPredicates?.disabledWhen != null && editDisabledPred;
  const deleteDisabledByPredicate = deletePredicates?.disabledWhen != null && deleteDisabledPred;

  // ── Audit history fetch ────────────────────────────────────────────
  // Loads recent sys_audit_log entries for this record so the record page can
  // render a read-only "History" tab (`record:history`). Gated on three preconditions to keep
  // the network and the UI quiet for objects that opt out of history:
  //   1) trackHistory must be explicitly true on the object capabilities
  //      (the framework default is false, so we never speculatively fetch).
  //   2) sys_audit_log must be present in the registered objects list — if
  //      the platform-objects package isn't deployed the tab makes no sense.
  //   3) The object being viewed must not be sys_audit_log itself, to avoid
  //      a recursive tab on the audit log detail page.
  // We request only the safe projection (created_at, action, user_id) so the
  // browser never receives serialized old_value/new_value payloads, which
  // can contain restricted fields. Field-level redaction in PR2 will harden
  // this further once a backend-scoped audit endpoint exists.
  const historyEnabled = useMemo(() => {
    if (!objectDef) return false;
    if (objectDef.name === 'sys_audit_log') return false;
    if (objectDef.enable?.trackHistory !== true) return false;
    return objects.some((o: any) => o.name === 'sys_audit_log');
  }, [objectDef, objects]);

  // ── Capability gates: enable.feeds / enable.activities (objectstack-ai/objectstack#2707) ─────
  // Both are opt-OUT capabilities (spec default `true`): absent enable
  // block/flag = on; only an explicit `false` disables. `feeds:false`
  // hides the discussion panel and skips the sys_comment fetch (the
  // server also rejects new comments with 403 FEEDS_DISABLED);
  // `activities:false` skips the sys_activity timeline fetch/merge (the
  // server stops mirroring CRUD for such objects, so the fetch would be
  // empty anyway — skipping keeps the network quiet).
  const feedsEnabled = objectDef?.enable?.feeds !== false;
  const activitiesEnabled = objectDef?.enable?.activities !== false;
  // `enable.files` (objectstack-ai/objectstack#2727) is opt-IN (spec default `false`): the generic
  // Attachments panel is a new surface, so it only renders when the object
  // explicitly declares it. The server enforces the same gate on
  // sys_attachment creation (403 FILES_DISABLED).
  const filesEnabled = objectDef?.enable?.files === true;

  // ── The feed reads wait for a block that draws them (objectui#13010) ─────
  //
  // The `sys_comment` and `sys_activity` reads below, and the `sys_user`
  // mention list, fill only the DiscussionContext, and only a
  // `record:discussion` / `record:chatter` / `record:activity` block draws it.
  // Read while no such block was mounted, they shared the record read's wave
  // and drew nothing: HotCRM's opportunity page keeps `record:activity` in its
  // Activity tab, so every open paid for a timeline no one had opened. So the
  // reads go out when such a block is on screen, judged on the tree this view
  // renders (`feeds: false` strips the discussion nodes, as below) and the
  // `?tab=` the tab strip writes: at open when the page shows one (the
  // synthesized page's discussion footer, or `?tab=` naming the tab that holds
  // one), else on the tab switch that mounts it. Until then the feed stays in
  // its loading state, which is what such a block shows when it mounts.
  //
  // Once on screen it stays wanted for this view's life. A strip keeps its own
  // selection across a record swap in the same view (a drawer swaps
  // `recordIdOverride` without a remount), while `?tab=` may not follow it, so
  // a reading taken after the swap could say hidden while the block is drawn.
  const feedPage = useMemo(
    () => (feedsEnabled ? effectivePage : stripDiscussionNodes(effectivePage)),
    [feedsEnabled, effectivePage],
  );
  const feedConsumerOnScreen = useMemo(
    () => feedPage != null && pageShowsNodeOnOpen(feedPage, FEED_CONSUMER_TYPES, activeTabParam),
    [feedPage, activeTabParam],
  );
  const [feedConsumerShown, setFeedConsumerShown] = useState(false);
  // Recorded during render, React's pattern for state derived from an earlier
  // render: no effect, and no render that reads the latch unset.
  if (feedConsumerOnScreen && !feedConsumerShown) setFeedConsumerShown(true);
  const feedWanted = feedConsumerOnScreen || feedConsumerShown;

  // The host's own Attachments panel, appended at the page foot for a page
  // that places none (below), is mounted on every open but drawn below the
  // record's content, so its `sys_attachment` read waits until the panel
  // scrolls into view, the way the reference rail's reads do. Held until then
  // by handing the panel no data source: it issues no read and stays in its
  // loading state. Latched for the view's life, like the feed above.
  const [attachmentsFallbackEl, setAttachmentsFallbackEl] = useState<HTMLDivElement | null>(null);
  const [attachmentsFallbackSeen, setAttachmentsFallbackSeen] = useState(false);
  // No observer (SSR / a test environment): read at once, as before.
  const attachmentsFallbackShown = attachmentsFallbackSeen || typeof IntersectionObserver === 'undefined';
  useEffect(() => {
    if (attachmentsFallbackShown || !attachmentsFallbackEl) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setAttachmentsFallbackSeen(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(attachmentsFallbackEl);
    return () => observer.disconnect();
  }, [attachmentsFallbackEl, attachmentsFallbackShown]);

  // ── The audit read waits for the History tab (objectui#13010 part 5) ───
  //
  // The `sys_audit_log` read below, and the `sys_user` name lookup behind it,
  // fill only the `record:history` node of the History tab the synthesized
  // page composes; an assigned page is rendered as authored, and its
  // `record:history` reads its own source. So, like the feed above, the read
  // goes out when that node is on screen, judged by `pageShowsNodeOnOpen` on
  // the page this view synthesizes (the History tab is added only in the
  // rebuild below, so the judgment synthesizes it here with no rows): at open
  // when `?tab=` names the History tab, else on the tab switch that mounts it.
  // Latched for the view's life for the feed's reason.
  const historyPage = useMemo(() => {
    if (!historyEnabled || assignedPage || namedPageBlocked || !objectDef) return null;
    return buildDefaultPageSchema(objectDef, {
      ...(assignedSlots ? { slots: assignedSlots } : {}),
      history: { entries: [] },
    });
  }, [historyEnabled, assignedPage, namedPageBlocked, objectDef, assignedSlots]);
  const historyConsumerOnScreen = useMemo(
    () => historyPage != null && pageShowsNodeOnOpen(historyPage, HISTORY_CONSUMER_TYPES, activeTabParam),
    [historyPage, activeTabParam],
  );
  const [historyConsumerShown, setHistoryConsumerShown] = useState(false);
  if (historyConsumerOnScreen && !historyConsumerShown) setHistoryConsumerShown(true);
  const historyWanted = historyConsumerOnScreen || historyConsumerShown;
  // The read is issued from an effect, after the commit that mounts the tab;
  // that commit shows the tab's loading state, as the read's own would.
  const historyPending = historyWanted && !!dataSource && !!pureRecordId;

  useEffect(() => {
    if (!dataSource || !pureRecordId || !objectDef || !historyEnabled) {
      setHistoryEntries(null);
      return;
    }
    if (!historyWanted) return;
    let cancelled = false;
    setHistoryLoading(true);

    // Pull `old_value` and `new_value` so we can render a per-field diff
    // ("Industry: finance → healthcare") instead of just the action verb.
    // The backend already authorises sys_audit_log row access; column-level
    // redaction would need to happen server-side, not by omitting columns here.
    // `actor` (service/automation principal, ADR-0014 D2) is a newer column —
    // only select it when the registered sys_audit_log schema declares it, so
    // the whole query doesn't fail against older deployments.
    const auditLogDef = objects.find((o: any) => o.name === 'sys_audit_log');
    const hasActorColumn = !!auditLogDef?.fields?.actor;

    dataSource
      .find('sys_audit_log', {
        $filter: { record_id: pureRecordId, object_name: objectDef.name },
        $orderby: { created_at: 'desc' },
        $top: 50,
        $select: ['id', 'created_at', 'action', 'user_id', ...(hasActorColumn ? ['actor'] : []), 'old_value', 'new_value'],
      })
      .then(async (res: any) => {
        if (cancelled) return;
        const items: any[] = Array.isArray(res) ? res : res?.data || [];

        // 1) Resolve actor display names + avatars in a single batched call
        //    so the timeline never falls back to a raw UUID.
        const userIds = Array.from(
          new Set(
            items
              .map((it) => it?.user_id)
              .filter((v): v is string => typeof v === 'string' && v.length > 0),
          ),
        );
        let userMap = new Map<string, { name?: string | null; image?: string | null }>();
        if (userIds.length > 0) {
          try {
            const usersRes = await dataSource.find('sys_user', {
              $filter: { id: { $in: userIds } },
              $top: userIds.length,
              $select: ['id', 'name', 'email', 'image'],
            });
            const users: any[] = Array.isArray(usersRes) ? usersRes : usersRes?.data || [];
            userMap = new Map(
              users.map((u) => [u.id, { name: u.name || u.email || null, image: u.image || null }]),
            );
          } catch (err) {
            console.warn('[RecordDetailView] Failed to resolve audit user names:', err);
          }
        }

        // 2) Build a label map for the current object so diff lines show
        //    "Industry: …" rather than the snake_case "industry: …".
        const fieldLabels: Record<string, string> = {};
        for (const [name, def] of Object.entries<any>(objectDef.fields || {})) {
          if (def?.label) fieldLabels[name] = def.label;
        }

        // 3) Compute display-worthy diffs (drops computed/hidden/system
        //    fields and empty↔empty no-ops — see auditHistoryDisplay).
        const rawChangesPerItem = items.map((it) =>
          collectAuditChanges(parseAuditValue(it?.old_value), parseAuditValue(it?.new_value), objectDef.fields),
        );

        // 4) Batch-resolve lookup ids → record display labels (one query per
        //    referenced object) so diffs show "紧前计划: 任务A" instead of a
        //    raw id. Best-effort: a failed lookup keeps the raw id.
        const lookupIdsByTarget = collectLookupIds(rawChangesPerItem.flat(), objectDef.fields);
        const lookupLabels = new Map<string, Map<string, string>>();
        await Promise.all(
          Array.from(lookupIdsByTarget.entries()).map(async ([target, ids]) => {
            const targetDef = objects.find((o: any) => o.name === target);
            const titleField = resolveTitleField(targetDef) ?? 'name';
            try {
              const refRes = await dataSource.find(target, {
                $filter: { id: { $in: Array.from(ids) } },
                $top: ids.size,
                $select: ['id', titleField],
              });
              const rows: any[] = Array.isArray(refRes) ? refRes : refRes?.data || [];
              lookupLabels.set(
                target,
                new Map(
                  rows
                    .filter((r) => r?.id != null && typeof r?.[titleField] === 'string' && r[titleField])
                    .map((r) => [String(r.id), r[titleField] as string]),
                ),
              );
            } catch (err) {
              console.warn(`[RecordDetailView] Failed to resolve audit lookup labels for ${target}:`, err);
            }
          }),
        );
        if (cancelled) return;

        // `locale` is spent on the date faces only, so it is the display
        // locale, never the UI language (objectui#10442).
        const fmtCtx = { t, locale: displayLocale, lookupLabels };
        const enriched = items.map((it, idx) => {
          const u = it?.user_id ? userMap.get(it.user_id) : undefined;
          // Attribution fallback chain: resolved user name → service/automation
          // principal from the `actor` column (e.g. "svc:flow:<name>") → null
          // (the timeline then shows its localized unknown-user text).
          // A `svc:*` principal is a machine, not a person — render the
          // localized "System" label rather than the raw principal string
          // (framework#4366); the raw value stays available on the entry.
          const rawActor =
            typeof it?.actor === 'string' && it.actor.trim() && it.actor !== it?.user_id
              ? it.actor.trim()
              : null;
          const actorLabel = rawActor?.startsWith('svc:')
            ? t('detail.systemActor', { defaultValue: 'System' })
            : rawActor;
          const changes = rawChangesPerItem[idx].map((c) => ({
            field: c.field,
            label: fieldLabels[c.field] || c.field,
            from: formatAuditValue(objectDef.fields?.[c.field], c.from, fmtCtx),
            to: formatAuditValue(objectDef.fields?.[c.field], c.to, fmtCtx),
          }));
          return {
            ...it,
            user_name: u?.name ?? actorLabel,
            user_avatar: u?.image ?? null,
            changes: changes.length > 0 ? changes : undefined,
          };
        });

        setHistoryEntries(enriched);
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.warn('[RecordDetailView] Failed to fetch sys_audit_log:', err);
        setHistoryEntries([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
    // `t` is identity-stable per language; `language` refires the effect on a
    // language switch so the translated values re-localize, and
    // `displayLocale` on a display-locale switch so the dates do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, pureRecordId, objectDef, historyEnabled, historyWanted, objects, language, displayLocale]);

  // Fetch a directory of active users once per dataSource mount and expose
  // them as @-mention suggestions to the DiscussionContext. Capped at 50 to
  // keep the dropdown tight; hosts can swap in a paginated/server-search
  // implementation later by mounting their own DiscussionContextProvider.
  // Only the comment composer of a feed block reads the list, so it waits for
  // one to be on screen (objectui#13010, `feedWanted` above).
  useEffect(() => {
    if (!dataSource || !feedWanted) return;
    let cancelled = false;

    // Always seed with the current user so the @-mention dropdown shows at
    // least one entry even when the backend has no sys_user directory.
    // Hosts wanting a richer roster should provide it via dataSource.
    const selfSuggestion = user
      ? [{
          id: String(user.id),
          label: user.name || user.email || String(user.id),
          avatarUrl: (user as any).image || undefined,
        }]
      : [];

    (async () => {
      try {
        const res = await dataSource.find('sys_user', {
          $top: 50,
          $select: ['id', 'name', 'email', 'image'],
        } as any);
        if (cancelled) return;
        const rows: any[] = Array.isArray(res) ? res : res?.data || [];
        const fetched = rows
          .map((u) => ({
            id: String(u.id),
            label: u.name || u.email || String(u.id),
            avatarUrl: u.image || undefined,
          }))
          .filter((s) => s.label);
        // Merge: current user first, then directory (de-duped by id).
        const seen = new Set(selfSuggestion.map((s) => s.id));
        const merged = [
          ...selfSuggestion,
          ...fetched.filter((s) => !seen.has(s.id)),
        ];
        setMentionSuggestions(merged.length > 0 ? merged : selfSuggestion);
      } catch {
        if (cancelled) return;
        // Fall back to just the current user so mentions still work.
        setMentionSuggestions(selfSuggestion);
      }
    })();
    return () => { cancelled = true; };
  }, [dataSource, user?.id, user?.name, user?.email, feedWanted]);

  // Memoize so the object identity is stable across renders — otherwise
  // any effect that depends on it (e.g. the feed loader below) would
  // re-fire every render and create an infinite request loop.
  //
  // Carries the ADR-0066 D4 capability gate into this view's ActionProvider —
  // see `resolveActionUser` for why that matters (framework#3923).
  const currentUser = useMemo(
    () => resolveActionUser(user, permissionsLoaded, systemPermissions),
    [user?.id, user?.name, user?.image, permissionsLoaded, systemPermissions],
  );

  // ── Feed loading signal (objectui#3209) ──────────────────────────────────
  //
  // This view OWNS the discussion fetch (the two `find`s below are the only
  // thing that can fill `feedItems`), so it is the only place that can say
  // "still fetching". Until this existed nobody on the chain could: the
  // panel spent every fetch asserting `No comments yet` — a factual claim
  // about the record — and then contradicted itself when the rows landed.
  // #3205 gave `RecordActivityTimeline` the loading render branch; this is
  // the missing SIGNAL behind it. Same shape as #3165/#3205: produced by the
  // host that owns the fetch, never guessed at the consumer (a "no items yet
  // and just mounted" heuristic down in the timeline would be wrong the
  // moment a record genuinely has no comments).
  //
  // Keyed rather than a plain boolean, deliberately. A `useState(false)` +
  // `setFeedLoading(true)` inside the effect paints the empty state for the
  // frame before the effect runs, and navigating to another record would show
  // the PREVIOUS record's settled state until its effect re-fired. Deriving
  // "the key I would fetch for ≠ the key I have settled" makes the very first
  // render of a record already read as loading, with no reset effect.
  // `record:activity` derives its own flag the same way (`canSelfFetch &&
  // fetched === null`) — one idiom, not two.
  //
  // ── Feed STATE is keyed by the same key (objectui#3268) ─────────────────
  //
  // `feedRecordKey` is the identity of the record a feed row belongs to — the
  // very `thread_id` the rows are stored under server-side. Every write into
  // the feed, fetched or optimistic, goes into that record's slice, and the
  // render reads only the CURRENT key's slice. This view is not remounted
  // between records (no `key=` at any mount site — `console/AppContent.tsx`
  // and the `ObjectView` / `ObjectDataPage` / `InterfaceListPage` drawers just
  // swap `recordIdOverride`, deliberately: #2269 "refresh data, don't rebuild
  // UI"), and both reads below merge by row id — so with one flat `FeedItem[]`
  // record A's comments and activity stayed on record B's panel with B's rows
  // merged in alongside (different ids, so the merge could not dedupe them).
  //
  // Keying rather than clearing is the point:
  //   • "empty for a new record" FALLS OUT of reading a key with no slice —
  //     there is no `setFeedItems([])` racing the fetch that filled it;
  //   • a response that lands AFTER the user navigated away is written under
  //     the key its effect closed over, so it can never bleed into the record
  //     now on screen (the same guarantee `settledFeedKey` gives the loading
  //     flag — one idiom in this file, not two);
  //   • ⛔ optimistic rows (a comment posted but not yet persisted) ride in
  //     their own record's slice, so navigating away and back does not drop
  //     them. Nothing here ever deletes a slice; that is deliberate, and it is
  //     also why coming back to a record shows its rows immediately instead of
  //     a spinner while the re-read confirms them (#3205).
  const feedRecordKey = objectName && pureRecordId ? `${objectName}:${pureRecordId}` : null;
  const feedItems = (feedRecordKey ? feedItemsByRecord[feedRecordKey] : undefined) ?? EMPTY_FEED;
  const feedRefusal = feedRecordKey ? feedRefusalByRecord[feedRecordKey] : undefined;
  const feedFetchKey =
    dataSource && feedRecordKey && (feedsEnabled || activitiesEnabled) ? feedRecordKey : null;
  const [settledFeedKey, setSettledFeedKey] = useState<string | null>(null);
  const feedLoading = feedFetchKey !== null && settledFeedKey !== feedFetchKey;

  // ── Where a comment's reactions are stored (objectui#12078) ─────────────
  //
  // `records`: one `sys_comment_reaction` row per member, emoji and comment,
  // read in one batched `$in` read and written as the member's own row
  // (COMMENT_REACTION_OBJECT). `column`: the `sys_comment.reactions` JSON
  // column, read off each comment and written back whole — kept ONLY where the
  // deployment has no `sys_comment_reaction` (a framework that predates
  // objectstack-ai/objectstack#22566, such as cloud's v17 pin), so reactions
  // there keep working exactly as before rather than reading empty and failing
  // every write. The object registry answers which, through the shell's one
  // presence reading; per its contract only an earned `absent` changes the
  // path, and every uncertain answer takes the records path. `null` until the
  // registry has answered, and the feed read waits for it: comments and their
  // reactions are read as one answer.
  const reactionPresence = useObjectPresence(COMMENT_REACTION_OBJECT);
  const reactionStore: 'records' | 'column' | null = !reactionPresence.settled
    ? null
    : reactionPresence.presence === 'absent'
      ? 'column'
      : 'records';
  /**
   * The signed-in user's own reaction rows, per comment (`[thread, comment]`)
   * and emoji: the row id a click that takes the reaction back deletes. Filled
   * by the read, and by each create and delete as it answers.
   */
  const ownReactionRowsRef = useRef(new Map<string, Map<string, string>>());

  // Fetch comments from API.
  //
  // NOTE: Record-level presence ("who else is viewing this record") used to
  // be probed here by `dataSource.find('sys_presence', …)`, but that was an
  // architectural mistake: presence is real-time ephemeral state and does
  // not belong in a regular REST collection. The probe has been removed
  // pending a proper transport-level design (WebSocket-backed
  // `<PresenceProvider>` in @object-ui/collaboration). See ROADMAP for the
  // realtime / OCC plan.
  useEffect(() => {
    if (!dataSource || !objectName || !pureRecordId) return;
    // No block that draws the feed is on screen yet (objectui#13010): nothing
    // is read, and the feed stays in its loading state until one mounts.
    if (!feedWanted) return;
    // The comment read needs to know where reactions are stored; until the
    // registry says, nothing is read and the panel stays in its loading state.
    if (feedsEnabled && reactionStore === null) return;
    let cancelled = false;
    const threadId = `${objectName}:${pureRecordId}`;
    // The two reads below run in PARALLEL and are collected here so the
    // loading flag can close over BOTH of them — see the `allSettled` at the
    // end of this effect.
    const inFlight: Promise<unknown>[] = [];

    // objectui#11195: each read's verdict on REFUSAL, recorded under THIS
    // record's key when it settles. An answered read clears it, so a grant
    // the member receives shows on the next read. Returning `prev` for an
    // unchanged verdict keeps the map's identity when nothing moved. Nothing
    // here re-issues a read: a refusal is recorded, never retried.
    const recordRefusal = (source: keyof FeedRefusal, refused: boolean) => {
      setFeedRefusalByRecord(prev => {
        const current = prev[threadId];
        if ((current?.[source] ?? false) === refused) return prev;
        return {
          ...prev,
          [threadId]: {
            activity: current?.activity ?? false,
            comments: current?.comments ?? false,
            [source]: refused,
          },
        };
      });
    };

    // M10.10: Fetch persisted comments from sys_comment. Field names
    // are snake_case to match the object's schema (`sys_comment` in
    // `@objectstack/plugin-audit`): thread_id, author_id, author_name,
    // author_avatar_url, body, parent_id, is_edited, edited_at, created_at,
    // updated_at — and `reactions` (JSON string) only on the `column` store
    // below, a framework that predates `sys_comment_reaction`.
    //
    // Either store reaches the screen as `{ emoji: string[] }` (one array of
    // user-ids per emoji). The aggregator below counts entries and flags the
    // currently-signed-in user, and keeps each emoji's stored ids as
    // `userIds`: a reaction click changes only the clicker's own id
    // (objectui#11019).
    const toReactions = (stored: Record<string, string[]> | undefined): FeedItem['reactions'] => {
      if (!stored) return undefined;
      return Object.entries(stored).map(([emoji, ids]) => {
        const userIds = Array.isArray(ids) ? ids : [];
        return { emoji, count: userIds.length, reacted: userIds.includes(currentUser.id), userIds };
      });
    };
    // The `column` store: the JSON in `sys_comment.reactions`.
    const parseReactions = (raw: unknown): FeedItem['reactions'] => {
      if (!raw) return undefined;
      let parsed: Record<string, string[]> | undefined;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { return undefined; }
      } else if (typeof raw === 'object') {
        parsed = raw as Record<string, string[]>;
      }
      return toReactions(parsed);
    };

    if (feedsEnabled) inFlight.push(dataSource.find('sys_comment', { $filter: { thread_id: threadId }, $orderby: { created_at: 'asc' } })
      .then(async (res: any) => {
        recordRefusal('comments', false);
        if (!res?.data?.length) return;
        // The `records` store (objectui#12078): ONE batched read of the
        // comments' reaction rows (paged only past REACTION_READ_COMMENT_IDS
        // ids), never one read per comment, grouped here into the column's
        // shape. The column is not read on this path: a reaction stored only
        // there is not shown (the maintainer ruled no migration of it,
        // objectstack-ai/objectstack#22505). A failed reaction read does not
        // take the comments down with it; they show without reactions.
        let records: ReturnType<typeof groupReactionRows> | null = null;
        if (reactionStore === 'records') {
          const commentIds: string[] = res.data.map((c: { id: unknown }) => String(c.id));
          try {
            records = groupReactionRows(await readCommentReactionRows(dataSource, commentIds), currentUser.id);
          } catch {
            records = null;
          }
          if (records) {
            for (const commentId of commentIds) {
              ownReactionRowsRef.current.set(
                JSON.stringify([threadId, commentId]),
                records.own.get(commentId) ?? new Map<string, string>(),
              );
            }
          }
        }
        // objectui#12144: each comment's reply count is its children in the
        // rows this read returned. `sys_comment` stores no count: its object
        // definition says to count `parent_id` children at read time. With
        // threading on, the timeline shows a comment's replies only under a
        // `replyCount` above zero, so without this a stored reply was shown
        // nowhere. Counted the way the timeline groups replies: by the row's
        // `parent_id`, when it has one. A reply whose parent is not among
        // these rows counts toward no item here.
        const replyCounts = new Map<unknown, number>();
        for (const c of res.data as Array<{ parent_id?: unknown }>) {
          if (c.parent_id) replyCounts.set(c.parent_id, (replyCounts.get(c.parent_id) ?? 0) + 1);
        }
        const mapped: FeedItem[] = res.data.map((c: any) => ({
          id: c.id,
          type: 'comment' as const,
          actor: c.author_name ?? t('detail.unknownUser', { defaultValue: 'Unknown' }),
          actorAvatarUrl: c.author_avatar_url ?? undefined,
          body: c.body ?? '',
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          parentId: c.parent_id ?? undefined,
          replyCount: replyCounts.get(c.id),
          // objectui#12268: a comment its author edited reads as edited, from
          // the row's own `is_edited`; and the viewer's own comment offers its
          // author's Edit and Delete. Whose it is, is the one rule
          // `CommentThread` gates on (`isCommentAuthor`), asked here so the
          // feed never derives it.
          edited: c.is_edited === true,
          authoredByViewer: isCommentAuthor(c.author_id, currentUser.id),
          reactions:
            reactionStore === 'records'
              ? toReactions(records?.stored.get(String(c.id)))
              : parseReactions(c.reactions),
        }));
        // Into THIS record's slice — `threadId` is the key the effect closed
        // over, so a response that arrives after the user navigated away
        // updates the record it was fetched for, never the one on screen.
        setFeedItemsByRecord(prev => ({
          ...prev,
          [threadId]: mergeFeedRows(prev[threadId] ?? EMPTY_FEED, mapped),
        }));
      })
      // A refused comment read is the same panel's other half (objectui#11195):
      // the panel says the member may not see the comments, instead of "No
      // comments yet". Any other failure still lands on the empty state.
      .catch((err: unknown) => { recordRefusal('comments', isRefusedFeedRead(err)); }));

    // M10.11: Fetch sys_activity rows for this record and merge into the
    // timeline. plugin-audit's writers populate sys_activity on every
    // create/update/delete unless the object opts OUT via an explicit
    // `enable.activities: false` (objectstack-ai/objectstack#2707 — opt-out contract, spec default
    // true), so this surface gives us a Salesforce-style "what happened
    // on this record" feed without any per-app glue.
    //
    // The whole row -> FeedItem reading is `record:activity`'s exported
    // `activityRowToFeedItem` (@object-ui/plugin-detail), NOT a copy of it.
    // This merge and that block read the SAME rows of the SAME system table,
    // so two readings can only ever be a bug.
    //
    // objectui#5878 shared the TYPE TABLE (until then, #5840's `scheduled` ->
    // `event` entry existed in the renderer and not here, so a scheduled
    // meeting rendered on a hand-authored record page and vanished on the
    // console one). objectui#5896 shares the CONSTRUCTION around it, which had
    // drifted the same way one level up: this loop dropped a type the table
    // does not contain SILENTLY, while the block renders it through
    // `UNMAPPED_ACTIVITY_FEED_TYPE` and warns once. `sys_activity.type` is
    // author-extensible (objectstack `88b9d749a`, direction 4, ruled 2026-08-24) and
    // is never validated on write, so that drop made every author-extended
    // row stored, queryable and INVISIBLE on the surface where a shipped
    // producer's rows are most likely to be watched — objectui#5840's failure
    // mode, reached by another route. The helper's docblock carries which
    // types map where and why `commented` / `mentioned` / `login` / `logout`
    // deliberately map to nothing; do not restate it here, and never
    // re-declare the table or rebuild the item by hand.
    //
    // sys_activity is system-owned so a 404 ("table not provisioned",
    // older schemas without activities) is silently tolerated. A REFUSED read
    // is not (objectui#11195): a member the server will not show this record's
    // activity to sees the panel say so, not "no activity". The verdict is
    // `isRefusedFeedRead`, the one the `record:activity` block's self-fetch
    // uses, so the two surfaces cannot disagree about what a refusal is.
    if (activitiesEnabled) inFlight.push(dataSource.find('sys_activity', {
      $filter: { object_name: objectName, record_id: pureRecordId },
      $orderby: { timestamp: 'asc' },
      $top: 200,
      // The actor's record in place of its id, so a row with no `actor_name`
      // names its user instead of reading "System" (objectui#12067). The
      // shared constructor reads it; the `record:activity` block's own read
      // passes the same expand.
      $expand: ['actor_id'],
    })
      .then((res: any) => {
        recordRefusal('activity', false);
        if (!res?.data?.length) return;
        const systemActorLabel = t('detail.systemActor', { defaultValue: 'System' });
        const mapped: FeedItem[] = [];
        for (const row of res.data) {
          // `null` is the ONE outcome that drops a row, and it means exactly
          // one thing: a type the shared table maps to `undefined` ON PURPOSE
          // (`commented` / `mentioned` / `login` / `logout` — their content
          // lives in `sys_comment`, or they are account events rather than
          // record activity). Everything else comes back as an item, including
          // a type nobody has mapped yet.
          const item = activityRowToFeedItem(row, systemActorLabel);
          if (item) mapped.push(item);
        }
        if (!mapped.length) return;
        // Merge by id into THIS record's slice (timeline events are
        // append-only); `mergeFeedRows` sorts by createdAt ascending so the
        // activity panel reads as a chronological narrative.
        setFeedItemsByRecord(prev => ({
          ...prev,
          [threadId]: mergeFeedRows(prev[threadId] ?? EMPTY_FEED, mapped),
        }));
      })
      .catch((err: unknown) => { recordRefusal('activity', isRefusedFeedRead(err)); }));

    // The panel leaves the loading state exactly once, when BOTH reads have
    // answered. `allSettled` over promises that already carry their own
    // `.catch` is what makes a FAILED read count as an answer: a 404 from
    // `sys_activity` (deployment without the audit plugin) or a rejected
    // `sys_comment` must land the panel on the empty state, and a REFUSED one
    // on the no-permission state (objectui#11195), never pin it in a permanent
    // spinner. Keyed off `feedFetchKey` so a settle
    // that arrives after the user has navigated to another record cannot
    // clear the new record's loading state.
    Promise.allSettled(inFlight).then(() => {
      if (!cancelled) setSettledFeedKey(feedFetchKey);
    });

    return () => { cancelled = true; };
  }, [dataSource, objectName, pureRecordId, currentUser, feedsEnabled, activitiesEnabled, feedFetchKey, reactionStore, feedWanted]);

  /**
   * Note: comment-mention → notification fan-out lives on the server
   * (`@objectstack/plugin-audit` registers a `sys_comment` afterInsert hook
   * that parses the `mentions` JSON and calls `messaging.emit('collab.mention')`
   * — ADR-0030 single ingress — which materializes one `sys_inbox_message` per
   * recipient that the bell then reads). The client's only job is to ensure
   * `sys_comment.mentions` carries the real id list (see handleAddComment
   * /handleAddReply below). Deployments without the messaging pipeline will not
   * deliver bell notifications, which is the expected degradation.
   */

  /**
   * The feed's writes this caller may be offered, read from the
   * affordance-to-grant map (objectui#12082; `resolveFeedWriteGates` above).
   * Booleans, so the handlers below key on what they read, not on an object.
   */
  const feedGates = resolveFeedWriteGates(objects, perms);
  const reactionRemoveGranted = feedGates.reactionRemove;

  /**
   * A comment is on the panel only once the server has it (objectui#10899,
   * maintainer ruling on cloud#2431: a failed comment write is never rendered
   * as sent).
   *
   * Both writers used to append an OPTIMISTIC row, then fire the `create` and
   * swallow its rejection. On a tenant with no `sys_comment` the write answered
   * 404 while the panel showed the comment and 「讨论 (1)」 — and the comment was
   * gone on reload, with nothing ever saying it had not been saved. Now the row
   * is appended after the `create` resolves; while it is in flight the composer
   * shows its own submitting state. A rejected write raises a localized error
   * and REJECTS back to the composer, which keeps the draft
   * (`RecordActivityTimeline` / `ThreadedReplies` treat a rejection as "not
   * written"), so the user can retry without retyping.
   *
   * The row keeps its client-minted id — the same id the `create` persists — so
   * the next re-read merges the stored copy onto it by id, and it still goes
   * into the slice of the record it was written ON (objectui#3268).
   */
  const commentWriteFailed = useCallback(
    (err: unknown): Error => {
      toast.error(
        t('detail.commentFailed', {
          defaultValue: 'Your comment was not posted. Nothing was saved — please try again.',
        }),
      );
      return err instanceof Error ? err : new Error(String(err));
    },
    [t],
  );

  const handleAddComment = useCallback(
    async (text: string) => {
      if (!dataSource || !feedRecordKey) {
        throw commentWriteFailed(new Error('No data source to write sys_comment through'));
      }
      const newItem: FeedItem = {
        id: crypto.randomUUID(),
        type: 'comment',
        actor: currentUser.name,
        actorAvatarUrl: 'avatar' in currentUser ? (currentUser as any).avatar : undefined,
        body: text,
        createdAt: new Date().toISOString(),
        // Written under the viewer's own id (the server stamps the session's),
        // asked through the same rule as a read row (objectui#12268).
        authoredByViewer: isCommentAuthor(currentUser.id, currentUser.id),
      };
      // Persist to backend (M10.10: snake_case fields per sys_comment schema)
      const threadId = `${objectName}:${pureRecordId}`;
      const mentionIds = extractMentions(text, mentionSuggestions);
      try {
        await dataSource.create('sys_comment', {
          id: newItem.id,
          thread_id: threadId,
          author_id: currentUser.id,
          author_name: currentUser.name,
          author_avatar_url: 'avatar' in currentUser ? (currentUser as any).avatar : undefined,
          body: text,
          mentions: JSON.stringify(mentionIds),
          created_at: newItem.createdAt,
        });
      } catch (err) {
        throw commentWriteFailed(err);
      }
      const key = feedRecordKey;
      setFeedItemsByRecord(prev => ({
        ...prev,
        [key]: [...(prev[key] ?? EMPTY_FEED), newItem],
      }));
    },
    [currentUser, dataSource, objectName, pureRecordId, feedRecordKey, mentionSuggestions, commentWriteFailed],
  );

  const handleAddReply = useCallback(
    async (parentId: string | number, text: string) => {
      if (!dataSource || !feedRecordKey) {
        throw commentWriteFailed(new Error('No data source to write sys_comment through'));
      }
      const newItem: FeedItem = {
        id: crypto.randomUUID(),
        type: 'comment',
        actor: currentUser.name,
        actorAvatarUrl: 'avatar' in currentUser ? (currentUser as any).avatar : undefined,
        body: text,
        createdAt: new Date().toISOString(),
        parentId,
        authoredByViewer: isCommentAuthor(currentUser.id, currentUser.id),
      };
      const threadId = `${objectName}:${pureRecordId}`;
      const mentionIds = extractMentions(text, mentionSuggestions);
      try {
        await dataSource.create('sys_comment', {
          id: newItem.id,
          thread_id: threadId,
          author_id: currentUser.id,
          author_name: currentUser.name,
          author_avatar_url: 'avatar' in currentUser ? (currentUser as any).avatar : undefined,
          body: text,
          mentions: JSON.stringify(mentionIds),
          created_at: newItem.createdAt,
          parent_id: parentId,
        });
      } catch (err) {
        throw commentWriteFailed(err);
      }
      // Same record-scoped write as `handleAddComment` — the reply and the
      // parent's bumped `replyCount` both belong to THIS record's slice
      // (objectui#3268), and both land only once the reply is stored.
      const key = feedRecordKey;
      setFeedItemsByRecord(prev => {
        const updated = [...(prev[key] ?? EMPTY_FEED), newItem];
        return {
          ...prev,
          [key]: updated.map(item =>
            item.id === parentId
              ? { ...item, replyCount: (item.replyCount ?? 0) + 1 }
              : item
          ),
        };
      });
    },
    [currentUser, dataSource, objectName, pureRecordId, feedRecordKey, mentionSuggestions, commentWriteFailed],
  );

  /**
   * The author's Edit on their own comment or reply (objectui#12268).
   *
   * The panel offers it on a `comment` row the read marked `authoredByViewer`,
   * and only while the caller holds the update grant on `sys_comment`
   * (`feedGates.commentEdit`). The server's rule stays the authority: the
   * platform's comment access hooks let the author, or a user who may edit the
   * parent record, update a comment, and refuse anyone else.
   *
   * Same shape as the composers above (objectui#10899): the row's text changes
   * only after the server has stored it. A refused write raises a localized
   * error and REJECTS back to the editor, which keeps the draft, and the row
   * keeps its old text.
   *
   * The write sends the new text and nothing that marks the comment edited:
   * the platform stamps `is_edited` and `edited_at` itself when the body
   * changes, and both fields are read-only to the client (ruling A on
   * objectstack-ai/objectstack#23124). The row reads as edited from the
   * stored record the update answers with, the same field the next read
   * shows it from, so the mark never says what the row does not. `mentions`
   * is rewritten from the new text, so the row's id list stays the text's.
   */
  const handleEditComment = useCallback(
    async (itemId: string | number, text: string) => {
      const editFailed = (err: unknown): Error => {
        toast.error(
          t('detail.commentEditFailed', {
            defaultValue: 'Your edit was not saved. The comment keeps its previous text.',
          }),
        );
        return err instanceof Error ? err : new Error(String(err));
      };
      if (!dataSource || !feedRecordKey) {
        throw editFailed(new Error('No data source to write sys_comment through'));
      }
      const key = feedRecordKey;
      // A `sys_comment` id only: any other row is refused without a write, as
      // the reaction handler refuses one (objectui#11035).
      const row = (feedItemsByRecord[key] ?? EMPTY_FEED).find(item => item.id === itemId);
      if (!row || row.type !== 'comment') return;
      let stored: { is_edited?: unknown } | null | undefined;
      try {
        stored = await dataSource.update(COMMENT_OBJECT, String(itemId), {
          body: text,
          mentions: JSON.stringify(extractMentions(text, mentionSuggestions)),
        });
      } catch (err) {
        throw editFailed(err);
      }
      const edited = stored?.is_edited === true;
      setFeedItemsByRecord(prev => ({
        ...prev,
        [key]: (prev[key] ?? EMPTY_FEED).map(item =>
          item.id === itemId ? { ...item, body: text, edited } : item,
        ),
      }));
    },
    [dataSource, feedRecordKey, feedItemsByRecord, mentionSuggestions, t],
  );

  /**
   * The author's Delete on their own comment or reply (objectui#12268), offered
   * on the same rows under the delete grant (`feedGates.commentDelete`).
   *
   * It asks first, through the console's ordinary destructive-action confirm:
   * this page's own `confirmHandler`, the `ActionConfirmDialog` the record's
   * Delete opens, painted destructive. A cancel settles `false` and nothing is
   * sent. The row leaves the panel only once the server has deleted it; a
   * refused delete raises a localized error and leaves the row where it was.
   * A deleted reply takes one off its parent's `replyCount`, the count
   * `handleAddReply` adds one to.
   */
  const handleDeleteComment = useCallback(
    async (itemId: string | number) => {
      if (!dataSource || !feedRecordKey) return;
      const key = feedRecordKey;
      const row = (feedItemsByRecord[key] ?? EMPTY_FEED).find(item => item.id === itemId);
      if (!row || row.type !== 'comment') return;
      const confirmed = await confirmHandler(
        t('detail.deleteCommentConfirm', {
          defaultValue: 'Are you sure you want to delete this comment?',
        }),
        {
          title: t('detail.deleteComment', { defaultValue: 'Delete comment' }),
          confirmText: t('objectActions.deleteConfirmButton', { defaultValue: 'Delete' }),
          destructive: true,
        },
      );
      if (!confirmed) return;
      try {
        if ((await dataSource.delete(COMMENT_OBJECT, String(itemId))) === false) {
          throw new Error('The comment was not deleted.');
        }
      } catch (err) {
        toast.error(
          t('detail.commentDeleteFailed', {
            defaultValue: 'The comment was not deleted. Please try again.',
          }),
        );
        throw err instanceof Error ? err : new Error(String(err));
      }
      const parentId = row.parentId;
      setFeedItemsByRecord(prev => ({
        ...prev,
        [key]: (prev[key] ?? EMPTY_FEED)
          .filter(item => item.id !== itemId)
          .map(item =>
            parentId != null && item.id === parentId
              ? { ...item, replyCount: Math.max(0, (item.replyCount ?? 0) - 1) }
              : item,
          ),
      }));
    },
    [dataSource, feedRecordKey, feedItemsByRecord, confirmHandler, t],
  );

  /**
   * A reaction click shows at once and is stored in the background, and a
   * reaction whose write fails does not stay shown as applied (objectui#10899,
   * the same family as the comment writers above).
   *
   * The toggle is computed HERE, in the handler, from the row on screen, and
   * the write is issued here too. It used to be issued from inside the state
   * updater, which React may call twice (StrictMode does in development, so
   * one click sent two `update`s; the StrictMode row of
   * `RecordDetailView.reactionWriteFailure-10899.test.tsx` pins one), and to
   * end in `.catch(() => {})`, so a refused write left the reaction on screen
   * as applied, with no message, until a reload.
   *
   * Each write stores the row's WHOLE reaction set as of its click, so after
   * several quick clicks the server holds the set of the newest write it
   * accepted. The rollback follows that: every click records the set it
   * showed, and once a write is refused the row shows the newest recorded set
   * whose write was not refused. A refused click is therefore taken back only
   * when no later click, whose write carries it too, can still store it. Two
   * simpler rollbacks each break a real case: undoing one click at a time (the
   * inverse toggle) takes back a reaction a later write did store, and
   * restoring the pre-click set only while the row is unchanged leaves the
   * first of two refused clicks on screen. The rollback is also skipped when
   * the row no longer shows what this ledger put there, because a re-read
   * replaced it and the server copy is the truth.
   *
   * The error is raised only when a rollback takes back something the user
   * sees; a refused write whose click a later write stored lost nothing.
   *
   * The set a write stores is the row's stored ids as the read kept them, with
   * only the clicker's id added or taken out of the clicked emoji
   * (`toggleOwnReaction`, objectui#11019), so every other user's reaction is
   * written back as it was read. Two people reacting at the same moment still
   * means the later write wins.
   *
   * All of the above is the `column` store, which runs only where the
   * deployment has no `sys_comment_reaction`. On the `records` store
   * (objectui#12078) a click writes nothing but the clicker's own row: it
   * creates that row, or deletes it, so no write can replace another member's
   * reaction and two members reacting at once both stay stored. The writes of
   * one comment and emoji run one after another (a take-back deletes the row an
   * earlier click is still creating). Once the last of them answers, the row
   * must show the clicker's reaction exactly when the server holds their row;
   * if it does not, a write was refused, and the clicker's own id on that emoji
   * is put back as stored and the same error is raised. As on the column store,
   * that is skipped when a re-read already replaced what the click showed.
   */
  const reactionLedgersRef = useRef(new Map<string, ReactionLedger>());
  const reactionQueuesRef = useRef(new Map<string, ReactionRecordQueue>());

  const handleToggleReaction = useCallback(
    (itemId: string | number, emoji: string) => {
      // No data source to store through, or no record: not a write failure.
      if (!dataSource || !feedRecordKey) return;
      // Reactions are toggled from the panel of the record on screen, so they
      // apply to that record's slice only (objectui#3268) — an id collision
      // with a row cached for another record cannot reach across.
      const key = feedRecordKey;
      const row = (feedItemsByRecord[key] ?? EMPTY_FEED).find(item => item.id === itemId);
      // Only a `sys_comment` row carries reactions, and those are the feed's
      // `comment` rows. The panel offers the control on comment rows only;
      // this refuses any other id without a write, so a `sys_activity` id can
      // never key a `sys_comment` update or a reaction row (objectui#11035).
      if (!row || row.type !== 'comment') return;

      if (reactionStore === 'records') {
        const userId = currentUser.id;
        const want = !holdsOwnReaction(row.reactions, emoji, userId);
        // The control is offered on the add row (`feedReactionAdd`, where it is
        // handed over below); taking a reaction back is the delete of the
        // caller's own row, its own row of the map. A click that would take
        // back with that row closed writes nothing and shows nothing changed,
        // rather than showing a take-back the server then refuses
        // (objectui#12082).
        if (!want && !reactionRemoveGranted) return;
        const commentKey = JSON.stringify([key, String(itemId)]);
        const writeKey = JSON.stringify([key, String(itemId), emoji]);
        const ownRows = () => {
          let mine = ownReactionRowsRef.current.get(commentKey);
          if (!mine) {
            mine = new Map<string, string>();
            ownReactionRowsRef.current.set(commentKey, mine);
          }
          return mine;
        };
        const shown = toggleOwnReaction(row.reactions, emoji, userId);
        setFeedItemsByRecord(prev => ({
          ...prev,
          [key]: (prev[key] ?? EMPTY_FEED).map(item => (item.id === itemId ? { ...item, reactions: shown } : item)),
        }));

        let queue = reactionQueuesRef.current.get(writeKey);
        if (!queue) {
          queue = { tail: Promise.resolve(), pending: 0, shown: want };
          reactionQueuesRef.current.set(writeKey, queue);
        }
        const q = queue;
        q.pending += 1;
        q.shown = want;
        // Each write decides when its turn comes, from the row the server
        // holds by then: a click whose wish is already stored writes nothing.
        const write = async () => {
          const rowId = ownRows().get(emoji);
          if (want && rowId === undefined) {
            const created: { id?: unknown } | undefined = await dataSource.create(COMMENT_REACTION_OBJECT, {
              comment_id: String(itemId),
              emoji,
            });
            if (created?.id == null || created.id === '') {
              throw new Error(`The ${emoji} reaction was stored without an id, so it cannot be taken back.`);
            }
            ownRows().set(emoji, String(created.id));
          } else if (!want && rowId !== undefined) {
            if ((await dataSource.delete(COMMENT_REACTION_OBJECT, rowId)) === false) {
              throw new Error(`The ${emoji} reaction was not deleted.`);
            }
            ownRows().delete(emoji);
          }
        };
        q.tail = q.tail
          .then(write)
          // A refused write leaves the server's row as it was; the check
          // below reads that, so the rejection itself carries nothing more.
          .catch(() => {})
          .then(() => {
            q.pending -= 1;
            if (q.pending > 0) return;
            reactionQueuesRef.current.delete(writeKey);
            const stored = ownRows().has(emoji);
            if (stored === q.shown) return;
            setFeedItemsByRecord(prev => {
              const rows = prev[key];
              const current = rows?.find(item => item.id === itemId);
              if (!rows || !current || holdsOwnReaction(current.reactions, emoji, userId) !== q.shown) return prev;
              return {
                ...prev,
                [key]: rows.map(item =>
                  item === current ? { ...item, reactions: toggleOwnReaction(item.reactions, emoji, userId) } : item,
                ),
              };
            });
            toast.error(
              t('detail.reactionFailed', {
                defaultValue: 'Your reaction was not saved. Please try again.',
              }),
            );
          });
        return;
      }
      if (reactionStore !== 'column') return;

      const rowKey = JSON.stringify([key, String(itemId)]);
      let ledger = reactionLedgersRef.current.get(rowKey);
      if (!ledger || ledger.shown !== row.reactions) {
        ledger = { steps: [{ reactions: row.reactions, outcome: 'stored' }], shown: row.reactions };
        reactionLedgersRef.current.set(rowKey, ledger);
      }
      const step: ReactionStep = {
        reactions: toggleOwnReaction(row.reactions, emoji, currentUser.id),
        outcome: 'pending',
      };
      ledger.steps.push(step);
      ledger.shown = step.reactions;
      setFeedItemsByRecord(prev => ({
        ...prev,
        [key]: (prev[key] ?? EMPTY_FEED).map(item =>
          item.id === itemId ? { ...item, reactions: step.reactions } : item,
        ),
      }));

      const settle = (outcome: 'stored' | 'failed') => {
        const live = reactionLedgersRef.current.get(rowKey);
        const at = live ? live.steps.indexOf(step) : -1;
        // A re-read restarted the row, or a newer stored write superseded this one.
        if (!live || at < 0) return;
        step.outcome = outcome;
        // A stored write holds the row's whole set as of its click.
        if (outcome === 'stored') live.steps.splice(0, at);
        if (!live.steps.some(s => s.outcome === 'pending')) reactionLedgersRef.current.delete(rowKey);
        // `steps[0]` is stored, so there is always a newest set not refused.
        const target = [...live.steps].reverse().find(s => s.outcome !== 'failed') as ReactionStep;
        if (target.reactions === live.shown) return;
        const from = live.shown;
        live.shown = target.reactions;
        setFeedItemsByRecord(prev => {
          const rows = prev[key];
          if (!rows?.some(item => item.id === itemId && item.reactions === from)) return prev;
          return {
            ...prev,
            [key]: rows.map(item =>
              item.id === itemId && item.reactions === from ? { ...item, reactions: target.reactions } : item,
            ),
          };
        });
        toast.error(
          t('detail.reactionFailed', {
            defaultValue: 'Your reaction was not saved. Please try again.',
          }),
        );
      };

      dataSource
        .update('sys_comment', String(itemId), {
          reactions: JSON.stringify(storedReactions(step.reactions ?? [])),
        })
        .then(
          () => settle('stored'),
          () => settle('failed'),
        );
    },
    [currentUser.id, dataSource, feedRecordKey, feedItemsByRecord, reactionStore, reactionRemoveGranted, t],
  );

  useEffect(() => {
    // Reset loading on navigation; the page-record effect above owns data fetching
    setIsLoading(true);
    queueMicrotask(() => setIsLoading(false));
  }, [objectName, recordId]);

  // Build the synthesized-page inputs — the object-derived parts that
  // `buildDefaultPageSchema` folds into the default record page when no
  // authored Page is assigned. Must be before early returns to keep hook
  // count consistent across renders and avoid React error #310.
  const synthParts = useMemo(() => {
    if (!objectDef) {
      return {} as {
        sections?: Array<Record<string, any>>;
        highlightFields?: string[];
        headerActions?: ActionDef[];
        related?: Array<{ title?: string; objectName: string; relationshipField: string; columns?: any[]; icon?: string; isPrimary?: boolean }>;
        history?: { entries: any[]; loading: boolean; unknownUserText?: string };
        approvals?: { count?: number; node?: Record<string, any> };
      };
    }

    // Build sections (ADR-0085: grouping is the `fieldGroups` semantic
    // role — there is no per-surface sections override; per-page
    // customization goes through an assigned Page schema):
    //   1) sections derived from the object's `fieldGroups`;
    //   2) auto-grouping (primary + collapsible "More details").
    const sections = deriveRecordDetailSections(objectDef, {
      moreDetails: sectionLabel(objectDef.name, 'details', t('detail.sectionMoreDetails', 'More details')),
    });

    // Audit fields (created_at/created_by/updated_at/updated_by) are NOT
    // appended as a section here — they are surfaced by `<RecordMetaFooter>`
    // (rendered once by this view, at the page foot, objectui#12307) as a
    // single subtle line below the content, replacing the old card-style
    // "System Information" panel. The inline-edit
    // drawer continues to hide them via `DEFAULT_SYSTEM_FIELDS` in
    // `@object-ui/plugin-detail/RecordDetailDrawer`.

    // Filter actions for the record page header and deduplicate by name.
    // Both header locations are included: `record_header` renders inline,
    // `record_more` renders inside the header's ⋯ overflow menu (the spec's
    // "overflow menu under the More/⋯ button" location — PageHeaderRenderer
    // routes record_more-only actions into the overflow; #2358 trap 2).
    const recordHeaderActions = (() => {
      const seen = new Set<string>();
      const base = (objectDef.actions || []).filter((a: any) => {
        if (!a.locations?.includes('record_header') && !a.locations?.includes('record_more')) return false;
        if (!a.name) return true;
        if (seen.has(a.name)) return false;
        seen.add(a.name);
        return true;
      }).map((a: any) => localizeActionTexts(objectDef.name, a));

      // ⛔ No approval actions are injected here any more (objectui#3055).
      // They used to be two hand-written buttons (approve/reject only, no
      // attachments, own copy, own CLIENT-side approver test) spliced into this
      // header list. They now render from `sys_approval_request`'s OWN declared
      // actions through `<DeclaredActionsBar>` below — the same metadata the
      // approvals list runs, gated by the same server-computed `viewer` block.
      //
      // The header list is the wrong carrier for them and cannot be fixed into
      // one: `action:bar` evaluates a `visible` predicate against THIS page's
      // record (a business record has no `viewer` block) and stamps that same
      // record into `params._rowRecord`, so a declared action targeting
      // `/api/v1/approvals/requests/{id}/…` would resolve `{id}` to the
      // business record's id. The request row has to be the dispatch record,
      // which is exactly what the bar does.
      return base;
    })();

    // Highlight-strip field names from the object's semantic role
    // (ADR-0085). Bare names pass through; `{ name }` descriptors reduce
    // to their name. Empty → undefined below, so the synthesizer
    // auto-derives instead.
    const rawHighlightFields = (objectDef as any).highlightFields ?? [];
    // Drop the record's title field: it is the page H1 and repeating it as
    // the first chip duplicated the name, truncated, right under the
    // heading. Mirrors deriveHighlightFields' declared-list handling —
    // this pre-computed list bypasses that derivation (#2548).
    const titleField = resolveTitleField(objectDef as any);
    const highlightFields: string[] = (Array.isArray(rawHighlightFields) ? rawHighlightFields : [])
      .map((f: any) => (typeof f === 'string' ? f : f?.name))
      .filter((n: any): n is string => typeof n === 'string' && n.length > 0 && n !== titleField);

    // Related child lists from reverse-reference relationships, in
    // `buildDefaultPageSchema`'s `related` shape. `relationshipField` is
    // the FK field on the child pointing back to this record — passed so
    // the related-list renderer can hide the redundant parent-ID column.
    // Each list's `record:related_list` renderer self-fetches lazily when
    // its tab is shown (nothing is preloaded here), and header/row
    // affordances (+ New / View All / row navigation) are wired
    // downstream by `RelatedRecordActionsBridge`.
    const related = childRelations.map(({ childObject, childLabel, referenceField, title: titleOverride, columns: columnsOverride, isPrimary, sort: inheritedSort, filter: declaredFilter }) => {
      const childObjectDef = objects.find((o: any) => o.name === childObject);
      // A `relatedListTitle` on the relationship wins; else fall back to the
      // localized child-object PLURAL label — the section lists the child's
      // records, so it is named as that object's list page is (objectui#11733).
      const localizedTitle = titleOverride
        || (childObjectDef
          ? objectPluralLabel({ name: childObjectDef.name, label: childObjectDef.label || childLabel, pluralLabel: childObjectDef.pluralLabel })
          : childLabel);
      return {
        title: localizedTitle,
        objectName: childObject,
        relationshipField: referenceField,
        // Explicit columns from `relatedListColumns` on the relationship; when
        // absent the related-list renderer auto-derives them from the child
        // object's fields.
        ...(Array.isArray(columnsOverride) && columnsOverride.length > 0
          ? { columns: columnsOverride }
          : {}),
        // Row order inherited from the child object's default list view
        // (objectui#5795, ruled direction 1 on objectstack#11345). Already
        // normalized to the array arm by `deriveRelatedLists` — the ListView
        // legacy string dialect (`'seq_no desc'`) is NOT the one the related
        // list's `normalizeSortSpec` reads, so it must never travel verbatim.
        // Absent when the child declares no list-view sort, keeping the
        // synthesized node byte-identical to what it was before.
        ...(inheritedSort && inheritedSort.length > 0 ? { sort: inheritedSort } : {}),
        // The list's own declared scope, from `relatedListFilter` on the FK
        // (objectui#4664). Forwarded onto the SAME `filter` key the
        // component-level `record:related_list` input already uses
        // (objectstack#7118), so both producers land on one read site and one
        // lowering — the declared shape is the platform's existing
        // `FilterCondition`, not a second dialect for derived pages.
        //
        // `RelatedList` ANDs it with `{ [referenceField]: parentId }`, and the
        // tab strip's count probe composes the SAME pair, so the badge and the
        // rows answer one question. Omitted when the FK declared nothing, for
        // the reason the sibling keys are: a `filter: undefined` written onto
        // the node is a different fact from "the author said nothing".
        ...(declaredFilter ? { filter: declaredFilter } : {}),
        ...(childObjectDef?.icon ? { icon: childObjectDef.icon } : {}),
        // `relatedList: 'primary'` prominence flag (ADR-0085) — the list is
        // promoted to its own tab by `buildDefaultTabs`.
        ...(isPrimary ? { isPrimary: true } : {}),
      };
    });

    return {
      sections,
      // Empty → undefined so the synthesizer falls back to its own
      // derivation (highlights) / skips the node (actions, related, history).
      highlightFields: highlightFields.length > 0 ? highlightFields : undefined,
      headerActions: recordHeaderActions.length > 0 ? (recordHeaderActions as ActionDef[]) : undefined,
      related: related.length > 0 ? related : undefined,
      ...(historyEnabled && {
        history: {
          entries: historyEntries ?? [],
          loading: (historyLoading || historyPending) && historyEntries === null,
          unknownUserText: t('detail.unknownUser', { defaultValue: 'Unknown' }),
        },
      }),
      // Approvals tab (#3461) — only when the record actually has requests,
      // so approval-free records carry no dead tab. The node carries the
      // LIVE hook result this view already holds (the same read behind the
      // header decision buttons); like `history`, data flows through the
      // synthesized schema, and the deps below rebuild the page when a
      // decision changes the request set or its tally.
      ...(approvals.available && approvals.requests.length > 0 && {
        approvals: {
          count: approvals.requests.length,
          node: {
            approvals: {
              available: approvals.available,
              requests: approvals.requests,
              pendingRequest: approvals.pendingRequest,
            },
            currentUserId: user?.id,
          },
        },
      }),
    };
  // `approvals.requests` / `approvals.pendingRequest` are in the deps for the
  // Approvals tab payload (#3461) — the tab's node carries the live rows, and
  // the panel's headline is the pending one. (The decision actions no longer
  // ride this list at all — objectui#3055 moved them to the declared-action
  // bar, which reads the pending row directly.)
  }, [objectDef?.name, childRelations, t, objectPluralLabel, objects, historyEnabled, historyEntries, historyLoading, historyPending, approvals.available, approvals.pendingRequest, approvals.requests, user?.id]);

  if (isLoading) {
    return <SkeletonDetail />;
  }

  if (!objectDef) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.objectNotFound')}</EmptyTitle>
          <EmptyDescription>
            {t('empty.objectNotFoundDescription', { name: objectName })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // objectui#12715 — the named record page route. While the pages load,
  // draw the skeleton (never the default page); a name that is not a record
  // page of this object shows the console's page-not-found state. Neither
  // stamps the print root, so a print driver never reads either as ready.
  if (namedPageState === 'pending') {
    return <SkeletonDetail />;
  }
  if (namedPageState === 'refused') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty data-testid="record-page-not-found">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.pageNotFound')}</EmptyTitle>
          <EmptyDescription>
            {t('empty.pageNotFoundDescription', { name: requestedPageName })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // Record-not-found short-circuit. Previously we rendered the page chrome
  // (rail, discussion, breadcrumb with the truncated raw id) even when the
  // record didn't exist, which made invalid links look like a partially-
  // broken page instead of a clean 404.
  if (pageRecordStatus === 'missing') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>{t('empty.recordNotFound', { defaultValue: 'Record not found' })}</EmptyTitle>
          <EmptyDescription>
            {t('empty.recordNotFoundDescription', {
              defaultValue:
                'The record you are looking for does not exist or may have been deleted.',
            })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // objectui#11902 — a REFUSED read. The refusal is about the object, not this
  // record, so the copy names the object and never implies the record exists:
  // it shows no more than the server's own 403 already says (objectstack#8013).
  // No Retry: retrying a permission decision cannot change it — the same
  // reasoning as the app-level `appAccessDenied` screen in `AppContent`.
  if (pageRecordStatus === 'forbidden') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty data-testid="record-access-denied">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>
            {t('empty.recordAccessDenied', {
              object: objectLabel({ name: objectName!, label: objectDef?.label || objectName! }),
              defaultValue: 'You don’t have access to {{object}} records',
            })}
          </EmptyTitle>
          <EmptyDescription>
            {t('empty.recordAccessDeniedDescription', {
              defaultValue:
                'You don’t have permission to view records of this type. Contact your administrator if you think you should have access.',
            })}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // objectui#11902 — the read FAILED (a 5xx, a transport error, …): say so,
  // and offer Retry, which re-runs the page's own record load.
  if (pageRecordStatus === 'failed') {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty data-testid="record-load-failed">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          </div>
          <EmptyTitle>
            {t('empty.recordLoadFailed', { defaultValue: 'Couldn’t load this record' })}
          </EmptyTitle>
          <EmptyDescription>
            {t('empty.recordLoadFailedDescription', {
              defaultValue: 'Something went wrong while loading it. Check your connection and try again.',
            })}
          </EmptyDescription>
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              data-testid="record-load-failed-retry"
              onClick={() => reloadPageRecordRef.current?.()}
            >
              <RotateCw className="mr-1.5 h-4 w-4" />
              {t('common.retry', { defaultValue: 'Retry' })}
            </Button>
          </div>
        </Empty>
      </div>
    );
  }

  // A page always exists past the guards above — authored (assignedPage)
  // or synthesized (buildDefaultPageSchema).
  // Synthesized pages place `record:attachments` beside the discussion feed
  // (objectstack#4358); the legacy bottom-of-page append below stays only as
  // the fallback for authored pages that don't slot the panel themselves.
  const hasAttachments = hasExplicitAttachments(effectivePage as any);

  // System actions (Edit / Share / Delete) — synthesized for every record
  // page so objects without authored record_header actions still surface
  // the basic affordances.
  //
  // Placement metadata (objectui#2361): the page header now renders up to
  // `maxVisible` inline buttons sorted by `order` (lower = more prominent).
  // Authored business actions default to `order: 0`, so giving the system
  // set high orders (100+) keeps them behind every business action, and
  // `component: 'action:menu'` pins Share/Delete inside the `⋯` overflow
  // menu permanently — Delete must never surface as an inline red button
  // just because an object has few actions.
  const synthSystemActions: ActionDef[] = (() => {
    const objectAffordances = resolveRecordHeaderActionGates(objectDef, perms);
    // Object-level gate AND the record-level verdict (objectstack#3821) AND the
    // object's per-record `userActions` predicate (objectui#4213 — see the
    // evaluation block beside `recordDeleteAllowed` above).
    //
    // The predicate is a FOURTH conjunct: the affordance and permission gates
    // above are untouched, so a predicate that holds can never resurrect a
    // button the bucket closed or the user may not press. It only ever
    // subtracts.
    const affordances = {
      edit: objectAffordances.edit && recordWriteAllowed && editVisible,
      delete: objectAffordances.delete && recordDeleteAllowed && deleteVisible,
    };
    const items: ActionDef[] = [];
    if (affordances.edit) {
      // Single primary Edit CTA → opens the full record form. Inline editing
      // is no longer a standalone header button; it is entered by
      // double-clicking a field (or its hover pencil) in the record body,
      // with the object-editability gate applied at the field-render source
      // (record-details.tsx). See #2401.
      items.push({
        name: 'sys_edit',
        label: t('detail.edit', { defaultValue: 'Edit' }),
        // objectui#12529 — each system entry declares its icon through the
        // same `icon` key the app's actions use, so every row draws one kind
        // of entry. `page:header` keeps this CTA a labelled button in the row
        // at every width: it takes none of the app's `maxVisible` slots and
        // never folds into the `⋯` (objectui#12617). It is the filled primary
        // button only when the record has no app action ahead of it; next to
        // app actions it is an outline button, which `page:header` decides —
        // no `variant` is declared here for it to read.
        icon: 'pencil',
        type: 'script',
        locations: ['record_header'],
        order: 100,
        // objectui#2572 item 4 — while a shared inline-edit draft is live,
        // the page:header renderer greys this CTA out so the classic form
        // can't be stacked on top of the draft (two competing edit sessions
        // with no reconciliation).
        disableDuringInlineEdit: true,
        // framework#3794 — an approval-LOCKED record refuses every write (the
        // server answers RECORD_LOCKED), so opening the form only to be
        // rejected on Save after filling a screen is wasted work. Disabled
        // rather than hidden: the user should see the affordance exists and is
        // off, with the lock band next to it saying why. Note this is the
        // LOCK, not the mere presence of an approval — a `lockRecord: false`
        // node keeps Edit live, which is the point of that setting.
        //
        // objectui#4213 — `edit.disabledWhen` composes onto this SAME key
        // rather than opening a second one: `visibleWhen` decides existence,
        // `disabledWhen` decides pressability, and either reason for "off" is
        // the same off. OR, not AND: an approval lock and a declared predicate
        // are independent reasons, and neither may cancel the other. With no
        // predicate declared `editDisabledByPredicate` is `false`, so this is
        // byte-identical to the pre-#4213 `disabled: approvalLocked`.
        disabled: approvalLocked || editDisabledByPredicate,
        onClick: () => onEdit({ id: pureRecordId }),
      } as any);
    }
    // The record's favorites entry (objectui#12427), in the `⋯` overflow ahead
    // of Share. A record is never a navigation entry, so this toggles the
    // `record:` favorite, which the sidebar draws in its Favorites section at
    // the top.
    if (favoriteRecord) {
      items.push({
        name: 'sys_favorite',
        label: isRecordFavorite
          ? t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' })
          : t('common.addToFavorites', { defaultValue: 'Add to favorites' }),
        icon: 'star',
        type: 'script',
        locations: ['record_header'],
        variant: 'outline',
        order: 105,
        component: 'action:menu',
        onClick: handleToggleRecordFavorite,
      } as any);
    }
    items.push({
      name: 'sys_share',
      label: t('detail.share', { defaultValue: 'Share' }),
      icon: 'share',
      type: 'script',
      locations: ['record_header'],
      variant: 'outline',
      order: 110,
      component: 'action:menu',
      onClick: async () => {
        try {
          if ((navigator as any).share) {
            await (navigator as any).share({
              title: document.title,
              url: window.location.href,
            });
            return;
          }
        } catch {
          // user dismissed the native share sheet — no-op
          return;
        }
        // Fallback path: clipboard. Surface failure to the user so we
        // never silently no-op (e.g. when clipboard access is denied
        // because the page is not focused or running over http://).
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast.success(t('detail.linkCopied', { defaultValue: 'Link copied to clipboard' }));
        } catch (err: any) {
          toast.error(
            t('detail.linkCopyFailed', { defaultValue: 'Failed to copy link' }) +
              (err?.message ? `: ${err.message}` : ''),
          );
        }
      },
    } as any);
    if (affordances.delete) {
      items.push({
        name: 'sys_delete',
        label: t('detail.delete', { defaultValue: 'Delete' }),
        // Last in the `⋯`, behind a separator: `page:header` sets every
        // destructive entry apart at the bottom of the menu (objectui#12529).
        icon: 'trash',
        type: 'script',
        locations: ['record_header'],
        variant: 'destructive',
        order: 120,
        component: 'action:menu',
        // objectui#4213 — `delete.disabledWhen` greys the overflow entry, the
        // kebab's rule for the same key. Spread only when it HOLDS: this action
        // declared no `disabled` key before, and `page:header` reads a declared
        // `disabled` by `!= null`, so emitting a bare `false` would say
        // something the object never declared. With no predicate the emitted
        // ActionDef is byte-identical to the pre-#4213 one.
        ...(deleteDisabledByPredicate ? { disabled: true } : null),
        onClick: async () => {
          // objectui#11695 — the list's delete copy, from the one shared core
          // (`recordDelete.confirmCopy`): the title names this record by the
          // ADR-0079 resolver over the READABLE row the header title reads
          // (a denied name field reads as absent here too) plus the object
          // label, the body is the list's question, and the confirm button is
          // "Delete", painted destructive.
          const copy = recordDelete.confirmCopy(
            {
              objectName: objectName!,
              t,
              label: objectLabel({ name: objectName!, label: objectDef?.label || objectName! }),
              objectDef,
            },
            { record: (readablePageRecord as Record<string, unknown> | null | undefined) ?? { id: pureRecordId } },
          );
          // objectui#11001 — asked through this page's own confirm runtime,
          // the in-app `ActionConfirmDialog` the list view's delete asks
          // through too, never the browser's native `window.confirm` (which
          // cannot be themed, and which headless automation dismisses, so the
          // button reads as dead). A cancel settles `false` and leaves the
          // record and the page alone.
          if (
            !(await confirmHandler(copy.message, {
              title: copy.title,
              confirmText: copy.confirmText,
              destructive: true,
            }))
          ) return;
          try {
            await dataSource.delete(objectName!, pureRecordId!);
            toast.success(t('detail.deleted', { defaultValue: 'Record deleted' }));
            const baseAppUrl = appName ? `/apps/${appName}` : '';
            navigate(`${baseAppUrl}/${objectName}`, { replace: true });
          } catch (err: any) {
            toast.error(err?.message || 'Delete failed');
          }
        },
      } as any);
    }
    return items;
  })();

  // The synth path hands ONLY business actions (authored on objectDef and
  // routed to the record_header location, e.g. Lead.convert) to the page
  // schema. System actions (Edit / Share / Delete) ride through
  // `RecordContext.headerSystemActions` instead, so they reach both
  // synth/slotted pages AND authored full-Lightning pages without
  // mutating the assignedPage tree. `PageHeaderRenderer` dedupes by
  // name so authored business actions still win on collision.
  const composedPage = assignedPage
    ? effectivePage
    : buildDefaultPageSchema(objectDef as any, {
        sections: synthParts.sections,
        highlightFields: synthParts.highlightFields,
        headerActions: synthParts.headerActions,
        related: synthParts.related,
        history: synthParts.history,
        approvals: synthParts.approvals,
        // ADR-0085 removed the per-object `detail.*` presentation
        // toggles (show/hideReferenceRail, hideRelatedTab, relatedLayout)
        // — the synth defaults apply; per-page layout goes through an
        // assigned Page schema (`record:reference_rail` stays available
        // there as a renderer capability).
        ...(assignedSlots ? { slots: assignedSlots } : {}),
      });

  // objectui#7298 — A RECORD PAGE SHOWS A DISCUSSION PANEL BECAUSE IT COMPOSES
  // ONE. Maintainer ruling 2026-09-12 (decision batch #120 item 5): *"a page is
  // what its author composes … nothing is appended by default and then removed
  // by a negative flag."* This view used to append `RecordChatterRenderer`
  // below the page whenever the tree placed no `record:discussion` /
  // `record:chatter` node, and the only documented way out was
  // `assignedPage.disableDiscussion = true` — a key `PageSchema` is a
  // `strictObject` about, so authoring it is a hard PARSE ERROR, not a dropped
  // key. The append is gone with the read; the node is now the whole answer,
  // and the panel's own `feed` config is honoured as authored. The synthesized
  // default page still shows the panel because `buildDefaultPageSchema`
  // composes `record:discussion` itself — out-of-the-box record pages are
  // unchanged; AUTHORED pages that relied on the append add one node.
  //
  // `enable.feeds` (objectstack-ai/objectstack#2707) stays the OBJECT's switch and OUTRANKS the page: an
  // object with feeds off shows no panel, declared or not. That is the one half
  // of the ruling this tree did not already do — the old `feedsEnabled` gate
  // sat on the append alone, so a declared (or synthesized) node rendered a
  // panel on a feeds-off object, over a feed the view deliberately never
  // fetched. Pruning the composed tree is what makes the precedence real rather
  // than documented, and it is identity-preserving: a feeds-ON page is handed
  // through untouched.
  const renderedPage = feedsEnabled ? composedPage : stripDiscussionNodes(composedPage);

  // Same split as attachments, but introspected on `renderedPage` — the tree
  // actually rendered — NOT `effectivePage` (#3461): the Approvals tab exists
  // only in the synthParts-aware rebuild above (it depends on runtime request
  // data), so the early `effectivePage` synth never contains it and checking
  // that tree would double-render the panel (tab + bottom fallback).
  const hasApprovalsNode = hasExplicitApprovals(renderedPage as any);

  // objectui#11958 (card ② of the objectstack#8346 ruling, M1, zero server) —
  // the record page's "print" action. The page this view renders for the
  // record is the page bound to it, and when that page declares `print` it is
  // a print page: `PageRenderer` mounts its print stylesheet, which puts only
  // the page on paper (this view's own chrome and fallback panels included in
  // what it hides). The action is the browser's print preview of it, and it is
  // offered only where the page declares `print`, so every other record page
  // is unchanged.
  const pagePrint = (renderedPage as { print?: unknown } | null | undefined)?.print;
  const pageDeclaresPrint = typeof pagePrint === 'object' && pagePrint !== null && !Array.isArray(pagePrint);
  const printHint = t('common.printDialogHint');

  // Shared cross-cutting chrome: lifecycle badge + presence avatars —
  // rendered above the page tree so custom Page-assigned record pages
  // don't lose these affordances. The badge is an authoring aid and
  // draws for an authoring caller only (objectui#12194); the gate
  // lives in `ManagedByBadge`, so an end user sees none here. Inside
  // Setup it is not drawn at all: its note rides the header's
  // object-label chip (`objectLabelNote` below, objectui#13385).
  const sharedChrome = (
    <>
      {recordPresence.length > 0 && (
        <PresenceAvatars users={recordPresence} size="sm" maxVisible={3} showStatus />
      )}
      {!inSetupApp && <ManagedByBadge managedBy={(objectDef as any)?.managedBy} />}
    </>
  );

  return (
    <div className="h-full bg-background overflow-hidden flex flex-col relative">
      {/* On a print page the shared chrome joins the print chrome row below,
          so the row's buttons are not drawn under it. */}
      {!pageDeclaresPrint && (
        <div className="absolute top-2 sm:top-4 right-2 sm:right-4 z-50 flex items-center gap-2">
          {sharedChrome}
        </div>
      )}

      <RecordContextProvider
        objectName={objectName!}
        recordId={pureRecordId}
        data={readablePageRecord}
        objectSchema={objectDef}
        dataSource={dataSource}
        embedded={embedded}
        refresh={headerRefresh}
        headerSystemActions={synthSystemActions}
        objectLabelNote={inSetupApp ? managedByNote ?? undefined : undefined}
      >
        {/* No `isFavorite` / `onToggleFavorite` here (objectui#12427): the
            record's favorites entry is the `sys_favorite` item in the header's
            `⋯` overflow, and the `page:header` chrome draws its star only for
            a host that wires `onToggleFavorite`, so this page draws none. */}
        {/* objectui#2407 P2 — ONE record-level inline-edit session spanning
            the highlights strip AND the details body (both descend from this
            provider), committed together by the single <InlineEditSaveBar>
            below. `canEdit` carries the object-lifecycle / permission gate
            AND the approval lock (objectui#2572 item 2): a locked record
            hides the pencil affordances and no-ops `enter()`, so users can't
            type into a draft that Save would reject with RECORD_LOCKED.
            `locked` surfaces the approval lock as its own signal so the
            DetailView approval band renders from the SAME dual-source
            `approvalLocked` that gated `canEdit` — engaging even on backends
            that track the lock via approval requests only and never
            materialize an `approval_status` field (objectui#2618).
            `approvalPending` rides alongside it so a node that declares
            `lockRecord: false` still shows its band and recall button while
            leaving the record editable (objectui#2902).

            objectui#4213 — the object's per-record `userActions.edit` predicate
            joins the SAME conjunction, and joins it exactly where
            `approvalLocked` already sits. This expression mirrors the header's
            `sys_edit` gate on purpose (the header CTA and the body pencils are
            one edit affordance in two places), so folding the predicate into
            only one of them would re-create, inside a single file, precisely
            the header-vs-row asymmetry #4213 is about: Edit gone from the
            header while double-click still opened a draft the object says this
            record may not have. `disabledWhen` suppresses the pencils for the
            same reason `approvalLocked` does — a draft Save would reject. */}
        <InlineEditProvider
          canEdit={
            resolveRecordHeaderActionGates(objectDef, perms).edit
            && recordWriteAllowed
            && !approvalLocked
            && editVisible
            && !editDisabledByPredicate
          }
          locked={approvalLocked}
          approvalPending={approvalPending}
          approvalReadAnswered={approvals.answered}
          approvalProgress={approvalProgress}
          approvalIsSubmitter={approvalIsSubmitter}
          lockedReason={t('detail.lockedTooltip', {
            defaultValue: 'This record has a pending approval request; editing is locked',
          })}
        >
        <HighlightFieldsProvider>
        <DiscussionContextProvider
          items={feedItems as any}
          loading={feedLoading}
          activityDenied={feedRefusal?.activity ?? false}
          commentsDenied={feedRefusal?.comments ?? false}
          // objectui#12082: each write is handed over only where its row of
          // the affordance-to-grant map allows it, and the panel draws the
          // composer, the reply input and the reaction picker from the
          // handler's presence. The reaction control is the add row on the
          // records store (its take-back asks the remove row per click), and
          // the column row where the deployment stores reactions in a column.
          onAddComment={feedGates.comment ? (handleAddComment as any) : undefined}
          onAddReply={feedGates.comment ? (handleAddReply as any) : undefined}
          // objectui#12268: the author's Edit and Delete, each under its own
          // grant; the panel offers them only on the rows the read marked
          // `authoredByViewer`.
          onEditComment={feedGates.commentEdit ? handleEditComment : undefined}
          onDeleteComment={feedGates.commentDelete ? handleDeleteComment : undefined}
          onToggleReaction={
            (reactionStore === 'records'
              ? feedGates.reactionAdd
              : reactionStore === 'column' && feedGates.reactionColumn)
              ? (handleToggleReaction as any)
              : undefined
          }
          mentionSuggestions={mentionSuggestions}
        >
        {/* No `approval` handler in the set below (objectui#3055): the record
            page has no bespoke approval action TYPE any more. A decision is an
            ordinary `type:'api'` action declared on `sys_approval_request` and
            run by the shared runtime the decision bar mounts.
            `org` is the spec-declared `${ctx.org.*}` scope. This provider
            shadows the shell runtime's for every action on the record page, so
            it carries the same `actionContextOrg` projection, or
            `${ctx.org.id}` interpolates empty here (objectui#10918). */}
        <ActionProvider
          context={{
            record: pageRecord || {},
            objectName,
            // This object's field definitions, published beside `objectName`
            // (objectui#11122): the runner's `operation: 'update'` Undo capture
            // reads them to capture a relation `$expand` filled as its stored id.
            ...(objectDef?.fields ? { objectFields: objectDef.fields } : {}),
            // Its declared actions (objectui#13022): the same capture reads the
            // `patch` of the declaration an update action's `name` names,
            // which is what the platform action route writes.
            ...(Array.isArray(objectDef?.actions) ? { objectActions: objectDef.actions } : {}),
            user: currentUser,
            org: actionContextOrg(activeOrganization),
          }}
          onConfirm={confirmHandler}
          onToast={toastHandler}
          onNavigate={navigateHandler}
          onParamCollection={paramCollectionHandler}
          onResultDialog={resultDialogHandler}
          onModal={modalHandler}
          handlers={{ api: apiHandler, flow: flowHandler, script: serverActionHandler, modal: modalActionHandler }}
        >
          <div className="flex-1 overflow-hidden flex flex-row">
            <div className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6 scroll-pb-48">
              {originFrom?.pathname && originFrom?.label && (
                <Link
                  to={originFrom.pathname}
                  className="inline-flex items-center gap-1 mb-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>{originFrom.label}</span>
                </Link>
              )}
              {/* objectui#12906 — the print page's screen-only chrome. A page
                  that declares `print` holds only the printable component
                  types, and `page:header` is not one of them, so the record's
                  header actions have no block to draw them on such a page.
                  This row draws them: the object's declared `record_header` /
                  `record_more` actions and the system set the
                  `RecordContextProvider` above hands over (Edit / Share /
                  Delete), through `PageHeaderActions`, the ONE resolver
                  `page:header` draws them with, so each is gated, ordered,
                  folded and dispatched exactly as on any other record page.
                  The row sits outside the print page's root, as the Print
                  button beside it does, so the print stylesheet hides it on
                  paper by the same rule (objectui#11958). A page without
                  `print` draws none of it and keeps its own `page:header`. */}
              {pageDeclaresPrint && (
                <div
                  className="mb-4 flex flex-wrap items-center justify-end gap-2"
                  data-record-print-chrome=""
                >
                  {sharedChrome}
                  <PageHeaderActions actions={synthParts.headerActions} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => window.print()}
                    aria-label={`${t('list.print')}: ${printHint}`}
                    title={printHint}
                    data-testid="record-print-button"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('list.print')}</span>
                  </Button>
                </div>
              )}
              {/* The pending approval's DECISION ACTIONS (objectui#3055).
                  `sys_approval_request` declares them as object metadata —
                  approve / reject (with decision attachments) / reassign /
                  send back / request info, plus the submitter's recall and
                  resubmit — and this is the same bar, the same runtime and the
                  same server-computed `visible` gate the approvals list runs
                  them through. The record page adds no per-action code, so a
                  ninth decision action ships as metadata alone.

                  The dispatch record is the REQUEST row, not the business
                  record: that is what makes `{id}` resolve to the request and
                  what gives each action's `visible` the server's `viewer`
                  block (`can_act` / `is_submitter` / `can_override`) to read.
                  Placed above the page body rather than in the header for that
                  reason — see the header-actions comment above — and above the
                  fold, because a pending decision is why the approver opened
                  the record.

                  `approval_remind` is excluded: the approvals panel already
                  renders a richer remind (throttle-aware copy, timeline
                  refresh), and `exclude` is how a host keeps one of an
                  object's declared actions in its own UI without the bar
                  double-rendering it. */}
              {approvals.available && approvals.pendingRequest && (
                <DeclaredActionsBar
                  className="mb-4"
                  objectName={SYS_APPROVAL_REQUEST_OBJECT}
                  record={approvals.pendingRequest}
                  location={RECORD_APPROVAL_ACTION_LOCATION}
                  exclude={[...RECORD_APPROVAL_EXCLUDED_ACTIONS]}
                  onDone={handleApprovalActionDone}
                />
              )}
              <RelatedRecordActionsBridge
                appName={appName}
                objects={objects}
                dataSource={dataSource}
                parentObjectName={objectName}
                parentRecordId={pureRecordId ?? undefined}
                parentTitle={recordTitle}
                /* [#4646] The related-list toolbars under this page evaluate
                   their child objects' `userActions.create` predicates against
                   THIS record — the spec's "record in scope where the toolbar
                   renders". Same record and same field definitions the header's
                   edit/delete predicates above are evaluated against, so one
                   page cannot hold two answers to "is this record frozen". */
                parentRecord={pageRecord}
                parentObjectFields={predicateFields}
              >
                <SchemaRenderer schema={withPageTabsUrlSync(renderedPage, { defaultTab: activeTabParam, onTabChange: handleTabChange }) as any} />
              </RelatedRecordActionsBridge>
              {/* Approval visibility fallback (objectui#3461) — synthesized
                  pages surface approvals as a TAB (`record:approvals` via
                  buildDefaultTabs); this bottom append fires only for
                  AUTHORED pages that don't place the node, so the read-gated
                  approval story is never lost to a custom layout. Renders
                  nothing when the record has no requests. */}
              {pureRecordId && !hasApprovalsNode && (
                <RecordApprovalsPanel
                  className="mt-6"
                  approvals={approvals}
                  currentUserId={user?.id}
                />
              )}
              {/* Generic Attachments panel (objectstack-ai/objectstack#2727) — opt-in via
                  `enable.files: true`; the server rejects attachments
                  targeting any other object (403 FILES_DISABLED).
                  Fallback only: synthesized pages already place a
                  `record:attachments` node beside the discussion feed
                  (objectstack#4358), so this bottom append fires only for
                  authored pages that omit the panel. */}
              {filesEnabled && !hasAttachments && pureRecordId && (
                <div className="mt-6" ref={setAttachmentsFallbackEl} data-record-attachments-fallback="">
                  <RecordAttachmentsPanel
                    objectName={objectName!}
                    recordId={pureRecordId}
                    // Withheld until the panel scrolls into view
                    // (objectui#13010, `attachmentsFallbackShown` above).
                    dataSource={attachmentsFallbackShown ? dataSource : undefined}
                    currentUserId={currentUser?.id}
                  />
                </div>
              )}
              {/* The record's provenance footer, ONCE for the page
                  (objectui#12307). A `record:details` node that reads this
                  page's record no longer draws its own, so a page with two
                  nodes shows one line and a node whose sections are all
                  hidden draws nothing. Placed at the page foot, after the
                  page tree and the bottom appends above, the way this host
                  already places its page-level additions; it is the record's,
                  so it does not move with the active tab. `readablePageRecord`
                  is the row every block on the page reads, and the footer
                  renders nothing when the record carries no audit field. */}
              <RecordMetaFooter
                data={readablePageRecord}
                objectSchema={objectDef}
                objectName={objectName}
              />
              {/* Record-level inline-edit Save/Cancel bar (objectui#2407 P2) —
                  commits the whole draft (highlights + body) in ONE atomic OCC
                  update; renders (sticky) only while editing. */}
              <InlineEditSaveBar
                dataSource={dataSource}
                objectName={objectName}
                recordId={pureRecordId}
                data={pageRecord}
                refresh={notifyRecordChanged}
                fieldLabelFor={(name: string) => (objectDef as any)?.fields?.[name]?.label || fieldLabel(objectName || '', name, name)}
                locked={approvalLocked}
                lockedHint={t('detail.lockedTooltip', {
                  defaultValue: 'This record has a pending approval request; editing is locked',
                })}
              />
            </div>
            <MetadataPanel
              open={showDebug}
              sections={[{ title: 'Page Schema', data: renderedPage }]}
            />
          </div>
          {modalElement}
        </ActionProvider>
        </DiscussionContextProvider>
        </HighlightFieldsProvider>
        </InlineEditProvider>
      </RecordContextProvider>

      {/* Action Confirm Dialog */}
      <ActionConfirmDialog
        state={confirmState}
        onOpenChange={(open) => {
          if (!open) setConfirmState(s => ({ ...s, open: false }));
        }}
      />

      {/* Action Param Collection Dialog.

          The close is field-preserving and that is load-bearing, not incidental:
          Radix holds the dialog mounted through its 200ms exit animation, so
          whatever this writes is what the user watches fade out. This side was
          already correct; `useConsoleActionRuntime` — the second runtime mounted
          into this same dialog — was the one that blanked, and objectui#6431
          converged it onto this shape. The measurement and the full rationale
          live at that close site; the parity is pinned by
          `RecordDetailView.paramRuntimeParity-6431.test.tsx`. */}
      <ActionParamDialog
        state={paramState}
        onOpenChange={(open) => {
          if (!open) setParamState(s => ({ ...s, open: false }));
        }}
      />

      {/* Action Result Reveal Dialog */}
      <ActionResultDialog
        state={resultDialogState}
        onAcknowledge={() => {
          resultDialogState.resolve?.();
          setResultDialogState({ open: false });
        }}
      />
      <FlowRunner
        state={screenFlow}
        authFetch={authFetch}
        baseUrl={import.meta.env.VITE_SERVER_URL || ''}
        dataSource={dataSource}
        objects={objects}
        onClose={() => setScreenFlow(null)}
        onComplete={() => { setScreenFlow(null); notifyRecordChanged(); }}
      />
      <FlowRefusalNotice
        state={flowRefusal}
        onClose={() => setFlowRefusal(s => ({ ...s, open: false }))}
      />
    </div>
  );
}
