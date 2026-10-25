/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The empty state a list draws when it has no records (objectui#12217).
 *
 * ONE component, drawn by the two surfaces that show a list of records as
 * rows or cards: `ListView` for its `grid` and `gallery` visualizations, and
 * `ObjectGallery` when it is rendered without a `ListView` around it (an
 * authored `object-gallery` node, `ObjectView`'s own non-grid path). It used to
 * live inline in `ListView`'s grid branch, and `ObjectGallery` drew its own
 * hard-coded English line instead, ignoring both the view's authored
 * `emptyState` and the locale.
 *
 * Module-internal: not exported from the package barrel. The copy is the
 * `list.*` keys the grid already read; ⛔ no second string table. Each caller
 * hands over the translation function and display locale it already holds, the
 * authored members it has (an authored icon NAME already resolved through the
 * icon seam), and what it knows about the query that came back empty; a caller
 * that has no search box or user filters (a standalone gallery) says `false`.
 */

import * as React from 'react';
import { Button, DataEmptyState, EmptyStateLink } from '@object-ui/components';
import { Inbox, Plus, type LucideIcon } from 'lucide-react';
import type { ListViewSchema } from '@object-ui/types';
// The spec's own resolver for an `I18nLabel` (a plain string or an inline
// locale map), under the name `ListView` gives it.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';

/**
 * Whether a DECLARED filter (the view's own `filter`, or a standalone node's)
 * narrows the query at all: a non-empty condition array or a non-empty
 * filter-node object. An absent filter, `[]` and `{}` narrow nothing.
 */
export function hasDeclaredFilter(filter: unknown): boolean {
  if (Array.isArray(filter)) return filter.length > 0;
  if (filter && typeof filter === 'object') return Object.keys(filter).length > 0;
  return false;
}

/** The authored `emptyState` (the spec's `EmptyStateSchema`). */
type AuthoredEmptyState = NonNullable<ListViewSchema['emptyState']>;

export interface ListEmptyStateProps {
  /** The authored `emptyState.title` (`I18nLabel`), resolved here against `displayLocale`. */
  title?: AuthoredEmptyState['title'];
  /** The authored `emptyState.message` (`I18nLabel`), resolved here against `displayLocale`. */
  message?: AuthoredEmptyState['message'];
  /**
   * The authored `emptyState.icon`, already resolved by the caller through the
   * ONE icon seam (`resolveIcon`, objectui#5935); `null` or absent draws the
   * `Inbox` glyph.
   */
  icon?: LucideIcon | null;
  /**
   * The authored `emptyState.link`, `{ label, url }` (objectui#12270), drawn by
   * the one shared `EmptyStateLink` beside the add-record action. The spec
   * keeps the two apart: the link is the empty state's own next step, the
   * add-record entry point is the view's `addRecord` block, so either, both or
   * neither may be drawn.
   */
  link?: AuthoredEmptyState['link'];
  /**
   * The USER applied a query: the search box, the user-filter chips, the
   * filter panel. Only then is the user told to adjust or clear their filters.
   */
  hasUserQuery: boolean;
  /** The declared filter narrows the query (see {@link hasDeclaredFilter}). */
  hasBaseFilter: boolean;
  /** Draws the add-record action when supplied; omitted, no action is drawn. */
  onAddRecord?: () => void;
  /** The caller's `list.*` translation function. */
  t: (key: string) => string;
  /** The locale an authored `I18nLabel` map is resolved against. */
  displayLocale: string;
}

export function ListEmptyState({
  title: authoredTitle,
  message: authoredMessage,
  icon,
  link,
  hasUserQuery,
  hasBaseFilter,
  onAddRecord,
  t,
  displayLocale,
}: ListEmptyStateProps) {
  // ⛔ The `Inbox` fallback stays here, at the surface — an empty state always
  // shows a glyph, and that is this surface's decision, not the icon seam's
  // (objectui#5935, maintainer ruling 2026-09-03, option C).
  const ResolvedIcon: LucideIcon = icon ?? Inbox;
  // Distinguish "filtered/searched to empty" from "truly empty (first run)".
  // A new user with no filters shouldn't be told to "adjust your filters" —
  // they should be invited to create.
  //
  // The declared filter counts as an active query too (objectui#4155). It used
  // to be excluded, so a view that returns nothing *because it is filtered* —
  // the declared `status not_in [archived]`, or a stale stored condition —
  // rendered the first-run copy ("no data yet / create your first record")
  // over an object full of records. That reads as data loss or a permission
  // problem and sends triage away from the view layer.
  //
  // …but it is not the USER's query (objectui#11687). "Your current filters or
  // search" is said only when the user applied one. A list emptied by its own
  // declared filter alone gets its own message, which names the view's filter
  // instead of telling the user to clear filters they never set.
  const hasActiveQuery = hasUserQuery || hasBaseFilter;
  // objectui#11227 — `title` and `message` are the spec's `I18nLabel`
  // (`EmptyStateSchema`): a plain string or an inline locale map. They are
  // RESOLVED against the display locale, as the view's `label` is. A
  // `typeof === 'string'` test stood here, which is not a resolution: it
  // answered "absent" for every map an author may write, so a localised empty
  // state silently drew the default copy in every locale. A string still
  // passes through unchanged, and a map with no usable entry still falls to
  // the default.
  const title = resolveInlineI18nLabel(authoredTitle, displayLocale)
    ?? (hasActiveQuery ? t('list.noMatches') : t('list.firstRunTitle'));
  const description = resolveInlineI18nLabel(authoredMessage, displayLocale)
    ?? (hasUserQuery
      ? t('list.noMatchesMessage')
      : hasBaseFilter
        ? t('list.viewFilterNoMatchesMessage')
        : t('list.firstRunMessage'));
  const addRecordAction = onAddRecord ? (
    <Button
      variant="default"
      size="sm"
      data-testid="empty-state-add-record"
      onClick={() => onAddRecord()}
    >
      <Plus className="h-4 w-4 mr-1.5" />
      {t('list.addRecord')}
    </Button>
  ) : undefined;
  return (
    <DataEmptyState
      data-testid="empty-state"
      className="h-full min-h-[200px] p-8 gap-1 [&>h3]:text-lg [&>h3]:font-medium [&>h3]:text-foreground [&>p]:max-w-md"
      icon={<ResolvedIcon className="h-12 w-12 text-muted-foreground/50" />}
      iconWrapperClassName="mb-3"
      title={title}
      description={description}
      action={link ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {addRecordAction}
          <EmptyStateLink link={link} displayLocale={displayLocale} />
        </div>
      ) : addRecordAction}
    />
  );
}
