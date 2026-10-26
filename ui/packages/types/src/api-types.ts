/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - API Schemas
 * 
 * Type definitions for API integration, data fetching and expression nodes.
 * These schemas enable dynamic API calls. The event-handler dialect this module
 * once declared is RETIRED (objectui#6497); its tombstone stands where it was.
 * 
 * @module api
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';

/**
 * HTTP Method types
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/**
 * API request configuration
 */
export interface APIRequest {
  /**
   * API endpoint URL
   * Supports variable substitution: "/api/users/${userId}"
   */
  url: string;
  /**
   * HTTP method
   * @default 'GET'
   */
  method?: HTTPMethod;
  /**
   * Request headers
   */
  headers?: Record<string, string>;
  /**
   * Request body data
   * For POST, PUT, PATCH requests
   */
  data?: any;
  /**
   * Query parameters
   */
  params?: Record<string, any>;
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
  /**
   * Whether to send credentials (cookies)
   * @default false
   */
  withCredentials?: boolean;
  /**
   * Data transformation function
   * Transform request data before sending
   */
  transformRequest?: string;
  /**
   * Response transformation function
   * Transform response data after receiving
   */
  transformResponse?: string;
}

/**
 * API configuration for components
 */
export interface APIConfig {
  /**
   * API request configuration
   */
  request?: APIRequest;
  /**
   * Success handler
   * JavaScript expression or function name
   */
  onSuccess?: string;
  /**
   * Error handler
   * JavaScript expression or function name
   */
  onError?: string;
  /**
   * Loading indicator
   * Whether to show loading state during request
   * @default true
   */
  showLoading?: boolean;
  /**
   * Success message to display
   */
  successMessage?: string;
  /**
   * Error message to display
   */
  errorMessage?: string;
  /**
   * Whether to reload data after success
   * @default false
   */
  reload?: boolean;
  /**
   * Whether to redirect after success
   */
  redirect?: string;
  /**
   * Whether to close dialog/modal after success
   * @default false
   */
  close?: boolean;
  /**
   * Retry configuration
   */
  retry?: {
    /**
     * Maximum retry attempts
     */
    maxAttempts?: number;
    /**
     * Delay between retries in milliseconds
     */
    delay?: number;
    /**
     * HTTP status codes to retry
     */
    retryOn?: number[];
  };
  /**
   * Cache configuration
   */
  cache?: {
    /**
     * Cache key
     */
    key?: string;
    /**
     * Cache duration in milliseconds
     */
    duration?: number;
    /**
     * Whether to use stale cache while revalidating
     */
    staleWhileRevalidate?: boolean;
  };
}

/**
 * `UIEventHandler` and `EventableSchema` — RETIRED. This comment is the
 * tombstone: both were TypeScript interfaces, which erase and leave no runtime
 * residue that could carry a marker of their own.
 *
 * RETIRED under ADR-0049 enforce-or-remove by the director-seat ruling recorded
 * on objectui#6497 (2026-09-24, maintainer verbatim 「同意」): the re-priced
 * option 2 of the three that card offered. ⛔ Not option 1 (mirror the dialect in
 * zod, have component schemas extend it, build a dispatcher for it) and ⛔ not
 * option 3 (leave it on the published surface). The ruling follows objectui#6182
 * (ruled A, 2026-08-25): an authored handler EXPRESSION is not a supported
 * authoring form.
 *
 * **What went.** Both exported interfaces and their `@object-ui/types` barrel
 * re-exports. `UIEventHandler` was an event-handler object: `event`, a `type` of
 * `action | api | script | navigation | dialog | toast | custom`, one config
 * member per type, then `condition`, `preventDefault`, `stopPropagation`,
 * `debounce` and `throttle`. Its `dialog.actions[]` entries carried a recursive
 * `handler?: UIEventHandler`, which went with it. `EventableSchema` extended
 * {@link BaseSchema} with an `events` array and nine `on*` keys, each typed
 * `UIEventHandler | string`. Its arm of {@link APISchema} went too. There is no
 * replacement type and no replacement key.
 *
 * **Why.** Declared and inert, an island: no component schema extended
 * `EventableSchema`, neither type had a zod mirror (so `objectui validate` had
 * no path to the dialect), and nothing outside this file and the barrel read
 * either one. Only `tsc` said yes, which invited authors to write a handler
 * dialect that no runtime dispatches.
 *
 * **The supported form.** An action is the declarative `ActionDef` object that
 * `@object-ui/core`'s `ActionRunner` executes, and a control that runs
 * something is the `action:button` node type (AGENTS.md, commandment #4).
 * Runtime callbacks stay the programmatic face.
 */

/**
 * Data fetching configuration
 */
export interface DataFetchConfig {
  /**
   * Data source API
   */
  api: string | APIRequest;
  /**
   * Whether to fetch on mount
   * @default true
   */
  fetchOnMount?: boolean;
  /**
   * Polling interval in milliseconds
   * If set, data will be refetched at this interval
   */
  pollInterval?: number;
  /**
   * Dependencies for refetching
   * Array of variable names to watch
   */
  dependencies?: string[];
  /**
   * Default data before fetch completes
   */
  defaultData?: any;
  /**
   * Transform function for fetched data
   * JavaScript expression or function name
   */
  transform?: string;
  /**
   * Filter function for data
   * JavaScript expression or function name
   */
  filter?: string;
  /**
   * Sort configuration
   */
  sort?: {
    /**
     * Field to sort by
     */
    field: string;
    /**
     * Sort order
     */
    order: 'asc' | 'desc';
  };
  /**
   * Pagination configuration
   */
  pagination?: {
    /**
     * Current page
     */
    page?: number;
    /**
     * Page size
     */
    pageSize?: number;
    /**
     * Whether pagination is enabled
     */
    enabled?: boolean;
  };
}

/**
 * Component with data fetching
 */
export interface DataFetchableSchema extends BaseSchema {
  /**
   * Data fetching configuration
   */
  dataSource?: DataFetchConfig;
  /**
   * Loading state
   */
  loading?: boolean;
  /**
   * Error state
   */
  error?: string | null;
  /**
   * Fetched data
   */
  data?: any;
}

/**
 * Expression evaluation context
 */
export interface ExpressionContext {
  /**
   * Current component data
   */
  data?: any;
  /**
   * Global application state
   */
  state?: any;
  /**
   * Form values (when in form context)
   */
  form?: any;
  /**
   * Current user information
   */
  user?: any;
  /**
   * Environment variables
   */
  env?: Record<string, any>;
  /**
   * Utility functions
   */
  utils?: Record<string, (...args: any[]) => any>;
}

/**
 * Expression schema for dynamic values
 */
export interface ExpressionNodeSchema {
  /**
   * Expression type
   */
  type: 'expression';
  /**
   * Expression string
   * Supports ${} syntax for variable interpolation
   */
  value: string;
  /**
   * Default value if expression fails
   */
  defaultValue?: any;
  /**
   * Whether to watch and re-evaluate on context changes
   * @default true
   */
  reactive?: boolean;
}

/**
 * Union type of all API schemas
 */
export type APISchema =
  | DataFetchableSchema
  | ExpressionNodeSchema;
