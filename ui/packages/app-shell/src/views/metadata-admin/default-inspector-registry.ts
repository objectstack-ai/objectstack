// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataDefaultInspectorRegistry — "home" inspectors shown when the
 * preview has NO active selection.
 *
 * The scoped {@link MetadataInspectorRegistry} only kicks in once the
 * preview emits a selection. Before that, the right panel falls back to
 * the generic whole-draft `SchemaForm`. For some types that generic form
 * is a poor authoring surface (e.g. a View, where authors want a curated
 * "pick a view type, manage which fields show" panel — Airtable style).
 *
 * Registering a default inspector here lets the host render a curated,
 * selection-less panel instead of the generic form. Selecting a
 * sub-element (a column) still swaps in the scoped inspector.
 *
 * Observable, like the preview registry (objectui#11939): a component reads it
 * during render through `useRegisteredMetadataDefaultInspector(type)` and
 * re-renders when a default inspector is registered later.
 * `getMetadataDefaultInspector` reads the registry as it is at the moment of the
 * call, for non-render code.
 */
import type { ComponentType } from 'react';
import type { SupportedLocale } from './i18n.js';
import { createObservableTypeRegistry, type MetadataSelection } from './preview-registry.js';

export interface MetadataDefaultInspectorProps {
  /** Metadata type, e.g. 'view'. */
  type: string;
  /** Item primary-key name (may be empty in create mode). */
  name: string;
  /** Current draft from the editor. Treat as immutable. */
  draft: Record<string, unknown>;
  /** Apply a shallow patch to the draft. */
  onPatch: (patch: Record<string, unknown>) => void;
  /**
   * Emit a selection. The default inspector uses this to drill into a
   * sub-element (e.g. focus one column), which makes the host swap in the
   * scoped inspector for that selection.
   */
  onSelectionChange?: (next: MetadataSelection | null) => void;
  /**
   * Report how many BLOCKING author-time issues the inspector is currently
   * showing — e.g. a CEL expression that does not parse (objectui#4527).
   *
   * Symmetric with `MetadataInspectorProps.onBlockingIssuesChange` (#4306), and
   * deliberately the SAME shape: the default (no-selection) inspectors host CEL
   * editors too — the hook guard, an action's visible/disabled predicates, a
   * view's conditional formatting — and the host owns Save, so only the host
   * can refuse to write. Without this member no host could pass the callback at
   * all, which is why the whole default-inspector family published malformed
   * expressions while the scoped family already refused them.
   *
   * Fires whenever the aggregate changes, `0` when everything is clean.
   *
   * Optional — an inspector with nothing to block on simply never calls it.
   * Hosts must expire their own count when the inspected item changes or the
   * inspector unmounts rather than waiting for a final `0`, since a component
   * that has gone away cannot report anything.
   */
  onBlockingIssuesChange?: (count: number) => void;
  /** Whether the host is in edit mode. False → disable inputs. */
  readOnly: boolean;
  /** Active UI locale for i18n. */
  locale: SupportedLocale;
  /**
   * The live server JSONSchema for this type (`RichMetadataTypeEntry.schema`,
   * from `/meta/types`). Curated inspectors graft any server-only top-level
   * fields onto the bundled-spec form so new server fields (e.g. a report's
   * `dataset`/`rows`/`values`) are directly editable even when objectui's
   * bundled `@objectstack/spec` lags the running server. Undefined when no
   * server schema is available (offline / older server).
   */
  serverSchema?: Record<string, unknown>;
}

export type MetadataDefaultInspector = ComponentType<MetadataDefaultInspectorProps>;

const REGISTRY = createObservableTypeRegistry<MetadataDefaultInspector>();

/**
 * Register (or replace) the default inspector for a metadata type. Every
 * component that read this type through
 * {@link useRegisteredMetadataDefaultInspector} re-renders with the new entry.
 */
export function registerMetadataDefaultInspector(
  type: string,
  component: MetadataDefaultInspector,
): void {
  REGISTRY.set(type, component);
}

/**
 * The registered default inspector for a type, if any, as the registry is now.
 * During render use {@link useRegisteredMetadataDefaultInspector}: this read is
 * not told about a later registration.
 */
export function getMetadataDefaultInspector(
  type: string,
): MetadataDefaultInspector | undefined {
  return REGISTRY.get(type);
}

/**
 * The registered default inspector for `type`, if any, for a component to
 * render (objectui#11939). The component re-renders when a default inspector
 * for `type` is registered or replaced after its first render.
 */
export function useRegisteredMetadataDefaultInspector(
  type: string,
): MetadataDefaultInspector | undefined {
  return REGISTRY.useEntry(type);
}
