// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

const SYSTEM_SCOPES = new Set(['system', 'cloud']);

/**
 * Build the Studio package-scope options from the raw `package` metadata list:
 * the **writable bases** (project-scoped, DB-backed packages) only — the sole
 * valid authoring destinations (ADR-0070 D2). Code/installed (system|cloud)
 * packages are filtered out.
 *
 * There is no package-less "Local / Custom" scope, so the selector never
 * offers an orphan bucket. A create in the console names its package: where
 * none is named, the person is asked to pick one or create one
 * (`PackageCreateAsk.tsx`, objectstack#38149, ADR-0070 D3). The kernel does
 * NOT yet refuse a create that names no package — the metadata door still
 * accepts a `null` package and stores the row package-less (a loose item,
 * which Packages → Adopt loose items moves into a base); that refusal is the
 * kernel-close card's of topic objectstack#37424. Until it lands, the ask is
 * the console's only guard.
 *
 * These options carry no writability: the server's `writable` verdict is read
 * where a create's package is chosen (the ask), not here.
 */
export function buildPackageScopeOptions(
  rawList: unknown[] | null | undefined,
): { id: string; name: string }[] {
  const rows = (rawList ?? [])
    .map((raw) => {
      const item =
        raw && typeof raw === 'object' && 'item' in raw ? (raw as { item: unknown }).item : raw;
      const m = ((item as { manifest?: unknown } | null)?.manifest ?? item ?? {}) as Record<
        string,
        unknown
      >;
      return {
        id: m.id as string,
        scope: m.scope as string,
        name: (m.name as string) || (m.id as string),
      };
    })
    .filter((p) => p.id && !SYSTEM_SCOPES.has(p.scope));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows.map((p) => ({ id: p.id, name: p.name }));
}
