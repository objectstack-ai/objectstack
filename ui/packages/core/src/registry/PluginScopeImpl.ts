/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Plugin Scope Implementation
 * 
 * Section 3.3: Implementation of scoped plugin system to prevent conflicts.
 * Provides isolated component registration, state management, and event bus.
 * 
 * @module plugin-scope-impl
 * @packageDocumentation
 */

import type { 
  PluginScope, 
  PluginScopeConfig, 
  PluginEventHandler
} from '@object-ui/types';
import type { Registry, RegistryComponentMeta } from './Registry.js';

/**
 * Event Bus for scoped plugin events
 */
class EventBus {
  private listeners = new Map<string, Set<PluginEventHandler>>();

  on(event: string, handler: PluginEventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(handler);
      if (this.listeners.get(event)?.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit(event: string, data?: any): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for "${event}":`, error);
        }
      });
    }
  }

  cleanup(): void {
    this.listeners.clear();
  }
}

/**
 * Global event bus for cross-plugin communication
 */
const globalEventBus = new EventBus();

/**
 * Plugin Scope Implementation
 * 
 * Provides isolated access to registry, state, and events for each plugin.
 */
export class PluginScopeImpl implements PluginScope {
  public readonly name: string;
  public readonly version: string;
  
  private registry: Registry;
  private state = new Map<string, any>();
  private eventBus = new EventBus();
  private config: Required<PluginScopeConfig>;

  constructor(
    name: string,
    version: string,
    registry: Registry,
    config?: PluginScopeConfig
  ) {
    this.name = name;
    this.version = version;
    this.registry = registry;
    this.config = {
      enableStateIsolation: config?.enableStateIsolation ?? true,
      enableEventIsolation: config?.enableEventIsolation ?? true,
      allowGlobalEvents: config?.allowGlobalEvents ?? true,
      maxStateSize: config?.maxStateSize ?? 5 * 1024 * 1024, // 5MB
    };
  }

  /**
   * Register a component in the scoped namespace
   */
  registerComponent(type: string, component: any, meta?: any): void {
    // Components are registered as "pluginName:type"
    const registryMeta: RegistryComponentMeta = {
      ...meta,
      namespace: this.name,
    };
    this.registry.register(type, component, registryMeta);
  }

  /**
   * Get a component from the scoped namespace
   */
  getComponent(type: string): any | undefined {
    // First try scoped lookup
    const scoped = this.registry.get(`${this.name}:${type}`);
    if (scoped) {
      return scoped;
    }
    
    // Fall back to global lookup
    return this.registry.get(type);
  }

  /**
   * Scoped state management
   */
  useState<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
    if (!this.config.enableStateIsolation) {
      throw new Error('State isolation is disabled for this plugin');
    }

    // Initialize state if not present
    if (!this.state.has(key)) {
      this.setState(key, initialValue);
    }

    const currentValue = this.getState<T>(key) ?? initialValue;

    const setValue = (value: T | ((prev: T) => T)) => {
      const newValue = typeof value === 'function' 
        ? (value as (prev: T) => T)(this.getState<T>(key) ?? initialValue)
        : value;
      this.setState(key, newValue);
    };

    return [currentValue, setValue];
  }

  /**
   * Get scoped state value
   */
  getState<T>(key: string): T | undefined {
    return this.state.get(key);
  }

  /**
   * Set scoped state value
   */
  setState<T>(key: string, value: T): void {
    if (!this.config.enableStateIsolation) {
      throw new Error('State isolation is disabled for this plugin');
    }

    // Check state size limit
    const stateSize = this.estimateStateSize();
    const valueSize = this.estimateValueSize(value);
    
    if (stateSize + valueSize > this.config.maxStateSize) {
      throw new Error(
        `Plugin "${this.name}" exceeded maximum state size of ${this.config.maxStateSize} bytes`
      );
    }

    this.state.set(key, value);
  }

  /**
   * Subscribe to scoped events
   */
  on(event: string, handler: PluginEventHandler): () => void {
    if (!this.config.enableEventIsolation) {
      // If isolation is disabled, use global event bus
      return this.onGlobal(event, handler);
    }

    // Scoped event: prefix with plugin name
    const scopedEvent = `${this.name}:${event}`;
    return this.eventBus.on(scopedEvent, handler);
  }

  /**
   * Emit a scoped event
   */
  emit(event: string, data?: any): void {
    if (!this.config.enableEventIsolation) {
      // If isolation is disabled, emit globally
      this.emitGlobal(event, data);
      return;
    }

    // Scoped event: prefix with plugin name
    const scopedEvent = `${this.name}:${event}`;
    this.eventBus.emit(scopedEvent, data);
  }

  /**
   * Emit a global event
   */
  emitGlobal(event: string, data?: any): void {
    if (!this.config.allowGlobalEvents) {
      throw new Error('Global events are disabled for this plugin');
    }
    globalEventBus.emit(event, data);
  }

  /**
   * Subscribe to global events
   */
  onGlobal(event: string, handler: PluginEventHandler): () => void {
    if (!this.config.allowGlobalEvents) {
      throw new Error('Global events are disabled for this plugin');
    }
    return globalEventBus.on(event, handler);
  }

  /**
   * Clean up all plugin resources
   */
  cleanup(): void {
    this.state.clear();
    this.eventBus.cleanup();
  }

  /**
   * Estimate total state size in bytes
   */
  private estimateStateSize(): number {
    let size = 0;
    for (const value of this.state.values()) {
      size += this.estimateValueSize(value);
    }
    return size;
  }

  /**
   * Estimate size of a value in bytes
   */
  private estimateValueSize(value: any): number {
    try {
      return JSON.stringify(value).length * 2; // UTF-16 encoding
    } catch {
      // If not serializable, use rough estimate
      return 1024; // 1KB default
    }
  }
}
