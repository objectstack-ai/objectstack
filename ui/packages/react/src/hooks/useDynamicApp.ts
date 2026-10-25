/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Options for dynamic app configuration loading.
 */
export interface DynamicAppOptions<TAppConfig = unknown> {
  /** Application identifier to load */
  appId: string;
  /**
   * Static (fallback) configuration used when the server does not
   * provide an app definition or is unreachable.
   */
  staticConfig?: TAppConfig;
  /**
   * Data source adapter with `getApp` and `invalidateCache` methods.
   * Typically an ObjectStackAdapter instance.
   */
  adapter?: {
    getApp: (appId: string) => Promise<unknown | null>;
    invalidateCache?: (key?: string) => void;
    getObjectSchema?: (objectName: string) => Promise<unknown>;
  };
  /** Whether to attempt loading from the server (default: true) */
  enabled?: boolean;
}

/**
 * Result returned by useDynamicApp.
 */
export interface DynamicAppResult<TAppConfig = unknown> {
  /** The resolved app configuration (server or static fallback) */
  config: TAppConfig | null;
  /** Whether the configuration is currently loading */
  isLoading: boolean;
  /** Error from the most recent load attempt */
  error: Error | null;
  /** Whether the config was loaded from the server (vs static fallback) */
  isServerConfig: boolean;
  /** Re-fetch the app configuration from the server, invalidating cache */
  refresh: () => Promise<void>;
}

/**
 * React hook for dynamic app configuration loading.
 *
 * Fetches app configuration from the server via `adapter.getApp(appId)`,
 * falling back to `staticConfig` when the server is unavailable.
 * Supports cache-based hot-reload via the `refresh()` callback.
 *
 * @example
 * ```tsx
 * import { useDynamicApp } from '@object-ui/react';
 * import staticAppConfig from '../config/app.json';
 *
 * function App() {
 *   const { config, isLoading, refresh } = useDynamicApp({
 *     appId: 'crm',
 *     staticConfig: staticAppConfig,
 *     adapter: dataSource,
 *   });
 *
 *   if (isLoading) return <LoadingScreen />;
 *   return <Console config={config} onRefresh={refresh} />;
 * }
 * ```
 */
export function useDynamicApp<TAppConfig = unknown>(
  options: DynamicAppOptions<TAppConfig>,
): DynamicAppResult<TAppConfig> {
  const { appId, staticConfig, adapter, enabled = true } = options;

  const [config, setConfig] = useState<TAppConfig | null>(staticConfig ?? null);
  const [isLoading, setIsLoading] = useState(enabled && !!adapter);
  const [error, setError] = useState<Error | null>(null);
  const [isServerConfig, setIsServerConfig] = useState(false);

  // Ref to track unmount / stale requests
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadConfig = useCallback(async () => {
    if (!adapter || !enabled) {
      setConfig(staticConfig ?? null);
      setIsServerConfig(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const serverConfig = await adapter.getApp(appId);

      if (!mountedRef.current) return;

      if (serverConfig) {
        setConfig(serverConfig as TAppConfig);
        setIsServerConfig(true);
      } else {
        // Server returned null — fall back to static config
        setConfig(staticConfig ?? null);
        setIsServerConfig(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;

      setError(err instanceof Error ? err : new Error(String(err)));
      // Fall back to static config on error
      setConfig(staticConfig ?? null);
      setIsServerConfig(false);
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [adapter, appId, staticConfig, enabled]);

  // Load on mount and when appId changes
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const refresh = useCallback(async () => {
    // Invalidate cache before re-fetching
    adapter?.invalidateCache?.(`app:${appId}`);
    await loadConfig();
  }, [adapter, appId, loadConfig]);

  return { config, isLoading, error, isServerConfig, refresh };
}
