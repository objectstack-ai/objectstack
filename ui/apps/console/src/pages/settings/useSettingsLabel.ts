/**
 * useSettingsLabel — convention-based i18n hook for SettingsView/SettingsField.
 *
 * Mirrors `@object-ui/i18n`'s `useObjectLabel` pattern: discovers any
 * top-level i18next namespace that contains a `settings` branch and
 * resolves keys following the standard convention authored against the
 * `TranslationData.settings.<namespace>.…` tree.
 *
 *   settings.<namespace>.title
 *   settings.<namespace>.description
 *   settings.<namespace>.groups.<groupKey>.title / .description
 *   settings.<namespace>.keys.<key>.label / .help / .placeholder
 *   settings.<namespace>.keys.<key>.options.<value>
 *   settings.<namespace>.actions.<actionId>.label / .confirmText / .successMessage
 *   settings.<namespace>.banners.<bannerId>.title / .text
 *
 * `banners.<bannerId>` is keyed by an `info_banner` specifier's `id`: `title`
 * translates its `label` and `text` its `bannerText` (objectstack#23886, read
 * by `resolveSettingsBannerTitle` / `resolveSettingsBannerText` in the spec's
 * `i18n-resolver.ts`). That slot is the ONE spelling: no other leaf or branch
 * name for a banner is read here (objectui#12671).
 *
 * All lookups fall back to the literal authored in the manifest, so an
 * unconfigured locale gracefully degrades to English (or whatever the
 * plugin author shipped).
 */

import { useMemo } from 'react';
import { useObjectTranslation } from '@object-ui/i18n';

/** Top-level i18next namespaces we never treat as candidate roots. */
const BUILTIN_KEYS = new Set([
  'common',
  'validation',
  'errors',
  'system',
  'auth',
]);

export interface SettingsLabelHelpers {
  title: (fallback: string) => string;
  description: (fallback: string | undefined) => string | undefined;
  groupTitle: (groupKey: string, fallback: string) => string;
  groupDescription: (groupKey: string, fallback: string | undefined) => string | undefined;
  fieldLabel: (key: string, fallback: string) => string;
  fieldHelp: (key: string, fallback: string | undefined) => string | undefined;
  fieldPlaceholder: (key: string, fallback: string | undefined) => string | undefined;
  optionLabel: (key: string, optionValue: string, fallback: string) => string;
  actionLabel: (actionId: string, fallback: string) => string;
  actionConfirm: (actionId: string, fallback: string | undefined) => string | undefined;
  actionSuccess: (actionId: string, fallback: string | undefined) => string | undefined;
  /** An `info_banner` title, keyed by the specifier's `id`; falls back to its `label`. */
  bannerTitle: (bannerId: string, fallback: string) => string;
  /** An `info_banner` body, keyed by the specifier's `id`; falls back to its `bannerText`. */
  bannerText: (bannerId: string, fallback: string | undefined) => string | undefined;
  /** Human label for a `ResolvedSettingValue.source` (env/global/tenant/user/default). */
  sourceLabel: (source: 'env' | 'global' | 'tenant' | 'user' | 'default') => string;
}

/**
 * Build a SettingsLabelHelpers bound to a given settings `namespace`
 * (e.g. `'mail'`, `'branding'`).
 */
export function useSettingsLabel(namespace: string): SettingsLabelHelpers {
  const { t, i18n } = useObjectTranslation();

  return useMemo<SettingsLabelHelpers>(() => {
    const discoverNamespaces = (): string[] => {
      if (!i18n || typeof i18n.getResourceBundle !== 'function') return [];
      const lang = i18n.language || 'en';
      const bundle = i18n.getResourceBundle(lang, 'translation') as
        | Record<string, unknown>
        | undefined;
      if (!bundle) return [];
      return Object.keys(bundle).filter(
        (key) =>
          !BUILTIN_KEYS.has(key) &&
          bundle[key] &&
          typeof bundle[key] === 'object' &&
          (bundle[key] as Record<string, unknown>).settings,
      );
    };

    const resolve = (suffix: string, fallback: string | undefined): string | undefined => {
      if (!namespace) return fallback;
      try {
        const namespaces = discoverNamespaces();
        for (const ns of namespaces) {
          const key = `${ns}.settings.${namespace}.${suffix}`;
          // objectui#11801 — a probe is a CONVENTION lookup, so a miss is the
          // design working (the manifest literal renders), not a missing
          // string. Ask i18next whether the key exists first: `exists()`
          // never reaches the dev missing-key handler, while a `t()` miss
          // logs one "Missing translation" warning per key. Discovery admits
          // built-in groups whose `settings` member is a menu label
          // (`workspace`, `sidebar`, `user`) or another page's strings
          // (`organization`), and the server translates `label`/`help` but
          // not every option, so most probes here miss on purpose.
          // `useObjectLabel` excludes its own convention probes the same way.
          if (!i18n.exists(key)) continue;
          const translated = t(key, { defaultValue: '' });
          if (translated && translated !== key && translated !== '') {
            return translated;
          }
        }
      } catch {
        // Graceful degradation when i18n provider is unavailable.
      }
      return fallback;
    };

    /** Cross-namespace lookup under `<ns>.settingsCommon.<suffix>`. */
    const resolveCommon = (suffix: string, fallback: string): string => {
      try {
        if (!i18n || typeof i18n.getResourceBundle !== 'function') return fallback;
        const lang = i18n.language || 'en';
        const bundle = i18n.getResourceBundle(lang, 'translation') as
          | Record<string, unknown>
          | undefined;
        if (!bundle) return fallback;
        for (const ns of Object.keys(bundle)) {
          if (BUILTIN_KEYS.has(ns)) continue;
          const root = bundle[ns];
          if (!root || typeof root !== 'object') continue;
          if (!('settingsCommon' in (root as object))) continue;
          const key = `${ns}.settingsCommon.${suffix}`;
          const translated = t(key, { defaultValue: '' });
          if (translated && translated !== key && translated !== '') return translated;
        }
      } catch {
        // Fall through.
      }
      return fallback;
    };

    const SOURCE_FALLBACKS = {
      env: 'Env',
      global: 'Global',
      tenant: 'Tenant',
      user: 'User',
      default: 'Default',
    } as const;

    return {
      title: (fallback) => resolve('title', fallback) ?? fallback,
      description: (fallback) => resolve('description', fallback),
      groupTitle: (groupKey, fallback) =>
        resolve(`groups.${groupKey}.title`, fallback) ?? fallback,
      groupDescription: (groupKey, fallback) =>
        resolve(`groups.${groupKey}.description`, fallback),
      fieldLabel: (key, fallback) => resolve(`keys.${key}.label`, fallback) ?? fallback,
      fieldHelp: (key, fallback) => resolve(`keys.${key}.help`, fallback),
      fieldPlaceholder: (key, fallback) => resolve(`keys.${key}.placeholder`, fallback),
      optionLabel: (key, optionValue, fallback) =>
        resolve(`keys.${key}.options.${optionValue}`, fallback) ?? fallback,
      actionLabel: (actionId, fallback) =>
        resolve(`actions.${actionId}.label`, fallback) ?? fallback,
      actionConfirm: (actionId, fallback) =>
        resolve(`actions.${actionId}.confirmText`, fallback),
      actionSuccess: (actionId, fallback) =>
        resolve(`actions.${actionId}.successMessage`, fallback),
      bannerTitle: (bannerId, fallback) =>
        resolve(`banners.${bannerId}.title`, fallback) ?? fallback,
      bannerText: (bannerId, fallback) => resolve(`banners.${bannerId}.text`, fallback),
      sourceLabel: (source) =>
        resolveCommon(`sourceLabels.${source}`, SOURCE_FALLBACKS[source] ?? source),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, t, i18n, i18n?.language]);
}
