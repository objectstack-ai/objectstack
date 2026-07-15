// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime interfaces for ObjectStack plugins.
 * These define the contract that every plugin must implement to be loaded by the ObjectStack runtime.
 */

/**
 * Logger interface provided to plugins for structured logging.
 */
export interface PluginLogger {
  /** Log an informational message */
  info(message: string, meta?: Record<string, any>): void;
  /** Log a warning message */
  warn(message: string, meta?: Record<string, any>): void;
  /** Log an error message */
  error(message: string, error?: Error, meta?: Record<string, any>): void;
  /** Log a debug message */
  debug(message: string, meta?: Record<string, any>): void;
}

/**
 * ObjectQL Client interface for database operations.
 * Provides a GraphQL-like query interface to the ObjectStack data layer.
 */
export interface ObjectQLClient {
  /**
   * Execute a query against the ObjectQL engine.
   * @param query - The ObjectQL query string
   * @param variables - Optional variables for the query
   * @returns Promise resolving to query results
   */
  query<T = any>(query: string, variables?: Record<string, any>): Promise<T>;
  
  /**
   * Execute a mutation against the ObjectQL engine.
   * @param mutation - The ObjectQL mutation string
   * @param variables - Optional variables for the mutation
   * @returns Promise resolving to mutation results
   */
  mutate<T = any>(mutation: string, variables?: Record<string, any>): Promise<T>;
}

/**
 * Kernel interface.
 * Provides access to core operating system services.
 */
export interface IKernel {
  /**
   * Get a reference to another installed plugin by its ID.
   * @param pluginId - The unique identifier of the plugin
   * @returns The plugin instance or null if not found
   */
  getPlugin(pluginId: string): any | null;
  
  /**
   * Emit an event to the system event bus.
   * @param event - The event name
   * @param data - The event payload
   */
  emit(event: string, data?: any): void;
  
  /**
   * Subscribe to system events.
   * @param event - The event name to listen for
   * @param handler - Callback function to handle the event
   * @returns Unsubscribe function
   */
  on(event: string, handler: (data: any) => void): () => void;
}

/** @deprecated Renamed — use {@link IKernel}. The "ObjectOS" layer name is retired; ObjectOS now names the commercial runtime environment. */
export type ObjectOSKernel = IKernel;

/**
 * Plugin Context provided to plugin lifecycle methods.
 * This context gives plugins access to the ObjectStack runtime environment.
 */
export interface PluginContext {
  /**
   * ObjectQL client for database operations.
   * Use this to query and mutate data in the ObjectStack data layer.
   */
  ql: ObjectQLClient;
  
  /**
   * Kernel for system-level operations.
   * Use this to interact with other plugins and system services.
   */
  os: IKernel;
  
  /**
   * Logger instance for structured logging.
   * All logs are automatically tagged with the plugin ID.
   */
  logger: PluginLogger;
  
  /**
   * The unique identifier of this plugin.
   */
  pluginId: string;
  
  /**
   * Plugin configuration values (from manifest or runtime config).
   */
  config: Record<string, any>;
}

/**
 * Plugin Lifecycle Interface.
 * Every ObjectStack plugin must default export an object implementing this interface.
 */
export interface ObjectStackPlugin {
  /**
   * Called when the plugin is installed for the first time.
   * Use this to run one-time setup tasks (e.g. creating database tables).
   */
  onInstall?: (context: PluginContext) => Promise<void>;
  
  /**
   * Called when the plugin is enabled (at startup or manually).
   * Use this to register event listeners, start background tasks, etc.
   */
  onEnable?: (context: PluginContext) => Promise<void>;
  
  /**
   * Called when the plugin is disabled (at shutdown or manually).
   * Use this to cleanup resources, stop tasks, remove listeners.
   */
  onDisable?: (context: PluginContext) => Promise<void>;
}
