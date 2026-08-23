// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Data Query Hooks
 * 
 * React hooks for querying and mutating ObjectStack data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { QueryAST, FilterCondition } from '@objectstack/spec/data';
import { PaginatedResult } from '@objectstack/client';
import { useClient } from './context';
import { stableKey, useEventCallback } from './internal-deps';

/**
 * Query options for useQuery hook.
 *
 * Uses the canonical Spec protocol field names: `where`, `fields`,
 * `orderBy`, `limit`, `offset`. (The legacy aliases `filters` / `select` /
 * `sort` / `top` / `skip` were removed in 11.0.)
 */
export interface UseQueryOptions<T = any> {
  /** Query AST or simplified query options */
  query?: Partial<QueryAST>;

  // ── Canonical (Spec protocol) field names ──────────────────────────
  /** Filter conditions (WHERE clause). */
  where?: FilterCondition;
  /** Fields to retrieve (SELECT clause). */
  fields?: string[];
  /** Sort definition (ORDER BY clause). */
  orderBy?: string | string[];
  /** Maximum number of records to return (LIMIT). */
  limit?: number;
  /** Number of records to skip (OFFSET). */
  offset?: number;


  /** Enable/disable automatic query execution */
  enabled?: boolean;
  /** Refetch interval in milliseconds */
  refetchInterval?: number;
  /** Callback on successful query */
  onSuccess?: (data: PaginatedResult<T>) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Query result for useQuery hook
 */
export interface UseQueryResult<T = any> {
  /** Query result data */
  data: PaginatedResult<T> | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch the query */
  refetch: () => Promise<void>;
  /** Is currently refetching */
  isRefetching: boolean;
}

/**
 * Hook for querying ObjectStack data with automatic caching and refetching
 * 
 * @example
 * <!-- os:check -->
 * ```tsx
 * import { useQuery } from '@objectstack/client-react';
 *
 * function TaskList() {
 *   const { data, isLoading, error, refetch } = useQuery('todo_task', {
 *     fields: ['id', 'subject', 'priority'],
 *     orderBy: ['-created_at'],
 *     limit: 20
 *   });
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <div>
 *       {data?.records.map(task => (
 *         <div key={task.id}>{task.subject}</div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useQuery<T = any>(
  object: string,
  options: UseQueryOptions<T> = {}
): UseQueryResult<T> {
  const client = useClient();
  const [data, setData] = useState<PaginatedResult<T> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  
  const {
    query,
    // Canonical names take precedence over legacy names
    where, fields, orderBy, limit, offset,
    enabled = true,
    refetchInterval,
    onSuccess,
    onError
  } = options;

  const resolvedFields = fields;
  const resolvedWhere = where;
  const resolvedSort = orderBy;
  const resolvedLimit = limit;
  const resolvedOffset = offset;

  // The query shape as a VALUE (#4693). `where` / `fields` / `orderBy` are
  // objects and arrays, and the documented usage builds them inline, so keying
  // the fetch on their identities re-ran it every render — and since it calls
  // `setData`, every render caused another render. Measured before this fix:
  // `useQuery('todo_task', { where: { status: 'open' } })` issued 4691 `find`
  // calls in 250ms; the same call with a hoisted options object issued 1.
  const queryKey = stableKey({
    query,
    where: resolvedWhere,
    fields: resolvedFields,
    orderBy: resolvedSort,
    limit: resolvedLimit,
    offset: resolvedOffset,
  });

  // Handlers say what to do with a result; they are not part of what is being
  // fetched, so they must not drive refetching.
  const handleSuccess = useEventCallback(onSuccess);
  const handleError = useEventCallback(onError);

  const fetchData = useCallback(async (isRefetch = false) => {
    if (!enabled) return;
    
    try {
      if (isRefetch) {
        setIsRefetching(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      let result: PaginatedResult<T>;
      
      if (query) {
        // Use advanced query API
        result = await client.data.query<T>(object, query);
      } else {
        // Use canonical QueryOptionsV2 for the find call
        result = await client.data.find<T>(object, {
          where: resolvedWhere as any,
          fields: resolvedFields,
          orderBy: resolvedSort,
          limit: resolvedLimit,
          offset: resolvedOffset,
        });
      }

      setData(result);
      handleSuccess(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Query failed');
      setError(error);
      handleError(error);
    } finally {
      setIsLoading(false);
      setIsRefetching(false);
    }
  }, [client, object, queryKey, enabled, handleSuccess, handleError]);

  // Initial fetch and dependency-based refetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Setup refetch interval
  useEffect(() => {
    if (refetchInterval && enabled) {
      intervalRef.current = setInterval(() => {
        fetchData(true);
      }, refetchInterval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
    return undefined;
  }, [refetchInterval, enabled, fetchData]);

  const refetch = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  return {
    data,
    isLoading,
    error,
    refetch,
    isRefetching
  };
}

/**
 * Mutation options for useMutation hook
 */
export interface UseMutationOptions<TData = any, TVariables = any> {
  /** Callback on successful mutation */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Callback on error */
  onError?: (error: Error, variables: TVariables) => void;
  /** Callback when mutation is settled (success or error) */
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables) => void;
}

/**
 * Mutation result for useMutation hook
 */
export interface UseMutationResult<TData = any, TVariables = any> {
  /** Execute the mutation */
  mutate: (variables: TVariables) => Promise<TData>;
  /** Async version of mutate that throws errors */
  mutateAsync: (variables: TVariables) => Promise<TData>;
  /** Mutation result data */
  data: TData | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Reset mutation state */
  reset: () => void;
}

/**
 * Hook for creating, updating, or deleting ObjectStack data
 * 
 * @example
 * <!-- os:check -->
 * ```tsx
 * import { useMutation } from '@objectstack/client-react';
 *
 * function CreateTaskForm() {
 *   const { mutate, isLoading, error } = useMutation('todo_task', 'create', {
 *     onSuccess: (data) => {
 *       console.log('Task created:', data);
 *     }
 *   });
 *
 *   const handleSubmit = (formData: Record<string, unknown>) => {
 *     mutate(formData);
 *   };
 *
 *   return <button onClick={() => handleSubmit({ subject: 'New task' })}>Create</button>;
 * }
 * ```
 */
export function useMutation<TData = any, TVariables = any>(
  object: string,
  operation: 'create' | 'update' | 'delete' | 'createMany' | 'updateMany' | 'deleteMany',
  options: UseMutationOptions<TData, TVariables> = {}
): UseMutationResult<TData, TVariables> {
  const client = useClient();
  const [data, setData] = useState<TData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { onSuccess, onError, onSettled } = options;

  const mutateAsync = useCallback(async (variables: TVariables): Promise<TData> => {
    setIsLoading(true);
    setError(null);

    try {
      let result: TData;

      switch (operation) {
        case 'create':
          result = (await client.data.create(object, variables as any)) as TData;
          break;
        case 'update':
          // Expect variables to be { id: string, data: Partial<T> }
          const updateVars = variables as any;
          result = (await client.data.update(object, updateVars.id, updateVars.data)) as TData;
          break;
        case 'delete':
          // Expect variables to be { id: string }
          const deleteVars = variables as any;
          result = await client.data.delete(object, deleteVars.id) as any;
          break;
        case 'createMany':
          // createMany returns an array, which may not match TData type
          result = await client.data.createMany(object, variables as any) as any;
          break;
        case 'updateMany':
          // Expect variables to be { records: Array<{ id: string, data: Partial<T> }> }
          const updateManyVars = variables as any;
          result = await client.data.updateMany(object, updateManyVars.records, updateManyVars.options) as any;
          break;
        case 'deleteMany':
          // Expect variables to be { ids: string[] }
          const deleteManyVars = variables as any;
          result = await client.data.deleteMany(object, deleteManyVars.ids, deleteManyVars.options) as any;
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      setData(result);
      onSuccess?.(result, variables);
      onSettled?.(result, null, variables);
      
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Mutation failed');
      setError(error);
      onError?.(error, variables);
      onSettled?.(undefined, error, variables);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [client, object, operation, onSuccess, onError, onSettled]);

  const mutate = useCallback((variables: TVariables): Promise<TData> => {
    return mutateAsync(variables).catch(() => {
      // Swallow error for non-async version
      // Error is still available in the error state
      return null as any;
    });
  }, [mutateAsync]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    mutate,
    mutateAsync,
    data,
    isLoading,
    error,
    reset
  };
}

/**
 * Pagination options for usePagination hook
 */
export interface UsePaginationOptions<T = any> extends Omit<UseQueryOptions<T>, 'limit' | 'offset'> {
  /** Page size */
  pageSize?: number;
  /** Initial page (1-based) */
  initialPage?: number;
}

/**
 * Pagination result for usePagination hook
 */
export interface UsePaginationResult<T = any> extends UseQueryResult<T> {
  /** Current page (1-based) */
  page: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of records */
  totalCount: number;
  /** Go to next page */
  nextPage: () => void;
  /** Go to previous page */
  previousPage: () => void;
  /** Go to specific page */
  goToPage: (page: number) => void;
  /** Whether there is a next page */
  hasNextPage: boolean;
  /** Whether there is a previous page */
  hasPreviousPage: boolean;
}

/**
 * Hook for paginated data queries
 * 
 * @example
 * <!-- os:check -->
 * ```tsx
 * import { usePagination } from '@objectstack/client-react';
 *
 * function PaginatedTaskList() {
 *   const {
 *     data,
 *     isLoading,
 *     page,
 *     totalPages,
 *     nextPage,
 *     previousPage,
 *     hasNextPage,
 *     hasPreviousPage
 *   } = usePagination('todo_task', {
 *     pageSize: 10,
 *     orderBy: ['-created_at']
 *   });
 *
 *   return (
 *     <div>
 *       {data?.records.map(task => <div key={task.id}>{task.subject}</div>)}
 *       <button onClick={previousPage} disabled={!hasPreviousPage}>Previous</button>
 *       <span>Page {page} of {totalPages}</span>
 *       <button onClick={nextPage} disabled={!hasNextPage}>Next</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function usePagination<T = any>(
  object: string,
  options: UsePaginationOptions<T> = {}
): UsePaginationResult<T> {
  const { pageSize = 20, initialPage = 1, ...queryOptions } = options;
  const [page, setPage] = useState(initialPage);

  const queryResult = useQuery<T>(object, {
    ...queryOptions,
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const totalCount = queryResult.data?.total || 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  const nextPage = useCallback(() => {
    if (hasNextPage) {
      setPage(p => p + 1);
    }
  }, [hasNextPage]);

  const previousPage = useCallback(() => {
    if (hasPreviousPage) {
      setPage(p => p - 1);
    }
  }, [hasPreviousPage]);

  const goToPage = useCallback((newPage: number) => {
    const clampedPage = Math.max(1, Math.min(newPage, totalPages));
    setPage(clampedPage);
  }, [totalPages]);

  return {
    ...queryResult,
    page,
    totalPages,
    totalCount,
    nextPage,
    previousPage,
    goToPage,
    hasNextPage,
    hasPreviousPage
  };
}

/**
 * Infinite query options for useInfiniteQuery hook
 */
export interface UseInfiniteQueryOptions<T = any> extends Omit<UseQueryOptions<T>, 'offset'> {
  /** Page size for each fetch */
  pageSize?: number;
  /** Get next page parameter */
  getNextPageParam?: (lastPage: PaginatedResult<T>, allPages: PaginatedResult<T>[]) => number | undefined;
}

/**
 * Infinite query result for useInfiniteQuery hook
 */
export interface UseInfiniteQueryResult<T = any> {
  /** All pages of data */
  data: PaginatedResult<T>[];
  /** Flattened data from all pages */
  flatData: T[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Load the next page */
  fetchNextPage: () => Promise<void>;
  /** Whether there are more pages */
  hasNextPage: boolean;
  /** Is currently fetching next page */
  isFetchingNextPage: boolean;
  /** Refetch all pages */
  refetch: () => Promise<void>;
}

/**
 * Hook for infinite scrolling / load more functionality
 * 
 * @example
 * <!-- os:check -->
 * ```tsx
 * import { useInfiniteQuery } from '@objectstack/client-react';
 *
 * function InfiniteTaskList() {
 *   const {
 *     flatData,
 *     isLoading,
 *     fetchNextPage,
 *     hasNextPage,
 *     isFetchingNextPage
 *   } = useInfiniteQuery('todo_task', {
 *     pageSize: 20,
 *     orderBy: ['-created_at']
 *   });
 *
 *   return (
 *     <div>
 *       {flatData.map(task => <div key={task.id}>{task.subject}</div>)}
 *       {hasNextPage && (
 *         <button onClick={fetchNextPage} disabled={isFetchingNextPage}>
 *           {isFetchingNextPage ? 'Loading...' : 'Load More'}
 *         </button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useInfiniteQuery<T = any>(
  object: string,
  options: UseInfiniteQueryOptions<T> = {}
): UseInfiniteQueryResult<T> {
  const client = useClient();
  const {
    pageSize = 20,
    // getNextPageParam is reserved for future use
    query,
    // Canonical names take precedence over legacy names
    where, fields, orderBy,
    enabled = true,
    onSuccess,
    onError
  } = options;

  const resolvedFields = fields;
  const resolvedWhere = where;
  const resolvedSort = orderBy;

  // Same value-keyed dependency as useQuery (#4693) — measured at 6611 `find`
  // calls in 250ms before this fix, with inline options.
  const queryKey = stableKey({
    query,
    where: resolvedWhere,
    fields: resolvedFields,
    orderBy: resolvedSort,
    pageSize,
  });
  const handleSuccess = useEventCallback(onSuccess);
  const handleError = useEventCallback(onError);

  const [pages, setPages] = useState<PaginatedResult<T>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasNextPage, setHasNextPage] = useState(true);

  const fetchPage = useCallback(async (skip: number, isNextPage = false) => {
    try {
      if (isNextPage) {
        setIsFetchingNextPage(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      let result: PaginatedResult<T>;

      if (query) {
        result = await client.data.query<T>(object, {
          ...query,
          limit: pageSize,
          offset: skip
        });
      } else {
        result = await client.data.find<T>(object, {
          where: resolvedWhere as any,
          fields: resolvedFields,
          orderBy: resolvedSort,
          limit: pageSize,
          offset: skip,
        });
      }

      if (isNextPage) {
        setPages(prev => [...prev, result]);
      } else {
        setPages([result]);
      }

      // Determine if there's a next page
      const fetchedCount = result.records?.length ?? 0;
      const hasMore = fetchedCount === pageSize;
      setHasNextPage(hasMore);

      handleSuccess(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Query failed');
      setError(error);
      handleError(error);
    } finally {
      setIsLoading(false);
      setIsFetchingNextPage(false);
    }
  }, [client, object, queryKey, handleSuccess, handleError]);

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchPage(0);
    }
  }, [enabled, fetchPage]);

  const fetchNextPage = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return;

    const nextSkip = pages.length * pageSize;
    await fetchPage(nextSkip, true);
  }, [hasNextPage, isFetchingNextPage, pages.length, pageSize, fetchPage]);

  const refetch = useCallback(async () => {
    setPages([]);
    await fetchPage(0);
  }, [fetchPage]);

  const flatData = pages.flatMap(page => page.records ?? []);

  return {
    data: pages,
    flatData,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch
  };
}
