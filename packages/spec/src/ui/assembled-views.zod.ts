// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5320/#8070] The declared, portable home for NON-container view artifacts in
 * runtime-ASSEMBLED manifests — the `viewItems:` channel.
 *
 * ## The gap this closes (measured on #5320, ruled 2026-08-12)
 *
 * Two view vocabularies are declared: the stack manifest's `views:` collection
 * accepts CONTAINERS only (`stack.zod.ts`, `z.array(ViewSchema)`), while the
 * `view` METADATA door accepts four branches ({@link ViewMetadataSchema} —
 * standalone ViewItem records, containers, and the two flattened overlays).
 * Manifests the platform assembles at runtime FROM metadata-door artifacts —
 * `GET /packages/:id/export` and the cloud env-artifact boot bundle — therefore
 * carry entries the stack vocabulary refuses: expanded `viewKind` items (the
 * ADR-0017 dual-read keeps them registered beside their container), tenant-
 * authored standalone ViewItems, and flattened overlays. Measured by execution,
 * 2 of 3 exported entries in the minimal single-container case are refused by
 * the stack schema; the round trip worked only through the registration loop's
 * UNDECLARED wider acceptance — exactly the runtime-wider hole #5320 records.
 *
 * The 2026-08-12 fork ruling (option B plus A's mechanical half) closes it by
 * DECLARING the bridge instead of keeping it silent:
 *
 *  1. **This module (B):** an assembled manifest carries its non-container view
 *     artifacts under the {@link ASSEMBLED_VIEW_ITEMS_KEY} collection, each
 *     entry judged by {@link AssembledViewArtifactSchema} — strictly schema'd,
 *     no passthrough bags.
 *  2. **Producers (A's mechanical half):** export/artifact factories fold
 *     expanded items back into their containers where a container exists
 *     ({@link partitionAssembledViewArtifacts}); only items no container can
 *     re-derive travel in `viewItems:`.
 *  3. **The runtime loop then tightens** `views:` to the declared container-only
 *     contract, refusing loudly with the wrap-it prescription.
 *
 * ## `viewItems:` is MACHINE-ASSEMBLED, not a second authoring spelling
 *
 * The decision is refuse-loudly, documented here and enforced in
 * `stack.zod.ts`: an author writing `viewItems:` in `defineStack` source gets a
 * named rejection with the prescription (author containers in `views:`;
 * standalone views are authored through the metadata door), and `z.input` types
 * the key `never` so `tsc` refuses first. Rationale, on the three ruling axes:
 * no measured authoring pull exists for pre-expanded items in stack source
 * (every in-tree stack authors containers); a hand-written expansion would be a
 * SECOND spelling of the container it duplicates, drifting from it silently —
 * the exact class of AI-authoring mistake strict schemas exist to prevent; and
 * the 2026-08-12 11:15Z ruling forbids widening the authored stack surface.
 *
 * ## Why the producer helper lives in `packages/spec`
 *
 * Same precedent as {@link expandViewContainer} (this directory): logic that
 * two independent codebases must agree on byte-for-byte belongs beside the
 * schema it serves, so the producers cannot drift. The partition is the exact
 * inverse of the expansion the registration loop performs — deciding "is this
 * item re-derivable from its container?" requires running THE expansion, not a
 * re-implementation of it.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import {
  VIEW_METADATA_BRANCHES,
  VIEW_METADATA_MEMBERS,
  expandViewContainer,
  isAggregatedViewContainer,
} from './view.zod';

/**
 * The manifest key runtime-assembled manifests carry non-container view
 * artifacts under. Declared as a constant so producers (package export, the
 * artifact factories) and the consumer (the ObjectQL registration loop) name
 * one key instead of four string literals.
 */
export const ASSEMBLED_VIEW_ITEMS_KEY = 'viewItems' as const;

/**
 * One entry of an assembled manifest's `viewItems:` collection — the
 * NON-container branches of the `view` metadata vocabulary, and nothing else.
 *
 * Built by mapping {@link VIEW_METADATA_BRANCHES} minus `container` over
 * {@link VIEW_METADATA_MEMBERS}, so this union cannot drift from the metadata
 * door's own members: an artifact legal at the metadata door (standalone
 * ViewItem, flattened list/form overlay) is legal here BY CONSTRUCTION, and a
 * container is not — containers travel in `views:`, where the stack vocabulary
 * has always put them. The members are the WIRE variants (`.strip()`), so
 * Studio round-trip keys survive and undeclared bags do not.
 */
export const AssembledViewArtifactSchema = lazySchema(() => {
  const members = VIEW_METADATA_BRANCHES
    .filter((branch) => branch !== 'container')
    .map((branch) => VIEW_METADATA_MEMBERS[branch]);
  return z.union(members as unknown as readonly [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
    .describe(
      'A non-container view artifact travelling in a runtime-assembled manifest\'s `viewItems:` '
      + 'collection: a ViewItem record (`viewKind` + `config`), or a flattened list/form overlay. '
      + 'Machine-assembled (package export, environment artifacts) — authored stack sources carry '
      + 'containers in `views:` instead.',
    );
});

/** One assembled `viewItems:` entry (input shape). */
export type AssembledViewArtifact = z.input<typeof AssembledViewArtifactSchema>;
/** Post-parse shape of {@link AssembledViewArtifact} — defaults applied, transforms run (ADR-0122). */
export type AssembledViewArtifactParsed = z.infer<typeof AssembledViewArtifactSchema>;

/** Result of {@link partitionAssembledViewArtifacts}. */
export interface AssembledViewPartition {
  /** Container documents — the assembled manifest's `views:` collection. */
  views: Record<string, unknown>[];
  /** Non-container artifacts no exported container re-derives — `viewItems:`. */
  viewItems: Record<string, unknown>[];
  /**
   * Names of expanded items DROPPED because an exported container re-derives
   * them byte-for-byte (the re-aggregation): the import side's expansion of
   * that container reproduces each, so carrying them too would register every
   * view twice and fork the container's authority over its own views.
   */
  folded: string[];
}

/** Keys the expansion/registration machinery stamps that carry no authored
 *  content — excluded from the derivability comparison on both sides. */
const MECHANICAL_KEYS = new Set(['order', 'scope', '_diagnostics']);

/** Deep structural equality; object keys unordered, arrays ordered. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      Object.prototype.hasOwnProperty.call(b, k)
      && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** The comparable projection of an item: mechanical keys dropped, `isDefault`
 *  normalised (absent ≡ `false` — the expansion stamps it only on winners). */
function comparable(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (MECHANICAL_KEYS.has(k) || v === undefined) continue;
    out[k] = v;
  }
  if (!out.isDefault) delete out.isDefault;
  return out;
}

/**
 * True for a view artifact of CONTAINER shape — including the empty container
 * (`{ name }`, schema-legal, registers nothing). {@link isAggregatedViewContainer}
 * answers "does this container carry views to expand?", which is false for an
 * empty container; classification for travel needs the shape question instead:
 * anything that is not a ViewItem record (`viewKind`/`config`) and carries no
 * inline view-config fingerprint is a container document.
 *
 * EXPORTED because the producers and the consumer must run ONE classifier: the
 * partition below routes by it on assembly, and the ObjectQL registration
 * loop's `views:` tighten (#5320 step 3) refuses by it on ingestion. Two
 * classifiers would let an assembler emit an entry the importer refuses —
 * re-opening, one level down, the exact producer/consumer disagreement this
 * module exists to close.
 */
export function isViewContainerShaped(item: unknown): boolean {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const rec = item as Record<string, unknown>;
  if (isAggregatedViewContainer(rec)) return true;
  if (rec.viewKind != null || rec.config != null) return false;
  // Flattened overlays put single-view config keys at the top level.
  return !['type', 'columns', 'sections', 'data', 'filter', 'sort'].some((k) => k in rec);
}

/**
 * Partition one package's view artifacts for manifest assembly — A's
 * mechanical half of the #5320 fork ruling, shared by every producer.
 *
 * Containers go to `views:`. Every other artifact is judged individually
 * against the containers travelling WITH it: an expanded item that the import
 * side's own expansion of its container will reproduce EXACTLY (same name,
 * same authored payload — mechanical `order`/`scope`/`_diagnostics` excluded,
 * personalisation keys like `isPinned` included, so a personalised or edited
 * item is never folded away) is dropped as derivable and reported in `folded`;
 * everything else — tenant-authored standalone ViewItems, flattened overlays,
 * expanded items whose stored body has since diverged from their container —
 * travels in `viewItems:`.
 *
 * Pure over its input: items are not mutated, and the caller owns any
 * provenance stripping (`_`-prefixed keys) before partitioning.
 */
export function partitionAssembledViewArtifacts(
  items: readonly Record<string, unknown>[],
): AssembledViewPartition {
  const views: Record<string, unknown>[] = [];
  const rest: Record<string, unknown>[] = [];
  for (const item of items) {
    if (isViewContainerShaped(item)) views.push(item);
    else rest.push(item);
  }

  // Expand each travelling container ONCE, exactly as the registration loop
  // will on import (same helper, same base name), and index by expanded name.
  const derivable = new Map<string, Record<string, unknown>>();
  for (const container of views) {
    const base = typeof container.name === 'string' && container.name
      ? container.name
      : typeof container.object === 'string' ? container.object : undefined;
    if (!base) continue;
    for (const expanded of expandViewContainer(base, container)) {
      derivable.set(expanded.name, comparable(expanded as unknown as Record<string, unknown>));
    }
  }

  const viewItems: Record<string, unknown>[] = [];
  const folded: string[] = [];
  for (const item of rest) {
    const name = item && typeof item === 'object' && typeof item.name === 'string' ? item.name : undefined;
    const twin = name ? derivable.get(name) : undefined;
    if (twin && deepEqual(comparable(item), twin)) {
      folded.push(name as string);
      continue;
    }
    viewItems.push(item);
  }

  return { views, viewItems, folded };
}
