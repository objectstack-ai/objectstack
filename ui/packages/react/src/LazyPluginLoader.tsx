/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { lazy, Suspense, Component } from 'react';

export interface LazyPluginOptions {
  /**
   * Fallback component to show while loading
   */
  fallback?: React.ReactNode;
  /**
   * Number of retry attempts on load failure (default: 2)
   */
  retries?: number;
  /**
   * Delay in ms between retries (default: 1000)
   */
  retryDelay?: number;
  /**
   * Custom error fallback component
   */
  errorFallback?: React.ComponentType<{ error: Error; retry: () => void }>;
}

/**
 * Error boundary for lazy-loaded plugins
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PluginErrorBoundary extends Component<
  { fallback?: React.ComponentType<{ error: Error; retry: () => void }>; children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback;
      if (FallbackComponent) {
        return <FallbackComponent error={this.state.error} retry={this.handleRetry} />;
      }
      return null;
    }
    return this.props.children;
  }
}

/**
 * Create a lazy-loaded import function with retry support
 */
function createRetryImport<P extends object>(
  importFn: () => Promise<{ default: React.ComponentType<P> }>,
  retries: number,
  retryDelay: number,
): () => Promise<{ default: React.ComponentType<P> }> {
  return () => {
    let attempt = 0;
    const tryImport = (): Promise<{ default: React.ComponentType<P> }> =>
      importFn().catch((err) => {
        attempt++;
        if (attempt <= retries) {
          return new Promise((resolve) =>
            setTimeout(() => resolve(tryImport()), retryDelay),
          );
        }
        throw err;
      });
    return tryImport();
  };
}

/**
 * Create a lazy-loaded plugin component with Suspense wrapper
 *
 * @param importFn - Dynamic import function resolving to a module whose
 *   `default` is the component to render. ObjectUI plugin packages export
 *   their components by NAME and have no `default`, so a bare
 *   `() => import('@object-ui/plugin-<x>')` does NOT satisfy this — it hands
 *   over the module namespace object, which is neither a component at runtime
 *   nor assignable here. Name the component you want, as the examples do.
 * @param options - Configuration options for the lazy plugin
 * @returns A component that lazy loads the plugin
 *
 * @example
 * ```tsx
 * // Basic usage. `@object-ui/plugin-grid` has no default export, so unwrap the
 * // named component. Use the `async` form: the `.then((m) => ({ default: m.X }))`
 * // spelling infers `P` as `never` on one branch of the `then` overload.
 * const ObjectGrid = createLazyPlugin(
 *   async () => ({ default: (await import('@object-ui/plugin-grid')).ObjectGrid })
 * );
 *
 * // With custom fallback
 * const ObjectGridWithFallback = createLazyPlugin(
 *   async () => ({ default: (await import('@object-ui/plugin-grid')).ObjectGrid }),
 *   { fallback: <div>Loading grid...</div> }
 * );
 *
 * // With retry and error handling
 * const ObjectGridWithRetry = createLazyPlugin(
 *   async () => ({ default: (await import('@object-ui/plugin-grid')).ObjectGrid }),
 *   {
 *     retries: 3,
 *     errorFallback: ({ error, retry }) => (
 *       <div>
 *         <p>Failed to load: {error.message}</p>
 *         <button onClick={retry}>Retry</button>
 *       </div>
 *     ),
 *   }
 * );
 * ```
 */
export function createLazyPlugin<P extends object = any>(
  importFn: () => Promise<{ default: React.ComponentType<P> }>,
  options?: LazyPluginOptions
): React.ComponentType<P> {
  const { retries = 2, retryDelay = 1000, errorFallback } = options || {};

  const retryImport = retries > 0
    ? createRetryImport(importFn, retries, retryDelay)
    : importFn;

  const LazyComponent = lazy(retryImport);
  
  const PluginWrapper: React.FC<P> = (props) => {
    const content = (
      <Suspense fallback={options?.fallback || null}>
        <LazyComponent {...props} />
      </Suspense>
    );

    if (errorFallback) {
      return (
        <PluginErrorBoundary fallback={errorFallback}>
          {content}
        </PluginErrorBoundary>
      );
    }

    return content;
  };
  
  return PluginWrapper;
}

/**
 * Preload a plugin module without rendering it.
 * Useful for preloading plugins that will be needed soon.
 *
 * @param importFn - Dynamic import function
 * @returns Promise that resolves when the module is loaded
 *
 * @example
 * ```tsx
 * // Preload on hover
 * const loadGrid = () => import('@object-ui/plugin-grid');
 * <button onMouseEnter={() => preloadPlugin(loadGrid)}>Show Grid</button>
 * ```
 */
export function preloadPlugin<T = unknown>(
  importFn: () => Promise<T>,
): Promise<T> {
  return importFn();
}
