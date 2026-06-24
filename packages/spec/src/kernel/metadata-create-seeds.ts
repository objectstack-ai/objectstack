// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Type → minimal **valid create seed** (single source of truth).
 *
 * The recurring "designer creates a minimal item that fails spec validation on
 * save" family (a new dashboard lacked `layout`; a new `script` action lacks
 * `body`; a report carried stale `objectName`/`columns`) has one root cause:
 * the create-form's default shape was invented client-side (objectui's
 * `createDefaults`) and drifted from the spec's required fields, with nothing
 * validating the two against each other.
 *
 * This registry is the authoritative minimal shape a freshly-created item of
 * each type should carry — co-located with the schemas in `packages/spec` and
 * asserted valid by `metadata-create-seeds.test.ts`. When a schema tightens a
 * requirement, this seed (and the test) is right next to it, so the create
 * path can't silently break. Consumers (the Studio designer via `/meta/types`,
 * the CLI, API clients) should derive their create defaults from here instead
 * of re-inventing them.
 *
 * Each seed is a COMPLETE minimal valid object including placeholder identity
 * (`name`/`label`/object binding); a create flow overrides those from user
 * input. Structural defaults (empty collections, the required `type`/`body`,
 * …) are the part that matters and must not drift.
 */

import type { MetadataType } from './metadata-plugin.zod';

const PLACEHOLDER_OBJECT = 'example_object';

/**
 * Built-in minimal create seeds. Keyed by metadata type; every entry is
 * validated against its `metadata-type-schemas` schema by the test.
 *
 * Canvas-create types whose full shape is built INTERACTIVELY (e.g. `report`
 * picks its dataset/measures on the canvas, `object` adds fields on the canvas)
 * are intentionally absent — their minimal shape isn't a static literal. The
 * test documents these exclusions.
 */
const BUILTIN_METADATA_CREATE_SEEDS: Partial<Record<MetadataType, unknown>> = {
  dashboard: {
    name: 'new_dashboard',
    label: 'New Dashboard',
    widgets: [],
  },
  action: {
    name: 'new_action',
    label: 'New Action',
    // `type` defaults to 'script', which the spec requires to carry an
    // executable body or target — seed a no-op L2 body so create round-trips.
    type: 'script',
    body: { language: 'js', source: 'return { success: true };' },
  },
  page: {
    name: 'new_page',
    label: 'New Page',
    object: PLACEHOLDER_OBJECT,
    type: 'list',
    kind: 'full',
    regions: [],
  },
  view: {
    name: `${PLACEHOLDER_OBJECT}.new_view`,
    object: PLACEHOLDER_OBJECT,
    viewKind: 'list',
    label: 'New View',
    config: { type: 'grid', columns: [], data: { provider: 'object', object: PLACEHOLDER_OBJECT } },
  },
  flow: {
    name: 'new_flow',
    label: 'New Flow',
    type: 'autolaunched',
    nodes: [],
    edges: [],
  },
  validation: {
    name: 'new_validation',
    label: 'New Validation',
    message: 'This record is invalid.',
    type: 'script',
    active: true,
    events: ['insert', 'update'],
    priority: 10,
    severity: 'error',
    condition: 'false',
  },
  hook: {
    name: 'new_hook',
    label: 'New Hook',
    object: PLACEHOLDER_OBJECT,
    events: [],
  },
  dataset: {
    name: 'new_dataset',
    label: 'New Dataset',
    object: PLACEHOLDER_OBJECT,
    dimensions: [],
    // A dataset needs at least one measure to be useful; seed a count.
    measures: [{ name: 'count', label: 'Count', aggregate: 'count' }],
  },
  object: {
    name: 'new_object',
    label: 'New Object',
    pluralLabel: 'New Objects',
    fields: {},
  },
};

/**
 * Return the authoritative minimal create seed for a metadata type, or
 * `undefined` when none is registered (caller falls back to `{}`). The
 * returned object is a fresh deep clone so callers may mutate it freely.
 */
export function getMetadataCreateSeed(type: string): unknown | undefined {
  const seed = BUILTIN_METADATA_CREATE_SEEDS[type as MetadataType];
  return seed === undefined ? undefined : structuredClone(seed);
}

/** Snapshot of every type that has a built-in create seed. */
export function listMetadataCreateSeedTypes(): string[] {
  return Object.keys(BUILTIN_METADATA_CREATE_SEEDS).sort();
}
