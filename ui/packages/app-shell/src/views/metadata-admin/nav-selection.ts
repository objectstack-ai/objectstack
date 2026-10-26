// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Nav-item deep-link selection (#2272).
 *
 * The designer's internal selection ids are POSITIONAL (`navigation[2]`,
 * `nav[0].children[1]`) — cheap for canvas/inspector wiring but unstable:
 * they drift on reorder and mean nothing outside one editing session. The
 * EXTERNAL contract is the nav item's spec-required snake_case `id`,
 * carried in the URL as `?sel=nav:<id>`. These helpers translate between
 * the two at the designer boundary; positions never leave component state.
 */

/**
 * Root keys apps accept nav content under (#5600). This describes nav
 * SHAPE, not the `AppNavInspector` editor, so it lives here rather than
 * being re-exported out of that 500+ line React component — this module
 * is pure string/array plumbing and stays importable without dragging a
 * Radix/dnd-kit-backed inspector into every URL-parsing consumer's graph.
 * `AppNavInspector`'s own copy never did anything but re-export this
 * array, so it was deleted there rather than re-imported.
 */
export const APP_NAV_ROOT_KEYS = ['nav', 'navigation', 'tabs', 'items', 'menu'];

/** Search param carrying the designer's selected element. */
export const DESIGNER_SEL_PARAM = 'sel';

/** Parse a `sel` param value; returns the nav item id for `nav:<id>`. */
export function parseNavSelParam(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('nav:')) return null;
  const id = value.slice(4);
  return id.length > 0 ? id : null;
}

export function formatNavSelParam(navId: string): string {
  return `nav:${navId}`;
}

/**
 * Surface deep-link (#code-block-menu-nav).
 *
 * The Interfaces pillar opens ONE nav target's design surface in the canvas
 * at a time; `?surface=<type>:<name>` records which, so a menu selection is
 * shareable and survives a reload instead of snapping back to the first leaf.
 * The value is the surface identity `{type,name}` (e.g. `page:crm_workbench`),
 * which also drives the nav highlight — types never contain `:`, so a split on
 * the first colon is unambiguous.
 */
export const DESIGNER_SURFACE_PARAM = 'surface';

export function formatSurfaceParam(surface: { type: string; name: string }): string {
  return `${surface.type}:${surface.name}`;
}

export function parseSurfaceParam(value: string | null | undefined): { type: string; name: string } | null {
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const type = value.slice(0, idx);
  const name = value.slice(idx + 1);
  return type && name ? { type, name } : null;
}

interface NavNode {
  id?: string;
  label?: unknown;
  children?: NavNode[];
  [k: string]: unknown;
}

/**
 * Locate a nav item by its `id` across all accepted root keys, returning
 * the positional selection id the canvas/inspector pair uses
 * (`<rootKey>[i]` / `<rootKey>[i].children[j]`), or null when absent.
 *
 * `label` is the item's authored plain-string `label`, and nothing else
 * (objectui#11196). It used to fall back to `title` / `name`, which are not
 * nav-item keys, so an entry with no label was named by keys the spec refuses
 * rather than by the text it inherits. That text is its target's CURRENT
 * label, which only a surface holding the metadata can answer, so a
 * label-less entry leaves `label` undefined here: the inspector names the
 * selected entry from the entry itself, through the runtime's inheritance
 * rule. This module stays pure string/array plumbing.
 */
export function findNavPositionById(
  draft: Record<string, unknown>,
  navId: string,
): { selectionId: string; label?: string } | null {
  const walk = (nodes: NavNode[], prefix: string): { selectionId: string; label?: string } | null => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node || typeof node !== 'object') continue;
      const pos = `${prefix}[${i}]`;
      if (node.id === navId) {
        return { selectionId: pos, label: typeof node.label === 'string' ? node.label : undefined };
      }
      if (Array.isArray(node.children)) {
        const hit = walk(node.children, `${pos}.children`);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const rootKey of APP_NAV_ROOT_KEYS) {
    const arr = (draft as any)[rootKey];
    if (!Array.isArray(arr)) continue;
    const hit = walk(arr as NavNode[], rootKey);
    if (hit) return hit;
  }
  return null;
}

/**
 * Read the nav item `id` at a positional selection id (the inverse of
 * {@link findNavPositionById}); null when the path is invalid or the node
 * has no id.
 */
export function navIdAtPosition(
  draft: Record<string, unknown>,
  positionalId: string,
): string | null {
  const segs = positionalId.split('.');
  let node: NavNode | undefined;
  for (let s = 0; s < segs.length; s++) {
    const m = /^([a-zA-Z_]\w*)\[(\d+)\]$/.exec(segs[s]);
    if (!m) return null;
    const key = m[1];
    const index = Number(m[2]);
    const arr = s === 0 ? (draft as any)[key] : (node as any)?.[key];
    if (!Array.isArray(arr)) return null;
    node = arr[index];
    if (!node || typeof node !== 'object') return null;
  }
  return typeof node?.id === 'string' && node.id ? node.id : null;
}
