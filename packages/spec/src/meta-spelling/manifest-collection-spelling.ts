// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MANIFEST-COLLECTION SPELLING of a metadata type — the `defineStack()` half
 * of the plural↔singular vocabulary, moved to a schema-free module (#11503)
 * under the #10096 standing principle (recorded verbatim, untranslated):
 * 「浏览器可达的 spec 导出面必须 schema-free」.
 *
 * ## Why this module exists, and imports NOTHING
 *
 * `pluralToSingular` is a runtime value with ONE owner (#7378 row 2 — copying
 * the map into a consumer would be the per-implementation folk normalization
 * that ruling forbids), and `@objectstack/core` — a package every browser
 * client links eagerly — reads it to key metadata stores. When the map's
 * declaration lived in `shared/metadata-collection.zod.ts`, that one value
 * import put the whole `/shared` schema graph on every browser consumer's
 * eager closure (#11503's measurement: the console's eagerly-loaded vendor
 * chunk kept the `/shared` bundle through core's edge after every
 * consumer-side lever was ablated). So the declaration lives HERE, in the
 * schema-free `/meta-spelling` entry's graph, and `/shared` re-exports it —
 * same symbols, same owner, no schema closure on the vocabulary path.
 *
 * ## ⚠️ This map is NOT `META_URL_TO_SINGULAR` (#8424)
 *
 * The two maps are deliberately different contracts that merely overlap:
 *
 *  - **This map** (`PLURAL_TO_SINGULAR`) is the MANIFEST-COLLECTION map. Its
 *    keys are the properties an author writes in `defineStack()`
 *    (`objects: [...]`, `apps: [...]`), and
 *    `kernel/metadata-authoring-lint.ts` iterates it to decide WHICH
 *    COLLECTIONS EXIST at stack level. It has no `fields`, `seeds`,
 *    `externalCatalogs` or `translations` spelling, because none of those is
 *    a stack-level collection.
 *  - **`META_URL_TO_SINGULAR`** (`./metadata-url-spelling`) is the URL map:
 *    its keys are path segments a client may send to `/meta/:type`, derived
 *    at build time from this map ∪ the registry's REST plurals.
 *
 * Merging them would advertise stack collections that do not exist (see the
 * `fields:` incident recorded in `./metadata-url-spelling`). Keep them
 * distinct symbols with distinct domains.
 *
 * `check:stack-collection-maps` pins this map's key set against
 * `ObjectStackDefinitionSchema` (both directions, waivers recorded there),
 * and `check:meta-url-spelling` re-derives the URL map from it on every lap.
 *
 * @module
 */

/**
 * Mapping from plural manifest field names to singular metadata type names.
 *
 * Manifest / `defineStack()` uses plural property names because they are
 * collection fields (e.g. `objects: [...]`, `apps: [...]`).  The metadata
 * registry and `MetadataTypeSchema` use singular names as the canonical form.
 *
 * Use this mapping at the boundary where manifest fields are fed into the
 * metadata registry to ensure a consistent singular naming convention.
 */
export const PLURAL_TO_SINGULAR: Record<string, string> = {
  objects: 'object',
  apps: 'app',
  pages: 'page',
  dashboards: 'dashboard',
  reports: 'report',
  datasets: 'dataset',
  actions: 'action',
  // `themes: 'theme'` was removed at #10485 (ADR-0049; the carrier key is
  // retired). Its absence here is load-bearing twice over: the generated
  // `META_URL_TO_SINGULAR` (gen:meta-url-spelling) loses the fold, so
  // `/meta/theme` gets `unrecognisedMetaTypeRefusal`'s loud verdict instead of
  // the pre-#10194 store-anything branch; and `applyConversionsToStoredItem`
  // passes legacy `theme` rows through untouched rather than manufacturing a
  // collection for them.
  flows: 'flow',
  jobs: 'job',
  positions: 'position',
  permissions: 'permission',
  // [ADR-0066 D1, #5870] Package-declared authorization capabilities. The
  // singular form is what `bootstrapDeclaredCapabilities` reads back
  // (`readDeclared(ql, 'capability')`) and what `AppPlugin` already registers
  // under; without the mapping the registration seam stored them as
  // `'capabilities'`, a store nothing reads.
  capabilities: 'capability',
  sharingRules: 'sharing_rule',
  apis: 'api',
  webhooks: 'webhook',
  agents: 'agent',
  tools: 'tool',
  skills: 'skill',
  ragPipelines: 'rag_pipeline',
  hooks: 'hook',
  mappings: 'mapping',
  analyticsCubes: 'analytics_cube',
  connectors: 'connector',
  datasources: 'datasource',
  views: 'view',
  emailTemplates: 'email_template',
  docs: 'doc',
  books: 'book',
};

/** Reverse mapping: singular metadata type → plural manifest field name. */
export const SINGULAR_TO_PLURAL: Record<string, string> = Object.fromEntries(
  Object.entries(PLURAL_TO_SINGULAR).map(([plural, singular]) => [singular, plural]),
);

/** Convert a plural manifest field name to its singular metadata type name. Returns the input unchanged if no mapping exists. */
export function pluralToSingular(key: string): string {
  return PLURAL_TO_SINGULAR[key] ?? key;
}

/** Convert a singular metadata type name to its plural manifest field name. Returns the input unchanged if no mapping exists. */
export function singularToPlural(key: string): string {
  return SINGULAR_TO_PLURAL[key] ?? key;
}
