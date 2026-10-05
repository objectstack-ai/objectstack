// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata History Utilities
 *
 * Utility functions for metadata versioning and history tracking,
 * including checksum calculation, JSON normalization, and diff generation.
 */

/**
 * Calculate SHA-256 checksum of normalized JSON metadata.
 * Normalizes the JSON by sorting keys and removing whitespace
 * to ensure consistent checksums across identical content.
 *
 * ⚠️ Not the `sys_metadata.checksum` stamp (#21828). That column carries
 * `hashSpec(body, type)` from `@objectstack/metadata-core`, which every writer
 * of it stamps (`DatabaseLoader`, `SysMetadataRepository`). This function sorts
 * EVERY map, an object's `fields` included, whose key order the spec declares
 * to be the field order, so it cannot tell a field reorder from no change.
 *
 * @param metadata - The metadata object to checksum
 * @returns SHA-256 hex string
 */
export async function calculateChecksum(metadata: unknown): Promise<string> {
  // Normalize JSON by sorting keys recursively
  const normalized = normalizeJSON(metadata);
  const jsonString = JSON.stringify(normalized);

  // Use Web Crypto API (available in Node.js 15+ and all modern browsers)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(jsonString);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for environments without Web Crypto API
  // Use a simple hash function (not cryptographically secure, but sufficient for change detection)
  return simpleHash(jsonString);
}

/**
 * Normalize JSON by recursively sorting object keys.
 * This ensures deterministic serialization for checksum calculation.
 *
 * @param value - The value to normalize
 * @returns Normalized value with sorted keys
 */
function normalizeJSON(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJSON);
  }

  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as object).sort();
    for (const key of keys) {
      sorted[key] = normalizeJSON((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}

/**
 * Simple hash function fallback for environments without Web Crypto API.
 * Based on djb2 hash algorithm.
 *
 * @param str - String to hash
 * @returns Hex hash string
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to hex and pad to 64 characters to match SHA-256 length
  const hexHash = Math.abs(hash).toString(16);
  return hexHash.padStart(64, '0');
}

/**
 * Generate a simple JSON patch between two objects.
 * Returns an array of operations showing what changed.
 *
 * @param oldObj - Original object
 * @param newObj - New object
 * @param path - Current path (for recursion)
 * @returns Array of change operations
 */
export function generateSimpleDiff(
  oldObj: unknown,
  newObj: unknown,
  path: string = ''
): Array<{ op: string; path: string; value?: unknown; oldValue?: unknown }> {
  const changes: Array<{ op: string; path: string; value?: unknown; oldValue?: unknown }> = [];

  // Handle primitives
  if (typeof oldObj !== 'object' || oldObj === null || typeof newObj !== 'object' || newObj === null) {
    if (oldObj !== newObj) {
      changes.push({ op: 'replace', path: path || '/', value: newObj, oldValue: oldObj });
    }
    return changes;
  }

  // Handle arrays
  if (Array.isArray(oldObj) || Array.isArray(newObj)) {
    if (!Array.isArray(oldObj) || !Array.isArray(newObj) || oldObj.length !== newObj.length) {
      changes.push({ op: 'replace', path: path || '/', value: newObj, oldValue: oldObj });
    } else {
      // Compare array elements
      for (let i = 0; i < oldObj.length; i++) {
        const subPath = `${path}/${i}`;
        changes.push(...generateSimpleDiff(oldObj[i], newObj[i], subPath));
      }
    }
    return changes;
  }

  // Handle objects
  const oldKeys = new Set(Object.keys(oldObj as object));
  const newKeys = new Set(Object.keys(newObj as object));

  // Check for added keys
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      const subPath = path ? `${path}/${key}` : `/${key}`;
      changes.push({ op: 'add', path: subPath, value: (newObj as Record<string, unknown>)[key] });
    }
  }

  // Check for removed keys
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      const subPath = path ? `${path}/${key}` : `/${key}`;
      changes.push({ op: 'remove', path: subPath, oldValue: (oldObj as Record<string, unknown>)[key] });
    }
  }

  // Check for modified keys
  for (const key of oldKeys) {
    if (newKeys.has(key)) {
      const subPath = path ? `${path}/${key}` : `/${key}`;
      changes.push(...generateSimpleDiff(
        (oldObj as Record<string, unknown>)[key],
        (newObj as Record<string, unknown>)[key],
        subPath
      ));
    }
  }

  return changes;
}

/**
 * Generate a human-readable summary of changes.
 *
 * @param diff - The diff operations
 * @returns Human-readable summary
 */
export function generateDiffSummary(
  diff: Array<{ op: string; path: string; value?: unknown; oldValue?: unknown }>
): string {
  if (diff.length === 0) {
    return 'No changes';
  }

  const summary: string[] = [];
  const addCount = diff.filter(d => d.op === 'add').length;
  const removeCount = diff.filter(d => d.op === 'remove').length;
  const replaceCount = diff.filter(d => d.op === 'replace').length;

  if (addCount > 0) summary.push(`${addCount} field${addCount > 1 ? 's' : ''} added`);
  if (removeCount > 0) summary.push(`${removeCount} field${removeCount > 1 ? 's' : ''} removed`);
  if (replaceCount > 0) summary.push(`${replaceCount} field${replaceCount > 1 ? 's' : ''} modified`);

  return summary.join(', ');
}
