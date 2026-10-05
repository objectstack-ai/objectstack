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

import { redactDatasourceConfig } from '@objectstack/spec/data';

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
 * A patch whose CONTAINER for a nested leaf is removed is the author's word
 * too (they deleted the block), so nothing is grafted there.
 *
 * ## Derived from the redactor, not restated beside it
 *
 * This function used to mirror the read path rule by rule — one loop per
 * redaction source, each a copy that could silently fall behind (the docblock
 * threat on every one of them: "a redaction the restore side did not mirror
 * turns an untouched Save into silent credential deletion"). The nested-
 * position fix made the read path recursive, which would have added two more
 * loops — so the mirroring is now structural instead: compute what the read
 * path SERVES for the stored row (`redactDatasourceConfig(driver, stored)`),
 * and for every redacted path graft the stored value back exactly where the
 * patch still matches the served projection. A future redaction source is
 * mirrored here by construction, with nothing to forget. (Same inversion the
 * metadata door's generic `carryForwardRedactedValues` performs; this one
 * consumes the redactor's exact `redactedPaths` segments, so a stored key
 * with a literal dot cannot be mis-split.)
 *
 * ## Array positions: carried only onto an element that is provably the same
 *
 * The contractless-driver redaction withholds credentials inside array
 * elements (`servers.0.password`, `headers.1.value`, `headers.0.1`), and a
 * position is not an identity: after the author deletes, reorders or renames
 * an element, the same index names a different element, and grafting by index
 * would put a credential onto it — under another header name, onto another
 * server. So every ARRAY hop of a redacted path is resolved against the patch
 * by identity, never by index alone:
 *
 *  - the patch's array equals the served array (nothing in it was touched) ⇒
 *    the same index;
 *  - otherwise the served element — the element as the read path served it,
 *    every non-credential sibling of the withheld value included — must occur
 *    exactly ONCE in the served array and exactly once in the patch's array,
 *    and the value is carried onto that one element wherever it now sits
 *    (a reorder, or a sibling deleted before it);
 *  - anything else — the element changed (a header renamed, a sibling field
 *    edited), it is gone, or it cannot be told apart from another — and the
 *    withheld value is DROPPED: the author changed the element that held it,
 *    which is their word about it, and guessing would misbind it.
 *
 * A withheld value that IS an array element (a header tuple's value, a
 * raw-headers list's value) is carried only when the patch's array equals the
 * served array.
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

  const served = redactDatasourceConfig(driver, stored);
  let out: Record<string, unknown> = patch;

  for (const path of served.redactedPaths) {
    const storedLeaf = valueAt(stored, path);
    if (storedLeaf === undefined) continue;
    const landing = landingPath(served.config, patch, path);
    if (!landing) continue;
    if (out === patch) out = { ...patch };
    graftAt(out, landing, storedLeaf);
  }

  return out;
}

/** An array position, as the redactor spells it in a path (its decimal index). */
const isIndex = (segment: string): boolean => /^(0|[1-9][0-9]*)$/.test(segment);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Where in `patch` the stored value at `path` (a path into the stored and the
 * served config) lands, or `undefined` when the patch does not speak to it as
 * the read path served it — see {@link restoreRedactedConfig}. Judged on the
 * patch as the caller sent it, so one graft never changes another's answer.
 */
function landingPath(
  servedConfig: Record<string, unknown>,
  patch: Record<string, unknown>,
  path: readonly string[],
): string[] | undefined {
  const landing: string[] = [];
  let servedNode: unknown = servedConfig;
  let patchNode: unknown = patch;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i] as string;
    if (Array.isArray(servedNode)) {
      if (!Array.isArray(patchNode) || !isIndex(segment)) return undefined;
      const index = matchingElement(servedNode, patchNode, Number(segment));
      if (index === undefined) return undefined;
      landing.push(String(index));
      servedNode = servedNode[Number(segment)];
      patchNode = patchNode[index];
      continue;
    }
    // A patch whose CONTAINER is gone (or is no longer a container of this
    // kind) is the author's word: nothing is grafted there.
    if (!isRecord(servedNode) || !isRecord(patchNode)) return undefined;
    landing.push(segment);
    servedNode = servedNode[segment];
    patchNode = patchNode[segment];
  }
  const leaf = path[path.length - 1] as string;
  if (Array.isArray(servedNode)) {
    // The withheld value is itself an element: carried only into an untouched array.
    if (!isIndex(leaf) || !Array.isArray(patchNode) || !sameValue(servedNode, patchNode)) return undefined;
  } else {
    if (!isRecord(servedNode) || !isRecord(patchNode)) return undefined;
    // What the read path served at this position: `undefined` for a dropped
    // key, the rewritten string for an embedded-credential redaction. The
    // patch speaks for the author exactly where it DIFFERS from that projection.
    if (!sameValue(patchNode[leaf], servedNode[leaf])) return undefined;
  }
  landing.push(leaf);
  return landing;
}

/**
 * The index in `patchArray` of the element served at `servedIndex`, by
 * identity: the same index when the arrays are equal, else the one element
 * equal to the served one when it is unique on both sides; `undefined` when
 * no single element answers.
 */
function matchingElement(servedArray: readonly unknown[], patchArray: readonly unknown[], servedIndex: number): number | undefined {
  if (servedIndex >= servedArray.length) return undefined;
  if (sameValue(servedArray, patchArray)) return servedIndex;
  const servedElement = servedArray[servedIndex];
  if (servedArray.filter((element) => sameValue(element, servedElement)).length !== 1) return undefined;
  let found: number | undefined;
  for (let index = 0; index < patchArray.length; index += 1) {
    if (!sameValue(patchArray[index], servedElement)) continue;
    if (found !== undefined) return undefined;
    found = index;
  }
  return found;
}

/** Structural equality over JSON-shaped values (and bytes). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Number.isNaN(a as number) && Number.isNaN(b as number);
  }
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.every((byte, i) => byte === y[i]);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && sameValue(ao[k], bo[k]));
}

/**
 * The value at `path` inside a record-ish value, or `undefined` off the walk.
 * An array is entered only at an index segment.
 */
function valueAt(value: unknown, path: readonly string[]): unknown {
  let node: unknown = value;
  for (const segment of path) {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node) && !isIndex(segment)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Set `path` to `value` inside `out`, copying every container along the spine
 * so the caller's `{ ...patch }` shallow copy never aliases a mutation back
 * into the patch object the caller handed us. Every intermediate container is
 * known to exist — {@link landingPath} walked it in the patch.
 */
function graftAt(out: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let node: Record<string, unknown> = out;
  for (const segment of path.slice(0, -1)) {
    const current = node[segment];
    const child = Array.isArray(current) ? [...current] : { ...(current as Record<string, unknown>) };
    node[segment] = child;
    node = child as unknown as Record<string, unknown>;
  }
  node[path[path.length - 1] as string] = value;
}
