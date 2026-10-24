/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * WidgetRegistry - Runtime widget management with auto-discovery.
 *
 * Provides registration, loading, and lookup of runtime widgets
 * described by RuntimeWidgetManifest objects. Widgets can be loaded from
 * ES module URLs, provided inline, or resolved from the component registry.
 *
 * @module
 */

import type {
  RuntimeWidgetManifest,
  ResolvedWidget,
  WidgetRegistryEvent,
  WidgetRegistryListener,
} from '@object-ui/types';
import type { Registry } from './Registry.js';

/**
 * Options for creating a WidgetRegistry instance.
 */
export interface WidgetRegistryOptions {
  /**
   * Component registry to sync loaded widgets into.
   * When a widget is loaded, its component is also registered here.
   */
  componentRegistry?: Registry;
}

/**
 * WidgetRegistry manages runtime-loadable widgets described by manifests.
 *
 * @example
 * ```ts
 * const widgets = new WidgetRegistry({ componentRegistry: registry });
 *
 * widgets.register({
 *   name: 'custom-chart',
 *   version: '1.0.0',
 *   type: 'chart',
 *   label: 'Custom Chart',
 *   source: { type: 'module', url: '/widgets/chart.js' },
 * });
 *
 * const resolved = await widgets.load('custom-chart');
 * ```
 */
export class WidgetRegistry {
  private manifests = new Map<string, RuntimeWidgetManifest>();
  private resolved = new Map<string, ResolvedWidget>();
  private listeners = new Set<WidgetRegistryListener>();
  private componentRegistry?: Registry;

  constructor(options: WidgetRegistryOptions = {}) {
    this.componentRegistry = options.componentRegistry;
  }

  /**
   * Register a widget manifest.
   * Does not load the widget; call `load()` to resolve it.
   */
  register(manifest: RuntimeWidgetManifest): void {
    this.manifests.set(manifest.name, manifest);
    this.emit({ type: 'widget:registered', widget: manifest });
  }

  /**
   * Register multiple widget manifests at once.
   */
  registerAll(manifests: RuntimeWidgetManifest[]): void {
    for (const manifest of manifests) {
      this.register(manifest);
    }
  }

  /**
   * Unregister a widget by name.
   */
  unregister(name: string): boolean {
    const existed = this.manifests.delete(name);
    this.resolved.delete(name);
    if (existed) {
      this.emit({ type: 'widget:unregistered', name });
    }
    return existed;
  }

  /**
   * Get a widget manifest by name.
   */
  getManifest(name: string): RuntimeWidgetManifest | undefined {
    return this.manifests.get(name);
  }

  /**
   * Get all registered widget manifests.
   */
  getAllManifests(): RuntimeWidgetManifest[] {
    return Array.from(this.manifests.values());
  }

  /**
   * Get manifests filtered by category.
   */
  getByCategory(category: string): RuntimeWidgetManifest[] {
    return this.getAllManifests().filter((m) => m.category === category);
  }

  /**
   * Check if a widget is registered.
   */
  has(name: string): boolean {
    return this.manifests.has(name);
  }

  /**
   * Check if a widget has been loaded (resolved).
   */
  isLoaded(name: string): boolean {
    return this.resolved.has(name);
  }

  /**
   * Load (resolve) a widget by name.
   * If already loaded, returns the cached resolved widget.
   *
   * @throws Error if the widget is not registered or fails to load.
   */
  async load(name: string): Promise<ResolvedWidget> {
    // Return cached if already loaded
    const cached = this.resolved.get(name);
    if (cached) return cached;

    const manifest = this.manifests.get(name);
    if (!manifest) {
      const error = new Error(`Widget "${name}" is not registered`);
      this.emit({ type: 'widget:error', name, error });
      throw error;
    }

    // Resolve dependencies first
    if (manifest.dependencies) {
      for (const dep of manifest.dependencies) {
        if (!this.isLoaded(dep)) {
          await this.load(dep);
        }
      }
    }

    try {
      const component = await this.resolveComponent(manifest);

      const resolved: ResolvedWidget = {
        manifest,
        component,
        loadedAt: Date.now(),
      };

      this.resolved.set(name, resolved);

      // Sync to component registry if available
      if (this.componentRegistry) {
        this.componentRegistry.register(manifest.type, component as any, {
          label: manifest.label,
          icon: manifest.icon,
          category: manifest.category,
          // `WidgetInput.label` / `defaultValue` / `advanced` are NOT copied
          // across: they are ADR-0049 retirement tombstones on BOTH faces now
          // (`ComponentInput` by objectui#7493 / objectui#7781,
          // `WidgetInput` by objectui#7911) — the manifest serializer never
          // forwarded them and no consumer of `ComponentMeta.inputs` read them,
          // so this copy was the one non-test write of the three keys and it
          // fed nothing. Restoring a line here would assign from a `never`.
          inputs: manifest.inputs?.map((input) => ({
            name: input.name,
            type: input.type,
            required: input.required,
            enum: input.options,
            description: input.description,
          })),
          defaultProps: manifest.defaultProps as Record<string, any>,
          isContainer: manifest.isContainer,
        });
      }

      this.emit({ type: 'widget:loaded', widget: resolved });
      return resolved;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit({ type: 'widget:error', name, error });
      throw error;
    }
  }

  /**
   * Load all registered widgets.
   * Returns an array of results (settled promises).
   */
  async loadAll(): Promise<Array<{ name: string; result: ResolvedWidget | Error }>> {
    const results: Array<{ name: string; result: ResolvedWidget | Error }> = [];

    for (const [name] of this.manifests) {
      try {
        const resolved = await this.load(name);
        results.push({ name, result: resolved });
      } catch (err) {
        results.push({ name, result: err instanceof Error ? err : new Error(String(err)) });
      }
    }

    return results;
  }

  /**
   * Subscribe to widget registry events.
   * @returns Unsubscribe function.
   */
  on(listener: WidgetRegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Clear all registered and loaded widgets.
   */
  clear(): void {
    this.manifests.clear();
    this.resolved.clear();
  }

  /**
   * Get registry statistics.
   */
  getStats(): { registered: number; loaded: number; categories: string[] } {
    const categories = new Set<string>();
    for (const m of this.manifests.values()) {
      if (m.category) categories.add(m.category);
    }
    return {
      registered: this.manifests.size,
      loaded: this.resolved.size,
      categories: Array.from(categories),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async resolveComponent(manifest: RuntimeWidgetManifest): Promise<unknown> {
    const { source } = manifest;

    switch (source.type) {
      case 'inline':
        return source.component;

      case 'registry': {
        if (!this.componentRegistry) {
          throw new Error(
            `Widget "${manifest.name}" uses registry source but no component registry is configured`,
          );
        }
        const component = this.componentRegistry.get(source.registryKey);
        if (!component) {
          throw new Error(
            `Widget "${manifest.name}" references registry key "${source.registryKey}" which is not registered`,
          );
        }
        return component;
      }

      case 'module': {
        // Runtime-only dynamic import for loading widgets from external URLs
        // This uses Function constructor to prevent bundlers (Webpack/Turbopack/Vite)
        // from attempting static analysis at build time, which would fail since
        // source.url is only known at runtime.
        //
        // Security: Widget URLs must be from trusted sources only. Never pass
        // user-supplied URLs directly to RuntimeWidgetManifest. URLs should be validated
        // and controlled by the application developer.
        //
        // CSP Consideration: If your application uses strict Content Security Policy,
        // ensure dynamic imports are allowed or use 'inline' or 'registry' source types.
        const dynamicImport = new Function('url', 'return import(url)');
        const mod = await dynamicImport(source.url);
        const exportName = source.exportName ?? 'default';
        const component = mod[exportName];
        if (!component) {
          throw new Error(
            `Widget "${manifest.name}" module at "${source.url}" does not export "${exportName}"`,
          );
        }
        return component;
      }

      default:
        throw new Error(`Unknown widget source type for "${manifest.name}"`);
    }
  }

  private emit(event: WidgetRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }
}
