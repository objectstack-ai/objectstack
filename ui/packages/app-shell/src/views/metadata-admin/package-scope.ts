// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

const SYSTEM_SCOPES = new Set(['system', 'cloud']);

/**
 * Build the Studio package-scope options from the raw `package` metadata list:
 * the **writable bases** (project-scoped, DB-backed packages) only — the sole
 * valid authoring destinations (ADR-0070 D2). Code/installed (system|cloud)
 * packages are filtered out.
 *
 * There is no package-less "Local / Custom" scope: every runtime-authored item
 * lives in a writable base (ADR-0070 D1/D5 — the kernel rejects orphan creates
 * with `writable_package_required`, and legacy orphans are adopted into a base),
 * so the selector never offers an orphan bucket. The kernel keeps `null` /
 * `sys_metadata` provenance only as a read-side rehydration tag for legacy rows.
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
