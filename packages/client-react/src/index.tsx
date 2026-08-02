// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/client-react
 * 
 * React hooks for ObjectStack Client SDK
 * 
 * Provides type-safe React hooks for:
 * - Data queries (useQuery, useMutation, usePagination, useInfiniteQuery)
 * - Metadata access (useObject, useView, useFields, useMetadata)
 * - Client context (ObjectStackProvider, useClient)
 */

// Context & Provider
export {
  ObjectStackProvider,
  ObjectStackContext,
  ObjectStackLocaleContext,
  useClient,
  useObjectStackLocale,
  type ObjectStackProviderProps
} from './context';

// Data Hooks
export {
  useQuery,
  useMutation,
  usePagination,
  useInfiniteQuery,
  type UseQueryOptions,
  type UseQueryResult,
  type UseMutationOptions,
  type UseMutationResult,
  type UsePaginationOptions,
  type UsePaginationResult,
  type UseInfiniteQueryOptions,
  type UseInfiniteQueryResult
} from './data-hooks';

// Metadata Hooks
export {
  useObject,
  useView,
  useFields,
  useMetadata,
  type UseMetadataOptions,
  type UseMetadataResult
} from './metadata-hooks';

// Realtime Event Hooks
export {
  useMetadataSubscription,
  useDataSubscription,
  useMetadataSubscriptionCallback,
  useDataSubscriptionCallback,
  useBulkDataSubscription,
  useBulkDataSubscriptionCallback,
  useRealtimeConnection,
  useAutoRefresh
} from './realtime-hooks';

// Re-export ObjectStackClient and types from @objectstack/client
export { ObjectStackClient, type ClientConfig } from '@objectstack/client';
