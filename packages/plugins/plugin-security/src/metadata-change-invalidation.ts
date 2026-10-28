// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26596, #26698] Which runtime signals tell this plugin that metadata
 * changed, so its metadata-derived caches are dropped the moment a change
 * lands.
 *
 * ## What is invalidated
 *
 * `SecurityPlugin` derives per-object inputs from the object's declaration and
 * keeps them for reuse: the per-object posture (`objectSecurityMetaCache`), the
 * field set (`fieldNamesCache` and its `datetime` / number siblings), the
 * tenancy opt-out and the controlled-by-parent relation. Each is read off the
 * ENGINE registry (`ql.getSchema`) on a miss. The body that drops them is
 * `SecurityPlugin#invalidateMetadataDerivedCaches`; this module only decides
 * WHEN it runs.
 *
 * ## The signals, and why these
 *
 * A cache is only as fresh as the signal that clears it, and the signal has to
 * fire AFTER the registry it re-reads has the new definition — a clear that
 * lands first lets the next request re-cache the old one.
 *
 *  1. `protocol.onMetadataMutation` — the post-persistence notification every
 *     metadata authoring door funnels through (`saveMetaItem`,
 *     `publishMetaItem` and the package publish, `revertCommit`,
 *     `rollbackMetaItem`, `deleteMetaItem`): Studio, the AI builders, the
 *     package publish and direct protocol callers alike. It is emitted after
 *     the registry write-through, so the re-read sees the new definition. A
 *     cluster peer's mutation is replayed into the same listeners after that
 *     replica's own registry has converged (`applyRemoteMetadataMutation`),
 *     so every node invalidates, in the same order. Drafts are skipped: a
 *     draft never enters the registry, so nothing derived from it moved.
 *
 *  2. The `metadata:reloaded` kernel hook — the platform's "re-read what you
 *     cached" announcement, fired by the metadata plugin's artifact reload
 *     (which ingests through `register(…, { notify: false })`, so no
 *     per-item event exists) and after a batch publish. `ObjectQLPlugin`
 *     ingests the reloaded objects on the same hook; this plugin declares
 *     `dependencies: ['com.objectstack.engine.objectql']`, so its handler is
 *     registered — and runs — after that ingest.
 *
 * ⛔ Not the metadata service's own watch API. The runtime authoring path
 * writes `sys_metadata` and the engine registry and refreshes the metadata
 * service's copy of an object in place, without announcing to its watchers —
 * so a subscription there never hears an authoring change. That is also why a
 * probe for an optional `watch` member on the service is not a subscription:
 * when the member is absent the probe does nothing, silently.
 */

/** The slice of a post-persistence mutation event this module reads. */
interface MetadataMutationLike {
  readonly state?: string;
}

/** The one protocol member this module subscribes through. */
interface MetadataMutationSource {
  onMetadataMutation(listener: (evt: MetadataMutationLike) => void): unknown;
}

/** The plugin-context slice this module needs. */
export interface MetadataChangeInvalidationContext {
  getService?: (name: string) => unknown;
  hook?: (name: string, handler: () => void) => void;
  logger: { warn: (message: string, meta?: Record<string, unknown>) => void };
}

function isMutationSource(candidate: unknown): candidate is MetadataMutationSource {
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as { onMetadataMutation?: unknown }).onMetadataMutation === 'function'
  );
}

/**
 * Wire `invalidate` to every signal above. Call once, from `start()` — every
 * plugin's `init()` has run by then, so the `protocol` service is registered
 * when the kernel has one.
 *
 * @returns the disposers for the subscriptions that return one (the kernel
 *   hook has no unsubscribe: it lives as long as the kernel does).
 */
export function subscribeMetadataChangeInvalidation(
  ctx: MetadataChangeInvalidationContext,
  invalidate: () => void,
): Array<() => void> {
  const disposers: Array<() => void> = [];

  let protocol: unknown;
  try {
    protocol = ctx.getService?.('protocol');
  } catch {
    // No protocol on this kernel ⇒ no metadata authoring door to hear from.
    protocol = undefined;
  }
  if (isMutationSource(protocol)) {
    const off = protocol.onMetadataMutation((evt) => {
      if (evt?.state === 'draft') return;
      invalidate();
    });
    if (typeof off === 'function') disposers.push(off as () => void);
  } else if (protocol) {
    // Present but older than the seam: functional, not durability — `warn`.
    ctx.logger.warn(
      '[security] the protocol service exposes no onMetadataMutation seam, so a metadata change saved or '
        + 'published at runtime is not seen here: the authorization inputs this plugin derives from an '
        + 'object\'s declaration keep the definition they were first read from until this process restarts. '
        + 'Upgrade @objectstack/metadata-protocol to a version whose protocol offers onMetadataMutation.',
    );
  }

  if (typeof ctx.hook === 'function') {
    ctx.hook('metadata:reloaded', () => {
      invalidate();
    });
  }

  return disposers;
}
