// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata Collection Utilities
 * 
 * Provides support for defining metadata collections in either array or map (Record) format.
 * Map format automatically injects the key as the `name` field, following the same pattern
 * used by `fields` in ObjectSchema (which already uses `z.record(key, FieldSchema)`).
 * 
 * ## Usage
 * 
 * Both formats are accepted and normalized to arrays:
 * 
 * ```ts
 * // Array format (traditional)
 * defineStack({
 *   objects: [
 *     { name: 'account', fields: { ... } },
 *     { name: 'contact', fields: { ... } },
 *   ]
 * });
 * 
 * // Map format (key becomes `name`)
 * defineStack({
 *   objects: {
 *     account: { fields: { ... } },
 *     contact: { fields: { ... } },
 *   }
 * });
 * ```
 * 
 * @module
 */

/**
 * Input type for metadata collections: accepts either an array or a named map.
 * When using map format, the key is injected as the `name` field of each item.
 * 
 * @typeParam T - The metadata item type (e.g., `ObjectSchema`, `AppSchema`)
 * 
 * @example
 * ```ts
 * // Array format — name is required in each item
 * const apps: MetadataCollectionInput<App> = [
 *   { name: 'sales', label: 'Sales' },
 *   { name: 'service', label: 'Service' },
 * ];
 * 
 * // Map format — key serves as name, so name is optional in value
 * const apps: MetadataCollectionInput<App> = {
 *   sales: { label: 'Sales' },
 *   service: { label: 'Service' },
 * };
 * ```
 */
export type MetadataCollectionInput<T> =
  | T[]
  | Record<string, Omit<T, 'name'> & { name?: string }>;

/**
 * List of metadata fields in ObjectStackDefinitionSchema that support map format.
 * These are fields where each item has a `name` field that can be inferred from the map key.
 * 
 * Excluded fields:
 * - `views` — ViewSchema has no `name` field (it's a container with `list`/`form`)
 * - `objectExtensions` — uses `extend` as its identifier, not `name`
 * - `data` — SeedSchema uses `object` as its identifier
 * - `translations` — TranslationBundleSchema is a record, not a named object
 * - `plugins` / `devPlugins` — not named metadata schemas
 */
export const MAP_SUPPORTED_FIELDS = [
  'objects',
  'apps',
  'pages',
  'dashboards',
  'reports',
  'datasets',
  'actions',
  'themes',
  'flows',
  'jobs',
  'roles',
  'permissions',
  'sharingRules',
  'policies',
  'apis',
  'webhooks',
  'agents',
  'hooks',
  'mappings',
  'analyticsCubes',
  'connectors',
  'datasources',
  'emailTemplates',
] as const;

export type MapSupportedField = (typeof MAP_SUPPORTED_FIELDS)[number];

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
  themes: 'theme',
  flows: 'flow',
  jobs: 'job',
  roles: 'role',
  permissions: 'permission',
  profiles: 'profile',
  sharingRules: 'sharing_rule',
  policies: 'policy',
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


/**
 * Normalize a single metadata collection value from map format to array format.
 * If the input is already an array (or nullish), it is returned unchanged.
 * If the input is a plain object (map), it is converted to an array where
 * each key is injected as the `name` field of the corresponding item.
 * 
 * **Precedence:** If an item already has a `name` property, it is preserved
 * (the map key is only used as a fallback).
 * 
 * @param value - The raw input value (array, map, or nullish)
 * @param keyField - The field name to inject the key into (default: `'name'`)
 * @returns The normalized array, or the original value if already an array/nullish
 * 
 * @example
 * ```ts
 * // Map input
 * normalizeMetadataCollection({
 *   account: { fields: { name: { type: 'text' } } },
 *   contact: { fields: { email: { type: 'email' } } },
 * });
 * // → [
 * //   { name: 'account', fields: { name: { type: 'text' } } },
 * //   { name: 'contact', fields: { email: { type: 'email' } } },
 * // ]
 * 
 * // Array input (pass-through)
 * normalizeMetadataCollection([{ name: 'account', fields: {} }]);
 * // → [{ name: 'account', fields: {} }]
 * ```
 */
export function normalizeMetadataCollection(value: unknown, keyField = 'name'): unknown {
  // Nullish or already an array — pass through
  if (value == null || Array.isArray(value)) return value;

  // Plain object — treat as map and convert to array
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        // Only inject key if the item doesn't already have the field set
        if (!(keyField in obj) || obj[keyField] === undefined) {
          return { ...obj, [keyField]: key };
        }
        return obj;
      }
      // Non-object values (shouldn't happen, but let Zod handle the error)
      return item;
    });
  }

  // Other types — return as-is and let Zod validation handle the error
  return value;
}

/**
 * Normalize all metadata collections in a stack definition input.
 * Converts any map-formatted collections to arrays with key→name injection.
 * 
 * This function is applied to the raw input before Zod validation,
 * ensuring the canonical internal format is always arrays.
 * 
 * @param input - The raw stack definition input
 * @returns A new object with all map collections normalized to arrays
 */
export function normalizeStackInput<T extends Record<string, unknown>>(input: T): T {
  const result = { ...input };
  for (const field of MAP_SUPPORTED_FIELDS) {
    if (field in result) {
      (result as Record<string, unknown>)[field] = normalizeMetadataCollection(result[field]);
    }
  }
  return result;
}

/**
 * Mapping of legacy / alternative field names to their canonical names
 * in `ObjectStackDefinitionSchema`.
 *
 * Plugins may use legacy names (e.g., `triggers` instead of `hooks`).
 * This map lets `normalizePluginMetadata()` rewrite them automatically.
 */
export const METADATA_ALIASES: Record<string, MapSupportedField> = {
  triggers: 'hooks',
};

/**
 * Normalize plugin metadata so it matches the canonical format expected by the runtime.
 *
 * This handles two issues that commonly arise when loading third-party plugin metadata:
 *
 * 1. **Map → Array conversion** — plugins often define metadata as maps
 *    (e.g., `actions: { convert_lead: { ... } }`), but the runtime expects arrays.
 *    Every key listed in {@link MAP_SUPPORTED_FIELDS} is normalized via
 *    {@link normalizeMetadataCollection}.
 *
 * 2. **Field aliasing** — plugins may use legacy or alternative field names
 *    (e.g., `triggers` instead of `hooks`). {@link METADATA_ALIASES} maps them
 *    to their canonical counterparts.
 *
 * 3. **Recursive normalization** — if the plugin itself contains nested `plugins`,
 *    each nested plugin is normalized recursively.
 *
 * @param metadata - Raw plugin metadata object
 * @returns A new object with all collections normalized to arrays, aliases resolved,
 *          and nested plugins recursively normalized
 *
 * @example
 * ```ts
 * const raw = {
 *   actions: { lead_convert: { type: 'custom', label: 'Convert' } },
 *   triggers: { lead_scoring: { object: 'lead', event: 'afterInsert' } },
 * };
 * const normalized = normalizePluginMetadata(raw);
 * // normalized.actions → [{ name: 'lead_convert', type: 'custom', label: 'Convert' }]
 * // normalized.hooks   → [{ name: 'lead_scoring', object: 'lead', event: 'afterInsert' }]
 * // normalized.triggers → removed (merged into hooks)
 * ```
 */
export function normalizePluginMetadata<T extends Record<string, unknown>>(metadata: T): T {
  const result = { ...metadata };

  // 1. Resolve aliases (e.g. triggers → hooks), merging with any existing canonical values
  for (const [alias, canonical] of Object.entries(METADATA_ALIASES)) {
    if (alias in result) {
      const aliasValue = normalizeMetadataCollection(result[alias]);
      const canonicalValue = normalizeMetadataCollection(result[canonical]);

      // Merge: canonical array wins; alias values are appended
      if (Array.isArray(aliasValue)) {
        (result as Record<string, unknown>)[canonical] = Array.isArray(canonicalValue)
          ? [...canonicalValue, ...aliasValue]
          : aliasValue;
      }

      delete (result as Record<string, unknown>)[alias];
    }
  }

  // 2. Normalize map-formatted collections → arrays
  for (const field of MAP_SUPPORTED_FIELDS) {
    if (field in result) {
      (result as Record<string, unknown>)[field] = normalizeMetadataCollection(result[field]);
    }
  }

  // 3. Recursively normalize nested plugins
  if (Array.isArray(result.plugins)) {
    (result as Record<string, unknown>).plugins = result.plugins.map((p: unknown) => {
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        return normalizePluginMetadata(p as Record<string, unknown>);
      }
      return p;
    });
  }

  return result;
}
