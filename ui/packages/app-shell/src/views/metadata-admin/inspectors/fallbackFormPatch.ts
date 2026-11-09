// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The patch a default inspector's "More fields" fallback `SchemaForm` hands to
 * its host's `onPatch`.
 *
 * `SchemaForm` reports a whole next object, and it reports a CLEARED key by
 * deleting it from that object (its `setField` convention: a "— None —" pick,
 * an emptied text box, an emptied number box). The hosts' `onPatch` MERGES the
 * patch over the draft (`{ ...draft, ...patch }`), so a key that is merely
 * missing from the patch keeps its old value: every clear in the fallback form
 * was silently undone.
 *
 * So the patch is `next` plus every key the draft carries and `next` dropped,
 * set to `undefined`. The merge then overwrites it, and the saved JSON omits
 * it — the key is absent, which is what "declares nothing" means. A key `next`
 * still carries is passed through as `next` has it; a key it never touched is
 * never turned into `undefined`.
 */
export function fallbackFormPatch(
  draft: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...next };
  for (const key of Object.keys(draft)) {
    if (!(key in next)) patch[key] = undefined;
  }
  return patch;
}
