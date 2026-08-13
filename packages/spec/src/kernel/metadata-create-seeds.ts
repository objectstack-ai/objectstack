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
  // ADR-0088 (#4509): no `validation` seed — the kind is retired, so there is
  // no standalone "create validation" flow to seed. Rules are added to an
  // object's `validations:` array.
  hook: {
    name: 'new_hook',
    label: 'New Hook',
    object: PLACEHOLDER_OBJECT,
    events: [],
  },
  mapping: {
    name: 'new_mapping',
    label: 'New Import Mapping',
    targetObject: PLACEHOLDER_OBJECT,
    // At least one rename so the wizard's save produces a usable artifact.
    fieldMapping: [{ source: 'Column A', target: 'field_a' }],
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
    // [#8308 / ADR-0090 D1] The OWD baseline is an AUTHORED decision, never an
    // accident. The runtime already resolves an absent `sharingModel` on a
    // custom object to 'private' (fail-closed — `effectiveSharingModel`,
    // packages/plugins/plugin-sharing/src/sharing-service.ts), so seeding
    // 'private' changes no tenant's effective sharing; it makes the operative
    // default explicit in the platform's own minimal create body, which is
    // what lets `security-owd-unset` enforce at the runtime publish door
    // (#7891 programme) without refusing the platform's own seed.
    sharingModel: 'private',
  },
  agent: {
    name: 'new_agent',
    label: 'New Agent',
    // role + instructions are required — the agent's persona and behavior.
    role: 'A helpful assistant.',
    instructions: 'Describe what this agent should do.',
  },
  tool: {
    name: 'new_tool',
    label: 'New Tool',
    // description + a (possibly empty) parameters record are required.
    description: 'Describe what this tool does.',
    parameters: {},
  },
  skill: {
    name: 'new_skill',
    label: 'New Skill',
    // a skill bundles tools; an empty list is a valid starting point.
    tools: [],
  },
  // [#5488] `api` HAD a create seed here (#5271). It was REMOVED when `api`
  // became code-only (`allowRuntimeCreate: false` + `allowOrgOverride: false`,
  // maintainer ruling 2026-08-07T16:59Z): a create seed exists to make a
  // runtime CREATE round-trip, and there is no longer a runtime create surface
  // for it to seed — the #5086 inlet refuses `PUT /api/v1/meta/api/:name` with
  // 403 `NOT_CREATABLE` before any body is validated. Keeping it would have
  // handed the Studio designer a pre-filled "New API Endpoint" form whose save
  // can only 403, which is the UI half of the same false compliance ADR-0049
  // made this change to remove. `api` is on `KNOWN_UNSEEDED` in the test for
  // `capability`'s reason (ADR-0066 D1 / #5961), not as deferred work.
  // Endpoints are authored in the stack artifact (`**/*.api.ts`, or
  // `defineStack({ apis })`) and shipped through `publishPackage`.
  email_template: {
    name: 'new_email_template',
    label: 'New Email Template',
    subject: 'Subject line',
    bodyHtml: '<p>Email body</p>',
  },
  permission: {
    name: 'new_permission',
    label: 'New Permission',
    // a permission set's per-object grant map; empty = no grants yet.
    objects: {},
  },
  translation: {
    name: 'new_translation',
    label: 'New Translation',
    // One item translates one locale, and `locale` is required — seeding it
    // means a create round-trips instead of 422-ing on an empty body. The
    // empty `objects` map is the shape hint that matters: it is where object,
    // field, view, section, and action translations go (#3778).
    locale: 'en',
    objects: {},
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
