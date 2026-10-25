/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useEffect, useContext } from 'react';
import { SchemaRendererContext } from '../context/SchemaRendererContext.js';

/**
 * Discovery service information structure.
 * Represents server capabilities and service status.
 */
/**
 * Per-service availability entry (framework 15.1+, ADR-0076 D12 "honest
 * capabilities"): discovery no longer hardcodes every registered service as
 * `available` — a dev fake reports `stub`, a serving fallback reports
 * `degraded`, and `handlerReady` says whether a real handler backs the route.
 * Older servers omit `handlerReady` and only ever report
 * `available`/`unavailable`, so consumers must treat the new fields as
 * OPT-IN signals (see {@link isServiceUsable}), never require them.
 */
export interface DiscoveryServiceStatus {
  enabled: boolean;
  status?: 'available' | 'degraded' | 'stub' | 'unavailable';
  handlerReady?: boolean;
}

/**
 * The backward-compatible "can I actually use this service?" check
 * (ADR-0076 D12 console slice):
 *
 * - absent entry / absent fields → usable (pre-15.1 servers say nothing —
 *   keep their historical default);
 * - `enabled: false` or `handlerReady: false` → not usable;
 * - `status: 'stub'` → not usable (a dev fake must not be treated as the
 *   real service — the exact dishonesty D12 removed);
 * - `status: 'degraded'` → USABLE (a fallback that keeps serving; callers
 *   may surface a warning but must not turn the feature off).
 */
export function isServiceUsable(svc: DiscoveryServiceStatus | undefined | null): boolean {
  if (!svc) return true;
  if (svc.enabled === false) return false;
  if (svc.handlerReady === false) return false;
  if (svc.status === 'stub' || svc.status === 'unavailable') return false;
  return true;
}

export interface DiscoveryInfo {
  /** Server name and version */
  name?: string;
  version?: string;
  
  /** Runtime mode the server reports (`RuntimeMode` in `@objectstack/spec`) */
  mode?: string;
  
  /** Service availability status */
  services?: {
    /** Authentication service status */
    auth?: DiscoveryServiceStatus & { message?: string };
    /** Data access service status */
    data?: DiscoveryServiceStatus;
    /** Metadata service status */
    metadata?: DiscoveryServiceStatus;
    /** AI service configuration */
    ai?: DiscoveryServiceStatus & {
      /** AI service endpoint route (e.g. '/api/v1/ai') */
      route?: string;
    };
    [key: string]: any;
  };
  
  /** API capabilities */
  capabilities?: string[];
  
  /** Additional discovery metadata */
  [key: string]: any;
}

/**
 * Hook to access discovery information from the ObjectStack server.
 * 
 * This hook retrieves server capabilities and service status, which can be used
 * to conditionally enable/disable features based on server configuration.
 * 
 * @example
 * ```tsx
 * function App() {
 *   const { discovery, isLoading } = useDiscovery();
 *   
 *   if (isLoading) {
 *     return <LoadingScreen />;
 *   }
 *   
 *   // Check if auth is enabled on the server
 *   const authEnabled = discovery?.services?.auth?.enabled ?? true;
 *   
 *   return (
 *     <div>
 *       {authEnabled ? <AuthProvider>...</AuthProvider> : <App />}
 *     </div>
 *   );
 * }
 * ```
 * 
 * @returns Discovery information and loading state
 */
export function useDiscovery() {
  const context = useContext(SchemaRendererContext);
  const dataSource = context?.dataSource;
  const [discovery, setDiscovery] = useState<DiscoveryInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDiscovery() {
      if (!dataSource) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        
        // Check if dataSource has getDiscovery method
        if (typeof (dataSource as any).getDiscovery === 'function') {
          const discoveryData = await (dataSource as any).getDiscovery();
          
          if (!cancelled) {
            setDiscovery(discoveryData);
            setError(null);
          }
        } else {
          // DataSource doesn't support discovery
          if (!cancelled) {
            setDiscovery(null);
            setError(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Failed to fetch discovery'));
          setDiscovery(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchDiscovery();

    return () => {
      cancelled = true;
    };
  }, [dataSource]);

  return {
    discovery,
    isLoading,
    error,
    /**
     * Check if authentication is enabled AND actually backed by a real
     * handler (ADR-0076 D12 — a `stub`/`handlerReady:false` auth service is
     * not treated as real auth). Defaults to true when discovery data is not
     * available (pre-15.1 servers report nothing).
     */
    isAuthEnabled: isServiceUsable(discovery?.services?.auth),
    /**
     * Check if AI service is enabled and available on the server.
     * Defaults to false if discovery data is not available; `degraded`
     * still counts as available (it serves), `stub` never does.
     */
    isAiEnabled:
      discovery?.services?.ai?.enabled === true &&
      (discovery?.services?.ai?.status === 'available' || discovery?.services?.ai?.status === 'degraded') &&
      discovery?.services?.ai?.handlerReady !== false,
  };
}

