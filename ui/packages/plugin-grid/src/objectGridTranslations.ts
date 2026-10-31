/**
 * The English fallback translations of `ObjectGrid` (`./ObjectGrid.tsx`) and
 * the safe translation hook built on them, moved out of that file verbatim
 * (objectstack#25994, slice 1).
 */

import { createSafeTranslation } from '@object-ui/i18n';

// Default English fallback translations for the grid
const GRID_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'grid.actions': 'Actions',
  'grid.edit': 'Edit',
  'grid.delete': 'Delete',
  'grid.export': 'Export',
  'grid.exportAs': 'Export as {{format}}',
  'grid.loading': 'Loading grid…',
  'grid.errorLoading': 'Error loading grid',
  // objectui#9050 — the malformed-filter state, shared with `RelatedList`
  // and `LineItemsPanel` because it is one sentence about one authored
  // value, not three. Byte-identical to the `en` pack, which
  // `defaults-maps-mirror-en-pack` enforces.
  'view.malformedFilter': 'This view’s filter is malformed, so no records are shown: the {{subject}} condition cannot be applied.',
  'grid.pullToRefresh': 'Pull to refresh',
  'grid.refreshing': 'Refreshing…',
  'grid.openRecord': 'Open record',
  'grid.empty': 'Empty',
  'grid.yes': 'Yes',
  'grid.no': 'No',
  'grid.systemFields': 'System',
  // The grouped grid's refusal over a data source that cannot answer the
  // group header query (objectui#10881, ruling F). It must exist HERE as well
  // as in the locale packs: a provider-less host (a standalone grid, this
  // package's own tests) never reaches them, and it is the only thing such a
  // grid draws.
  'grid.grouping.needsHeaderQuery':
    'This view is grouped, but its data source does not implement queryGroupHeaders, so the groups cannot be counted. Remove the grouping to show the records.',
  // …and over rows a host handed in while declaring them one page of more.
  'grid.grouping.needsWholeRows':
    'Grouping needs every record, but this grid was handed one page of them, so the groups cannot be counted. Hand in every record, or let the grid fetch them from a data source that implements queryGroupHeaders.',
  // Reused by the grouped-view pager (falls back here when no I18nProvider).
  'table.rowsPerPage': 'Rows per page',
  'table.pageInfo': 'Page {{current}} of {{total}}',
  // The grouped-view pager's four icon buttons are named by these
  // (objectui#12143): the `data-table` pager's own keys, objectui#12124.
  'table.firstPage': 'First page',
  'table.previousPage': 'Previous page',
  'table.nextPage': 'Next page',
  'table.lastPage': 'Last page',
  // The default inline-edit saves' success toast (objectui#12303), counted in
  // the rows the server accepted — the `table.modified` unit the table's
  // "Save All" bar counts in.
  'table.saved': '{{count}} row saved',
  'table.saved_one': '{{count}} row saved',
  'table.saved_other': '{{count}} rows saved',
  // The field rules an inline edit is checked against before it is sent
  // (objectstack-ai/objectstack#27520), worded as the record form words them.
  // Byte-identical to the `en` pack, which `defaults-maps-mirror-en-pack`
  // enforces.
  'validation.required': '{{field}} is required',
  'validation.minLength': '{{field}} must be at least {{min}} characters',
  'validation.maxLength': '{{field}} must be at most {{max}} characters',
  'validation.min': '{{field}} must be at least {{min}}',
  'validation.max': '{{field}} must be at most {{max}}',
  'validation.email': 'Please enter a valid email address',
  'validation.url': 'Please enter a valid URL',
  'validation.pattern': '{{field}} format is invalid',
  // The heading of an authored `emptyState` that declares no `title`
  // (objectui#11068): the words the table's own empty row shows, so leaving the
  // member out changes nothing a user reads.
  'table.noResults': 'No results found',
  // The empty state an empty grid draws when no authored `emptyState` and no
  // search term are in force (objectui#13142). Borrowed from the `list.*`
  // namespace `ListEmptyState` reads, so a grid and a list say the same thing
  // about the same empty object; the rows exist HERE too for a provider-less
  // host.
  'list.firstRunTitle': 'Nothing here yet',
  'list.firstRunMessage': 'Create your first record to get started.',
  'list.noMatches': 'No matching records',
  'list.viewFilterNoMatchesMessage': 'No records match this view’s filter.',
  // objectstack#25898 — a grid filtered to the signed-in user, and an
  // unfiltered grid for a caller who may not create (`ListEmptyState` says
  // both in the same words).
  'list.ownedNoneTitle': 'Nothing of yours yet',
  'list.ownedNoneMessage': 'This view lists only records that are yours, and you don’t have any yet.',
  'list.noneVisibleTitle': 'No records you can see',
  'list.noneVisibleMessage': 'There are no records here that you have access to. If you expected to see some, ask your administrator for access.',
  // Heading of the record-detail overlay this grid opens on row click
  // (objectui#3426). Borrowed from the `detail.*` namespace rather than minted
  // as `grid.recordDetail`: `NavigationOverlay` already resolves
  // `detail.recordDetail` for hosts that pass no title, and one heading on one
  // control should not get two translations that can drift apart. Both entries
  // must exist HERE too — a provider-less host (a standalone grid, this
  // package's own tests) never reaches the locale packs.
  'detail.recordDetail': 'Record Detail',
  'detail.recordDetailWithLabel': '{{label}} Detail',
};

/**
 * Safe wrapper for useObjectTranslation that falls back to English defaults
 * when I18nProvider is not available (e.g., standalone usage).
 *
 * Delegates to `@object-ui/i18n`'s `createSafeTranslation`; the local copy this
 * replaced wrapped the hook in try/catch (rules-of-hooks, objectui#2879).
 */
export const useGridTranslation = createSafeTranslation(GRID_DEFAULT_TRANSLATIONS, 'grid.actions');
