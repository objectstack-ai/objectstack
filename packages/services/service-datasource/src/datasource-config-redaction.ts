// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-path credential redaction for a datasource's driver `config` (#8081,
 * the services half of #7990) — and the write-path inverse that keeps the
 * redaction from turning "Save" into credential deletion.
 *
 * ## Where the definition lives now (#8300)
 *
 * The derivation half — what counts as a credential key, and the read-path
 * redaction built on it — MOVED to `@objectstack/spec/data`
 * (`datasource-credential-redaction.ts`), so that this package and the
 * metadata read path (#8154, via the `kernel/metadata-type-redaction.ts`
 * seam) share ONE security list instead of two derived copies that must
 * agree. The re-exports below keep every existing consumer of this module
 * compiling unchanged; the moved module's header carries the full rationale
 * (three key sources, the unknown-driver posture, URL-userinfo boundaries).
 *
 * ## What stays here: {@link restoreRedactedConfig}
 *
 * `getDatasource()` feeds the Studio edit form, and `updateDatasource()` takes
 * that form's `config` back as a whole-object patch. A scrub with no inverse
 * would therefore turn every "Save" on an unmodified form into silent
 * credential DELETION — trading a disclosure bug for a data-loss bug.
 * {@link restoreRedactedConfig} is that inverse, and it is the same rule the
 * secret path next to it has always used ("preserve the existing
 * `credentialsRef` unless a new secret rewraps it"), applied to the material
 * the redaction hides. It stays in this package because restoration is a
 * write policy of the admin service's own edit round-trip, not a spec-derived
 * fact — and the generic metadata write door's equivalent carry-forward is
 * #8154's, deliberately not built here.
 */

import {
  passthroughSecretPaths,
  redactableConfigKeys,
  redactUrlCredentials,
} from '@objectstack/spec/data';

export {
  refusedCredentialKeys,
  passthroughSecretPaths,
  redactableConfigKeys,
  redactUrlPassword,
  redactUrlCredentialQueryParams,
  redactUrlCredentials,
  redactDatasourceConfig,
  type RedactedDatasourceConfig,
} from '@objectstack/spec/data';

/**
 * Re-apply the credential material `redactDatasourceConfig` hid, for a
 * patch that is round-tripping a previously-read config back to the store.
 *
 * The rule is deliberately narrow: stored material is carried forward ONLY
 * where the patch is indistinguishable from what the read path served — an
 * absent key, or a URL that matches the stored URL once redacted. Anything the
 * author actually changed wins, including clearing a URL's password by hand.
 *
 * What this does NOT do is let a patch set a refused key: `assertValidConfig`
 * still runs on the merged record, so a caller that types `password` into the
 * config gets #8078's refusal exactly as it would without this function.
 */
export function restoreRedactedConfig(
  driver: unknown,
  patch: Record<string, unknown> | undefined,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!patch || typeof patch !== 'object') return patch;
  if (!stored || typeof stored !== 'object') return patch;

  const hidden = new Set(redactableConfigKeys(driver));
  const out: Record<string, unknown> = { ...patch };

  for (const key of hidden) {
    // Only when the patch does not speak to the key at all. A patch that DOES
    // carry it is the author's word, and (for a refused spelling) is about to
    // be refused on its own merits rather than quietly overwritten here.
    if (!(key in out) && stored[key] !== undefined) out[key] = stored[key];
  }

  for (const [key, storedValue] of Object.entries(stored)) {
    if (hidden.has(key) || typeof storedValue !== 'string') continue;
    // The SAME composite the read path applies (userinfo password + #8337
    // credential query parameters) — a redaction this compare did not mirror
    // would make the untouched "Save" it exists for delete the credential.
    const redactedStored = redactUrlCredentials(storedValue);
    // Unchanged by redaction ⇒ it carried no credential ⇒ nothing to restore.
    if (redactedStored === storedValue) continue;
    if (out[key] === redactedStored) out[key] = storedValue;
  }

  // The passthrough spellings (#9040) — the nested material the read path
  // drops by PATH (`options.auth.password`, `options.proxyPassword`, …). The
  // same narrow rule as the top-level keys, translated per leaf: restore ONLY
  // when the patch's container for the leaf exists but does not speak to the
  // leaf at all — exactly what the read path served. A patch carrying the leaf
  // is the author's word (a typed-in `auth.password` is then refused by the
  // #9040 write gate on its own merits); a patch with the CONTAINER removed is
  // the author's word too (they deleted the block), so nothing is grafted.
  for (const path of passthroughSecretPaths(driver)) {
    const storedLeaf = valueAt(stored, path);
    if (storedLeaf === undefined) continue;
    const parentPath = path.slice(0, -1);
    const leafKey = path[path.length - 1] as string;
    const patchParent = valueAt(out, parentPath);
    if (!patchParent || typeof patchParent !== 'object' || Array.isArray(patchParent)) continue;
    if (leafKey in (patchParent as Record<string, unknown>)) continue;
    graftAt(out, path, storedLeaf);
  }

  return out;
}

/** The value at `path` inside a record-ish value, or `undefined` off the walk. */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let node: unknown = value;
  for (const segment of path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Set `path` to `value` inside `out`, copying every container along the spine
 * so the caller's `{ ...patch }` shallow copy never aliases a mutation back
 * into the patch object the caller handed us. Every intermediate container is
 * known to exist and be a record — the caller checked before grafting.
 */
function graftAt(out: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node = out;
  for (const segment of path.slice(0, -1)) {
    const child = { ...(node[segment] as Record<string, unknown>) };
    node[segment] = child;
    node = child;
  }
  node[path[path.length - 1] as string] = value;
}
