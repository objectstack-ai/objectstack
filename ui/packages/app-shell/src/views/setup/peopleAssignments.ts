// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → People & organization: the two assignment pages (ADR-0146 D7).
 *
 * Assigning people is operational work, not authoring: a position's holders and
 * a permission set's direct grants are rows of the caller's organization, and
 * an administrator reaches them here without opening a catalog item. Each page
 * picks one catalog item and renders the section the item page already renders
 * for it (`PositionHoldersSection`, `AssignedUsersSection`), so the reads, the
 * writes and every server refusal are the sections' own.
 *
 * The entries that open them are Setup navigation contributions, which the
 * server's security plugin declares; these refs are what those entries name.
 */

import { componentRefToUrlSegments } from '../../services/componentRegistry.js';

/** The component ref of the Position holders page. */
export const POSITION_HOLDERS_REF = 'security:position-holders';

/** The component ref of the Permission set assignment page. */
export const PERMISSION_SET_ASSIGNMENT_REF = 'security:permission-set-assignment';

/**
 * The page-scoped query parameter that names the picked item. Addressable
 * state (AGENTS.md #8): a shared or refreshed link opens the same item.
 */
export const POSITION_PARAM = 'position';
export const PERMISSION_SET_PARAM = 'set';

/** Where a page opens inside the Setup app, optionally on one item. */
function pagePath(ref: string, param: string, name?: string): string {
  const base = `/apps/setup/component/${componentRefToUrlSegments(ref).join('/')}`;
  return name ? `${base}?${param}=${encodeURIComponent(name)}` : base;
}

export function positionHoldersPagePath(position?: string): string {
  return pagePath(POSITION_HOLDERS_REF, POSITION_PARAM, position);
}

export function permissionSetAssignmentPagePath(set?: string): string {
  return pagePath(PERMISSION_SET_ASSIGNMENT_REF, PERMISSION_SET_PARAM, set);
}

/** One pickable catalog item: its machine name and what the list shows. */
export interface CatalogEntry {
  name: string;
  /** The served label, or the name when the item has none. */
  label: string;
  description: string;
}

/**
 * The pickable items of a registry list (`/meta/<type>`), by label then name.
 * An item without a string name cannot be addressed, so it is left out.
 */
export function catalogEntries(items: readonly unknown[]): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const it = raw as { name?: unknown; label?: unknown; description?: unknown } | null;
    if (typeof it?.name !== 'string' || !it.name || seen.has(it.name)) continue;
    seen.add(it.name);
    const label = typeof it.label === 'string' && it.label.trim() ? it.label : it.name;
    const description = typeof it.description === 'string' ? it.description : '';
    out.push({ name: it.name, label, description });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
}

/** The entries whose label or name contains `query`, ignoring case. */
export function filterCatalogEntries(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => e.label.toLocaleLowerCase().includes(q) || e.name.toLocaleLowerCase().includes(q));
}
