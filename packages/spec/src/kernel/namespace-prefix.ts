// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Namespace-prefix rules (ADR-0028 current-state contract).
 *
 * A package declares a short `manifest.namespace`; every `object.name` it
 * defines MUST be `${namespace}_${shortName}` (except platform-reserved
 * `sys_*` objects). See {@link file://../kernel/manifest.zod.ts} `namespace`.
 *
 * These helpers are the SINGLE source of that rule so the two enforcement
 * points cannot drift:
 *  - `defineStack()` / `os validate` (compile-time) — `validateNamespacePrefix`
 *    in `stack.zod.ts`.
 *  - `MetadataManager.publishPackage()` (runtime, Studio "全部发布").
 */

/** Namespace charset accepted by `manifest.namespace` (2-20 chars). */
const NAMESPACE_RE = /^[a-z][a-z0-9_]{1,19}$/;

/**
 * Validate a single object name against a package namespace prefix.
 *
 * Returns an actionable error message, or `null` when the name is compliant.
 * `sys_*` names are platform-reserved and always allowed. When `namespace` is
 * empty the check is skipped (returns `null`) — callers decide whether an
 * absent namespace is itself an error.
 */
export function validateObjectNamespacePrefix(
  objectName: string | undefined,
  namespace: string | undefined,
): string | null {
  if (!objectName || !namespace) return null;
  if (objectName.startsWith('sys_')) return null;

  const expectedPrefix = `${namespace}_`;
  if (objectName.includes('__')) {
    return `Object '${objectName}' uses the legacy FQN form '<ns>__<short>'. Rename it to '${expectedPrefix}${objectName.slice(objectName.indexOf('__') + 2)}'.`;
  }
  if (!objectName.startsWith(expectedPrefix)) {
    return `Object '${objectName}' is missing the package namespace prefix. Rename it to '${expectedPrefix}${objectName}' (namespace = '${namespace}').`;
  }
  return null;
}

/**
 * Derive a default namespace from a package id when the manifest declares none.
 *
 * Uses the last dot-segment of the id (`com.example.leave` → `leave`),
 * lowercased and sanitized to the namespace charset. Returns `null` when
 * nothing valid can be derived (caller then leaves the namespace unset rather
 * than inventing a bad one). This only supplies a DEFAULT for packages that
 * omit `namespace`; an explicitly declared namespace always wins.
 */
export function deriveNamespaceFromPackageId(packageId: string | undefined): string | null {
  if (!packageId) return null;
  const seg = packageId.split('.').pop() ?? packageId;
  const ns = seg
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_') // non-charset → underscore
    .replace(/^[^a-z]+/, '') // must start with a letter
    .slice(0, 20);
  return NAMESPACE_RE.test(ns) ? ns : null;
}
