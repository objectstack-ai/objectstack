// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useFlowNodePalette — server-driven node palette for the flow designer.
 *
 * The set of node types a flow can use is owned by the automation **engine**,
 * not the client: built-in node packs and plugins (e.g. the ADR-0019
 * `approval` node contributed by the approvals plugin, or third-party
 * `connector_action` providers) publish an `ActionDescriptor` that the engine
 * exposes at `GET /api/v1/automation/actions` — the same registry that backs
 * server-side flow validation. Driving the palette from that endpoint keeps the
 * designer in lock-step with what the running backend actually supports.
 *
 * The hardcoded {@link NODE_PALETTE} stays as the base: it supplies the
 * structural / control nodes the engine does not publish as actions (subflow,
 * wait, end, connector_action) and acts as an offline fallback so the designer
 * still works when the endpoint is unreachable or the plugin is not installed.
 * Server descriptors are overlaid on top — keeping the base ordering, adopting
 * the engine's labels/descriptions, and appending any engine-only node types
 * (and future plugin nodes) the base doesn't list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { NODE_PALETTE, nodeCategory, type PaletteItem } from './flow-canvas-parts.js';
import { apiBase } from '../../../utils/apiBase.js';

/** Minimal shape of an engine action descriptor we consume. */
interface ActionDescriptorLite {
  type: string;
  name?: string;
  description?: string;
  paradigms?: string[];
  deprecated?: boolean;
  /**
   * JSON Schema for the node's `config` (ADR-0018 §configSchema). Present only
   * for actions whose executor publishes one (e.g. the ADR-0019 approval node).
   * Drives the inspector's server-rendered property form.
   */
  configSchema?: unknown;
}

/**
 * Server API base — shared by the palette fetch and the runs panel.
 *
 * The definition moved to `utils/apiBase.ts`; this module re-exports it so its
 * existing importers are unchanged. It moved because importing it from HERE
 * pulls this module's scope — and so the whole flow-designer canvas below it —
 * into the importer's graph; see that file's header for what that cost.
 *
 * ⚠️ Imported and then exported, NOT `export { apiBase } from …`: this module
 * calls `apiBase()` itself further down, and a bare re-export forwards the name
 * without binding it in local scope.
 */
export { apiBase };

/**
 * Merge engine descriptors onto the hardcoded base. Base order is canonical;
 * a descriptor overlays its base entry's label/hint (so the engine is the
 * source of truth for naming), and engine-only types are appended.
 */
export function mergePalette(base: PaletteItem[], descriptors: ActionDescriptorLite[]): PaletteItem[] {
  const byType = new Map<string, PaletteItem>();
  for (const item of base) byType.set(item.type, item);

  for (const d of descriptors) {
    if (!d?.type) continue;
    if (d.deprecated) continue;
    // The flow designer only offers flow-capable nodes. Descriptors without a
    // paradigm list are treated as flow-capable (conservative default).
    if (Array.isArray(d.paradigms) && d.paradigms.length > 0 && !d.paradigms.includes('flow')) continue;
    const existing = byType.get(d.type);
    byType.set(d.type, {
      type: d.type,
      label: d.name || existing?.label || d.type,
      hint: d.description || existing?.hint,
      // Keep the base item's section; infer one for engine-only/plugin types so
      // they still group sensibly in the palette.
      category: existing?.category ?? nodeCategory(d.type),
    });
  }

  return [...byType.values()];
}

/**
 * Fetch the running engine's published action descriptors from
 * `GET /api/v1/automation/actions`. Returns `[]` while loading or on any error
 * (offline / plugin absent / older backend), so consumers fall back to their
 * hardcoded defaults. Shared by both the palette and the inspector's
 * server-driven config form.
 */
export function useActionDescriptors(): ActionDescriptorLite[] {
  const [descriptors, setDescriptors] = useState<ActionDescriptorLite[]>([]);
  // Avoid a state update after unmount (the fetch resolves async).
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/automation/actions`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) return; // keep fallbacks (404/501 when plugin absent)
        const payload = (await res.json()) as { data?: { actions?: ActionDescriptorLite[] } };
        const actions = payload?.data?.actions;
        if (!Array.isArray(actions) || actions.length === 0) return;
        if (alive.current) setDescriptors(actions);
      } catch {
        /* offline / aborted — keep the hardcoded fallback */
      }
    })();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);

  return descriptors;
}

/**
 * Returns the node palette merged with the running engine's published
 * descriptors. Falls back to {@link NODE_PALETTE} while loading or on any
 * error, so the designer always has a usable palette.
 */
export function useFlowNodePalette(): PaletteItem[] {
  const descriptors = useActionDescriptors();
  return useMemo(
    () => (descriptors.length ? mergePalette(NODE_PALETTE, descriptors) : NODE_PALETTE),
    [descriptors],
  );
}

/**
 * Map of node `type` → published config JSON Schema, for the actions whose
 * executor publishes one. Empty while loading / offline, so the inspector
 * falls back to its hardcoded field group for every type.
 */
export function useActionConfigSchemas(): Record<string, unknown> {
  const descriptors = useActionDescriptors();
  return useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const d of descriptors) {
      if (d?.type && d.configSchema !== undefined && d.configSchema !== null) {
        map[d.type] = d.configSchema;
      }
    }
    return map;
  }, [descriptors]);
}
