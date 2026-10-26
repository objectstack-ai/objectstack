/**
 * useFavorites — re-export shim
 *
 * The favorites state has been migrated to a React Context so all consumers
 * share a single state instance (fixes star toggle not updating HomePage).
 *
 * All existing imports of `useFavorites` and `FavoriteItem` from this path
 * continue to work without any changes at the call sites.
 *
 * @see apps/console/src/context/FavoritesProvider.tsx
 * @module
 */

export { useFavorites, type FavoriteItem } from '../context/FavoritesProvider.js';
