/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Plugin Scope Isolation
 * 
 * Section 3.3: Plugin scope isolation types to prevent conflicts between plugins.
 * Provides scoped component registration, state management, and event bus.
 * 
 * @module plugin-scope
 * @packageDocumentation
 */

import type { ComponentMeta } from './base.js';

/**
 * Plugin Scope Interface
 * 
 * Provides isolated access to the component registry, state management,
 * and event bus for a specific plugin, preventing conflicts between plugins.
 */
export interface PluginScope {
  /**
   * Plugin name
   */
  name: string;
  
  /**
   * Plugin version
   */
  version: string;
  
  /**
   * Register a component in the scoped namespace.
   * Components will be registered as "pluginName:type" to prevent conflicts.
   * 
   * @param type - Component type identifier (e.g., 'table', 'chart')
   * @param component - Component renderer
   * @param meta - Optional component metadata
   * 
   * @example
   * // Plugin 'my-grid' registers a 'table' component
   * // Registered as 'my-grid:table'
   * scope.registerComponent('table', TableComponent, {
   *   label: 'Data Table',
   *   category: 'data'
   * });
   */
  registerComponent(type: string, component: any, meta?: ComponentMeta): void;
  
  /**
   * Get a component from the scoped namespace.
   * First tries scoped lookup (pluginName:type), then falls back to global.
   * 
   * @param type - Component type identifier
   * @returns Component renderer or undefined if not found
   */
  getComponent(type: string): any | undefined;
  
  /**
   * Scoped state management.
   * Each plugin has its own isolated state that won't conflict with others.
   * 
   * @param key - State key unique to this plugin
   * @param initialValue - Initial state value
   * @returns Tuple of [currentValue, setValue]
   * 
   * @example
   * const [config, setConfig] = scope.useState('config', { theme: 'light' });
   */
  useState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void];
  
  /**
   * Get scoped state value without setter.
   * 
   * @param key - State key
   * @returns Current state value or undefined
   */
  getState<T>(key: string): T | undefined;
  
  /**
   * Set scoped state value directly.
   * 
   * @param key - State key
   * @param value - New state value
   */
  setState<T>(key: string, value: T): void;
  
  /**
   * Subscribe to scoped events.
   * Events are namespaced to prevent cross-plugin conflicts.
   * 
   * @param event - Event name (will be prefixed with plugin namespace)
   * @param handler - Event handler function
   * @returns Unsubscribe function
   * 
   * @example
   * const unsubscribe = scope.on('data-updated', (data) => {
   *   console.log('Scoped event received:', data);
   * });
   */
  on(event: string, handler: PluginEventHandler): () => void;
  
  /**
   * Emit a scoped event.
   * Only subscribers within this plugin scope will receive it.
   * 
   * @param event - Event name
   * @param data - Event data
   * 
   * @example
   * scope.emit('data-updated', { rows: 100 });
   */
  emit(event: string, data?: any): void;
  
  /**
   * Emit a global event that all plugins can receive.
   * Use sparingly for cross-plugin communication.
   * 
   * @param event - Event name
   * @param data - Event data
   */
  emitGlobal(event: string, data?: any): void;
  
  /**
   * Subscribe to global events from any plugin.
   * 
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  onGlobal(event: string, handler: PluginEventHandler): () => void;
  
  /**
   * Clean up all plugin resources (state, event listeners, etc.)
   * Called automatically when plugin is unloaded.
   */
  cleanup(): void;
}

/**
 * Component metadata for registration
 *
 * The plugin-scoped twin of `base.ts`' {@link ComponentMeta} is no longer a
 * twin: it is the SAME declaration, RE-EXPORTED rather than restated
 * (objectui#5893), following the shape objectui#5671 executed for the sibling
 * type `ComponentInput` in this same file. This is objectui#4580's ruling
 * applied to the second member of the family — *a structural copy would
 * reproduce the defect the moment either side moved.*
 *
 * Either side HAD moved, which is why this was not hypothetical. `base.ts`
 * carried eleven keys; this copy carried nine — `tags` and `description` were
 * missing here. A plugin author typing against the plugin-facing declaration
 * could not write two keys the main surface advertises, and which the runtime
 * validator (`ComponentMetaSchema` in `zod/base.zod.ts`) already accepted: two
 * of the three authorities agreed and this one did not. Nothing a user hits
 * was broken today, because no plugin registration had tried to write one yet.
 *
 * Re-exported under this name so that `index.ts`' public
 * `ComponentMeta as PluginComponentMeta` alias keeps naming a real export.
 * That alias is `@deprecated` as of the same card, on objectui#5674's pattern:
 * with the declaration shared, the second published name carries no
 * information the first does not.
 *
 * Note for whoever completes that retirement: this re-export is a SEPARATE
 * binding from the `import type { ComponentMeta }` at the top of the file. The
 * import is what types `PluginScope.registerComponent`'s `meta` parameter and
 * stays regardless; this re-export's only consumer is the aliased specifier in
 * `index.ts`, so it goes dead the moment that alias is deleted and should be
 * removed with it.
 */
export type { ComponentMeta } from './base.js';

/**
 * Event handler type
 */
export type PluginEventHandler = (data?: any) => void;

/**
 * Plugin lifecycle context passed to init/start/stop hooks
 */
export interface AppPluginContext {
  /** Logger instance (falls back to console) */
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  /** Kernel/runtime reference for plugin registration */
  kernel?: { use?: (plugin: AppMetadataPlugin | Record<string, unknown>) => Promise<void> | void };
  [key: string]: unknown;
}

/**
 * App Metadata Plugin Interface
 *
 * Standard interface for plugins that provide application metadata
 * (objects, views, actions, dashboards, etc.) to ObjectStack.
 * All example apps and third-party plugins should implement this interface.
 *
 * @example
 * ```typescript
 * export class MyPlugin implements AppMetadataPlugin {
 *   name = '@my-org/my-plugin';
 *   version = '1.0.0';
 *   type = 'app-metadata' as const;
 *   description = 'My custom plugin';
 *
 *   async init() { }
 *   async start(ctx) { ... }
 *   async stop() { }
 * }
 * ```
 */
export interface AppMetadataPlugin {
  /** Unique plugin identifier (npm-style, e.g. '@object-ui/example-crm') */
  readonly name: string;
  /** Semantic version */
  readonly version: string;
  /** Plugin type discriminator */
  readonly type: 'app-metadata';
  /** Human-readable description */
  readonly description?: string;

  /**
   * Initialize the plugin (pre-start setup).
   * Called before start() to allow validation or config loading.
   */
  init(): Promise<void> | void;

  /**
   * Start the plugin — register metadata with the kernel/runtime.
   * @param ctx - Lifecycle context providing logger and kernel references
   */
  start(ctx: AppPluginContext): Promise<void> | void;

  /**
   * Stop the plugin — tear down resources and deregister.
   * Called when the plugin is uninstalled or the host shuts down.
   */
  stop(): Promise<void> | void;

  /** Raw stack configuration for legacy/manual merging */
  getConfig?(): any;
}

/**
 * Plugin scope configuration
 */
export interface PluginScopeConfig {
  /**
   * Whether to enable state isolation (default: true)
   */
  enableStateIsolation?: boolean;
  
  /**
   * Whether to enable event isolation (default: true)
   */
  enableEventIsolation?: boolean;
  
  /**
   * Whether to allow global event access (default: true)
   */
  allowGlobalEvents?: boolean;
  
  /**
   * Maximum state size per plugin in bytes (default: 5MB)
   */
  maxStateSize?: number;
}
