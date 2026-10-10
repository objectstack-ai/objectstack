// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate`'s author-time half of the boot registrar's divergent
 * view-container `name` refusal (#20331).
 *
 * ## The defect
 *
 * A `views:` container whose own `name` disagrees with the object key it binds
 * to — `{ name: 'order_line', object: 'my_app_order_line', list: {…} }` — is
 * refused at boot by `ObjectQL.registerMetadataCollections` (#7378 row 1).
 * `os validate` had no counterpart, so it exited 0 on that stack and
 * `os serve` then refused it. `os validate` is the author-time judge of what
 * the runtime will accept (NORTH-STAR road step ①), and a green validate
 * followed by a boot refusal is the silent-validator shape.
 *
 * ## One judge, not a second rule
 *
 * {@link viewContainerNameRefusal} is `@objectstack/objectql`'s, the SAME
 * function the boot registrar throws the answer of. ⛔ Not an `@objectstack/lint`
 * rule and not a re-spelling of the check here: a twin agrees with the
 * runtime only until one of the two is edited, which is the drift this card
 * exists to close. What this module owns is the WALK — which `views:` entries
 * boot judges, and under which package id — and nothing about the verdict.
 *
 * ## The walk is the boot path's
 *
 * `AppPlugin` hands the manifest service `{ ...stack.manifest, ...stack }`;
 * `resolveArtifactPackageOrder` returns that payload itself when it carries no
 * `packages` key and each `packages[i].manifest` body otherwise (ADR-0130 D4);
 * `ObjectQL.registerApp(body)` then runs `registerMetadataCollections(body,
 * body.id || body.name, 'manifest')`. On a stack that carries `packages[]`,
 * `AppPlugin` then registers the RESIDUAL — the top-level items no package
 * body declares — through the metadata package's one residual rule
 * (`MetadataPlugin.registerUnclaimedTopLevel`), which refuses a divergent
 * residual container in the same words, from `manifest` and under the stack's
 * own manifest id. So:
 *
 *   - no `packages[]` → the top-level `views`, owned by the manifest's id;
 *   - `packages[]`    → each body's own `views`, owned by that package's id,
 *     THEN the top-level `views` the residual rule registers, owned by the
 *     stack's manifest id. ⛔ Never a top-level container a body already
 *     declares: the residual rule skips it, so judging it here would refuse
 *     the same document twice.
 *
 * WHICH top-level entries are residual, and their owner id, is
 * `@objectstack/metadata`'s `unclaimedTopLevel` — the answer the boot
 * registers from. ⛔ Never re-derived here: a second spelling of "which top
 * level does boot read" is how this walk and the boot came to disagree once.
 *
 * The package id is read through the owners that already exist for it: the
 * runtime's `artifactPackageId` (`@objectstack/core` — "every seam that has to
 * name a package reads the id through THIS function") for the one-package
 * payload, this package's `artifactPackages` for `packages[]`, the reader
 * both `os build` and `os validate` already walk with, and `unclaimedTopLevel`
 * for the residual.
 *
 * ⚠️ Bound, stated rather than hidden: a nested `plugins[]` entry's `views` is
 * registered by boot too (label `nested plugin`), and is NOT walked here. The
 * stack schema types `plugins` as `unknown[]` — in an authored config they are
 * runtime plugin instances, not metadata bundles — so this door has no parsed
 * shape to walk there.
 *
 * Reads the PARSED stack — what `defineStack()` hands the boot wrap, and what
 * `os build` serializes.
 */

import { artifactPackageId } from '@objectstack/core';
import { unclaimedTopLevel } from '@objectstack/metadata';
import { viewContainerNameRefusal } from '@objectstack/objectql';

import { artifactPackages } from './artifact-packages.js';

/** One refusal, located. `message` is the boot registrar's, verbatim. */
export interface ViewContainerNameRefusalRow {
  /** Where the entry sits in the parsed stack, e.g. `views[0]`. */
  path: string;
  /** The ADR-0112 code the boot registrar throws with. */
  code: string;
  /** The HTTP status the boot registrar throws with. */
  httpStatus: number;
  /** The refusal, in the boot registrar's own words. */
  message: string;
}

type AnyRec = Record<string, unknown>;

const asRec = (v: unknown): AnyRec | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRec) : undefined;

/**
 * Every `views:` container in this stack that the boot registrar would refuse
 * for a divergent `name`, in the order boot meets them within each body.
 *
 * Returns `[]` for a stack the boot registrar accepts on this axis.
 */
export function findViewContainerNameRefusals(parsed: AnyRec): ViewContainerNameRefusalRow[] {
  // `located`: `at` already names the one entry `views` holds.
  const bodies: Array<{ at: string; ownerId: string | undefined; views: unknown; located?: boolean }> = [];
  // The resolver's own branch test (`declared === undefined`). On the PARSED
  // stack a present `packages` is an array — `ArtifactPackageSchema[]`,
  // `.optional()`, so `null` and every non-array were refused at the parse.
  if (parsed.packages !== undefined) {
    for (const pkg of artifactPackages(parsed)) {
      bodies.push({ at: `packages[${pkg.index}].manifest.views`, ownerId: pkg.id, views: pkg.body.views });
    }
    // The residual, after the bodies — the order boot registers them in. Each
    // unclaimed `view` entry is located at its own top-level index; the judge
    // refuses only a container, exactly as the residual registration does.
    const residual = unclaimedTopLevel(parsed);
    for (const { field, index, type, item } of residual?.items ?? []) {
      if (type !== 'view') continue;
      bodies.push({ at: `${field}[${index}]`, ownerId: residual?.ownerId, views: [item], located: true });
    }
  } else {
    const manifest = asRec(parsed.manifest);
    const payload = manifest ? { ...manifest, ...parsed } : parsed;
    bodies.push({ at: 'views', ownerId: artifactPackageId(payload), views: parsed.views });
  }

  const rows: ViewContainerNameRefusalRow[] = [];
  for (const { at, ownerId, views, located } of bodies) {
    if (!Array.isArray(views)) continue;
    views.forEach((entry, index) => {
      const refusal = viewContainerNameRefusal(entry, 'manifest', ownerId);
      if (!refusal) return;
      rows.push({
        path: located ? at : `${at}[${index}]`,
        code: refusal.code,
        httpStatus: refusal.httpStatus,
        message: refusal.message,
      });
    });
  }
  return rows;
}
