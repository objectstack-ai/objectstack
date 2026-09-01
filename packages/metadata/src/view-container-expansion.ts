// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13913] Registry-free expansion of an aggregated `defineView` container
 * that reached `MetadataManager`'s OWN backing store.
 *
 * ---------------------------------------------------------------------------
 * Why this lives in `packages/metadata` and does NOT import the protocol's copy
 * ---------------------------------------------------------------------------
 * `packages/metadata-protocol` grew `expandRuntimeViewContainer` (#13407) for
 * `getMetaItems`' own inline expansion, and the obvious move would be to share
 * it. **The dependency edge forbids it**: `@objectstack/metadata-protocol`
 * declares `@objectstack/metadata` as a dependency, so an import in this
 * direction inverts an existing edge and closes a cycle. Promoting the
 * protocol's private method to a public export would not help either — it
 * would widen that package's surface *and* still be unreachable from here.
 *
 * The reusable substance is therefore taken from where it already is: the
 * canonical expansion primitives (`isAggregatedViewContainer`,
 * `expandViewContainer`) live in `@objectstack/spec`, one level BELOW both
 * packages, and this package already imports them (`plugin.ts`). Nothing is
 * duplicated except the ~6-line object-derivation chain — which is exactly the
 * part that has silently drifted three ways (the ObjectQL boot loop keys off
 * the registration name, `plugin.ts` walks two levels, and `protocol.ts` walks
 * four since #13407). {@link deriveViewContainerObject} is the one spelling of
 * it for this package, so the drift has a single place to be repaired rather
 * than a third private copy to fall behind.
 *
 * ---------------------------------------------------------------------------
 * Registry-free, on purpose
 * ---------------------------------------------------------------------------
 * Nothing here REGISTERS. `protocol.ts`'s own header records why its
 * registry-MUTATING path (`hydrateExpandedViewItems`) could not simply be
 * widened — it is gated off for every org-scoped row (ADR-0005: the registry
 * is shared by every org a kernel serves) — and why #13407's actual repair was
 * a separate, registry-free, per-request expansion. The same reasoning applies
 * one exit over: `MetadataManager`'s registry is process-wide too, so the
 * repair for {@link MetadataManager.getViewsByObject} is a pure function over
 * what that one read already holds.
 */

import {
  expandViewContainer,
  isAggregatedViewContainer,
  type ExpandedViewItem,
} from '@objectstack/spec';
import { applyProtection } from '@objectstack/spec/shared';

/**
 * Which object an aggregated view container binds to.
 *
 * The container's OWN top-level `object` field — `ViewSchema.object`,
 * documented there as "how a stack-level `views: [...]` entry says which object
 * its views belong to; read by `getViewsByObject()` / `GET /meta/view?object=`"
 * — is the authorial, explicit signal and is consulted FIRST (#13407). The
 * three-deep fallback below it is kept unchanged for every container written
 * before that field was read here: `list.data.object`, then `form.data.object`,
 * then the row's own `name` — which is the bound object only by convention, and
 * is why a container that set the top-level field but not `list.data.object`
 * used to bind under the wrong key or not at all.
 *
 * Returns `undefined` when no binding can be derived; every caller treats that
 * as "no expansion" rather than an error.
 */
export function deriveViewContainerObject(container: unknown): string | undefined {
  if (!container || typeof container !== 'object') return undefined;
  const c = container as Record<string, any>;
  const own = typeof c.object === 'string' && c.object ? c.object : undefined;
  const byName = typeof c.name === 'string' && c.name ? c.name : undefined;
  return own ?? c?.list?.data?.object ?? c?.form?.data?.object ?? byName;
}

/**
 * Expand an aggregated `defineView` container into the same independent
 * ViewItems the source registrars produce — object binding and package
 * provenance applied, but **nothing registered**.
 *
 * Returns `[]` (never throws) for a body that is not a container and for a
 * container with no derivable object binding — the two "no expansion" outcomes
 * callers already decide on independently. Every returned item carries a
 * `viewKind`, which is what makes it visible to the object-bound filters; the
 * container itself is never returned, because a container surfaced as a view is
 * the behaviour #7163 ruled wrong.
 *
 * The items are fresh objects from `expandViewContainer`, so stamping package
 * coords on them cannot mutate the stored container.
 */
export function expandRuntimeViewContainer(data: unknown): ExpandedViewItem[] {
  if (!isAggregatedViewContainer(data)) return [];
  const container = data as Record<string, any>;
  const viewObject = deriveViewContainerObject(container);
  if (!viewObject) return [];

  const out: ExpandedViewItem[] = [];
  for (const vi of expandViewContainer(viewObject, container)) {
    // Carry the container's package provenance onto each expanded item so the
    // package-disable filter and ADR-0048 artifact scoping judge them by the
    // same owner the container has. `applyProtection` stamps nothing when the
    // container has no package coords, which keeps runtime/DB-authored items
    // free of an unexpected `_provenance` (its own documented boundary).
    applyProtection(vi as unknown as Record<string, unknown>, {
      packageId: container._packageId,
      packageVersion: container._packageVersion,
    });
    out.push(vi);
  }
  return out;
}
