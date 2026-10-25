// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ComponentRegistry — central lookup for first-party UI components that
 * are addressable from App metadata via the `component` nav-item type.
 *
 * Phase 3b: introduced so the framework's Setup app (and any other app)
 * can declare admin/setup surfaces declaratively:
 *
 * ```ts
 * { id: 'nav_objects', type: 'component',
 *   componentRef: 'metadata:resource',
 *   params: { type: 'object' } }
 * ```
 *
 * Why a registry instead of importing the component directly in
 * AppContent.tsx?
 *   • Keeps the app-shell agnostic of which plugins are installed.
 *   • Lets plugin packages (plugin-designer, plugin-permissions,
 *     plugin-metadata-admin, …) register their pages without
 *     forcing a coupled import graph.
 *   • Provides a single place to render a friendly "component not
 *     registered" empty state when a metadata entry references a
 *     plugin that isn't loaded.
 *
 * Convention: registry keys are `namespace:name` (colon-separated).
 * The namespace maps to a route segment so URLs stay clean:
 *   `metadata:resource` → `/component/metadata/resource`
 * Params from the nav metadata are serialised as query string.
 */

import type { ComponentType } from 'react';

export type AppComponentRegistryEntry = {
  /** Registry key, e.g. `metadata:resource`. */
  ref: string;
  /** Human-readable label for diagnostics / "Component not found" empty state. */
  label?: string;
  /** Owning plugin / package id, for diagnostics. */
  source?: string;
  /** The React component. Receives the merged params (nav `params` + URL query) as props. */
  component: ComponentType<any>;
};

const REGISTRY = new Map<string, AppComponentRegistryEntry>();

/**
 * Register (or replace) a component. Idempotent — re-registering with the
 * same `ref` overwrites the previous entry, which is the expected behavior
 * during HMR / dev workflows.
 */
export function registerAppComponent(entry: AppComponentRegistryEntry): void {
  REGISTRY.set(entry.ref, entry);
}

/**
 * Look up a component by ref. Returns `undefined` if not registered;
 * AppContent surfaces this as a structured empty state so the operator
 * knows which plugin is missing.
 */
export function getAppComponent(ref: string): AppComponentRegistryEntry | undefined {
  return REGISTRY.get(ref);
}

/**
 * Snapshot of all registered components — used by diagnostics surfaces
 * (e.g. a future "Installed UI Components" admin page).
 */
export function listAppComponents(): AppComponentRegistryEntry[] {
  return Array.from(REGISTRY.values());
}

/**
 * Convert `metadata:resource` ↔ URL segments `['metadata', 'resource']`.
 * Component refs are restricted to one colon in MVP, but the helper is
 * future-proofed for nested keys (`metadata:resource:edit`).
 */
export function componentRefToUrlSegments(ref: string): string[] {
  return ref.split(':').filter(Boolean);
}

export function urlSegmentsToComponentRef(segments: string[]): string {
  return segments.filter(Boolean).join(':');
}
