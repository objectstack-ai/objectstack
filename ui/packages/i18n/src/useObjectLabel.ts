/**
 * @object-ui/i18n - Convention-based Object & Field Label i18n
 *
 * Provides automatic translation resolution for object metadata labels
 * using Salesforce-style convention-based key generation.
 *
 * The app namespace (e.g. "crm") is discovered dynamically from loaded
 * i18next resources — no hardcoded app names in platform code.
 *
 * Convention Rules:
 * | What               | Auto-generated key                              | Fallback              |
 * |--------------------|-------------------------------------------------|-----------------------|
 * | Object label       | {ns}.objects.{objectName}.label                  | objectDef.label       |
 * | Object plural      | {ns}.objects.{objectName}.pluralLabel            | objectDef.pluralLabel, then the object label |
 * | Object description | {ns}.objects.{objectName}.description             | objectDef.description |
 * | Field label        | {ns}.fields.{objectName}.{fieldName}              | field.label           |
 *
 * @module useObjectLabel
 */

import { useMemo } from 'react';
import { useObjectTranslation } from './provider.js';
import { I18N_PROBE_FLAG } from './i18n.js';

/**
 * Built-in Object UI top-level locale keys — not app namespaces.
 * Update this set when new top-level platform translation keys are added
 * to `packages/i18n/src/locales/en.ts` to prevent them from being treated
 * as app namespaces during dynamic namespace discovery.
 */
const BUILTIN_KEYS = new Set([
  'common', 'validation', 'form', 'table', 'grid', 'calendar',
  'list', 'kanban', 'chart', 'dashboard', 'configPanel',
  'appDesigner', 'console', 'errors', 'detail',
]);

/** The translation surface this module binds to, as `useObjectTranslation` hands it over. */
type ObjectTranslation = ReturnType<typeof useObjectTranslation>;

/**
 * Whether `i18n` is a real i18next instance rather than react-i18next's
 * no-instance placeholder.
 *
 * With nothing to bind to, `useTranslation` warns `NO_I18NEXT_INSTANCE` and
 * builds its return value out of a fresh `{}` on every render (`const
 * finalI18n = i18n || {}`, which then feeds that hook's own `useMemo` deps), so
 * the `i18n` we receive has a new identity each render even though nothing
 * about it can have changed.
 *
 * `getResourceBundle` is the probe because it is the only instance member the
 * resolvers below ever touch — via `getAppNamespaces`, the single gate every
 * `t()` call in this module sits behind.
 */
function hasUsableI18nInstance(i18n: ObjectTranslation['i18n'] | undefined): boolean {
  return Boolean(i18n) && typeof i18n?.getResourceBundle === 'function';
}

/**
 * Stand-ins pinned into the memo dependency list while no i18next instance is
 * bound, so the memo in {@link useObjectLabel} actually holds on the
 * no-provider path (objectui#5564). Module-level, so they carry one identity
 * for the lifetime of the process instead of one per render.
 *
 * Substituting them is unobservable rather than merely convenient: every `t()`
 * call in this module sits inside a `for (… of getAppNamespaces())` loop, and
 * `getAppNamespaces()` returns `[]` under exactly {@link hasUsableI18nInstance}
 * — so for as long as the substitution is in effect, the closures cannot read
 * either value at all. `NO_INSTANCE_T` still mirrors react-i18next's own
 * not-ready `t` (honour a string `defaultValue`, otherwise echo the key) so
 * that if that reachability argument ever stops holding, behaviour does not
 * change silently.
 */
const NO_INSTANCE_T = ((key: unknown, options?: { defaultValue?: unknown }) =>
  typeof options?.defaultValue === 'string' ? options.defaultValue : key
) as unknown as ObjectTranslation['t'];

/** @see NO_INSTANCE_T */
const NO_INSTANCE_I18N = Object.freeze({}) as unknown as ObjectTranslation['i18n'];

/**
 * Hook for convention-based auto-resolution of object and field labels.
 *
 * Automatically constructs i18n keys from object/field names and looks up
 * translations, falling back to the plain-string label when no translation exists.
 *
 * The app namespace is discovered dynamically from loaded i18next resources
 * by finding top-level keys that contain an `objects` sub-key.
 *
 * @example
 * ```tsx
 * const { objectLabel, fieldLabel } = useObjectLabel();
 * <h1>{objectLabel(objectDef)}</h1>
 * ```
 */
export function useObjectLabel() {
  const { t: boundT, i18n: boundI18n } = useObjectTranslation();

  // Pin both memo dependencies to module constants while there is no i18next
  // instance to bind to. Without this the memo below never held on exactly the
  // no-provider path `useSafeFieldLabel` advertises: react-i18next rebuilds its
  // return value from a fresh `{}` each render, so `i18n` arrived with a new
  // identity every time and re-keyed every consumer memo this hook feeds
  // (objectui#5564 measured 4 distinct identities across 4 renders). See
  // `hasUsableI18nInstance` for why the substitution cannot be observed.
  //
  // When an instance does appear these become the live values again, so a
  // provider mounting after first render recomputes the object exactly once and
  // resolves real translations from then on.
  const bound = hasUsableI18nInstance(boundI18n);
  const t = bound ? boundT : NO_INSTANCE_T;
  const i18n = bound ? boundI18n : NO_INSTANCE_I18N;

  // Memoize the entire returned object — all closures below reference `t`/`i18n`
  // and stay valid until the language changes. Returning a fresh object on every
  // render was busting downstream `useMemo`/`useCallback` deps in heavy consumers
  // like ListView.filterFields, causing avoidable recomputation.
  return useMemo(() => {

  /**
   * Discover app namespace(s) from loaded i18next resources.
   * Returns top-level keys (outside built-in Object UI keys) that contain
   * an `objects`, `fields`, or `apps` sub-key — e.g. "crm" when resources
   * include crm.objects.* or crm.apps.*.
   *
   * `globalActions` is included so an app bundle whose only translated scope
   * is global actions (no object/field entries) is still discovered — the
   * `globalActions.<action>.*` copy of its object-less actions would otherwise
   * be unreachable (objectui#3372; object-less only since objectui#11439, see
   * `actionSuffixes`).
   */
  const getAppNamespaces = (): string[] => {
    if (!hasUsableI18nInstance(i18n)) return [];
    const lang = i18n.language || 'en';
    const bundle = i18n.getResourceBundle(lang, 'translation') as Record<string, any> | undefined;
    if (!bundle) return [];
    return Object.keys(bundle).filter(
      (key) => !BUILTIN_KEYS.has(key) && bundle[key] && typeof bundle[key] === 'object'
        && (bundle[key].objects || bundle[key].fields || bundle[key].apps
          || bundle[key].dashboards || bundle[key].pages || bundle[key].reports
          || bundle[key].globalActions),
    );
  };

  /**
   * Strip an ObjectStack namespace prefix (e.g. `crm__lead` → `lead`) so that
   * translations authored against short object names still resolve when the
   * runtime presents fully-qualified names. The first `__` separates the
   * package namespace from the base name; everything after is preserved.
   */
  const stripNamespace = (name: string): string => {
    if (typeof name !== 'string') return '';
    const idx = name.indexOf('__');
    return idx > 0 ? name.slice(idx + 2) : name;
  };

  /** Try resolving a key across all discovered app namespaces. */
  const resolve = (suffixes: string | string[], fallback: string): string => {
    const suffixList = Array.isArray(suffixes) ? suffixes : [suffixes];
    try {
      const namespaces = getAppNamespaces();
      for (const ns of namespaces) {
        for (const suffix of suffixList) {
          const key = `${ns}.${suffix}`;
          // `I18N_PROBE_FLAG` marks this as a speculative convention lookup so
          // the dev missing-key warner stays silent when it (expectedly) misses
          // and we fall back to the server-resolved label.
          const translated = t(key, { defaultValue: '', [I18N_PROBE_FLAG]: true });
          if (translated && translated !== key && translated !== '') {
            return translated;
          }
        }
      }
    } catch {
      // Graceful degradation when i18n provider is not available
    }
    return fallback;
  };

  /** Build suffix candidates: prefer the given name, fall back to the base (unprefixed) name. */
  const objectSuffixes = (objectName: string, tail: string): string[] => {
    const base = stripNamespace(objectName);
    return base !== objectName
      ? [`objects.${objectName}.${tail}`, `objects.${base}.${tail}`]
      : [`objects.${objectName}.${tail}`];
  };

  /**
   * Build suffix candidates for an action-scoped key, mirroring the canonical
   * `@objectstack/spec` resolver (`actionTranslationNode` behind
   * `lookupActionField`, in `system/i18n-resolver`): ONE node per action, chosen
   * by its key object.
   *
   * `objectName` is the action's KEY object — the object the action belongs
   * to: its declared `objectName`, else the host object that embeds it, which
   * is what the spec's `translateObject` stamps on an embedded action. Callers
   * pass that object (`useActionTextLocalizer` derives it from the action).
   *
   * - A key object reads `objects.<obj>._actions.<action>.<tail>` and nothing
   *   else.
   * - No key object reads `globalActions.<action>.<tail>` and nothing else.
   *
   * There is deliberately NO object-then-global chain. objectui#3372 added one
   * so `globalActions` copy reached actions drawn on an object's bar; the
   * spec's `TranslationDataSchema.globalActions` is for actions "not bound to a
   * specific object via `objectName`", `@objectstack/spec` 17.7.0 never reads it
   * for a bound action, and objectui#11439 (triage's amended ruling) retired the
   * chain so this client and the server resolve one bundle entry the same way.
   * A bound action's copy filed under `globalActions` now misses on every
   * surface alike and the authored text shows — the misfiling is what
   * `os validate` already refuses, and it is fixed in the bundle, not here.
   *
   * The two object-name candidates (`objects.<ns__obj>` then `objects.<obj>`)
   * are a separate axis and stay — see `stripNamespace`.
   */
  const actionSuffixes = (
    objectName: string | undefined,
    actionName: string,
    tail: string,
  ): string[] =>
    objectName
      ? objectSuffixes(objectName, `_actions.${actionName}.${tail}`)
      : [`globalActions.${actionName}.${tail}`];

  const fieldSuffixes = (objectName: string, fieldName: string): string[] => {
    const base = stripNamespace(objectName);
    return base !== objectName
      ? [`fields.${objectName}.${fieldName}`, `fields.${base}.${fieldName}`]
      : [`fields.${objectName}.${fieldName}`];
  };

  const optionSuffixes = (objectName: string, fieldName: string, optionValue: string): string[] => {
    const base = stripNamespace(objectName);
    return base !== objectName
      ? [
          `fieldOptions.${objectName}.${fieldName}.${optionValue}`,
          `fieldOptions.${base}.${fieldName}.${optionValue}`,
        ]
      : [`fieldOptions.${objectName}.${fieldName}.${optionValue}`];
  };

  /**
   * Build suffix candidates for a dashboard-scoped key. Mirrors the
   * object/field convention: prefer the (possibly namespaced) dashboard name,
   * fall back to the unprefixed base name.
   */
  const dashboardSuffixes = (dashboardName: string, tail: string): string[] => {
    const base = stripNamespace(dashboardName);
    return base !== dashboardName
      ? [`dashboards.${dashboardName}.${tail}`, `dashboards.${base}.${tail}`]
      : [`dashboards.${dashboardName}.${tail}`];
  };

  /**
   * Build suffix candidates for a page-scoped key.
   */
  const pageSuffixes = (pageName: string, tail: string): string[] => {
    const base = stripNamespace(pageName);
    return base !== pageName
      ? [`pages.${pageName}.${tail}`, `pages.${base}.${tail}`]
      : [`pages.${pageName}.${tail}`];
  };

  /**
   * Build suffix candidates for a report-scoped key.
   */
  const reportSuffixes = (reportName: string, tail: string): string[] => {
    const base = stripNamespace(reportName);
    return base !== reportName
      ? [`reports.${reportName}.${tail}`, `reports.${base}.${tail}`]
      : [`reports.${reportName}.${tail}`];
  };

  /**
   * Build suffix candidates for a list-view scoped key.
   *
   * The runtime uses qualified view ids (`<objectName>.<viewName>`) in URLs and
   * metadata records, while translation bundles are keyed by the **bare** view
   * name under `_views` — the runtime view identity's own name, stripped of the
   * object prefix. That single spelling is canonical per the objectstack#5164
   * ruling A (2026-08-06): the i18n extractor asks the view composer for the key
   * (objectstack `b3c1f3cd5`) and `packages/lint` enforces exactly that spelling
   * (objectstack `7618ee814`), so this resolver accepts exactly what those produce.
   *
   * Deliberately NOT a second candidate: the prefixed full name
   * (`_views.<objectName>.<viewName>`). Accepting it made this client more
   * lenient than the server-side resolver, which only ever reads the one key
   * (objectstack#5165) — a bundle authored against the prefixed spelling showed
   * translated labels in the Console while every consumer that does not run a
   * second resolution pass (REST boundary, mobile, plain HTTP, SDUI) still got
   * English. A prefixed key now simply misses, and the label falls back to the
   * metadata default on every surface alike, so the authoring mistake is visible
   * instead of half-hidden. It is caught at authoring time by `os lint`'s
   * `translation-target-unknown`, not papered over here.
   *
   * The object-name candidates (`objects.<ns__obj>` then `objects.<obj>`) are a
   * separate axis and stay: they let bundles written against short object names
   * resolve when the runtime presents fully-qualified ones.
   */
  const viewSuffixes = (objectName: string, viewName: string, tail: string): string[] => {
    const objectNames = [objectName, stripNamespace(objectName)];
    const matchedPrefix = objectNames
      .map((name) => `${name}.`)
      .find((prefix) => viewName.startsWith(prefix));
    const bareViewName = matchedPrefix ? viewName.slice(matchedPrefix.length) : viewName;
    return objectSuffixes(objectName, `_views.${bareViewName}.${tail}`);
  };

  /** The singular object label; `objectPluralLabel` falls back to it. */
  const objectLabel = (objectDef: { name: string; label: string }) =>
    resolve(objectSuffixes(objectDef.name, 'label'), objectDef.label);

  return {
    /**
     * Resolve translated object label, falling back to objectDef.label.
     */
    objectLabel,

    /**
     * Resolve the object's PLURAL label — what a list of its records is called:
     * an object list page's title and the breadcrumb segment that links to that
     * list (objectui#11696). Record-scoped surfaces (the record page, a record
     * drawer, "New …") keep {@link objectLabel}.
     *
     * Order: the translated plural (`{ns}.objects.{objectName}.pluralLabel`),
     * else the declared `objectDef.pluralLabel`, else the singular as
     * `objectLabel` resolves it — `pluralLabel` is optional in the spec, and an
     * object that declares none is called by its label everywhere.
     *
     * The first two rungs are the client half of `translateObject` in
     * `@objectstack/spec` (`system/i18n-resolver`), which serves `pluralLabel`
     * as the catalog entry, else the authored value. There is deliberately NO
     * rung that prefers a translated SINGULAR over a declared plural the bundle
     * leaves untranslated: the server has none either, so every consumer of
     * `/meta` shows the authored plural in that case, and this client showing
     * something else would be a second dialect (see `viewSuffixes`). The gap is
     * the bundle's — `os i18n extract` writes `pluralLabel` wherever the object
     * declares one — and is fixed there.
     */
    objectPluralLabel: (objectDef: { name: string; label: string; pluralLabel?: string }) =>
      resolve(objectSuffixes(objectDef.name, 'pluralLabel'), '')
        || objectDef.pluralLabel
        || objectLabel(objectDef),

    /**
     * Resolve translated object description, falling back to objectDef.description.
     */
    objectDescription: (objectDef: { name: string; description?: string }) => {
      if (!objectDef.description) return undefined;
      return resolve(objectSuffixes(objectDef.name, 'description'), objectDef.description);
    },

    /**
     * Resolve translated field label, falling back to the provided fallback string.
     */
    fieldLabel: (objectName: string, fieldName: string, fallback: string) =>
      resolve(fieldSuffixes(objectName, fieldName), fallback),

    /**
     * Resolve a translated select option label for a given object field.
     * Falls back to the provided fallback (usually the English option label).
     */
    fieldOptionLabel: (objectName: string, fieldName: string, optionValue: string, fallback: string) =>
      resolve(optionSuffixes(objectName, fieldName, optionValue), fallback),

    /**
     * Translate all options for a given field, returning a new options array
     * with translated labels. Pass the objectName and fieldName to look up
     * translations; the original label is used as fallback.
     */
    translateOptions: (
      objectName: string,
      fieldName: string,
      options: Array<{ value: string; label: string; [key: string]: any }>
    ): Array<{ value: string; label: string; [key: string]: any }> =>
      options.map(opt => ({
        ...opt,
        label: resolve(optionSuffixes(objectName, fieldName, opt.value), opt.label),
      })),

    /**
     * Resolve translated app label, falling back to appDef.label.
     * Looks up `{ns}.apps.{appName}.label` from loaded i18next resources.
     */
    appLabel: (appDef: { name: string; label?: string }) =>
      resolve(`apps.${appDef.name}.label`, appDef.label ?? appDef.name),

    /**
     * Resolve translated app description, falling back to appDef.description.
     * Returns the translated value even when metadata has no description —
     * translation-only descriptions (defined only in i18n bundles) are common
     * in examples where the app metadata is English-only.
     */
    appDescription: (appDef: { name: string; description?: string }) => {
      const fallback = appDef.description ?? '';
      const resolved = resolve(`apps.${appDef.name}.description`, fallback);
      return resolved || undefined;
    },

    /**
     * Read `{ns}.apps.{appName}.navigation.{groupId}.label` out of the loaded
     * CLIENT translation resources, falling back to `fallback`.
     *
     * ⚠️ This does NOT localize the sidebar, and adding a translation pack
     * keyed this way will not change a single rendered nav label.
     * **App-navigation localization is owned solely by the server-side
     * `/meta` boundary**: `translateApp` in `@objectstack/spec`
     * (`src/system/i18n-resolver.ts`) rewrites every navigation node's
     * `label` by id, and `@objectstack/rest` applies it before the metadata
     * reaches this client — so nav labels arrive already localized. One
     * owner, not two. To translate a sidebar group, translate it there.
     *
     * History (`9c60144b5`): until then this docstring promised
     * `"Sales" → "销售"` for sidebar groups, and `NavigationRenderer`
     * accepted `resolveGroupLabel`/`resolveItemLabel` to wire it up. Those
     * props could never fire — the renderer's `isCustomized` guard compared a
     * node's authored label against its own `id` (`Workspace` vs
     * `grp_workspace`), which never match, so the guard was true for every
     * real entry. The props are gone, and so is the guard itself
     * (objectui#11201: the renderer no longer matches a label's text against
     * any name); the promise was false, not merely unused. This helper is kept
     * as a plain key reader for a consumer that renders navigation itself — it
     * has no first-party caller.
     */
    navGroupLabel: (appName: string, groupId: string, fallback: string) =>
      resolve(`apps.${appName}.navigation.${groupId}.label`, fallback),

    /**
     * Resolve translated dashboard label, falling back to dashboardDef.label.
     * Convention: `{ns}.dashboards.{dashboardName}.label`.
     */
    dashboardLabel: (dashboardDef: { name: string; label?: string }) =>
      resolve(dashboardSuffixes(dashboardDef.name, 'label'), dashboardDef.label ?? dashboardDef.name),

    /**
     * Resolve translated dashboard description, falling back to
     * dashboardDef.description. Returns undefined when neither metadata nor
     * translation provides one.
     * Convention: `{ns}.dashboards.{dashboardName}.description`.
     */
    dashboardDescription: (dashboardDef: { name: string; description?: string }) => {
      const fallback = dashboardDef.description ?? '';
      const resolved = resolve(dashboardSuffixes(dashboardDef.name, 'description'), fallback);
      return resolved || undefined;
    },

    /**
     * Resolve translated dashboard header-action label.
     * Convention: `{ns}.dashboards.{dashboardName}.actions.{actionKey}.label`.
     * The actionKey is typically the action's `actionUrl` (e.g.
     * `create_opportunity`) or its English label slugified.
     */
    dashboardActionLabel: (dashboardName: string, actionKey: string, fallback: string) =>
      resolve(dashboardSuffixes(dashboardName, `actions.${actionKey}.label`), fallback),

    /**
     * Resolve translated widget title within a dashboard.
     * Convention: `{ns}.dashboards.{dashboardName}.widgets.{widgetId}.title`.
     */
    widgetTitle: (dashboardName: string, widgetId: string, fallback: string) =>
      resolve(dashboardSuffixes(dashboardName, `widgets.${widgetId}.title`), fallback),

    /**
     * Resolve translated widget description within a dashboard.
     * Convention: `{ns}.dashboards.{dashboardName}.widgets.{widgetId}.description`.
     * Returns undefined when neither metadata nor translation provides one.
     *
     * This is a widget's ONE translated description. The sibling sub-caption
     * key, `widgets.{widgetId}.subCaption`, is retired with its resolver
     * (objectui#11389, ruling C): `@objectstack/spec` 17.7.0 refuses it by
     * name in a translation bundle, and nothing here reads it.
     */
    widgetDescription: (dashboardName: string, widgetId: string, fallback?: string) => {
      const fb = fallback ?? '';
      const resolved = resolve(dashboardSuffixes(dashboardName, `widgets.${widgetId}.description`), fb);
      return resolved || undefined;
    },

    /**
     * Resolve translated page label, falling back to pageDef.label.
     * Convention: `{ns}.pages.{pageName}.label`.
     */
    pageLabel: (pageDef: { name: string; label?: string }) =>
      resolve(pageSuffixes(pageDef.name, 'label'), pageDef.label ?? pageDef.name),

    /**
     * Resolve translated report label, falling back to reportDef.label.
     * Convention: `{ns}.reports.{reportName}.label`.
     */
    reportLabel: (reportDef: { name: string; label?: string }) =>
      resolve(reportSuffixes(reportDef.name, 'label'), reportDef.label ?? reportDef.name),

    /**
     * Resolve translated list-view label.
     * Convention (per @objectstack/spec): `{ns}.objects.{objectName}._views.{viewName}.label`,
     * where `{viewName}` is the **bare** view name — pass either the bare name or
     * the qualified runtime id, the object prefix is stripped either way. A key
     * that spells the prefix out does not resolve (see `viewSuffixes`).
     */
    viewLabel: (objectName: string, viewName: string, fallback: string) =>
      resolve(viewSuffixes(objectName, viewName, 'label'), fallback),

    /*
     * There is deliberately NO `viewDescription` member here, and no
     * `{ns}.objects.{objectName}._views.{viewName}.description` convention for
     * it to resolve (objectui#7219, maintainer ruling 2026-09-02, option B).
     *
     * A list view's description has exactly ONE channel: the `I18nLabel` value
     * authored on the view entry -- a string or an inline locale map -- which
     * `ObjectView` relays and the render site resolves with `pickLocalized`
     * (objectui#7199). The catalog key used to be declared and resolved right
     * here, between its two wired-up siblings, but had zero callers and zero
     * in-repo bundle usage: a bundle entry written under it reached no screen.
     *
     * Wiring it in instead was weighed and NOT taken -- two vocabularies for
     * one concept plus a precedence rule is the ambiguity, not the fix. Leaving
     * it declared and unfulfilled was not taken either; the standing rule is
     * remove, not phase out, when a surface has measured zero use.
     *
     * `viewSuffixes` is NOT retired with it: `viewLabel` above and
     * `viewEmptyState` below share that helper and keep resolving. Only the
     * `'description'` tail passed to it is gone.
     */

    /**
     * Resolve translated list-view emptyState. Returns a {title, message}
     * tuple with each field independently translated. Convention:
     *   `{ns}.objects.{objectName}._views.{viewName}.emptyState.title`
     *   `{ns}.objects.{objectName}._views.{viewName}.emptyState.message`
     */
    viewEmptyState: (
      objectName: string,
      viewName: string,
      fallback: { title?: string; message?: string; icon?: string } | undefined,
    ) => {
      if (!fallback) return undefined;
      const title = fallback.title
        ? resolve(viewSuffixes(objectName, viewName, 'emptyState.title'), fallback.title)
        : fallback.title;
      const message = fallback.message
        ? resolve(viewSuffixes(objectName, viewName, 'emptyState.message'), fallback.message)
        : fallback.message;
      return { ...fallback, title, message };
    },

    /**
     * Resolve translated form-section label.
     * Convention: `{ns}.objects.{objectName}._sections.{sectionName}.label`.
     */
    sectionLabel: (objectName: string, sectionName: string, fallback: string) =>
      resolve(objectSuffixes(objectName, `_sections.${sectionName}.label`), fallback),

    /**
     * Resolve translated action label.
     * `objectName` is the action's KEY object (its declared `objectName`, else
     * the host that embeds it). Convention:
     * `{ns}.objects.{objectName}._actions.{actionName}.label`; with no key
     * object, `{ns}.globalActions.{actionName}.label`. Never both: a bound
     * action does not read `globalActions` (objectui#11439, see
     * `actionSuffixes`). Every action resolver below follows the same rule.
     */
    actionLabel: (objectName: string | undefined, actionName: string, fallback: string) =>
      resolve(actionSuffixes(objectName, actionName, 'label'), fallback),

    /**
     * Resolve translated action confirmation prompt.
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.confirmText`;
     * with no key object, `{ns}.globalActions.{actionName}.confirmText`.
     * Returns undefined when no translation and no fallback exist.
     */
    actionConfirm: (objectName: string | undefined, actionName: string, fallback?: string) => {
      const fb = fallback ?? '';
      const resolved = resolve(actionSuffixes(objectName, actionName, 'confirmText'), fb);
      return resolved || undefined;
    },

    /**
     * Resolve translated action success message.
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.successMessage`;
     * with no key object, `{ns}.globalActions.{actionName}.successMessage`.
     */
    actionSuccess: (objectName: string | undefined, actionName: string, fallback?: string) => {
      const fb = fallback ?? '';
      const resolved = resolve(actionSuffixes(objectName, actionName, 'successMessage'), fb);
      return resolved || undefined;
    },

    /**
     * Resolve the translated success copy for ONE handler outcome — an entry of
     * the action's `outcomeMessages` (`@objectstack/spec` 17.6.0, objectui#11344).
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.outcomeMessages.{outcome}`;
     * with no key object, `{ns}.globalActions.{actionName}.outcomeMessages.{outcome}`
     * — the addresses the spec's translation bundle declares for the key.
     * Returns undefined when no translation and no fallback exist.
     *
     * Like `actionSuccess`, the answer is a TEMPLATE: a `${result.*}` token in a
     * bundle entry passes through untouched (i18next interpolates its own
     * `{{…}}` form, never `${…}`), and the action runner fills it in from the
     * handler's answer once the action has run.
     */
    actionOutcome: (
      objectName: string | undefined,
      actionName: string,
      outcome: string,
      fallback?: string,
    ) => {
      const fb = fallback ?? '';
      const resolved = resolve(actionSuffixes(objectName, actionName, `outcomeMessages.${outcome}`), fb);
      return resolved || undefined;
    },

    /**
     * Resolve translated action description (the explanatory line shown in the
     * action's param dialog / sheet / drawer header).
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.description`;
     * with no key object, `{ns}.globalActions.{actionName}.description`. Falls
     * back to the metadata's literal string; undefined when nothing resolves.
     */
    actionDescription: (objectName: string | undefined, actionName: string | undefined, fallback?: string) => {
      const fb = fallback ?? '';
      if (!actionName) return fb || undefined;
      const resolved = resolve(actionSuffixes(objectName, actionName, 'description'), fb);
      return resolved || undefined;
    },

    /**
     * Resolve a translated copy of an action's post-success RESULT DIALOG
     * (`title` / `description` / `acknowledge` + per-field labels).
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.resultDialog.*`;
     * with no key object, `{ns}.globalActions.{actionName}.resultDialog.*`.
     * Falls back to the metadata's literal strings.
     *
     * The `fields` translation node is keyed by the LITERAL result-field path
     * from the action metadata (may contain dots, e.g. `"user.email"`), so it
     * is fetched whole with `returnObjects` and indexed directly — never
     * resolved through a dotted i18next key.
     */
    actionResultDialog: <T extends {
      title?: string;
      description?: string;
      acknowledge?: string;
      fields?: Array<{ path: string; label?: string; [key: string]: any }>;
    }>(
      objectName: string | undefined,
      actionName: string | undefined,
      spec: T | undefined,
    ): T | undefined => {
      if (!spec || !actionName) return spec;
      const suffixesFor = (attr: string): string[] =>
        actionSuffixes(objectName, actionName, `resultDialog.${attr}`);
      const textFor = (attr: 'title' | 'description' | 'acknowledge'): string | undefined => {
        const resolved = resolve(suffixesFor(attr), spec[attr] ?? '');
        return resolved || spec[attr];
      };
      const fieldsMap = ((): Record<string, unknown> | undefined => {
        try {
          for (const ns of getAppNamespaces()) {
            for (const suffix of suffixesFor('fields')) {
              const node = t(`${ns}.${suffix}`, {
                returnObjects: true,
                defaultValue: null,
                [I18N_PROBE_FLAG]: true,
              }) as unknown;
              if (node && typeof node === 'object' && !Array.isArray(node)) {
                return node as Record<string, unknown>;
              }
            }
          }
        } catch {
          // Graceful degradation when i18n provider is not available
        }
        return undefined;
      })();
      const fields = Array.isArray(spec.fields)
        ? spec.fields.map((field) => {
            if (!field || typeof field.path !== 'string') return field;
            const label = fieldsMap?.[field.path];
            return typeof label === 'string' && label.length > 0 ? { ...field, label } : field;
          })
        : spec.fields;
      return {
        ...spec,
        title: textFor('title'),
        description: textFor('description'),
        acknowledge: textFor('acknowledge'),
        fields,
      };
    },

    /**
     * Resolve translated action-PARAMETER text (label / placeholder / helpText).
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.params.{paramName}.{attr}`;
     * with no key object, `{ns}.globalActions.{actionName}.params.{paramName}.{attr}`.
     * Falls back to the provided value (the metadata's literal string) when no
     * translation exists, so untranslated params keep rendering as authored.
     */
    actionParamText: (
      objectName: string | undefined,
      actionName: string | undefined,
      paramName: string,
      attr: 'label' | 'placeholder' | 'helpText',
      fallback?: string,
    ) => {
      const fb = fallback ?? '';
      if (!actionName || !paramName) return fb || undefined;
      const resolved = resolve(
        actionSuffixes(objectName, actionName, `params.${paramName}.${attr}`),
        fb,
      );
      return resolved || undefined;
    },
    /**
     * Resolve a translated action-parameter SELECT OPTION label.
     * Convention: `{ns}.objects.{objectName}._actions.{actionName}.params.{paramName}.options.{optionValue}`;
     * with no key object, the same path under `{ns}.globalActions.{actionName}`.
     * Falls back to the provided (English metadata) label when untranslated.
     */
    actionParamOptionLabel: (
      objectName: string | undefined,
      actionName: string | undefined,
      paramName: string,
      optionValue: string,
      fallback: string,
    ) => {
      if (!actionName || !paramName) return fallback;
      return resolve(
        actionSuffixes(objectName, actionName, `params.${paramName}.options.${optionValue}`),
        fallback,
      );
    },
  };
  }, [t, i18n]);
}

/**
 * Stable identity fallbacks for `useSafeFieldLabel` — referenced from a
 * module-level constant so consumers using the fallback branch don't get a
 * fresh object reference on every render (which would invalidate downstream
 * memoization in heavy components like ListView).
 */
const SAFE_FIELD_LABEL_FALLBACK = {
  fieldLabel: (_objectName: string, _fieldName: string, fallback: string) => fallback,
  translateOptions: (
    _objectName: string,
    _fieldName: string,
    options: Array<{ value: string; label: string; [key: string]: any }>
  ) => options,
  fieldOptionLabel: (_objectName: string, _fieldName: string, _optionValue: string, fallback: string) => fallback,
  sectionLabel: (_objectName: string, _sectionName: string, fallback: string) => fallback,
  actionLabel: (_objectName: string | undefined, _actionName: string, fallback: string) => fallback,
};

/**
 * Safe wrapper for useObjectLabel that falls back to identity functions
 * when no I18nProvider is available. Suitable for plugin components that
 * may be rendered outside an i18n context.
 */
export function useSafeFieldLabel() {
  // useObjectLabel delegates to the provider-safe useObjectTranslation (react-
  // i18next falls back to the global instance and never throws), so it needs no
  // try/catch — wrapping the hook call would violate rules-of-hooks. Its memo
  // now holds with or without an i18next instance, so the object below is
  // stable on both paths — it was NOT before objectui#5564, which measured a
  // fresh object every render outside a provider, i.e. the opposite of what
  // this wrapper advertises. The module-level fallback stays as a defensive
  // default, reached only if it ever returns nullish.
  return useObjectLabel() ?? SAFE_FIELD_LABEL_FALLBACK;
}
