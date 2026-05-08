/**
 * Load application-specific translations for a given language from the API.
 *
 * The @objectstack/spec REST API (`/api/v1/i18n/translations/:locale`) wraps
 * its response in the standard envelope: `{ data: { locale, translations } }`.
 * We extract `data.translations` when present, and fall back to the raw JSON
 * for mock / local-dev environments that may return flat translation objects.
 *
 * When the response uses the @objectstack/spec `TranslationData` format
 * (objects with nested fields), we automatically transform it into the flat
 * format expected by @object-ui/i18n's `useObjectLabel` hook:
 *   - `objects.{name}.fields.{field}.label`  →  `fields.{name}.{field}` (string)
 *   - `objects.{name}.fields.{field}.options` →  `fieldOptions.{name}.{field}`
 *   - Wrapped under an `app` namespace key for hook discovery
 */
export async function loadLanguage(lang: string): Promise<Record<string, unknown>> {
  try {
    const serverUrl = import.meta.env.VITE_SERVER_URL || '';
    const res = await fetch(`${serverUrl}/api/v1/i18n/translations/${lang}`);
    if (!res.ok) {
      console.warn(`[i18n] Failed to load translations for '${lang}': HTTP ${res.status}`);
      return {};
    }
    const json = await res.json();
    // Unwrap the spec REST API envelope when present
    let translations: Record<string, unknown>;
    if (json?.data?.translations && typeof json.data.translations === 'object') {
      translations = json.data.translations as Record<string, unknown>;
    } else {
      // Fallback: mock server / local dev returns flat translation objects
      translations = json;
    }
    // Auto-transform @objectstack/spec TranslationData format when detected
    if (isSpecTranslationData(translations)) {
      return transformSpecTranslations(translations);
    }
    return translations;
  } catch (err) {
    console.warn(`[i18n] Failed to load translations for '${lang}':`, err);
    return {};
  }
}

/**
 * Detect whether the data uses the @objectstack/spec `TranslationData` format.
 *
 * TranslationData has: `objects.{name}.fields.{field}.label` (nested objects).
 * The flat format has: `{namespace}.objects.{name}.label` + `{namespace}.fields.{name}.{field}` (string).
 *
 * We check if `data.objects` exists AND at least one object has a nested `fields`
 * key whose values are objects (not strings).
 */
function isSpecTranslationData(data: Record<string, unknown>): boolean {
  const objects = data.objects;
  if (!objects || typeof objects !== 'object' || Array.isArray(objects)) return false;
  for (const obj of Object.values(objects as Record<string, unknown>)) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && 'fields' in obj) {
      return true;
    }
  }
  return false;
}

/**
 * Transform `TranslationData` (objectstack/spec) into the flat format
 * expected by `useObjectLabel` (object-ui/i18n).
 *
 * The result is wrapped under an `app` namespace key so that
 * `useObjectLabel.getAppNamespaces()` discovers it via the presence
 * of `objects` and `fields` sub-keys.
 */
function transformSpecTranslations(data: Record<string, unknown>): Record<string, unknown> {
  const objects: Record<string, unknown> = {};
  const fields: Record<string, Record<string, string>> = {};
  const fieldOptions: Record<string, Record<string, Record<string, string>>> = {};

  const srcObjects = data.objects as Record<string, any> | undefined;
  if (srcObjects) {
    for (const [objName, objData] of Object.entries(srcObjects)) {
      if (!objData || typeof objData !== 'object') continue;

      // Object-level metadata
      const obj: Record<string, unknown> = { label: objData.label };
      if (objData.pluralLabel) obj.pluralLabel = objData.pluralLabel;
      if (objData.description) obj.description = objData.description;
      objects[objName] = obj;

      // Flatten fields: objects.X.fields.Y.label → fields.X.Y = string
      if (objData.fields && typeof objData.fields === 'object') {
        fields[objName] = {};
        for (const [fieldName, fieldData] of Object.entries(objData.fields as Record<string, any>)) {
          if (fieldData?.label) fields[objName][fieldName] = fieldData.label;
          if (fieldData?.options && typeof fieldData.options === 'object' && Object.keys(fieldData.options).length > 0) {
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
  if (data.apps) appNs.apps = data.apps;
  if (data.messages) appNs.messages = data.messages;
  if (data.validationMessages) appNs.validationMessages = data.validationMessages;
  if (data.dashboards) appNs.dashboards = data.dashboards;
  if (data.globalActions) appNs.globalActions = data.globalActions;

  return { app: appNs };
}
