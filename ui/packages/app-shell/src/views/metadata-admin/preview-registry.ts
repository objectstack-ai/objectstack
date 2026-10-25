// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataPreviewRegistry — per-type "Preview" tab renderers for the
 * metadata-admin engine.
 *
 * The Preview tab is opt-in: a type only gets a Preview tab when its
 * type id is registered here. This matches the philosophy used for
 * `DesignerTab` and the bespoke `EditPage` in `registry.ts` — generic
 * by default, escape hatch when a type benefits from a richer surface.
 *
 * The renderer receives the **current draft** (not the saved layered
 * record), so users see their unsaved edits live. Drafts can be
 * incomplete or invalid — implementations must defensively read fields.
 *
 *   registerMetadataPreview('page', PagePreview);
 *   const Preview = useRegisteredMetadataPreview('page'); // in a component
 *   if (Preview) <Preview type="page" name="crm_welcome" draft={draft} />;
 *
 * If the type isn't registered, the engine simply omits the tab — no
 * empty "preview not available" surface is shown.
 *
 * ## Reading the registry (objectui#11939)
 *
 * The registry is observable. A component reads it during render through
 * `useRegisteredMetadataPreview(type)` / `useRegisteredMetadataPreviewTypes()`,
 * and re-renders when a registration lands after its first render — a designer
 * that arrives in a lazily loaded chunk brings the surface back from its
 * fallback. `getMetadataPreview` / `listMetadataPreviewTypes` stay what they
 * were: a read of the registry as it is at the moment of the call, for event
 * handlers and other code that does not render. A render-time `get*` read is
 * never told about a later registration, so the component stays on whatever it
 * read first.
 */

import { useSyncExternalStore, type ComponentType } from 'react';
import { requestBuiltinDesigners } from './builtin-designers-loader.js';

/**
 * Identifies a sub-element selected inside a preview surface.
 *
 *   { kind: 'widget', id: 'metric_revenue', label: 'Revenue (KPI)' }
 *
 * `kind` is preview-defined (dashboard uses 'widget'; page may use
 * 'block'; view may use 'column'). The host (`ResourceEditPage`) is
 * agnostic — it only forwards the value to the registered inspector.
 */
export interface MetadataSelection {
  kind: string;
  id: string;
  label?: string;
}

export interface MetadataPreviewProps {
  /** The metadata type, e.g. 'page', 'dashboard'. */
  type: string;
  /** The item's primary-key name. May be empty string in create mode. */
  name: string;
  /**
   * The live draft from the Form tab. Implementations should treat this
   * as immutable and untrusted (validation may be in progress).
   */
  draft: Record<string, unknown>;
  /**
   * Optional: apply a shallow patch to the draft. When omitted, the
   * preview surface is read-only (legacy behavior). When provided, the
   * preview may offer in-place edits (Airtable-style column management,
   * inline rename, etc.) — implementations should respect `editing`
   * before exposing mutating affordances.
   */
  onPatch?: (patch: Record<string, unknown>) => void;
  /**
   * Optional: the last *published* version of this item, for previews
   * that offer a review/diff mode (e.g. the object designer diffing an
   * AI-authored draft against what's live). Undefined in create mode or
   * when no published baseline exists.
   */
  baseline?: Record<string, unknown>;
  /**
   * Optional: whether the host is in edit mode. Previews that ship
   * editing affordances should render them in a disabled/hidden state
   * when `editing === false`.
   */
  editing?: boolean;
  /**
   * Optional: BCP-47 locale code (e.g. 'en', 'zh-CN') for previews that
   * render localized labels. Defaults are derived from the host locale.
   */
  locale?: string;
  /**
   * Optional: the currently selected sub-element (e.g. a dashboard
   * widget). Previews use this to render selection chrome (highlight
   * ring, keyboard focus) and the host uses it to swap the inspector
   * to a scoped sub-form. `null` means "nothing selected → show the
   * top-level form".
   */
  selection?: MetadataSelection | null;
  /**
   * Optional: notify the host that the user picked (or cleared) a
   * sub-element. Pair with {@link MetadataPreviewProps.selection} and
   * a registered inspector (`registerMetadataInspector`) to get the
   * "click widget → edit widget in the right panel" pattern.
   */
  onSelectionChange?: (selection: MetadataSelection | null) => void;
  /**
   * Optional: server-computed validation diagnostics for the current draft
   * (the layered record's `_diagnostics`, kept in sync with live client-side
   * issues). Each entry carries a dotted JSON path so a preview can map it onto
   * the offending sub-element. Used by the flow preview's Problems panel +
   * on-canvas badges; ignored by previews that don't surface diagnostics.
   */
  diagnostics?: Array<{ path?: string; message: string; severity?: 'error' | 'warning' }>;
}

export type MetadataPreview = ComponentType<MetadataPreviewProps>;

/**
 * The store behind each of the three designer registries — this module,
 * `inspector-registry.ts` and `default-inspector-registry.ts` (objectui#11939):
 * a `type → component` `Map` plus change notification, read from React through
 * `useSyncExternalStore`.
 *
 * Module-internal. The package entry re-exports the registries' hooks, never
 * this store. It sits in this module because the other two registries already
 * take their shared types from here.
 */
export interface ObservableTypeRegistry<T> {
  /**
   * Store `value` under `type`, replacing any earlier entry, and notify subscribers —
   * except inside a built-in pass ({@link registerAsBuiltIns}), which never
   * replaces an entry that is already there.
   */
  set(type: string, value: T): void;
  /**
   * The entry for `type` as it is now. Like every read, it asks for the
   * built-in designers (`./builtin-designers-loader.ts`).
   */
  get(type: string): T | undefined;
  /**
   * A new sorted array of the registered types, the caller's to keep or mutate.
   * Like every read, it asks for the built-in designers.
   */
  types(): string[];
  /** Call `listener` after every change; returns the function that stops it. */
  subscribe(listener: () => void): () => void;
  /** The entry for `type`, read so that the calling component re-renders when it changes. */
  useEntry(type: string): T | undefined;
  /**
   * The registered types, sorted and frozen, read so that the calling component
   * re-renders when a new type is registered. The same array is returned until
   * then.
   */
  useTypes(): readonly string[];
}

/**
 * How many built-in registration passes are running (objectui#11939 step 2).
 * Shared by every store this module creates, so one pass covers all three
 * designer registries. See {@link registerAsBuiltIns}.
 */
let builtInPasses = 0;

/**
 * Run `register` as a BUILT-IN registration pass: while it runs, a
 * registration into any of the three designer registries stores its component
 * only for a type that has no entry yet, and leaves an existing entry — and its
 * readers — untouched.
 *
 * Why (objectui#11939 step 2): the package entry loads the built-in designers
 * with a dynamic `import()`, so they arrive AFTER the host's own start-up code
 * has run. A host that registers its own designer right after importing the
 * entry — the override `previews/index.ts` documents — would otherwise be
 * overwritten by the built-in that lands later (measured on objectui#11798).
 * Through this pass the host's entry is kept, whichever of the two comes first:
 *
 *   - host first, built-ins later: the built-in for that type is skipped;
 *   - built-ins first, host later: `register*` replaces the built-in, as it
 *     always has — outside a pass every registration is last-write-wins.
 *
 * Module-internal: the package entry does not re-export it. The one caller
 * outside tests is `register-builtin-designers.ts`.
 */
export function registerAsBuiltIns(register: () => void): void {
  builtInPasses += 1;
  try {
    register();
  } finally {
    builtInPasses -= 1;
  }
}

export function createObservableTypeRegistry<T>(): ObservableTypeRegistry<T> {
  const entries = new Map<string, T>();
  const listeners = new Set<() => void>();
  // `useSyncExternalStore` compares snapshots with `Object.is`: a snapshot that
  // is a new array on every read never compares equal, which React reports as
  // an uncached snapshot and answers with an endless re-render. So the types
  // snapshot is built once per change of the type SET and reused until then.
  // Replacing an existing type's entry leaves the set, and this array, as it is.
  let typesSnapshot: readonly string[] = Object.freeze([] as string[]);

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  // What the reader hooks subscribe with: a reader is a read, so it asks for
  // the built-in designers (`./builtin-designers-loader.ts`, objectui#12187).
  // React subscribes after the commit, so the request is not a render-phase
  // effect.
  const subscribeReader = (listener: () => void): (() => void) => {
    requestBuiltinDesigners();
    return subscribe(listener);
  };
  const readTypes = (): readonly string[] => typesSnapshot;

  return {
    set(type, value) {
      const known = entries.has(type);
      // A built-in never displaces an entry that is already there — the host's
      // own registration, made before the lazily loaded built-ins arrived
      // (`registerAsBuiltIns`).
      if (known && builtInPasses > 0) return;
      // Re-registering the component already stored changes nothing a reader
      // can see, so it notifies no one.
      if (known && entries.get(type) === value) return;
      entries.set(type, value);
      if (!known) typesSnapshot = Object.freeze(Array.from(entries.keys()).sort());
      // Iterate a copy: a listener can unsubscribe another (an unmount) mid-loop.
      for (const listener of Array.from(listeners)) listener();
    },
    get: (type) => {
      requestBuiltinDesigners();
      return entries.get(type);
    },
    types: () => {
      requestBuiltinDesigners();
      return Array.from(entries.keys()).sort();
    },
    subscribe,
    useEntry(type) {
      const read = (): T | undefined => entries.get(type);
      // The same read serves the server snapshot: registration is module state,
      // so a server render sees whatever its module graph registered.
      return useSyncExternalStore(subscribeReader, read, read);
    },
    useTypes() {
      return useSyncExternalStore(subscribeReader, readTypes, readTypes);
    },
  };
}

const REGISTRY = createObservableTypeRegistry<MetadataPreview>();

/**
 * Register (or replace) the Preview tab renderer for a metadata type.
 * Idempotent — re-registering overwrites the previous entry so app
 * authors can swap implementations from their plugin bootstrap.
 *
 * Every component that read this type through
 * {@link useRegisteredMetadataPreview} re-renders with the new entry.
 */
export function registerMetadataPreview(type: string, component: MetadataPreview): void {
  REGISTRY.set(type, component);
}

/**
 * Look up the registered preview for a type, if any, as the registry is now.
 * During render use {@link useRegisteredMetadataPreview}: this read is not told
 * about a later registration.
 */
export function getMetadataPreview(type: string): MetadataPreview | undefined {
  return REGISTRY.get(type);
}

/** Snapshot of registered preview types (diagnostics). */
export function listMetadataPreviewTypes(): string[] {
  return REGISTRY.types();
}

/**
 * The registered preview for `type`, if any, for a component to render
 * (objectui#11939). The component re-renders when a preview for `type` is
 * registered or replaced after its first render.
 */
export function useRegisteredMetadataPreview(type: string): MetadataPreview | undefined {
  return REGISTRY.useEntry(type);
}

/**
 * The registered preview types, sorted, for a component to render
 * (objectui#11939). The component re-renders when a new type is registered; the
 * array is frozen and stays the same array until then.
 */
export function useRegisteredMetadataPreviewTypes(): readonly string[] {
  return REGISTRY.useTypes();
}
