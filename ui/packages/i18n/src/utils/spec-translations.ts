/**
 * Adapters between `@objectstack/spec` `TranslationData` (the wire format
 * served by `/api/v1/i18n/translations/:locale`) and the flat namespace
 * tree that `@object-ui/i18n`'s `useObjectLabel` hook reads.
 *
 * The spec format nests every per-object scope (`fields`, `_views`,
 * `_actions`, …) under `objects.<n>.*`. `useObjectLabel` resolves keys
 * in two different shapes depending on the scope:
 *
 *   - **Flattened scopes** — `fields` becomes a top-level `fields.<obj>.<fld>`
 *     string map (and field options become `fieldOptions.<obj>.<fld>.<value>`)
 *     so per-field label lookup is cheap.
 *   - **Nested scopes** — every `_`-prefixed key (`_views`, `_actions`,
 *     `_sections`, `_notifications`, `_errors`, `_options`, …) is preserved
 *     verbatim under `objects.<n>._xxx`, matching the resolver
 *     conventions documented in `useObjectLabel` (e.g.
 *     `viewLabel` reads `objects.<n>._views.<view>.label`).
 *
 * The "preserve every `_`-prefixed key" rule is intentional: it future-proofs
 * the transform so newly-introduced spec scopes do **not** need a code change
 * here to flow through to the UI. This prevents a class of silent-failure
 * regressions where a new scope (e.g. `_views`) is added to the spec but the
 * console transform forgets to copy it, leaving lookups to fall back to the
 * untranslated source label.
 */

/**
 * Minimal shape of a `@objectstack/spec` `TranslationData` payload. We only
 * type the fields this transformer reads; everything else is forwarded
 * through opaquely.
 */
export interface SpecTranslationData {
  objects?: Record<
    string,
    {
      label?: string;
      pluralLabel?: string;
      description?: string;
      fields?: Record<
        string,
        {
          label?: string;
          options?: Record<string, string>;
          // Field-level nested scopes are forwarded as-is alongside `label`.
          [key: string]: unknown;
        }
      >;
      // Object-level nested scopes (`_views`, `_actions`, …) are preserved
      // verbatim — see module doc.
      [key: string]: unknown;
    }
  >;
  apps?: unknown;
  messages?: unknown;
  validationMessages?: unknown;
  dashboards?: unknown;
  globalActions?: unknown;
  // Top-level passthrough for any future namespace.
  [key: string]: unknown;
}

/**
 * The top-level groups of the translation document the server serves at
 * `/api/v1/i18n/translations/:locale` — the keys of the `translations` shape
 * of `@objectstack/spec`'s `GetTranslationsResponseSchema`: every per-app
 * `TranslationData` group plus the platform-only `settings`, because the
 * served document is the merge of the app's bundle and the platform's.
 *
 * Written out rather than imported: `@object-ui/i18n` deliberately does not
 * depend on `@objectstack/spec`. The console does, so the pin lives beside
 * its loader — `apps/console/src/loadLanguage.test.tsx` walks the spec's own
 * key list and requires a payload carrying any one group, alone, to take the
 * transform branch. A group the spec adds and this list lacks turns that test
 * red instead of dropping the group's bundles silently (objectui#10235).
 */
const SPEC_TRANSLATION_GROUPS = [
  'objects',
  'apps',
  'messages',
  'globalActions',
  'dashboards',
  'datasets',
  'pages',
  'flows',
  'settings',
  'metadataForms',
  'settingsCommon',
  // `@objectstack/spec` 17.6.0 serves `picklists` (objectstack `addbbf02`, the
  // `picklist` metadata kind); added at that bump (objectui#11438). The
  // transform below copies it through onto `app` like any other group.
  'picklists',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Detect whether the given record uses the spec `TranslationData` format.
 *
 * Returns `true` when the payload carries at least one spec translation group
 * (see {@link SPEC_TRANSLATION_GROUPS}) whose value is an object — every spec
 * group is a record or an object. A bundle is recognised by ANY group it
 * carries: one that translates only object labels, apps, pages, dashboards or
 * flows, with no field label anywhere, is as much a spec payload as one that
 * translates fields (objectui#10235 — this used to require an
 * `objects.<n>.fields` entry, and such a bundle was returned untransformed and
 * read by nothing).
 *
 * What stays `false` is the other shape the console's loader accepts: an
 * i18next resource tree that is already namespaced, as a mock or local-dev
 * server may return it. Its top-level keys are namespace names — a built-in
 * pack namespace such as `common`, an app namespace such as `crm`, or `app`,
 * the one {@link transformSpecTranslations} itself emits — and none of them
 * is a spec group, so feeding the transform's output back in never wraps it
 * twice. A group-named key holding a string or an array is not a group either.
 */
export function isSpecTranslationData(
  data: Record<string, unknown> | null | undefined,
): data is SpecTranslationData {
  if (!isPlainObject(data)) return false;
  return SPEC_TRANSLATION_GROUPS.some((group) => isPlainObject(data[group]));
}

/** Top-level keys that are copied through unchanged onto the `app` namespace. */
const PASSTHROUGH_TOP_LEVEL_KEYS = [
  'apps',
  'messages',
  'validationMessages',
  'dashboards',
  'globalActions',
] as const;

/**
 * Transform a `@objectstack/spec` `TranslationData` payload into the
 * namespaced tree expected by `useObjectLabel`.
 *
 * The output is wrapped under an `app` namespace key so the hook's
 * `getAppNamespaces()` discovery (which keys off the presence of `objects`
 * and `fields`) picks it up automatically.
 *
 * Behaviour:
 *   - `objects.<n>.label / pluralLabel / description` — copied verbatim.
 *   - `objects.<n>._*` — every underscore-prefixed key (any depth) is
 *     preserved as-is. This is the rule that prevents future spec scopes
 *     (`_views`, `_actions`, `_sections`, `_notifications`, `_errors`,
 *     `_options`, anything new) from silently disappearing.
 *   - `objects.<n>.fields.<f>.label` — flattened to `fields.<n>.<f>`.
 *   - `objects.<n>.fields.<f>.options` — flattened to
 *     `fieldOptions.<n>.<f>.<value>`.
 *   - `apps / messages / validationMessages / dashboards / globalActions`
 *     — copied verbatim to the `app` namespace root.
 *   - Any other top-level key on the source payload is also copied through,
 *     so new top-level spec namespaces flow through without a code change.
 */
export function transformSpecTranslations(
  data: SpecTranslationData,
): Record<string, unknown> {
  const objects: Record<string, Record<string, unknown>> = {};
  const fields: Record<string, Record<string, string>> = {};
  const fieldOptions: Record<string, Record<string, Record<string, string>>> = {};

  const srcObjects = data.objects;
  if (srcObjects) {
    for (const [objName, objData] of Object.entries(srcObjects)) {
      if (!objData || typeof objData !== 'object') continue;

      const obj: Record<string, unknown> = {};
      if (objData.label) obj.label = objData.label;
      if (objData.pluralLabel) obj.pluralLabel = objData.pluralLabel;
      if (objData.description) obj.description = objData.description;

      // Preserve EVERY `_`-prefixed nested scope (e.g. `_views`, `_actions`,
      // `_sections`, `_notifications`, `_errors`, `_options`, …). Doing this
      // by-convention (rather than a whitelist) means new spec scopes flow
      // through without a code change here.
      for (const [k, v] of Object.entries(objData)) {
        if (k.startsWith('_')) obj[k] = v;
      }
      objects[objName] = obj;

      // Flatten fields: objects.<n>.fields.<f>.label → fields.<n>.<f>
      if (objData.fields && typeof objData.fields === 'object') {
        const fieldEntries = Object.entries(
          objData.fields as Record<string, { label?: string; options?: Record<string, string> }>,
        );
        for (const [fieldName, fieldData] of fieldEntries) {
          if (fieldData?.label) {
            if (!fields[objName]) fields[objName] = {};
            fields[objName][fieldName] = fieldData.label;
          }
          if (
            fieldData?.options &&
            typeof fieldData.options === 'object' &&
            Object.keys(fieldData.options).length > 0
          ) {
            if (!fieldOptions[objName]) fieldOptions[objName] = {};
            fieldOptions[objName][fieldName] = fieldData.options;
          }
        }
      }
    }
  }

  const appNs: Record<string, unknown> = {};
  if (Object.keys(objects).length > 0) appNs.objects = objects;
  if (Object.keys(fields).length > 0) appNs.fields = fields;
  if (Object.keys(fieldOptions).length > 0) appNs.fieldOptions = fieldOptions;
  for (const key of PASSTHROUGH_TOP_LEVEL_KEYS) {
    if (data[key] !== undefined) appNs[key] = data[key];
  }
  // Forward any future top-level namespace we don't explicitly know about,
  // skipping the ones we've already consumed or flattened.
  const consumedTopLevel = new Set<string>(['objects', ...PASSTHROUGH_TOP_LEVEL_KEYS]);
  for (const [k, v] of Object.entries(data)) {
    if (consumedTopLevel.has(k)) continue;
    appNs[k] = v;
  }

  return { app: appNs };
}
