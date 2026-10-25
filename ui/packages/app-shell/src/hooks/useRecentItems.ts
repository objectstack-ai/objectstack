/**
 * useRecentItems — re-export shim
 *
 * The recent-items state has been migrated to a React Context so all consumers
 * share a single state instance and can be backed by an optional backend
 * persistence adapter. See `../context/RecentItemsProvider`.
 *
 * All existing imports of `useRecentItems` and `RecentItem` from this path
 * continue to work without any changes at the call sites.
 *
 * @module
 */

export {
  useRecentItems,
  type RecentItem,
  type RecentItemInput,
  type RecentItemType,
  type RecentNamedItem,
  type RecentTextItem,
  type RecentViewItem,
} from '../context/RecentItemsProvider.js';
// ⛔ Not `useRecentItemLabel`: it reads the metadata cache, so re-exporting it
// here would make every module that only wants the list — `RecordDetailView`
// among them — load `MetadataProvider` and its metadata client at module load
// (objectui#11678). The entry exports it from its own module.
