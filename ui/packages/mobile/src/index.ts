/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/mobile
 * 
 * Mobile optimization for Object UI providing:
 * - useBreakpoint / useResponsive hooks for responsive behavior
 * - useGesture hook for touch gesture detection
 * - PWA utilities (manifest generation, service worker registration)
 * - Mobile-aware component wrappers
 * - Pull-to-refresh and infinite scroll support
 * 
 * @packageDocumentation
 */

export { useBreakpoint, type BreakpointState } from './useBreakpoint.js';
export { useResponsive } from './useResponsive.js';
// `useResponsiveConfig` REMOVED (objectui#7580, maintainer ruling 2026-09-04).
// It read `@objectstack/spec`'s `ResponsiveConfigSchema`, which objectstack#11027
// retired; it was measured at zero callers on objectui#4773. Its exported
// `SpecResponsiveConfig` / `ResolvedResponsiveState` went with it — both named
// the retired schema's shape and neither had a reader. No behaviour is retired:
// the live per-breakpoint readers are `useBreakpoint` and
// `ResponsiveContainer` below, which are untouched.
export { useGesture, type UseGestureOptions } from './useGesture.js';
export { useSpecGesture, type UseSpecGestureOptions } from './useSpecGesture.js';
export { useTouchTarget, type UseTouchTargetOptions, type TouchTargetResult } from './useTouchTarget.js';
export { usePullToRefresh, type PullToRefreshOptions } from './usePullToRefresh.js';
export { MobileProvider, type MobileProviderProps } from './MobileProvider.js';
export { ResponsiveContainer, type ResponsiveContainerProps } from './ResponsiveContainer.js';
export { generatePWAManifest } from './pwa.js';
export { registerServiceWorker, type ServiceWorkerConfig } from './serviceWorker.js';
export {
  createOfflineQueue,
  IndexedDbOfflineQueue,
  MemoryOfflineQueue,
  generateOpId,
  type OfflineOperation,
  type OfflineQueueBackend,
} from './offlineQueue.js';
export {
  createOfflineDataSource,
  type OfflineDataSource,
  type OfflineDataSourceOptions,
  type QueueableDataSource,
} from './createOfflineDataSource.js';
export { useOfflineSync, type OfflineSyncState } from './useOfflineSync.js';
export {
  getServiceWorkerSource,
  requestBackgroundSync,
  type ServiceWorkerSourceOptions,
} from './serviceWorkerSource.js';
export { BREAKPOINTS, resolveResponsiveValue } from './breakpoints.js';

// Re-export types for convenience
export type {
  BreakpointName,
  ResponsiveValue,
  // `MobileResponsiveConfig` and `GestureConfig` RETIRED outright by
  // objectui#7519, from this barrel and from `@object-ui/types` in the same
  // change — see the RETIRED notes in that package's `mobile.ts`. No behaviour
  // went with them: the live per-breakpoint and gesture readers are the hooks
  // exported above.
  PWAConfig,
  PWAIcon,
  FetchCacheStrategy,
  PWAOfflineConfig,
  OfflineRoute,
  GestureType,
  GestureContext,
  SpecGestureConfig,
  SwipeGestureConfig,
  PinchGestureConfig,
  LongPressGestureConfig,
  TouchInteraction,
  TouchTargetConfig,
} from '@object-ui/types';
